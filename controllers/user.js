const auth = require("../auth");
const bcrypt = require("bcrypt");
const passport = require("passport");
const User = require("../models/user");
const { errorHandler } = require("../auth");

// [USER REGISTRATION]
module.exports.register = (req, res) => {
  let specialCharacters = /[!@#$%^&*(),.?":{}|<>]/;
  let numberCharacters = /\d/;
  if (!req.body.email.includes("@")) {
    return res.status(400).send({ message: "Invalid email format" });
  } else if (
    req.body.mobileNo.length !== 11 ||
    !req.body.mobileNo.startsWith("09")
  ) {
    return res.status(400).send({ message: "Mobile number is invalid" });
  } else if (req.body.password.length < 8) {
    return res
      .status(400)
      .send({ message: "Password must be atleast 8 characters" });
  } else if (!specialCharacters.test(req.body.password)) {
    return res
      .status(400)
      .send({ message: "Password must have at least one special character" });
  } else if (!numberCharacters.test(req.body.password)) {
    return res
      .status(400)
      .send({ message: "Password must have at least one number" });
  } else {
    let newUser = new User({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      mobileNo: req.body.mobileNo,
      password: bcrypt.hashSync(req.body.password, 10),
      image: req.body.image,
    });

    return newUser
      .save()
      .then((result) =>
        res.status(201).send({
          message: "User registered successfully",
        })
      )
      .catch((error) => error);
  }
};

// [USER LOGIN]
module.exports.login = (req, res) => {
  if (req.body.email.includes("@")) {
    return User.findOne({ email: req.body.email }).then((result) => {
      if (result == null) {
        return res.status(404).send({ message: "No email found" });
      } else {
        const isPasswordCorrect = bcrypt.compareSync(
          req.body.password,
          result.password
        );
        if (isPasswordCorrect) {
          return res.status(200).send({
            message: "User logged in successfully",
            access: auth.createAccessToken(result),
          });
        } else {
          return res
            .status(401)
            .send({ message: "Email and password do not match" });
        }
      }
    });
  }
};

// [USER DETAILS]
module.exports.details = (req, res) => {
  return User.findById(req.user.id)
    .then((user) => {
      if (!user) {
        // if the user has invalid token, send a message 'invalid signature'.
        return res.status(403).send({ message: "Invalid signature" });
      } else {
        // if the user is found, return the user.
        user.password = "";
        return res.status(200).send(user);
      }
    })
    .catch((error) => errorHandler(error, req, res));
};

module.exports.getAllUsers = (req, res) => {
  User.find({}).then((result) => {
    if (result.length > 0) {
      return res.status(200).send(result);
    } else {
      return res.status(200).send({ message: "No users found" });
    }
  });
};

// [UPDATE PASSWORD]
module.exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { id } = req.user; // Get the user ID from the authenticated token

    // Find the user by ID
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // Check if the current password is correct
    const isPasswordCorrect = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isPasswordCorrect) {
      return res.status(401).send({ message: "Incorrect current password" });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the password in the database
    user.password = hashedPassword;
    await user.save();

    // Send success response
    res.status(200).send({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
};

module.exports.updateAdminStatus = async (req, res) => {
  const userId = req.params.id; // Get the user ID from the URL parameter

  if (!userId) {
    return res.status(400).send({ message: "User ID is required" });
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
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
};
