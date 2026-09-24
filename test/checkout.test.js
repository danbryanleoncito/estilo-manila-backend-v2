const helpers = require("./helpers");
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mongoose } = helpers;
const refund = require("../utils/refund");
const Product = require("../models/product");
const Order = require("../models/order");
const Cart = require("../models/cart");
const Incident = require("../models/incident");
const PaymentSnapshot = require("../models/paymentSnapshot");
const { checkout } = require("../controllers/order");
const { placeOrderFromSnapshot } = require("../utils/placeOrder");

const userId = new mongoose.Types.ObjectId();
const req = () => ({ user: { id: String(userId) }, body: { shippingAddress: helpers.validAddress() } });
let stripe;

const makeProduct = (over = {}) =>
  Product.create({ name: `P${Math.random()}`, description: "d", price: 100, image: "http://x/y.png", stock: 10, ...over });

const makeCart = (lines) =>
  Cart.create({
    userId,
    cartItems: lines.map(([p, q]) => ({ productId: p._id, quantity: q, subtotal: p.price * q })),
    totalPrice: lines.reduce((sum, [p, q]) => sum + p.price * q, 0),
  });

// One in-memory database per file; every test starts from an empty one.
before(helpers.startDb);
after(helpers.stopDb);
beforeEach(async () => {
  await helpers.clearDb();
  stripe = helpers.fakeStripe();
  refund.useClient(stripe);
});

describe("cash on delivery checkout", () => {
  it("a double submit places exactly one order and takes the stock once", async () => {
    const p = await makeProduct();
    await makeCart([[p, 2]]);

    const [a, b] = [helpers.fakeRes(), helpers.fakeRes()];
    await Promise.all([checkout(req(), a), checkout(req(), b)]);

    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 400]);
    assert.equal(await Order.countDocuments({ userId: String(userId) }), 1);
    assert.equal((await Product.findById(p._id)).stock, 8);
    assert.equal(await Cart.countDocuments({ userId }), 0);
  });

  it("when an item is short, the customer keeps their cart", async () => {
    const p = await makeProduct({ stock: 1 });
    await makeCart([[p, 2]]);

    const res = helpers.fakeRes();
    await checkout(req(), res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.outOfStock.length, 1);
    const cart = await Cart.findOne({ userId });
    assert.ok(cart, "cart restored");
    assert.equal(cart.cartItems[0].quantity, 2);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Product.findById(p._id)).stock, 1, "nothing was taken");
  });

  it("a deleted product is a clean 409, not a crash", async () => {
    const p = await makeProduct();
    await makeCart([[p, 1]]);
    await Product.deleteOne({ _id: p._id });

    const res = helpers.fakeRes();
    await checkout(req(), res);

    assert.equal(res.statusCode, 409);
    assert.ok(await Cart.findOne({ userId }), "cart restored");
  });

  it("an empty cart is a 400", async () => {
    const res = helpers.fakeRes();
    await checkout(req(), res);
    assert.equal(res.statusCode, 400);
  });
});

describe("card checkout after the order was already saved", () => {
  it("a retry clears a cart that was left behind, and never someone else's items", async () => {
    const bought = await makeProduct();
    const other = await makeProduct();
    await Order.create({
      userId: String(userId),
      productsOrdered: [{ productId: String(bought._id), name: "x", quantity: 1, subtotal: 100 }],
      totalPrice: 100,
      paymentStatus: "Paid",
      paymentMethod: "card",
      paymentIntentId: "pi_done",
    });

    await makeCart([[bought, 1]]);
    let res = helpers.fakeRes();
    await checkout({ user: { id: String(userId) }, body: { paymentIntentId: "pi_done" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, "Order already placed");
    assert.equal(await Cart.countDocuments({ userId }), 0, "leftover cart cleared");

    // The customer has since started a new cart with something else: it must survive a retry.
    await makeCart([[other, 1]]);
    res = helpers.fakeRes();
    await checkout({ user: { id: String(userId) }, body: { paymentIntentId: "pi_done" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(await Cart.countDocuments({ userId }), 1);
  });

  it("another user cannot claim someone else's payment", async () => {
    await Order.create({
      userId: "somebody-else",
      productsOrdered: [{ productId: "p", name: "x", quantity: 1, subtotal: 100 }],
      totalPrice: 100,
      paymentStatus: "Paid",
      paymentMethod: "card",
      paymentIntentId: "pi_theirs",
    });
    const res = helpers.fakeRes();
    await checkout({ user: { id: String(userId) }, body: { paymentIntentId: "pi_theirs" } }, res);
    assert.equal(res.statusCode, 403);
  });
});

describe("placing a paid order when a refund is owed", () => {
  it("succeeds and clears the cart even if the refund fails, leaving it recorded for retry", async () => {
    const inStock = await makeProduct({ stock: 5 });
    const soldOut = await makeProduct({ stock: 0 });
    await makeCart([[inStock, 1], [soldOut, 2]]);
    const snapshot = await PaymentSnapshot.create({
      paymentIntentId: "pi_partial",
      userId: String(userId),
      items: [
        { productId: String(inStock._id), name: "In", quantity: 1, unitPrice: 100 },
        { productId: String(soldOut._id), name: "Out", quantity: 2, unitPrice: 100 },
      ],
      amount: 300,
    });

    stripe.failNext(1);
    const result = await placeOrderFromSnapshot({
      userId: String(userId),
      snapshot,
      paymentIntentId: "pi_partial",
    });

    assert.equal(result.ok, true, "the customer's order goes through");
    assert.equal(await Cart.countDocuments({ userId }), 0);
    const order = await Order.findOne({ paymentIntentId: "pi_partial" });
    assert.equal(order.pendingRefund, 200, "still owed");
    assert.equal(order.totalPrice, 100);
    const incident = await Incident.findOne({ type: "refund-failed" });
    assert.ok(incident && !incident.resolved);
  });
});

