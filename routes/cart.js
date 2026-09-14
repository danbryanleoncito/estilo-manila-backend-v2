const express = require("express");
const cartController = require("../controllers/cart");
const router = express.Router();
const auth = require("../auth");

const { verify, verifyAdmin } = auth;

router.post("/add-to-cart", verify, cartController.addToCart);
router.get("/get-cart", verify, cartController.getCart);

// Route for updating cart quantity
router.patch(
  "/update-cart-quantity",
  verify,
  cartController.updateCartQuantity
);

// [ROUTE FOR REMOVING ITEM FROM CART]
router.patch(
  "/:productId/remove-from-cart",
  verify,
  cartController.removeFromCart
);

// [ROUTE FOR CLEARING ITEMS FROM CART]
router.put("/clear-cart", verify, cartController.clearCart);

module.exports = router;
