// A 500 that tells the client only what it needs (what failed) and keeps the details, which can
// contain database or Stripe internals, in the server log.
module.exports.serverError = (res, message, error) => {
  console.error(message, error);
  if (res.headersSent) return;
  res.status(500).send({ message });
};
