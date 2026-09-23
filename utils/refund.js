const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Refund a card payment that can no longer be fulfilled (e.g. the item sold out after the
// customer paid). The idempotency key lets checkout and the webhook both call this safely.
module.exports.refundPayment = (paymentIntentId) =>
  stripe.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `refund_${paymentIntentId}` }
  );
