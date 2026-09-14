const Cart = require("../models/cart");
const Product = require("../models/product");

const { errorHandler } = require("../auth");

module.exports.addToCart = async (req, res) => {
  try {
    const userId = req.user.id; // Assuming you have user authentication and req.user is available
    const { productId, quantity } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }

    const subtotal = product.price * quantity;

    let cart = await Cart.findOne({ userId });

    if (cart) {
      // If cart exists for the user
      const itemIndex = cart.cartItems.findIndex(
        (p) => p.productId == productId
      );

      if (itemIndex > -1) {
        // If product already exists in cart, update quantity and subtotal
        cart.cartItems[itemIndex].quantity += quantity;
        cart.cartItems[itemIndex].subtotal += subtotal;
      } else {
        // If product does not exist in cart, add new item
        cart.cartItems.push({ productId, quantity, subtotal });
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
        cartItems: [{ productId, quantity, subtotal }],
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
    res.status(500).send({ message: errorHandler(error, req, res) });
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
    res.status(500).send({ message: errorHandler(error, req, res) });
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
    const quantity = Number(req.body.quantity); // Convert quantity to number

    if (isNaN(quantity) || quantity < 0) {
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
        const updatedSubtotal = Number(product.price) * quantity;
        cart.cartItems[itemIndex].quantity = quantity;
        cart.cartItems[itemIndex].subtotal = updatedSubtotal;
      }
    } else if (quantity > 0) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).send({ message: "Product not found" });
      }

      const newItem = {
        productId: product._id,
        quantity: quantity,
        subtotal: Number(product.price) * quantity,
      };

      cart.cartItems.push(newItem);
    }

    let totalPrice = cart.cartItems.reduce((sum, item) => {
      const itemPrice = Number(item.productId.price);
      const itemQuantity = Number(item.quantity);
      return sum + itemPrice * itemQuantity;
    }, 0);

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
    res.status(500).send({
      message: "An error occurred",
      error: errorHandler(error, req, res),
    });
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
    res.status(500).send({ message: errorHandler(error, req, res) });
  }
};
