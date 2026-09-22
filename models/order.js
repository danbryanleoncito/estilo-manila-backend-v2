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
    },
  ],
  totalPrice: {
    type: Number,
    required: [true, "Total Price is Required"],
  },
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
  paymentIntentId: {
    type: String,
    default: null,
    index: { unique: true, sparse: true },
  },
  paymentMethod: {
    type: String,
    enum: ["card", "cod"],
    default: "cod",
  },
});

module.exports = mongoose.model("Order", orderSchema);
