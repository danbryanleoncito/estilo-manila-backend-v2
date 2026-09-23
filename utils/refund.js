const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Full refund of a payment that cannot be fulfilled at all. The idempotency key lets
// checkout and the webhook both call this safely.
module.exports.refundPayment = (paymentIntentId) =>
  stripe.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `refund_${paymentIntentId}` }
  );

// Partial refund of `amountPesos` (whole pesos) against a payment. `key` must be unique per
// logical refund (e.g. "dispute_<id>") so retries never refund twice.
module.exports.refundAmount = (paymentIntentId, amountPesos, key) =>
  stripe.refunds.create(
    { payment_intent: paymentIntentId, amount: Math.round(amountPesos * 100) },
    { idempotencyKey: key }
  );
