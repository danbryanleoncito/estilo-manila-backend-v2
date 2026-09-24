const helpers = require("./helpers");
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mongoose } = helpers;
const refund = require("../utils/refund");
const Product = require("../models/product");
const Order = require("../models/order");
const Dispute = require("../models/dispute");
const Incident = require("../models/incident");
const { resolveDispute, expireDisputes } = require("../utils/disputes");

const USER = "u1";
const PI = "pi_dispute";
let stripe;

// A paid order for 5 units of a 100-peso product, of which 4 could be held: an open dispute.
async function seedDispute({ expiresAt } = {}) {
  const product = await Product.create({
    name: "Cargo Pants",
    description: "d",
    price: 100,
    image: "http://x/y.png",
    stock: 0, // the 4 held units are already out of stock
  });
  const order = await Order.create({
    userId: USER,
    productsOrdered: [
      {
        productId: String(product._id),
        name: "Cargo Pants",
        quantity: 4,
        requestedQuantity: 5,
        unitPrice: 100,
        subtotal: 400,
        lineStatus: "Disputed",
      },
    ],
    totalPrice: 500,
    paymentStatus: "Paid",
    paymentMethod: "card",
    paymentIntentId: PI,
  });
  const dispute = await Dispute.create({
    orderId: order._id,
    userId: USER,
    productId: String(product._id),
    productName: "Cargo Pants",
    lineId: order.productsOrdered[0]._id,
    paymentIntentId: PI,
    unitPrice: 100,
    requestedQuantity: 5,
    reservedQuantity: 4,
    expiresAt: expiresAt || new Date(Date.now() + 3600 * 1000),
  });
  return { product, order, dispute };
}

// One in-memory database per file; every test starts from an empty one.
before(helpers.startDb);
after(helpers.stopDb);
beforeEach(async () => {
  await helpers.clearDb();
  stripe = helpers.fakeStripe();
  refund.useClient(stripe);
});

describe("disputes", () => {
  it("a refund failure leaves the dispute Resolving, is recorded, and the sweep finishes it exactly once", async () => {
    const { product, order, dispute } = await seedDispute();

    stripe.failNext(1);
    const first = await resolveDispute({
      id: dispute._id,
      userId: USER,
      action: "reduce",
      quantity: 2,
    });
    assert.equal(first.ok, false);
    assert.equal(first.code, 502);

    let d = await Dispute.findById(dispute._id);
    assert.equal(d.status, "Resolving", "the decision is saved");
    assert.equal(d.resolvedQuantity, 2);
    assert.equal((await Product.findById(product._id)).stock, 0, "no stock moved yet");
    assert.equal((await Order.findById(order._id)).productsOrdered[0].lineStatus, "Disputed");
    const incident = await Incident.findOne({ type: "dispute-stuck" });
    assert.ok(incident && !incident.resolved, "the failure is recorded for an admin");

    // The customer is not blocked: asking again is a 409, not a second decision.
    const again = await resolveDispute({ id: dispute._id, userId: USER, action: "cancel" });
    assert.equal(again.code, 409);

    // "The server came back": the sweep only touches disputes stuck for 10+ minutes.
    await Dispute.updateOne(
      { _id: dispute._id },
      { $set: { resolvingSince: new Date(Date.now() - 11 * 60 * 1000) } }
    );
    const sweep = await expireDisputes();
    assert.equal(sweep.retried, 1);

    d = await Dispute.findById(dispute._id);
    assert.equal(d.status, "Resolved");
    assert.equal(stripe.all.length, 1, "exactly one refund");
    assert.equal(stripe.totalCentavos(PI), 30000, "3 of 5 units, at 100 each");
    assert.equal((await Product.findById(product._id)).stock, 2, "4 held - 2 kept = 2 back on sale");
    const line = (await Order.findById(order._id)).productsOrdered[0];
    assert.equal(line.lineStatus, "Adjusted");
    assert.equal(line.quantity, 2);
    assert.equal(line.refundedAmount, 300);
    const paid = await Order.findById(order._id);
    assert.equal(paid.totalPrice, 200);
    assert.equal(paid.refundedAmount, 300);
    assert.equal((await Incident.findOne({ type: "dispute-stuck" })).resolved, true);
  });

  it("finishing the same dispute again later never refunds or restocks twice", async () => {
    const { product, dispute } = await seedDispute();

    const done = await resolveDispute({ id: dispute._id, userId: USER, action: "reduce", quantity: 2 });
    assert.equal(done.ok, true);
    assert.equal(stripe.all.length, 1);
    assert.equal((await Product.findById(product._id)).stock, 2);

    // Simulate a crash right before the final status write: it is Resolving again, long ago.
    await Dispute.updateOne(
      { _id: dispute._id },
      { $set: { status: "Resolving", resolvingSince: new Date(Date.now() - 60 * 60 * 1000) } }
    );
    await expireDisputes();

    assert.equal(stripe.all.length, 1, "Stripe's key had expired, our own check still holds");
    assert.equal((await Product.findById(product._id)).stock, 2, "stock released once");
    assert.equal((await Dispute.findById(dispute._id)).status, "Resolved");
  });

  it("an expired dispute is cancelled and refunded in full for the line", async () => {
    const { product, order, dispute } = await seedDispute({ expiresAt: new Date(Date.now() - 1000) });

    const sweep = await expireDisputes();
    assert.equal(sweep.expired, 1);

    assert.equal(stripe.totalCentavos(PI), 50000);
    assert.equal((await Product.findById(product._id)).stock, 4);
    const line = (await Order.findById(order._id)).productsOrdered[0];
    assert.equal(line.lineStatus, "Cancelled");
    assert.equal(line.quantity, 0);
    const d = await Dispute.findById(dispute._id);
    assert.equal(d.status, "Resolved");
    assert.equal(d.resolution, "expired");
  });

  it("someone else's dispute cannot be resolved", async () => {
    const { dispute } = await seedDispute();
    const result = await resolveDispute({ id: dispute._id, userId: "someone-else", action: "cancel" });
    assert.equal(result.code, 404);
    assert.equal(stripe.all.length, 0);
  });

  it("rejects a quantity outside 1..held", async () => {
    const { dispute } = await seedDispute();
    for (const quantity of [0, 5, 9, "x", 1.5, undefined]) {
      const result = await resolveDispute({ id: dispute._id, userId: USER, action: "reduce", quantity });
      assert.equal(result.code, 400, `quantity ${quantity}`);
    }
    assert.equal((await Dispute.findById(dispute._id)).status, "Open");
  });

  it("two simultaneous resolutions: one wins, the other is told it is already resolved", async () => {
    const { dispute } = await seedDispute();
    const results = await Promise.all([
      resolveDispute({ id: dispute._id, userId: USER, action: "reduce", quantity: 4 }),
      resolveDispute({ id: dispute._id, userId: USER, action: "cancel" }),
    ]);
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    assert.ok(results.find((r) => !r.ok).code === 409);
    assert.equal(stripe.all.length <= 1, true);
  });
});

describe("refunds still owed on an order", () => {
  it("the sweep retries them until they go through, then closes the incident", async () => {
    const order = await Order.create({
      userId: USER,
      productsOrdered: [
        { productId: "p", name: "Tee", quantity: 0, requestedQuantity: 2, unitPrice: 100, subtotal: 0, lineStatus: "Cancelled", refundedAmount: 200 },
      ],
      totalPrice: 0,
      refundedAmount: 200,
      pendingRefund: 200,
      paymentStatus: "Paid",
      paymentMethod: "card",
      paymentIntentId: "pi_owed",
    });

    stripe.failNext(1);
    await expireDisputes();
    assert.equal((await Order.findById(order._id)).pendingRefund, 200, "still owed");
    assert.equal((await Incident.findOne({ type: "refund-failed" })).resolved, false);

    await expireDisputes();
    assert.equal((await Order.findById(order._id)).pendingRefund, 0);
    assert.equal(stripe.totalCentavos("pi_owed"), 20000);
    assert.equal((await Incident.findOne({ type: "refund-failed" })).resolved, true);

    await expireDisputes();
    assert.equal(stripe.all.length, 1, "nothing left to refund");
  });
});

