const express = require("express");
const { verify, isLoggedIn } = require("../auth");
const passport = require("passport");
const userController = require("../controllers/user");

const router = express.Router();
const { verifyAdmin } = require("../auth");

router.post("/register", userController.register);
router.post("/login", userController.login);
router.get("/details", verify, userController.details);
// router.patch("/update-password", verify, userController.updatePassword);
router.get("/", userController.getAllUsers); //For testing. DELETE WHEN DONE

// [SECTION] Route for updating user password
router.patch("/update-password", verify, userController.updatePassword);

// [SECTION] Route for updating another user's admin status (Admin only)
router.patch(
  "/:id/set-as-admin/",
  verify,
  verifyAdmin,
  userController.updateAdminStatus
);

module.exports = router;
