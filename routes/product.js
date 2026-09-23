const express = require("express");
const productController = require("../controllers/product");
const router = express.Router();
const auth = require("../auth");

const { verify, verifyAdmin } = auth;

//[SECTION] Activity: Route for creating a product
router.post("/", verify, verifyAdmin, productController.addProduct);

//[SECTION] Activity: Route for retrieving all product
router.get("/all", verify, verifyAdmin, productController.getAllProduct);

//[SECTION] Two added routes for the activity
router.get("/active", productController.getAllActive);

router.get("/:productId", productController.getProduct);

//[SECTION] Route for updating a product (Admin)
router.patch(
  "/:productId/update",
  verify,
  verifyAdmin,
  productController.updateProduct
);

// [SECTION] Route for archiving a product (Admin)
router.patch(
  "/:productId/archive",
  verify,
  verifyAdmin,
  productController.archiveProduct
);

// [SECTION] Route for activating a product (Admin)
router.patch(
  "/:productId/activate",
  verify,
  verifyAdmin,
  productController.activateProduct
);

// [SECTION] Route for searching products by name
router.post("/search-by-name", productController.searchByName);

// [SECTION] Route for searching products by price range
router.post("/search-by-price", productController.searchByPrice);

module.exports = router;
