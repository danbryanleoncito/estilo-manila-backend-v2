const Cart = require("../models/cart");
const Product = require("../models/product");

const mongoose = require("mongoose");
const { recomputeCartTotal } = require("../utils/cartTotal");
const { MAX_QTY_PER_LINE, maxPurchasable } = require("../utils/limits");

module.exports.addToCart = async (req, res) => {
  try {
    const userId = req.user.id; // Assuming you have user authentication and req.user is available
    const { productId, quantity } = req.body;

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).send({ message: "Invalid product id" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    if (product.isActive === false) {
      return res
        .status(409)
        .send({ message: `${product.name} is no longer available`, available: 0, maxPurchasable: 0 });
    }

    // The UI sends quantity as a string; coerce and validate it (a string used to be
    // concatenated onto the existing quantity, e.g. "2" + "2" = "22").
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .send({ message: "Quantity must be a whole number of at least 1" });
    }

    let cart = await Cart.findOne({ userId });

    const itemIndex = cart
      ? cart.cartItems.findIndex((p) => p.productId == productId)
      : -1;
    const alreadyInCart = itemIndex > -1 ? cart.cartItems[itemIndex].quantity : 0;

    const available = product.stock ?? 0;
    if (available <= 0) {
      return res
        .status(409)
        .send({ message: `${product.name} is out of stock`, available: 0 });
    }
    if (alreadyInCart + qty > available) {
      return res.status(409).send({
        message: `Only ${available} of ${product.name} available (${alreadyInCart} already in your cart)`,
        available,
        maxPurchasable: maxPurchasable(available),
      });
    }
    if (alreadyInCart + qty > MAX_QTY_PER_LINE) {
      return res.status(409).send({
        message: `You can buy at most ${MAX_QTY_PER_LINE} of one item (${alreadyInCart} already in your cart)`,
        available,
        maxPurchasable: MAX_QTY_PER_LINE,
      });
    }

    const subtotal = product.price * qty;

    if (cart) {
      // If cart exists for the user
      if (itemIndex > -1) {
        // If product already exists in cart, update quantity and subtotal
        cart.cartItems[itemIndex].quantity += qty;
        cart.cartItems[itemIndex].subtotal += subtotal;
      } else {
        // If product does not exist in cart, add new item
        cart.cartItems.push({ productId, quantity: qty, subtotal });
      }

      let totalPrice = 0;
      for (let i = 0; i < cart.cartItems.length; i++) {
        const item = cart.cartItems[i];
        const product = await Product.findById(item.productId);
        item.subtotal = product.price * item.quantity;
        totalPrice += item.subtotal;
      }
      cart.totalPrice = totalPrice;
    } else {
      // If no cart exists, create a new one
      cart = new Cart({
        userId,
        cartItems: [{ productId, quantity: qty, subtotal }],
        totalPrice: subtotal,
      });
    }

    await cart.save();
    res.status(200).send({
      success: true,
      message: `${product.name} added to cart successfully`,
      cart,
    });
  } catch (error) {
    res.status(500).send({ message: "Something went wrong", error: error.message });
  }
};

// Get cart items
module.exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await Cart.findOne({ userId }).populate("cartItems.productId");
    if (!cart) {
      return res.status(404).send({ message: "Cart not found" });
    }
    res.status(200).send(cart);
  } catch (error) {
    res.status(500).send({ message: "Something went wrong", error: error.message });
  }
};

// Helper function to calculate the total price of the cart
const calculateTotalPrice = (cartItems) => {
  return cartItems.reduce((total, item) => {
    if (isNaN(item.subtotal)) {
      console.warn(`Invalid subtotal for item: ${item}`);
      return total; // Skip this item if subtotal is NaN
    }
    return total + item.subtotal;
  }, 0);
};

// Update Product Quantity in Cart
module.exports.updateCartQuantity = async (req, res) => {
  try {
    if (!req.body.productId || !req.body.quantity) {
      return res
        .status(400)
        .send({ message: "Product ID and quantity are required" });
    }

    const productId = req.body.productId;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).send({ message: "Invalid product id" });
    }
    const quantity = Number(req.body.quantity); // Convert quantity to number

    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).send({ message: "Invalid quantity" });
    }

    const cart = await Cart.findOne({ userId: req.user.id }).populate(
      "cartItems.productId"
    );
    if (!cart) {
      return res.status(404).send({ message: "Cart not found" });
    }

    const itemIndex = cart.cartItems.findIndex(
      (item) => item.productId._id.toString() === productId
    );

    if (itemIndex > -1) {
      if (quantity === 0) {
        cart.cartItems.splice(itemIndex, 1);
      } else {
        const product = cart.cartItems[itemIndex].productId;
        if (product.isActive === false && quantity > cart.cartItems[itemIndex].quantity) {
          return res.status(409).send({
            message: `${product.name} is no longer available`,
            available: 0,
            maxPurchasable: 0,
          });
        }
        if (quantity > maxPurchasable(product.stock)) {
          return res.status(409).send({
            message:
              quantity > (product.stock ?? 0)
                ? `Only ${product.stock ?? 0} of ${product.name} available`
                : `You can buy at most ${MAX_QTY_PER_LINE} of one item`,
            available: product.stock ?? 0,
            maxPurchasable: maxPurchasable(product.stock),
          });
        }
        const updatedSubtotal = Number(product.price) * quantity;
        cart.cartItems[itemIndex].quantity = quantity;
        cart.cartItems[itemIndex].subtotal = updatedSubtotal;
      }
    } else if (quantity > 0) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).send({ message: "Product not found" });
      }
      if (product.isActive === false) {
        return res.status(409).send({
          message: `${product.name} is no longer available`,
          available: 0,
          maxPurchasable: 0,
        });
      }
      if (quantity > maxPurchasable(product.stock)) {
        return res.status(409).send({
          message:
            quantity > (product.stock ?? 0)
              ? `Only ${product.stock ?? 0} of ${product.name} available`
              : `You can buy at most ${MAX_QTY_PER_LINE} of one item`,
          available: product.stock ?? 0,
          maxPurchasable: maxPurchasable(product.stock),
        });
      }

      const newItem = {
        productId: product._id,
        quantity: quantity,
        subtotal: Number(product.price) * quantity,
      };

      cart.cartItems.push(newItem);
    }

    // Uses the shared helper: the old inline sum read `productId.price`, which is
    // undefined (NaN total) for a line just pushed with an unpopulated productId.
    const totalPrice = await recomputeCartTotal(cart.cartItems);

    if (isNaN(totalPrice)) {
      console.error("Total price calculation resulted in NaN:", totalPrice);
      return res.status(400).send({
        message: "Invalid totalPrice calculation",
        error: "totalPrice is NaN",
      });
    }

    cart.totalPrice = totalPrice;

    const updatedCart = await cart.save();
    res.status(200).send({
      message: "Cart updated successfully",
      cart: updatedCart,
    });
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).send({ message: "An error occurred", error: error.message });
  }
};

// [REMOVING FROM CART]
exports.removeFromCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).send({ message: "Cart not found" });
    }

    const itemIndex = cart.cartItems.findIndex((p) => p.productId == productId);
    if (itemIndex > -1) {
      const item = cart.cartItems[itemIndex];
      cart.totalPrice -= item.subtotal;

      cart.cartItems.splice(itemIndex, 1);
      await cart.save();
      let totalPrice = 0;
      for (let i = 0; i < cart.cartItems.length; i++) {
        const item = cart.cartItems[i];
        const product = await Product.findById(item.productId);
        item.subtotal = product.price * item.quantity;
        totalPrice += item.subtotal;
      }
      cart.totalPrice = totalPrice;
      return res.status(200).send({
        message: `Item removed from cart successfully`,
        cart,
      });
    } else {
      return res.status(404).send({ message: "Product not found in cart" });
    }
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};

// [CLEARING CART]
exports.clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).send({ message: "Cart not found" });
    }

    cart.cartItems = [];
    cart.totalPrice = 0;

    await cart.save();

    res.status(200).send({ message: "Cart cleared successfully", cart });
  } catch (error) {
    res.status(500).send({ message: "Something went wrong", error: error.message });
  }
};
