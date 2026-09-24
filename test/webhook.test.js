const helpers = require("./helpers");
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const refund = require("../utils/refund");
const Product = require("../models/product");
const Order = require("../models/order");
const Incident = require("../models/incident");
const PaymentSnapshot = require("../models/paymentSnapshot");
const { handleWebhook } = require("../controllers/payment");
const { ENV_TAG } = require("../utils/envTag");
const USER = String(new helpers.mongoose.Types.ObjectId());

let stripe;
before(helpers.startDb);
after(helpers.stopDb);
beforeEach(async () => {
  await helpers.clearDb();
  stripe = helpers.fakeStripe();
  refund.useClient(stripe);
});

// A correctly signed payment_intent.succeeded event, as Stripe would deliver it.
function deliver(intent) {
  const payload = JSON.stringify({
    id: "evt_test",
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { object: "payment_intent", currency: "php", ...intent } },
  });
  const header = Stripe("sk_test_dummy").webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const res = helpers.fakeRes();
  return handleWebhook({ headers: { "stripe-signature": header }, body: Buffer.from(payload) }, res).then(
    () => res
  );
}

describe("a payment this server has no snapshot for", () => {
  it("made by this environment is recorded as an incident and never auto-refunded", async () => {
    const res = await deliver({ id: "pi_ours", amount: 30000, metadata: { userId: USER, env: ENV_TAG } });
    assert.equal(res.statusCode, 200);
    const incident = await Incident.findOne({ type: "payment-no-snapshot", refId: "pi_ours" });
    assert.ok(incident, "an admin can see it");
    assert.equal(stripe.all.length, 0, "no refund from a guess");
    assert.equal(await Order.countDocuments(), 0);
  });

  it("made by another environment is ignored quietly", async () => {
    const other = ENV_TAG === "render" ? "local" : "render";
    const res = await deliver({ id: "pi_theirs", amount: 30000, metadata: { userId: USER, env: other } });
    assert.equal(res.statusCode, 200);
    assert.equal(await Incident.countDocuments(), 0);
    assert.equal(stripe.all.length, 0);
  });

  it("with no environment tag (created before tagging existed) is ignored quietly", async () => {
    const res = await deliver({ id: "pi_old", amount: 30000, metadata: { userId: USER } });
    assert.equal(res.statusCode, 200);
    assert.equal(await Incident.countDocuments(), 0);
    assert.equal(stripe.all.length, 0);
  });
});

describe("a payment this server has a snapshot for", () => {
  const snapshotFor = async (amount) => {
    const p = await Product.create({ name: "Tee", description: "d", price: 100, image: "http://x/y", stock: 5 });
    await PaymentSnapshot.create({
      paymentIntentId: "pi_mine",
      userId: USER,
      items: [{ productId: String(p._id), name: "Tee", quantity: 3, unitPrice: 100 }],
      amount,
    });
    return p;
  };

  it("becomes an order", async () => {
    const p = await snapshotFor(300);
    const res = await deliver({ id: "pi_mine", amount: 30000, metadata: { userId: USER, env: ENV_TAG } });
    assert.equal(res.statusCode, 200);
    const order = await Order.findOne({ paymentIntentId: "pi_mine" });
    assert.equal(order.paymentStatus, "Paid");
    assert.equal(order.productsOrdered[0].quantity, 3);
    assert.equal((await Product.findById(p._id)).stock, 2);
    assert.equal(await Incident.countDocuments(), 0);
  });

  it("is refunded and recorded when the charge does not match the snapshot", async () => {
    await snapshotFor(300);
    const res = await deliver({ id: "pi_mine", amount: 99900, metadata: { userId: USER, env: ENV_TAG } });
    assert.equal(res.statusCode, 200);
    assert.equal(stripe.all.length, 1, "full refund");
    assert.equal(await Order.countDocuments(), 0);
    assert.ok(await Incident.findOne({ type: "amount-mismatch" }));
  });

  it("a processing failure answers 500 (so Stripe retries), hides the reason, and is recorded until it works", async () => {
    await snapshotFor(300);
    const original = PaymentSnapshot.findOne;
    PaymentSnapshot.findOne = () => {
      throw new Error("db is on fire: secret internal detail");
    };
    let res;
    try {
      res = await deliver({ id: "pi_mine", amount: 30000, metadata: { userId: USER, env: ENV_TAG } });
    } finally {
      PaymentSnapshot.findOne = original;
    }
    assert.equal(res.statusCode, 500);
    assert.ok(!JSON.stringify(res.body).includes("secret internal detail"));
    const incident = await Incident.findOne({ type: "webhook-error", refId: "pi_mine" });
    assert.ok(incident && !incident.resolved);

    // Stripe delivers it again and this time it works: the incident closes itself.
    res = await deliver({ id: "pi_mine", amount: 30000, metadata: { userId: USER, env: ENV_TAG } });
    assert.equal(res.statusCode, 200);
    assert.equal(await Order.countDocuments({ paymentIntentId: "pi_mine" }), 1);
    assert.equal((await Incident.findOne({ type: "webhook-error" })).resolved, true);
  });
});

it("an unsigned or tampered request is rejected", async () => {
  const res = helpers.fakeRes();
  await handleWebhook({ headers: { "stripe-signature": "t=1,v1=bad" }, body: Buffer.from("{}") }, res);
  assert.equal(res.statusCode, 400);
});
