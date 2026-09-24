const Cart = require("../models/cart");
const Product = require("../models/product");

const mongoose = require("mongoose");
const { recomputeCartTotal } = require("../utils/cartTotal");
const { MAX_QTY_PER_LINE, maxPurchasable } = require("../utils/limits");
const { serverError } = require("../utils/respond");

// Totals in the cart screens skip lines whose product was deleted (checkout and payment still
// refuse them), so one dead line cannot make every cart action fail.
const totalOf = (cartItems) => recomputeCartTotal(cartItems, { skipMissing: true });

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

      cart.totalPrice = await totalOf(cart.cartItems);
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
    serverError(res, "Could not add the item to your cart", error);
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
    serverError(res, "Could not load your cart", error);
  }
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

    // A line whose product was deleted comes back populated as null; it can never be bought
    // again, so drop it here rather than let it fail the save ("productId is required").
    cart.cartItems = cart.cartItems.filter((item) => item.productId);

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
    cart.totalPrice = await totalOf(cart.cartItems);

    const updatedCart = await cart.save();
    res.status(200).send({
      message: "Cart updated successfully",
      cart: updatedCart,
    });
  } catch (error) {
    serverError(res, "Could not update your cart", error);
  }
};

// [REMOVING FROM CART]
exports.removeFromCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).send({ message: "Invalid product id" });
    }

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).send({ message: "Cart not found" });
    }

    const itemIndex = cart.cartItems.findIndex((p) => p.productId == productId);
    if (itemIndex === -1) {
      return res.status(404).send({ message: "Product not found in cart" });
    }

    cart.cartItems.splice(itemIndex, 1);
    // Recompute first, then save: the old code saved before recomputing, so the corrected
    // total was never stored.
    cart.totalPrice = await totalOf(cart.cartItems);
    await cart.save();
    return res.status(200).send({
      message: `Item removed from cart successfully`,
      cart,
    });
  } catch (error) {
    serverError(res, "Could not remove the item from your cart", error);
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
    serverError(res, "Could not clear your cart", error);
  }
};
