const mongoose = require("mongoose");

// What the customer was actually charged for, frozen when the PaymentIntent is created.
// Checkout and the webhook build the order from this, not from the (editable) cart.
const paymentSnapshotSchema = new mongoose.Schema({
  paymentIntentId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  items: [
    {
      productId: { type: String, required: true },
      name: { type: String },
      quantity: { type: Number, required: true },
      unitPrice: { type: Number, required: true },
    },
  ],
  amount: { type: Number, required: true }, // pesos
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

module.exports = mongoose.model("PaymentSnapshot", paymentSnapshotSchema);
