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
