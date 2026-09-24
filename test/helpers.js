// Shared setup for the backend tests. Require this FIRST in every test file: it points the app at
// throwaway settings before any app module reads the environment, so a test can never reach the
// real database or the real Stripe account.
process.env.NODE_ENV = "test";
process.env.MONGO_STRING = "mongodb://127.0.0.1:1/never-used";
process.env.JWT_SECRET_KEY = "test-jwt-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_never_sent_anywhere";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
delete process.env.RENDER;

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;

module.exports.startDb = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("estilo-test"));
  // Load every model and build its indexes (unique/sparse ones are part of what is tested).
  ["cart", "dispute", "incident", "order", "paymentSnapshot", "product", "user"].forEach((m) =>
    require(`../models/${m}`)
  );
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
};

module.exports.stopDb = async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
};

module.exports.clearDb = async () => {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
};

// A stand-in for Stripe's refund API. It deliberately IGNORES idempotency keys, which is what
// real Stripe does once a key is more than ~24 hours old, so a test can prove we do not rely on them.
module.exports.fakeStripe = () => {
  const refunds = [];
  const intents = [];
  let failures = 0;
  return {
    // Signature checking is local maths, not a network call, so the real one is used.
    webhooks: require("stripe")("sk_test_dummy").webhooks,
    paymentIntents: {
      create: async (params) => {
        const intent = { id: `pi_fake_${intents.length + 1}`, client_secret: "cs_fake", ...params };
        intents.push(intent);
        return intent;
      },
      cancel: async (id) => {
        const i = intents.findIndex((x) => x.id === id);
        if (i >= 0) intents.splice(i, 1);
        return { id, status: "canceled" };
      },
    },
    intents,
    refunds: {
      list: async ({ payment_intent }) => ({
        data: refunds.filter((r) => r.payment_intent === payment_intent),
      }),
      create: async (params) => {
        if (failures > 0) {
          failures--;
          throw new Error("stripe is down");
        }
        const refund = { id: `re_${refunds.length + 1}`, status: "succeeded", ...params };
        refunds.push(refund);
        return refund;
      },
    },
    all: refunds,
    failNext: (n = 1) => {
      failures = n;
    },
    totalCentavos: (pi) =>
      refunds.filter((r) => r.payment_intent === pi).reduce((sum, r) => sum + (r.amount || 0), 0),
  };
};

// Enough of an Express response for calling controllers directly.
module.exports.fakeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
    json(body) {
      return this.send(body);
    },
  };
  return res;
};

// A valid delivery address, as the storefront sends it.
module.exports.validAddress = (over = {}) => ({
  fullName: "Ada Lovelace",
  phone: "0917 123 4567",
  addressLine1: "12 Rizal Street",
  addressLine2: "Unit 4B",
  city: "Makati",
  province: "Metro Manila",
  postalCode: "1200",
  country: "Philippines",
  ...over,
});

module.exports.mongoose = mongoose;
