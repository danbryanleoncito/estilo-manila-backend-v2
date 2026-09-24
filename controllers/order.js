const Order = require("../models/order");
const Cart = require("../models/cart");
const PaymentSnapshot = require("../models/paymentSnapshot");
const Dispute = require("../models/dispute");
const Incident = require("../models/incident");
const { resolveDispute } = require("../utils/disputes");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  placeOrderFromCart,
  placeOrderFromSnapshot,
  clearCartIfPurchased,
} = require("../utils/placeOrder");
const { safeReconcile } = require("../utils/reconcile");
const { serverError } = require("../utils/respond");

module.exports.checkout = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentIntentId } = req.body;

    // ---- Card payment: build the order from what was actually charged (the snapshot). ----
    if (paymentIntentId) {
      // Idempotency first: the webhook may already have created this order.
      const existingOrder = await Order.findOne({ paymentIntentId });
      if (existingOrder) {
        if (existingOrder.userId !== String(userId)) {
          return res.status(403).send({ message: "This payment does not belong to the current user" });
        }
        // A retry after a failure part-way through: finish what may have been left undone.
        await clearCartIfPurchased(userId, existingOrder);
        await safeReconcile(existingOrder);
        return res.status(200).send({ message: "Order already placed", order: existingOrder });
      }

      let intent;
      try {
        intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch (stripeErr) {
        if (stripeErr && stripeErr.type === "StripeInvalidRequestError") {
          return res.status(400).send({ message: "We do not recognise that payment reference" });
        }
        throw stripeErr;
      }
      if (!intent || intent.status !== "succeeded") {
        return res.status(400).send({ message: "Payment has not succeeded yet" });
      }
      if (!intent.metadata || intent.metadata.userId !== String(userId)) {
        return res.status(403).send({ message: "This payment does not belong to the current user" });
      }

      const snapshot = await PaymentSnapshot.findOne({ paymentIntentId });
      if (
        !snapshot ||
        snapshot.userId !== String(userId) ||
        Math.round(snapshot.amount * 100) !== intent.amount
      ) {
        // The webhook refunds payments it cannot match to a snapshot.
        return res.status(409).send({
          message:
            "We could not match this payment to your cart. Please contact support and quote your payment reference: " +
            paymentIntentId,
        });
      }

      const result = await placeOrderFromSnapshot({
        userId: String(userId),
        snapshot,
        paymentIntentId,
      });

      if (!result.ok) {
        return res.status(409).send({
          message: "None of these items are available any more. Your payment has been fully refunded.",
          outOfStock: result.shortages,
        });
      }
      if (result.alreadyPlaced) {
        return res.status(200).send({ message: "Order already placed", order: result.order });
      }
      return res.status(200).send({
        message:
          result.disputesOpened > 0
            ? "Order placed. Some items were only partly available and need your decision."
            : "Ordered successfully",
        order: result.order,
        disputesOpened: result.disputesOpened || 0,
      });
    }

    // ---- Cash on Delivery: all-or-nothing, nothing has been charged. ----
    // Taking the cart out of the database is the atomic claim: two simultaneous requests
    // (a double click, a retry) cannot both get it, so only one order can be placed. It goes
    // back if the order does not happen.
    const cart = await Cart.findOneAndDelete({ userId });
    if (!cart || cart.cartItems.length === 0) {
      return res.status(400).send({ message: "Your cart is empty" });
    }

    let result;
    try {
      result = await placeOrderFromCart({
        userId,
        cart,
        paymentStatus: "COD",
        paymentMethod: "cod",
      });
    } catch (placeErr) {
      await restoreCart(cart);
      throw placeErr;
    }

    if (!result.ok) {
      await restoreCart(cart);
      return res.status(409).send({
        message: "Some items are out of stock",
        outOfStock: result.shortages,
      });
    }

    res.status(200).send({ message: "Ordered successfully", order: result.order });
  } catch (error) {
    serverError(res, "Checkout failed. Please try again.", error);
  }
};

// Put a claimed cart back, unless the customer has already started a new one.
const restoreCart = async (cart) => {
  try {
    const { _id, ...fields } = cart.toObject();
    await Cart.findOneAndUpdate(
      { userId: cart.userId },
      { $setOnInsert: { _id, ...fields } },
      { upsert: true }
    );
  } catch (err) {
    console.error("Could not restore the cart after a failed checkout:", err.message);
  }
};

module.exports.getLoggedUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await Order.find({ userId });

    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found for this user" });
    }

    res.status(200).send({ orders: orders });
  } catch (error) {
    serverError(res, "Could not load your orders", error);
  }
};

module.exports.getAllOrders = async (req, res) => {
  try {
    // Find all orders
    const orders = await Order.find({});

    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found" });
    }

    // Send the found orders to the client
    res.status(200).send({ orders: orders });
  } catch (error) {
    serverError(res, "Could not load orders", error);
  }
};

// ---- Shortfall disputes (paid card orders where a line was only partly available) ----

module.exports.getMyDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find({ userId: String(req.user.id) }).sort({ createdAt: -1 });
    res.status(200).send({ disputes });
  } catch (error) {
    serverError(res, "Could not load disputes", error);
  }
};

module.exports.getAllDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find({}).sort({ createdAt: -1 });
    res.status(200).send({ disputes });
  } catch (error) {
    serverError(res, "Could not load disputes", error);
  }
};

// body: { action: "cancel" } or { action: "reduce", quantity: n }
module.exports.resolveDisputeById = async (req, res) => {
  try {
    const result = await resolveDispute({
      id: req.params.id,
      userId: req.user.id,
      action: req.body.action,
      quantity: req.body.quantity,
    });
    if (!result.ok) return res.status(result.code).send({ message: result.message });
    res.status(200).send({ message: "Dispute resolved", dispute: result.dispute });
  } catch (error) {
    serverError(res, "Could not resolve the dispute", error);
  }
};

// Things that need a person: refunds that keep failing, disputes stuck half way, payments with
// no order. Unresolved ones only (see models/incident.js).
module.exports.getIncidents = async (req, res) => {
  try {
    const incidents = await Incident.find({ resolved: false }).sort({ lastSeen: -1 }).limit(100);
    res.status(200).send({ incidents });
  } catch (error) {
    serverError(res, "Could not load incidents", error);
  }
};
