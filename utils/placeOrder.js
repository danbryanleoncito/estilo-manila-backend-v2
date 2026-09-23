const Order = require("../models/order");
const Cart = require("../models/cart");
const { recomputeCartTotal } = require("./cartTotal");
const { reserveStock, releaseStock } = require("./stock");

// Shared by POST /order/checkout and the Stripe webhook so stock is decremented exactly
// once per order, whichever path gets there first.
module.exports.placeOrderFromCart = async ({
  userId,
  cart,
  paymentStatus,
  paymentMethod,
  paymentIntentId,
}) => {
  const totalPrice = await recomputeCartTotal(cart.cartItems);

  const reservation = await reserveStock(cart.cartItems);
  if (!reservation.ok) {
    return { ok: false, shortages: reservation.shortages };
  }

  const orderData = {
    userId,
    productsOrdered: cart.cartItems,
    totalPrice,
    paymentStatus,
    paymentMethod,
  };
  // Omit the field entirely for COD (see the note on Order.paymentIntentId).
  if (paymentIntentId) orderData.paymentIntentId = paymentIntentId;

  let order;
  try {
    order = await new Order(orderData).save();
  } catch (err) {
    await releaseStock(cart.cartItems);
    if (err.code === 11000 && paymentIntentId) {
      const existing = await Order.findOne({ paymentIntentId });
      if (existing) return { ok: true, order: existing, alreadyPlaced: true };
    }
    throw err;
  }

  await Cart.findOneAndDelete({ userId });
  return { ok: true, order };
};
