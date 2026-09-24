const Dispute = require("../models/dispute");
const Order = require("../models/order");
const Product = require("../models/product");
const refund = require("./refund");
const incidents = require("./incidents");
const { safeReconcile } = require("./reconcile");

const STUCK_AFTER_MS = 10 * 60 * 1000;

// Every step below is idempotent, so a dispute stuck in "Resolving" (crash, Stripe outage)
// can simply be finished again by the expiry sweep.
const finishDispute = async (d) => {
  // 1. Money: partial refund for the units the customer no longer wants / cannot get.
  if (d.refundAmount > 0) {
    await refund.refundAmount(d.paymentIntentId, d.refundAmount, `dispute_${d._id}`);
  }

  // 2. Stock: put back the held units that are not kept. The flag flips first so a crash can
  //    leak a few units but can never release the same units twice (overselling).
  const claim = await Dispute.findOneAndUpdate(
    { _id: d._id, stockReleased: false },
    { $set: { stockReleased: true } }
  );
  const toRelease = d.reservedQuantity - d.resolvedQuantity;
  if (claim && toRelease > 0) {
    await Product.updateOne({ _id: d.productId }, { $inc: { stock: toRelease } });
  }

  // 3. Order: set the line, then recompute totals from the lines in one atomic update.
  await Order.updateOne(
    { _id: d.orderId, "productsOrdered._id": d.lineId },
    {
      $set: {
        "productsOrdered.$.quantity": d.resolvedQuantity,
        "productsOrdered.$.subtotal": d.resolvedQuantity * d.unitPrice,
        "productsOrdered.$.lineStatus": d.resolvedQuantity === 0 ? "Cancelled" : "Adjusted",
        "productsOrdered.$.refundedAmount": d.refundAmount,
      },
    }
  );
  await Order.updateOne({ _id: d.orderId }, [
    {
      $set: {
        // Charged amount still standing: kept units, plus the full requested amount for any
        // line whose dispute is still open.
        totalPrice: {
          $sum: {
            $map: {
              input: "$productsOrdered",
              as: "l",
              in: {
                $multiply: [
                  {
                    $cond: [
                      { $eq: ["$$l.lineStatus", "Disputed"] },
                      "$$l.requestedQuantity",
                      "$$l.quantity",
                    ],
                  },
                  { $ifNull: ["$$l.unitPrice", 0] },
                ],
              },
            },
          },
        },
        refundedAmount: { $sum: "$productsOrdered.refundedAmount" },
      },
    },
  ]);

  // 4. Done.
  await Dispute.updateOne(
    { _id: d._id },
    { $set: { status: "Resolved", resolvedAt: new Date() } }
  );
  await incidents.resolve("dispute-stuck", d._id);
};

// Customer (or system) resolves an open dispute. `action` is "cancel" or "reduce".
// Returns { ok, dispute } or { ok:false, code, message }.
module.exports.resolveDispute = async ({ id, userId, action, quantity, expired = false }) => {
  const filter = { _id: id };
  if (userId) filter.userId = String(userId);

  const found = await Dispute.findOne(filter);
  if (!found) return { ok: false, code: 404, message: "Dispute not found" };
  if (found.status !== "Open") {
    return { ok: false, code: 409, message: "This dispute has already been resolved" };
  }

  let keep;
  let resolution;
  if (action === "cancel") {
    keep = 0;
    resolution = expired ? "expired" : "cancelled";
  } else if (action === "reduce") {
    keep = Number(quantity);
    if (!Number.isInteger(keep) || keep < 1 || keep > found.reservedQuantity) {
      return {
        ok: false,
        code: 400,
        message: `Quantity must be a whole number from 1 to ${found.reservedQuantity} (the units being held for you)`,
      };
    }
    resolution = "reduced";
  } else {
    return { ok: false, code: 400, message: 'action must be "cancel" or "reduce"' };
  }

  // Atomic claim: only one caller can move Open -> Resolving; the decision is stored so
  // the sweep can finish it if this request dies half way.
  const claimed = await Dispute.findOneAndUpdate(
    { _id: found._id, status: "Open" },
    {
      $set: {
        status: "Resolving",
        resolution,
        resolvedQuantity: keep,
        refundAmount: (found.requestedQuantity - keep) * found.unitPrice,
        resolvingSince: new Date(),
      },
    },
    { new: true }
  );
  if (!claimed) {
    return { ok: false, code: 409, message: "This dispute has already been resolved" };
  }

  try {
    await finishDispute(claimed);
  } catch (err) {
    // Leave it Resolving with the decision saved; the sweep retries idempotently.
    await incidents.report(
      "dispute-stuck",
      claimed._id,
      `Dispute ${claimed._id} not fully finished, will retry: ${err.message}`
    );
    return {
      ok: false,
      code: 502,
      message: "Your choice was saved but the refund is still processing. It will complete shortly.",
    };
  }
  return { ok: true, dispute: await Dispute.findById(claimed._id) };
};

// Run at boot and every few minutes: auto-cancel expired open disputes (refund + release the
// held units) and finish any that got stuck half way.
module.exports.expireDisputes = async () => {
  const now = new Date();
  const expired = await Dispute.find({ status: "Open", expiresAt: { $lte: now } });
  for (const d of expired) {
    await module.exports.resolveDispute({ id: d._id, action: "cancel", expired: true });
  }
  const stuck = await Dispute.find({
    status: "Resolving",
    resolvingSince: { $lte: new Date(now.getTime() - STUCK_AFTER_MS) },
  });
  for (const d of stuck) {
    try {
      await finishDispute(d);
    } catch (err) {
      await incidents.report("dispute-stuck", d._id, `Dispute ${d._id} still stuck: ${err.message}`);
    }
  }

  // Refunds owed on orders (lines that were unavailable at order time) that never went through.
  const owed = await Order.find({ pendingRefund: { $gt: 0 } }).limit(50);
  for (const order of owed) {
    await safeReconcile(order);
  }

  return { expired: expired.length, retried: stuck.length, refundsRetried: owed.length };
};
