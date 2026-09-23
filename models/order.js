const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: [true, "User ID is Required"],
  },
  productsOrdered: [
    {
      productId: {
        type: String,
        required: [true, "product ID is Required"],
      },
      quantity: {
        type: Number,
        required: [true, "Quantity is Required"],
      },
      subtotal: {
        type: Number,
        required: [true, "subtotal is Required"],
      },
      // Price per unit at purchase time, and what the customer originally ordered.
      // `quantity` is what is currently kept (or held, while a dispute is open).
      unitPrice: { type: Number },
      requestedQuantity: { type: Number },
      lineStatus: {
        type: String,
        enum: ["Fulfilled", "Disputed", "Adjusted", "Cancelled"],
        default: "Fulfilled",
      },
      refundedAmount: { type: Number, default: 0 },
    },
  ],
  // Net amount: what was charged minus any refunds issued so far.
  totalPrice: {
    type: Number,
    required: [true, "Total Price is Required"],
  },
  refundedAmount: { type: Number, default: 0 },
  // Pesos still owed back for lines that were unavailable at order time. Set when the order
  // is created and cleared once Stripe confirms the refund, so a failed refund is retried
  // (see reconcileOrder) instead of leaving the customer overcharged.
  pendingRefund: { type: Number, default: 0 },
  orderedOn: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    default: "Pending",
  },
  paymentStatus: {
    type: String,
    enum: ["COD", "Unpaid", "Paid", "Failed"],
    default: "Unpaid",
  },
  // No default: a sparse unique index still indexes an explicit null, so storing null on
  // COD orders would make the second COD order fail with E11000. Leave the field absent.
  paymentIntentId: {
    type: String,
    default: undefined,
    index: { unique: true, sparse: true },
  },
  paymentMethod: {
    type: String,
    enum: ["card", "cod"],
    default: "cod",
  },
});

module.exports = mongoose.model("Order", orderSchema);
