const auth = require("../auth");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/user");
const { errorHandler } = require("../auth");
const { serverError } = require("../utils/respond");

// Emails are compared case-insensitively (Ada@x.com and ada@x.com are the same person), which
// also covers accounts that were saved before emails were lower-cased.
const CASE_INSENSITIVE = { locale: "en", strength: 2 };
const findByEmail = (email) => User.findOne({ email }).collation(CASE_INSENSITIVE);

const isText = (value) => typeof value === "string" && value.trim() !== "";

// The password rules, in one place (used by registration and by changing a password).
const passwordProblem = (password) => {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be atleast 8 characters";
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return "Password must have at least one special character";
  }
  if (!/\d/.test(password)) {
    return "Password must have at least one number";
  }
  return null;
};

// [USER REGISTRATION]
module.exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, mobileNo, password, image } = req.body || {};

    if (![firstName, lastName, email, mobileNo, password].every(isText)) {
      return res.status(400).send({ message: "All fields are required" });
    }
    if (!email.includes("@")) {
      return res.status(400).send({ message: "Invalid email format" });
    }
    if (mobileNo.length !== 11 || !mobileNo.startsWith("09")) {
      return res.status(400).send({ message: "Mobile number is invalid" });
    }
    const problem = passwordProblem(password);
    if (problem) {
      return res.status(400).send({ message: problem });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (await findByEmail(normalizedEmail)) {
      return res.status(409).send({ message: "That email is already registered" });
    }

    const newUser = new User({
      firstName,
      lastName,
      email: normalizedEmail,
      mobileNo,
      password: bcrypt.hashSync(password, 10),
      // An empty avatar falls back to the schema default instead of storing "".
      image: isText(image) ? image : undefined,
    });

    await newUser.save();
    return res.status(201).send({ message: "User registered successfully" });
  } catch (error) {
    return errorHandler(error, req, res);
  }
};

// [USER LOGIN]
module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!isText(email) || typeof password !== "string") {
      return res.status(400).send({ message: "Email and password are required" });
    }

    const user = await findByEmail(email.trim());
    if (user == null) {
      return res.status(404).send({ message: "No email found" });
    }
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).send({ message: "Email and password do not match" });
    }
    return res.status(200).send({
      message: "User logged in successfully",
      access: auth.createAccessToken(user),
    });
  } catch (error) {
    return errorHandler(error, req, res);
  }
};

// [USER DETAILS]
module.exports.details = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      // if the user has invalid token, send a message 'invalid signature'.
      return res.status(403).send({ message: "Invalid signature" });
    }
    const { password, ...safe } = user.toObject();
    return res.status(200).send({ ...safe, password: "" });
  } catch (error) {
    return errorHandler(error, req, res);
  }
};

// Admin only (see routes/user.js). Never includes password hashes.
module.exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, "-password");
    if (users.length > 0) {
      return res.status(200).send(users);
    }
    return res.status(200).send({ message: "No users found" });
  } catch (error) {
    return errorHandler(error, req, res);
  }
};

// [UPDATE PASSWORD]
module.exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const { id } = req.user; // Get the user ID from the authenticated token

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return res.status(400).send({ message: "Current and new password are required" });
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      return res.status(400).send({ message: problem });
    }

    // Find the user by ID
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // Check if the current password is correct
    const isPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).send({ message: "Incorrect current password" });
    }

    // Hash the new password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Send success response
    res.status(200).send({ message: "Password updated successfully" });
  } catch (error) {
    serverError(res, "Could not update your password", error);
  }
};

module.exports.updateAdminStatus = async (req, res) => {
  const userId = req.params.id; // Get the user ID from the URL parameter

  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(400).send({ message: "A valid user ID is required" });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    user.isAdmin = true; // Set to false if removing admin status
    await user.save();

    // Send success response
    res.status(200).send({ message: "User status updated successfully" });
  } catch (error) {
    serverError(res, "Could not update the user", error);
  }
};
