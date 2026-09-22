const express = require("express");
const paymentController = require("../controllers/payment");
const router = express.Router();
const { verify } = require("../auth");

router.post("/create-payment-intent", verify, paymentController.createPaymentIntent);
// The webhook route is intentionally NOT defined here — it must be mounted in index.js
// before the global express.json() middleware so Stripe's raw request body is preserved
// for signature verification.

module.exports = router;
