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
    },
    {
      quantity: {
        type: Number,
        required: [true, "Quantity is Required"],
      },
    },
    {
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
});

module.exports = mongoose.model("Order", orderSchema);
