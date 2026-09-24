// All Stripe refunds go through here.
//
// Stripe only remembers an idempotency key for about 24 hours, but a refund that failed (Stripe
// outage, network) is retried by the sweep for as long as it stays unfinished. So the key alone
// cannot stop a late retry from refunding twice. Every refund therefore also carries our key in
// its metadata, and we look for it before creating a new one.

let client = null;
const getClient = () => {
  if (!client) client = require("stripe")(process.env.STRIPE_SECRET_KEY);
  return client;
};

// Tests only: swap in a fake Stripe client.
module.exports.useClient = (fake) => {
  client = fake;
};

const findExisting = async (paymentIntentId, key) => {
  const list = await getClient().refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  return (
    list.data.find(
      (r) =>
        r.metadata &&
        r.metadata.key === key &&
        r.status !== "failed" &&
        r.status !== "canceled"
    ) || null
  );
};

const refundOnce = async (paymentIntentId, params, key) => {
  const existing = await findExisting(paymentIntentId, key);
  if (existing) return existing;
  return getClient().refunds.create(
    { payment_intent: paymentIntentId, ...params, metadata: { key } },
    { idempotencyKey: key }
  );
};

// Full refund of a payment that cannot be fulfilled at all. Safe to call more than once.
module.exports.refundPayment = (paymentIntentId) =>
  refundOnce(paymentIntentId, {}, `refund_${paymentIntentId}`);

// Partial refund of `amountPesos` (whole pesos) against a payment. `key` must be unique per
// logical refund (e.g. "dispute_<id>"); calling again with the same key never refunds twice.
module.exports.refundAmount = (paymentIntentId, amountPesos, key) =>
  refundOnce(paymentIntentId, { amount: Math.round(amountPesos * 100) }, key);
