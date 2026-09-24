// Runs the real API against a throwaway in-memory database, for trying the storefront by hand or
// with browser automation WITHOUT touching a real database, Stripe, or the deployed site.
//
//   node test/devserver.js            (API on http://localhost:3005/b4)
//   cd ../frontend && REACT_APP_API_BASE_URL=http://localhost:3005/b4 npm start     (port 3000)
//
// The frontend must run on port 3000 (the API's CORS list). Stripe is a fake: refunds succeed and are
// recorded. Everything is lost when the process stops.
//
// Dev-only controls (not part of the API):
//   GET /__dev/down?on=1   drop every connection, as if the server were offline (on=0 brings it back)
//   GET /__dev/dump        orders, disputes, incidents, product stock and the refunds made so far
const helpers = require("./helpers");
const express = require("express");
const bcrypt = require("bcrypt");

const PASSWORD = "Secret123!";

async function seed(models, stripe) {
  const { Product, User, Order, Dispute, Incident } = models;
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const user = (email, extra = {}) =>
    User.create({ firstName: "Test", lastName: email.split("@")[0], email, password: hash, mobileNo: "09171234567", ...extra });

  const [admin, disputer, shopper] = await Promise.all([
    user("admin@example.com", { isAdmin: true }),
    user("dispute@example.com"),
    user("shopper@example.com"),
  ]);

  const img = (n) => `https://placehold.co/600x800?text=${encodeURIComponent(n)}`;
  const mk = (name, price, stock, extra = {}) =>
    Product.create({ name, description: `${name} description`, price, image: img(name), stock, ...extra });
  const [soldOut, low, boxy, cargo, hoodie] = await Promise.all([
    mk("Sold Out Tee", 500, 0),
    mk("Low Stock Cap", 350, 3),
    mk("Boxy Tee", 899, 25),
    mk("Cargo Pants", 1299, 25),
    mk("Manila Hoodie", 1599, 40),
    mk("Archived Jacket", 2500, 5, { isActive: false }),
  ]);

  const line = (p, q, req, unit, status, over = {}) => ({
    productId: String(p._id), name: p.name, quantity: q, requestedQuantity: req, unitPrice: unit,
    subtotal: q * unit, lineStatus: status, ...over,
  });
  const order = (lines, total, pi, when) =>
    Order.create({
      userId: String(disputer._id), productsOrdered: lines, totalPrice: total, paymentStatus: "Paid",
      paymentMethod: "card", paymentIntentId: pi, orderedOn: when || new Date(),
      shippingAddress: { fullName: "Dispute Tester", phone: "09171234567", addressLine1: "12 Rizal Street", addressLine2: "Unit 4B", city: "Makati", province: "Metro Manila", postalCode: "1200", country: "Philippines" },
    });
  const dispute = (o, lineIdx, p, unit, req, held, status, pi, extra = {}) =>
    Dispute.create({
      orderId: o._id, userId: String(disputer._id), productId: String(p._id), productName: p.name,
      lineId: o.productsOrdered[lineIdx]._id, paymentIntentId: pi, unitPrice: unit, requestedQuantity: req,
      reservedQuantity: held, status, expiresAt: new Date(Date.now() + 5 * 3600 * 1000), ...extra,
    });

  // Order 1: a normal line plus one that was short (paid 5, 4 held) -> Resolve.
  const o1 = await order([line(boxy, 2, 2, 899, "Fulfilled"), line(cargo, 4, 5, 1299, "Disputed")], 2 * 899 + 5 * 1299, "pi_dev_1");
  await dispute(o1, 1, cargo, 1299, 5, 4, "Open", "pi_dev_1");
  // Order 2 (older): a second open dispute, used for the "already resolved" case.
  const o2 = await order([line(hoodie, 2, 3, 1599, "Disputed")], 3 * 1599, "pi_dev_2", new Date(Date.now() - 86400000));
  await dispute(o2, 0, hoodie, 1599, 3, 2, "Open", "pi_dev_2", { expiresAt: new Date(Date.now() + 40 * 60000) });
  // Order 3: the customer already chose; the refund is still processing.
  const o3 = await order([line(low, 1, 2, 350, "Disputed")], 700, "pi_dev_3", new Date(Date.now() - 2 * 86400000));
  await dispute(o3, 0, low, 350, 2, 1, "Resolving", "pi_dev_3", { resolution: "reduced", resolvedQuantity: 1, refundAmount: 350, resolvingSince: new Date() });

  await Incident.create({ type: "refund-failed", refId: "demo", message: "Refund of ₱350 for order demo did not go through: stripe is down", count: 3 });
  console.log("\nSeeded (password for all: " + PASSWORD + "):");
  console.log("  admin@example.com    admin");
  console.log("  dispute@example.com  3 orders: 2 open disputes, 1 refund processing");
  console.log("  shopper@example.com  empty cart, for cart/checkout tests");
  console.log("  products: Sold Out Tee (0), Low Stock Cap (3), Boxy Tee, Cargo Pants, Manila Hoodie, Archived Jacket (archived)\n");
  return { admin, disputer, shopper };
}

(async () => {
  await helpers.startDb();
  const stripe = helpers.fakeStripe();
  require("../utils/refund").useClient(stripe);
  const models = {
    Product: require("../models/product"), User: require("../models/user"), Order: require("../models/order"),
    Dispute: require("../models/dispute"), Incident: require("../models/incident"),
  };
  await seed(models, stripe);

  const { app } = require("../index");
  const outer = express();
  let down = false;
  outer.get("/__dev/down", (req, res) => {
    down = req.query.on === "1";
    res.json({ down });
  });
  outer.get("/__dev/dump", async (req, res) => {
    res.json({
      orders: await models.Order.find({}),
      disputes: await models.Dispute.find({}),
      incidents: await models.Incident.find({}),
      products: (await models.Product.find({})).map((p) => ({ name: p.name, stock: p.stock })),
      refunds: stripe.all,
    });
  });
  outer.use((req, res, next) => (down ? req.socket.destroy() : next()));
  outer.use(app);

  const port = process.env.DEV_PORT || 3005; // not PORT: the real .env sets that to the real API's port
  outer.listen(port, () => console.log(`Isolated dev API on http://localhost:${port}/b4  (Ctrl+C to stop)`));
})();
