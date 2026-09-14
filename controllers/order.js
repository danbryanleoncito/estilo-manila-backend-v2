const Order = require("../models/order");
const Cart = require("../models/cart");
const Product = require("../models/product");
const { errorHandler } = require("../auth");

module.exports.checkout = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.cartItems.length === 0) {
      return res.status(400).send({ message: "Your cart is empty" });
    }

    // Recalculate subtotal and total price before placing the order
    let totalPrice = 0;
    for (let i = 0; i < cart.cartItems.length; i++) {
      const item = cart.cartItems[i];
      const product = await Product.findById(item.productId);
      item.subtotal = product.price * item.quantity;
      totalPrice += item.subtotal;
    }

    const order = new Order({
      userId,
      productsOrdered: cart.cartItems,
      totalPrice: totalPrice,
    });

    await order.save();

    // Clear the cart after placing the order
    await Cart.findOneAndDelete({ userId });

    res.status(200).send({ message: "Ordered successfully" });
  } catch (error) {
    res.status(500).send({ message: errorHandler(error, req, res) });
  }
};

module.exports.getLoggedUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await Order.find({ userId });

    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found for this user" });
    }

    res.status(200).send({ orders: orders });
  } catch (error) {
    res.status(500).send({ message: errorHandler(error, req, res) });
  }
};

module.exports.getAllOrders = async (req, res) => {
  try {
    // Find all orders
    const orders = await Order.find({});

    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found" });
    }

    // Send the found orders to the client
    res.status(200).send({ orders: orders });
  } catch (error) {
    // Catch any errors and send a message along with the error details
    res
      .status(500)
      .send({ message: "Error retrieving orders", error: error.message });
  }
};
