const Product = require("../models/product");

module.exports.recomputeCartTotal = async (cartItems) => {
  let totalPrice = 0;
  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    const product = await Product.findById(item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} no longer exists`);
    }
    item.subtotal = product.price * item.quantity;
    totalPrice += item.subtotal;
  }
  return totalPrice;
};
