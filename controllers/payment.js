const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Cart = require("../models/cart");
const Order = require("../models/order");
const { recomputeCartTotal } = require("../utils/cartTotal");
const { findShortages } = require("../utils/stock");
const { placeOrderFromCart } = require("../utils/placeOrder");
const { refundPayment } = require("../utils/refund");

module.exports.createPaymentIntent = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.cartItems.length === 0) {
      return res.status(400).send({ message: "Your cart is empty" });
    }

    // Never charge for items that are not available.
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

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalPrice * 100),
      currency: "php",
      metadata: { userId: String(userId) },
      payment_method_types: ["card"],
    });

    res.status(201).send({
      message: "Payment intent created",
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalPrice,
    });
  } catch (error) {
    res.status(500).send({ message: "Failed to create payment intent", error: error.message });
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
        return res.status(200).json({ received: true });
      }

      const cart = await Cart.findOne({ userId });
      if (!cart || cart.cartItems.length === 0) {
        console.warn(
          `No cart found for user ${userId} on webhook for ${paymentIntentId}; assuming already processed.`
        );
        return res.status(200).json({ received: true });
      }

      const result = await placeOrderFromCart({
        userId,
        cart,
        paymentStatus: "Paid",
        paymentMethod: "card",
        paymentIntentId,
      });

      if (!result.ok) {
        // Paid, but the item sold out in the meantime: refund instead of overselling.
        console.warn(
          `PaymentIntent ${paymentIntentId} paid but out of stock; refunding.`,
          JSON.stringify(result.shortages)
        );
        await refundPayment(paymentIntentId);
      } else if (result.alreadyPlaced) {
        console.warn(
          `Order for paymentIntentId ${paymentIntentId} already created by checkout; ignoring webhook duplicate.`
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

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return res.status(500).json({ message: "Webhook handler failure", error: error.message });
  }
};
