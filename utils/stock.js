const Product = require("../models/product");

// The only place stock is changed. Uses atomic conditional updates (no transactions:
// the deployment is not guaranteed to be a replica set), with manual rollback.

module.exports.findShortages = async (cartItems) => {
  const shortages = [];
  for (const item of cartItems) {
    const product = await Product.findById(item.productId);
    const available = product ? product.stock ?? 0 : 0;
    if (!product || available < item.quantity) {
      shortages.push({
        productId: String(item.productId),
        name: product ? product.name : "Unavailable product",
        requested: item.quantity,
        available,
      });
    }
  }
  return shortages;
};

const releaseStock = async (items) => {
  for (const item of items) {
    await Product.updateOne(
      { _id: item.productId },
      { $inc: { stock: item.quantity } }
    );
  }
};
module.exports.releaseStock = releaseStock;

module.exports.reserveStock = async (cartItems) => {
  const reserved = [];
  for (const item of cartItems) {
    const result = await Product.updateOne(
      { _id: item.productId, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } }
    );
    if (result.modifiedCount === 0) {
      await releaseStock(reserved);
      const shortages = await module.exports.findShortages(cartItems);
      return { ok: false, shortages };
    }
    reserved.push(item);
  }
  return { ok: true };
};
