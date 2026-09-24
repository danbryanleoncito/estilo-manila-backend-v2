const Product = require("../models/product");

// Recomputes every line's subtotal from the current price and returns the cart total.
// By default a product that no longer exists is an error (checkout and payment must not price a
// missing item). With `skipMissing` such a line is left out of the total instead, so the cart
// screens keep working (and the customer can remove the dead line) after a product is deleted.
module.exports.recomputeCartTotal = async (cartItems, { skipMissing = false } = {}) => {
  let totalPrice = 0;
  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    const product = item.productId ? await Product.findById(item.productId) : null;
    if (!product) {
      if (skipMissing) continue;
      throw new Error(`Product ${item.productId} no longer exists`);
    }
    item.subtotal = product.price * item.quantity;
    totalPrice += item.subtotal;
  }
  return totalPrice;
};
