// Which deployment created a payment. One Stripe test account can feed the webhooks of several
// environments at once (a local dev server and Render both receive every event), so each
// PaymentIntent is stamped with where it came from. A payment with no snapshot is a real problem
// only when it was created by *this* environment; otherwise it belongs to someone else's server.
// Render sets RENDER automatically.
module.exports.ENV_TAG = process.env.RENDER ? "render" : "local";
