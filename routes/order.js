const express = require("express");
const orderController = require("../controllers/order");
const router = express.Router();
const auth = require("../auth");

const { verify, verifyAdmin } = auth;

router.post("/checkout", verify, orderController.checkout);
router.get("/my-orders", verify, orderController.getLoggedUserOrders);

// New route for retrieving all orders
router.get("/all-orders", verify, verifyAdmin, orderController.getAllOrders);

module.exports = router;
