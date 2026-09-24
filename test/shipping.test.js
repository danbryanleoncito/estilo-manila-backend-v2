const helpers = require("./helpers");
const { before, after, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { mongoose } = helpers;
const stripeClient = require("../utils/stripeClient");
const Product = require("../models/product");
const Order = require("../models/order");
const Cart = require("../models/cart");
const PaymentSnapshot = require("../models/paymentSnapshot");
const { checkout } = require("../controllers/order");
const { createPaymentIntent, handleWebhook } = require("../controllers/payment");
const { placeOrderFromSnapshot } = require("../utils/placeOrder");
const { ENV_TAG } = require("../utils/envTag");

const userId = new mongoose.Types.ObjectId();
let fake;

before(helpers.startDb);
after(helpers.stopDb);
beforeEach(async () => {
  await helpers.clearDb();
  fake = helpers.fakeStripe();
  stripeClient.useStripe(fake);
});

const makeProduct = (over = {}) =>
  Product.create({ name: `P${Math.random()}`, description: "d", price: 100, image: "http://x/y", stock: 10, ...over });
const makeCart = (p, q) =>
  Cart.create({ userId, cartItems: [{ productId: p._id, quantity: q, subtotal: p.price * q }], totalPrice: p.price * q });
const asUser = (body) => ({ user: { id: String(userId) }, body });

describe("cash on delivery", () => {
  it("saves the delivery address on the order, normalised", async () => {
    const p = await makeProduct();
    await makeCart(p, 2);
    const res = helpers.fakeRes();
    await checkout(asUser({ shippingAddress: helpers.validAddress({ phone: "+63 917 123 4567" }) }), res);

    assert.equal(res.statusCode, 200);
    const order = await Order.findOne({});
    assert.equal(order.shippingAddress.fullName, "Ada Lovelace");
    assert.equal(order.shippingAddress.phone, "09171234567");
    assert.equal(order.shippingAddress.addressLine1, "12 Rizal Street");
    assert.equal(order.shippingAddress.postalCode, "1200");
    assert.equal(order.shippingAddress.country, "Philippines");
  });

  it("refuses a missing or bad address BEFORE touching the cart or the stock", async () => {
    const p = await makeProduct();
    await makeCart(p, 2);
    for (const body of [{}, { shippingAddress: helpers.validAddress({ postalCode: "12" }) }]) {
      const res = helpers.fakeRes();
      await checkout(asUser(body), res);
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.field, JSON.stringify(res.body));
    }
    assert.equal(await Cart.countDocuments({ userId }), 1, "cart untouched");
    assert.equal((await Product.findById(p._id)).stock, 10, "stock untouched");
    assert.equal(await Order.countDocuments(), 0);
  });
});

describe("card payment", () => {
  it("refuses to start a payment without a valid address, and creates nothing at Stripe", async () => {
    const p = await makeProduct();
    await makeCart(p, 1);
    for (const body of [{}, { shippingAddress: helpers.validAddress({ phone: "nope" }) }]) {
      const res = helpers.fakeRes();
      await createPaymentIntent(asUser(body), res);
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.field);
    }
    assert.equal(fake.intents.length, 0, "nobody was asked to pay");
    assert.equal(await PaymentSnapshot.countDocuments(), 0);
  });

  it("freezes the address with the items when the payment is created", async () => {
    const p = await makeProduct();
    await makeCart(p, 1);
    const res = helpers.fakeRes();
    await createPaymentIntent(asUser({ shippingAddress: helpers.validAddress() }), res);

    assert.equal(res.statusCode, 201);
    const snapshot = await PaymentSnapshot.findOne({ paymentIntentId: res.body.paymentIntentId });
    assert.equal(snapshot.shippingAddress.addressLine1, "12 Rizal Street");
    assert.equal(snapshot.shippingAddress.phone, "09171234567");
  });

  it("an order created by the webhook alone (checkout never called) still has the address", async () => {
    const p = await makeProduct();
    await makeCart(p, 1);
    const created = helpers.fakeRes();
    await createPaymentIntent(asUser({ shippingAddress: helpers.validAddress({ city: "Pasig" }) }), created);
    const pi = created.body.paymentIntentId;

    const payload = JSON.stringify({
      id: "evt_1",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: pi, object: "payment_intent", amount: 10000, currency: "php", metadata: { userId: String(userId), env: ENV_TAG } } },
    });
    const header = Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const res = helpers.fakeRes();
    await handleWebhook({ headers: { "stripe-signature": header }, body: Buffer.from(payload) }, res);

    assert.equal(res.statusCode, 200);
    const order = await Order.findOne({ paymentIntentId: pi });
    assert.ok(order, "the webhook made the order");
    assert.equal(order.shippingAddress.city, "Pasig");
    assert.equal(order.shippingAddress.fullName, "Ada Lovelace");
  });

  it("placing an order from a snapshot carries its address onto the order", async () => {
    const p = await makeProduct();
    const snapshot = await PaymentSnapshot.create({
      paymentIntentId: "pi_snap",
      userId: String(userId),
      items: [{ productId: String(p._id), name: "x", quantity: 1, unitPrice: 100 }],
      amount: 100,
      shippingAddress: helpers.validAddress({ province: "Cebu" }),
    });
    await placeOrderFromSnapshot({ userId: String(userId), snapshot, paymentIntentId: "pi_snap" });
    assert.equal((await Order.findOne({ paymentIntentId: "pi_snap" })).shippingAddress.province, "Cebu");
  });
});

describe("orders placed before addresses were stored", () => {
  it("still load and simply have no address", async () => {
    const order = await Order.create({
      userId: String(userId),
      productsOrdered: [{ productId: "p", name: "Old", quantity: 1, subtotal: 100 }],
      totalPrice: 100,
      paymentStatus: "COD",
      paymentMethod: "cod",
    });
    const found = await Order.findById(order._id);
    assert.equal(found.shippingAddress, undefined);
    assert.equal(found.toObject().shippingAddress, undefined);
  });
});
