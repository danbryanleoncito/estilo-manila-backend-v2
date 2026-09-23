const mongoose = require("mongoose");

// A paid order line that could only be partly fulfilled. The units that were available are
// held (taken out of Product.stock) until the customer cancels the line or reduces its
// quantity, or the dispute expires.
const disputeSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  userId: { type: String, required: true },
  productId: { type: String, required: true },
  productName: { type: String },
  lineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  paymentIntentId: { type: String, required: true },
  unitPrice: { type: Number, required: true },
  requestedQuantity: { type: Number, required: true },
  reservedQuantity: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Open", "Resolving", "Resolved"],
    default: "Open",
  },
  resolution: { type: String, enum: ["cancelled", "reduced", "expired"] },
  resolvedQuantity: { type: Number },
  refundAmount: { type: Number, default: 0 },
  // Flipped to true BEFORE held units go back to stock, so a crash can leak a few units
  // but can never release the same units twice (which would oversell).
  stockReleased: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  resolvingSince: { type: Date },
  resolvedAt: { type: Date },
});

disputeSchema.index({ userId: 1, status: 1 });
disputeSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("Dispute", disputeSchema);
