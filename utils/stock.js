const Product = require("../models/product");
const { maxPurchasable } = require("./limits");

// The only place stock is changed. Uses atomic conditional updates (no transactions:
// the deployment is not guaranteed to be a replica set), with manual rollback.

// `available` here is what may be bought right now: live stock capped at 99 per line.
module.exports.findShortages = async (cartItems) => {
  const shortages = [];
  for (const item of cartItems) {
    const product = await Product.findById(item.productId);
    // An archived product can no longer be bought, whatever its stock says.
    const available =
      product && product.isActive !== false ? maxPurchasable(product.stock) : 0;
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

// Takes as many of `qty` units as are available, atomically (one pipeline update, so
// concurrent buyers can never push stock below zero). Returns the units actually taken.
module.exports.reserveUpTo = async (productId, qty) => {
  const before = await Product.findOneAndUpdate(
    { _id: productId },
    [{ $set: { stock: { $max: [0, { $subtract: [{ $ifNull: ["$stock", 0] }, qty] }] } } }],
    { returnDocument: "before", projection: { stock: 1 } }
  );
  if (!before) return 0;
  return Math.min(before.stock ?? 0, qty);
};

module.exports.reserveStock = async (cartItems) => {
  const reserved = [];
  for (const item of cartItems) {
    const result = await Product.updateOne(
      // isActive: an archived product cannot be bought even if it still has stock.
      { _id: item.productId, stock: { $gte: item.quantity }, isActive: { $ne: false } },
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
