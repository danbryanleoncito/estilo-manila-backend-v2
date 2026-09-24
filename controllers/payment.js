const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Cart = require("../models/cart");
const Order = require("../models/order");
const Product = require("../models/product");
const PaymentSnapshot = require("../models/paymentSnapshot");
const { recomputeCartTotal } = require("../utils/cartTotal");
const { findShortages } = require("../utils/stock");
const { placeOrderFromSnapshot } = require("../utils/placeOrder");
const { safeReconcile } = require("../utils/reconcile");
const refund = require("../utils/refund");
const incidents = require("../utils/incidents");
const { ENV_TAG } = require("../utils/envTag");
const { serverError } = require("../utils/respond");

module.exports.createPaymentIntent = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.cartItems.length === 0) {
      return res.status(400).send({ message: "Your cart is empty" });
    }

    // Never charge for items that are not available (also enforces the 99-per-line cap).
    const shortages = await findShortages(cart.cartItems);
    if (shortages.length > 0) {
      return res
        .status(409)
        .send({ message: "Some items are out of stock", outOfStock: shortages });
    }

    const totalPrice = await recomputeCartTotal(cart.cartItems);
    cart.totalPrice = totalPrice;
    await cart.save();

    if (totalPrice <= 0) {
      return res.status(400).send({ message: "Cart total must be greater than zero" });
    }

    const products = await Product.find(
      { _id: { $in: cart.cartItems.map((i) => i.productId) } },
      "name"
    );
    const nameOf = Object.fromEntries(products.map((p) => [String(p._id), p.name]));

    // Freeze exactly what is being charged for; checkout and the webhook build the order
    // from this, so later cart edits cannot change what the customer receives.
    const items = cart.cartItems.map((i) => ({
      productId: String(i.productId),
      name: nameOf[String(i.productId)],
      quantity: i.quantity,
      unitPrice: i.subtotal / i.quantity,
    }));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalPrice * 100),
      currency: "php",
      metadata: { userId: String(userId), env: ENV_TAG },
      payment_method_types: ["card"],
    });

    try {
      await PaymentSnapshot.create({
        paymentIntentId: paymentIntent.id,
        userId: String(userId),
        items,
        amount: totalPrice,
      });
    } catch (snapshotErr) {
      await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
      throw snapshotErr;
    }

    res.status(201).send({
      message: "Payment intent created",
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalPrice,
    });
  } catch (error) {
    if (error && error.code === "amount_too_small") {
      return res.status(400).send({
        message:
          "Your total is below the minimum amount for a card payment. Add more items or pay with cash on delivery.",
      });
    }
    serverError(res, "Could not start your card payment", error);
  }
};

module.exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send({ message: `Webhook Error: ${err.message}` });
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const userId = intent.metadata && intent.metadata.userId;
      const paymentIntentId = intent.id;

      if (!userId) {
        console.error("payment_intent.succeeded missing metadata.userId", paymentIntentId);
        return res.status(200).json({ received: true });
      }

      const existing = await Order.findOne({ paymentIntentId });
      if (existing) {
        // Already handled (e.g. by checkout); finish any refund that was still owed.
        await safeReconcile(existing);
        return res.status(200).json({ received: true });
      }

      const snapshot = await PaymentSnapshot.findOne({ paymentIntentId });
      if (!snapshot || snapshot.userId !== String(userId)) {
        // One Stripe (test) account can feed several backends (a local dev server and the
        // deployed one all get every event), and refunding a payment that belongs to another
        // environment is wrong, so we never refund from here. Whether it is a problem depends
        // on who created the payment (see utils/envTag.js).
        if (intent.metadata.env === ENV_TAG) {
          // Ours, yet we have nothing to build an order from: a customer has been charged with
          // no order. Needs a person, so it is recorded where the admin can see it.
          await incidents.report(
            "payment-no-snapshot",
            paymentIntentId,
            `Payment ${paymentIntentId} (${intent.amount / 100} ${intent.currency}) for user ${userId} succeeded but this environment has no snapshot to build an order from. The customer may have been charged without an order.`
          );
        } else {
          console.warn(
            `Ignoring ${paymentIntentId}: created by "${intent.metadata.env || "unknown"}", not this environment ("${ENV_TAG}").`
          );
        }
        return res.status(200).json({ received: true });
      }
      if (Math.round(snapshot.amount * 100) !== intent.amount) {
        await incidents.report(
          "amount-mismatch",
          paymentIntentId,
          `Snapshot amount ${snapshot.amount} does not match charged ${intent.amount / 100} for ${paymentIntentId}; the payment was refunded.`
        );
        await refund.refundPayment(paymentIntentId);
        return res.status(200).json({ received: true });
      }

      const result = await placeOrderFromSnapshot({
        userId: String(userId),
        snapshot,
        paymentIntentId,
      });

      if (!result.ok) {
        console.warn(
          `PaymentIntent ${paymentIntentId} paid but nothing was in stock; fully refunded.`,
          JSON.stringify(result.shortages)
        );
      } else if (result.alreadyPlaced) {
        console.warn(
          `Order for paymentIntentId ${paymentIntentId} already created by checkout; ignoring webhook duplicate.`
        );
      } else if (result.disputesOpened > 0) {
        console.warn(
          `Order ${result.order._id}: ${result.disputesOpened} line(s) partly out of stock, dispute(s) opened.`
        );
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      console.warn(
        `PaymentIntent ${intent.id} failed for user ${intent.metadata && intent.metadata.userId}: ${
          intent.last_payment_error && intent.last_payment_error.message
        }`
      );
    }

    if (event.type === "payment_intent.succeeded") {
      await incidents.resolve("webhook-error", event.data.object.id);
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    // A 500 makes Stripe retry the event later, which is what we want; keep a record so a
    // payment that keeps failing to process does not go unnoticed.
    if (event.type === "payment_intent.succeeded") {
      await incidents.report(
        "webhook-error",
        event.data.object.id,
        `Could not process payment_intent.succeeded: ${error.message}`
      );
    }
    return res.status(500).json({ message: "Webhook handler failure" });
  }
};
