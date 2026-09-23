const Order = require("../models/order");
const Cart = require("../models/cart");
const PaymentSnapshot = require("../models/paymentSnapshot");
const Dispute = require("../models/dispute");
const { resolveDispute } = require("../utils/disputes");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  placeOrderFromCart,
  placeOrderFromSnapshot,
  reconcileOrder,
} = require("../utils/placeOrder");

module.exports.checkout = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentIntentId } = req.body;

    // ---- Card payment: build the order from what was actually charged (the snapshot). ----
    if (paymentIntentId) {
      // Idempotency first: the webhook may already have created this order.
      const existingOrder = await Order.findOne({ paymentIntentId });
      if (existingOrder) {
        await reconcileOrder(existingOrder);
        return res.status(200).send({ message: "Order already placed", order: existingOrder });
      }

      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
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
            "We could not match this payment to your cart. It will be refunded automatically; please try checking out again.",
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
    const cart = await Cart.findOne({ userId });
    if (!cart || cart.cartItems.length === 0) {
      return res.status(400).send({ message: "Your cart is empty" });
    }

    const result = await placeOrderFromCart({
      userId,
      cart,
      paymentStatus: "COD",
      paymentMethod: "cod",
    });

    if (!result.ok) {
      return res.status(409).send({
        message: "Some items are out of stock",
        outOfStock: result.shortages,
      });
    }

    res.status(200).send({ message: "Ordered successfully", order: result.order });
  } catch (error) {
    res.status(500).send({ message: "Checkout failed", error: error.message });
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
    res.status(500).send({ message: "Error retrieving orders", error: error.message });
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
    // Catch any errors and send a message along with the error details
    res
      .status(500)
      .send({ message: "Error retrieving orders", error: error.message });
  }
};

// ---- Shortfall disputes (paid card orders where a line was only partly available) ----

module.exports.getMyDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find({ userId: String(req.user.id) }).sort({ createdAt: -1 });
    res.status(200).send({ disputes });
  } catch (error) {
    res.status(500).send({ message: "Error retrieving disputes", error: error.message });
  }
};

module.exports.getAllDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find({}).sort({ createdAt: -1 });
    res.status(200).send({ disputes });
  } catch (error) {
    res.status(500).send({ message: "Error retrieving disputes", error: error.message });
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
    res.status(500).send({ message: "Failed to resolve dispute", error: error.message });
  }
};
