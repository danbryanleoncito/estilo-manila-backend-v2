const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  cartItems: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
      quantity: { type: Number, required: true },
      subtotal: { type: Number, required: true },
    },
  ],
  totalPrice: { type: Number, required: true },
  orderedOn: { type: Date },
});

module.exports = mongoose.model("Cart", cartSchema);
