const Order = require("../models/order");
const Cart = require("../models/cart");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { placeOrderFromCart } = require("../utils/placeOrder");
const { refundPayment } = require("../utils/refund");

module.exports.checkout = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentIntentId } = req.body;

    // Check idempotency before touching the cart: if the webhook already turned this
    // payment into an Order (and deleted the cart), the cart-empty check below would
    // otherwise mask that and report a false failure.
    if (paymentIntentId) {
      const existingOrder = await Order.findOne({ paymentIntentId });
      if (existingOrder) {
        return res.status(200).send({ message: "Order already placed", order: existingOrder });
      }
    }

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.cartItems.length === 0) {
      return res.status(400).send({ message: "Your cart is empty" });
    }

    let paymentStatus = "COD";
    let paymentMethod = "cod";
    let verifiedIntentId = null;

    if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (!intent || intent.status !== "succeeded") {
        return res.status(400).send({ message: "Payment has not succeeded yet" });
      }
      if (!intent.metadata || intent.metadata.userId !== String(userId)) {
        return res.status(403).send({ message: "This payment does not belong to the current user" });
      }

      paymentStatus = "Paid";
      paymentMethod = "card";
      verifiedIntentId = paymentIntentId;
    }

    const result = await placeOrderFromCart({
      userId,
      cart,
      paymentStatus,
      paymentMethod,
      paymentIntentId: verifiedIntentId,
    });

    if (!result.ok) {
      // Card payments are already charged by now, so give the money back.
      if (verifiedIntentId) await refundPayment(verifiedIntentId);
      return res.status(409).send({
        message: verifiedIntentId
          ? "Some items just sold out. Your payment has been refunded."
          : "Some items are out of stock",
        outOfStock: result.shortages,
      });
    }

    if (result.alreadyPlaced) {
      return res.status(200).send({ message: "Order already placed", order: result.order });
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
