const helpers = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const refund = require("../utils/refund");

test("refunds never double up, even when Stripe has forgotten the idempotency key", async () => {
  const stripe = helpers.fakeStripe();
  refund.useClient(stripe);

  await refund.refundAmount("pi_1", 300, "dispute_a");
  // Same logical refund again (e.g. the sweep retrying a day later): must find the first one.
  const again = await refund.refundAmount("pi_1", 300, "dispute_a");

  assert.equal(stripe.all.length, 1);
  assert.equal(again.metadata.key, "dispute_a");
  assert.equal(stripe.totalCentavos("pi_1"), 30000);
});

test("different keys are different refunds", async () => {
  const stripe = helpers.fakeStripe();
  refund.useClient(stripe);
  await refund.refundAmount("pi_2", 100, "dispute_a");
  await refund.refundAmount("pi_2", 50.5, "dispute_b");
  assert.equal(stripe.all.length, 2);
  assert.equal(stripe.totalCentavos("pi_2"), 15050);
});

test("a refund that failed on Stripe's side does not block a retry", async () => {
  const stripe = helpers.fakeStripe();
  refund.useClient(stripe);
  stripe.all.push({ id: "re_x", payment_intent: "pi_3", status: "failed", metadata: { key: "k" } });
  await refund.refundAmount("pi_3", 10, "k");
  assert.equal(stripe.all.filter((r) => r.status === "succeeded").length, 1);
});

test("a full refund is also only made once", async () => {
  const stripe = helpers.fakeStripe();
  refund.useClient(stripe);
  await refund.refundPayment("pi_4");
  await refund.refundPayment("pi_4");
  assert.equal(stripe.all.length, 1);
  assert.equal(stripe.all[0].amount, undefined, "no amount means the whole charge");
});

test("a Stripe failure is thrown, not swallowed", async () => {
  const stripe = helpers.fakeStripe();
  refund.useClient(stripe);
  stripe.failNext();
  await assert.rejects(() => refund.refundAmount("pi_5", 10, "k5"), /stripe is down/);
});
