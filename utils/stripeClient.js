// The one Stripe client. Created on first use (so importing a module never needs a key), and
// replaceable in tests with a fake. `stripe` behaves like the real client object.
let client = null;

const getStripe = () => {
  if (!client) client = require("stripe")(process.env.STRIPE_SECRET_KEY);
  return client;
};

module.exports.getStripe = getStripe;

// Tests only. Pass null to go back to the real client.
module.exports.useStripe = (fake) => {
  client = fake;
};

module.exports.stripe = new Proxy(
  {},
  {
    get: (_target, prop) => getStripe()[prop],
  }
);
