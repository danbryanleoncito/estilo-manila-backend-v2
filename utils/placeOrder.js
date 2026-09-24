const Order = require("../models/order");
const Cart = require("../models/cart");
const Product = require("../models/product");
const Dispute = require("../models/dispute");
const { recomputeCartTotal } = require("./cartTotal");
const { reserveStock, releaseStock, reserveUpTo } = require("./stock");
const refund = require("./refund");
const { findShortages: findAllShortages } = require("./stock");
const { reconcileOrder, safeReconcile } = require("./reconcile");
const { MAX_QTY_PER_LINE } = require("./limits");

const DISPUTE_TTL_MS = 24 * 60 * 60 * 1000;

module.exports.reconcileOrder = reconcileOrder;

// COD / all-or-nothing: every line must be fully in stock or nothing is placed. Shared
// with the older cart-based path.
module.exports.placeOrderFromCart = async ({
  userId,
  cart,
  paymentStatus,
  paymentMethod,
  paymentIntentId,
}) => {
  const overCap = cart.cartItems.filter((i) => i.quantity > MAX_QTY_PER_LINE);
  if (overCap.length > 0) {
    return {
      ok: false,
      shortages: overCap.map((i) => ({
        productId: String(i.productId),
        requested: i.quantity,
        available: MAX_QTY_PER_LINE,
      })),
    };
  }

  // A missing/archived product is a shortage (409), not an exception from the price lookup.
  const unavailable = await findAllShortages(cart.cartItems);
  if (unavailable.length > 0) return { ok: false, shortages: unavailable };

  const totalPrice = await recomputeCartTotal(cart.cartItems);

  const reservation = await reserveStock(cart.cartItems);
  if (!reservation.ok) {
    return { ok: false, shortages: reservation.shortages };
  }

  const products = await Product.find(
    { _id: { $in: cart.cartItems.map((i) => i.productId) } },
    "name"
  );
  const nameOf = Object.fromEntries(products.map((p) => [String(p._id), p.name]));

  const orderData = {
    userId,
    productsOrdered: cart.cartItems.map((i) => ({
      productId: String(i.productId),
      name: nameOf[String(i.productId)],
      quantity: i.quantity,
      subtotal: i.subtotal,
      unitPrice: i.quantity ? i.subtotal / i.quantity : 0,
      requestedQuantity: i.quantity,
      lineStatus: "Fulfilled",
    })),
    totalPrice,
    paymentStatus,
    paymentMethod,
  };
  // Omit the field entirely for COD (see the note on Order.paymentIntentId).
  if (paymentIntentId) orderData.paymentIntentId = paymentIntentId;

  let order;
  try {
    order = await new Order(orderData).save();
  } catch (err) {
    await releaseStock(cart.cartItems);
    if (err.code === 11000 && paymentIntentId) {
      const existing = await Order.findOne({ paymentIntentId });
      if (existing) return { ok: true, order: existing, alreadyPlaced: true };
    }
    throw err;
  }

  await Cart.findOneAndDelete({ userId });
  return { ok: true, order };
};

// Card payments, built from the snapshot taken when the intent was created (so the order
// always matches what was charged). Partial fulfilment is allowed:
//   fully available   -> Fulfilled line
//   partly available  -> Disputed line: the available units are held for the customer
//   none available    -> Cancelled line, refunded immediately
// If nothing at all is available the whole payment is refunded and no order is created.
module.exports.placeOrderFromSnapshot = async ({
  userId,
  snapshot,
  paymentIntentId,
}) => {
  const taken = [];
  const lines = [];
  for (const item of snapshot.items) {
    const got = await reserveUpTo(item.productId, item.quantity);
    if (got > 0) taken.push({ productId: item.productId, quantity: got });
    lines.push({ item, got });
  }

  if (taken.length === 0) {
    await refund.refundPayment(paymentIntentId);
    return {
      ok: false,
      shortages: lines.map(({ item }) => ({
        productId: String(item.productId),
        name: item.name,
        requested: item.quantity,
        available: 0,
      })),
    };
  }

  let instantRefund = 0;
  const productsOrdered = lines.map(({ item, got }) => {
    const base = {
      productId: String(item.productId),
      name: item.name,
      unitPrice: item.unitPrice,
      requestedQuantity: item.quantity,
    };
    if (got === item.quantity) {
      return { ...base, quantity: got, subtotal: got * item.unitPrice, lineStatus: "Fulfilled" };
    }
    if (got > 0) {
      return { ...base, quantity: got, subtotal: got * item.unitPrice, lineStatus: "Disputed" };
    }
    const lineAmount = item.quantity * item.unitPrice;
    instantRefund += lineAmount;
    return {
      ...base,
      quantity: 0,
      subtotal: 0,
      lineStatus: "Cancelled",
      refundedAmount: lineAmount,
    };
  });

  const order = new Order({
    userId,
    productsOrdered,
    totalPrice: snapshot.amount - instantRefund,
    refundedAmount: instantRefund,
    pendingRefund: instantRefund,
    paymentStatus: "Paid",
    paymentMethod: "card",
    paymentIntentId,
  });

  // Disputes are written before the order so a crash can never leave a Disputed line whose
  // held stock has no dispute to release it.
  const disputes = [];
  order.productsOrdered.forEach((line, idx) => {
    if (lines[idx].got > 0 && lines[idx].got < lines[idx].item.quantity) {
      disputes.push({
        orderId: order._id,
        userId,
        productId: String(lines[idx].item.productId),
        productName: lines[idx].item.name,
        lineId: line._id,
        paymentIntentId,
        unitPrice: lines[idx].item.unitPrice,
        requestedQuantity: lines[idx].item.quantity,
        reservedQuantity: lines[idx].got,
        expiresAt: new Date(Date.now() + DISPUTE_TTL_MS),
      });
    }
  });
  if (disputes.length > 0) await Dispute.insertMany(disputes);

  try {
    await order.save();
  } catch (err) {
    await Dispute.deleteMany({ orderId: order._id });
    await releaseStock(taken);
    if (err.code === 11000) {
      const existing = await Order.findOne({ paymentIntentId });
      if (existing) {
        await safeReconcile(existing);
        return { ok: true, order: existing, alreadyPlaced: true };
      }
    }
    throw err;
  }

  // The order exists and the customer has paid, so nothing below may turn this into an error:
  // clear the cart first, and a refund that fails is recorded and retried by the sweep.
  await Cart.findOneAndDelete({ userId });
  await safeReconcile(order);
  return { ok: true, order, disputesOpened: disputes.length };
};

// Retry path: the order was saved but the process died before the cart was cleared. Empty the
// cart only if everything in it was part of that order, so items the customer has added since
// are never thrown away.
module.exports.clearCartIfPurchased = async (userId, order) => {
  const cart = await Cart.findOne({ userId });
  if (!cart || cart.cartItems.length === 0) return;
  const ordered = new Set(order.productsOrdered.map((l) => String(l.productId)));
  if (cart.cartItems.every((i) => ordered.has(String(i.productId)))) {
    await Cart.deleteOne({ _id: cart._id });
  }
};
