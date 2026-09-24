const mongoose = require("mongoose");
const { addressSchemaDefinition } = require("../utils/address");

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
  // Frozen with the items: the webhook can create the order without checkout ever being called.
  shippingAddress: { type: new mongoose.Schema(addressSchemaDefinition, { _id: false }) },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

module.exports = mongoose.model("PaymentSnapshot", paymentSnapshotSchema);
