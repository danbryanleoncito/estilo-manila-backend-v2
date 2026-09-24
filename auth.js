const jwt = require("jsonwebtoken");

require("dotenv").config();

// [CREATING ACCESS TOKEN]
module.exports.createAccessToken = (user) => {
  const data = {
    id: user._id,
    email: user.email,
    isAdmin: user.isAdmin,
  };
  return jwt.sign(data, process.env.JWT_SECRET_KEY, {});
};

// [TOKEN VERIFICATION]
module.exports.verify = (req, res, next) => {
  let token = req.headers.authorization;

  if (typeof token === "undefined") {
    return res.status(401).send({ auth: "Failed. No Token" });
  } else {
    token = token.slice(7, token.length);

    jwt.verify(token, process.env.JWT_SECRET_KEY, function (err, decodedToken) {
      if (err) {
        return res.status(403).send({
          auth: "Failed",
          message: err.message,
        });
      } else {
        req.user = decodedToken;
        next();
      }
    });
  }
};

// [VERIFYING ADMIN]
module.exports.verifyAdmin = (req, res, next) => {
  if (req.user.isAdmin) {
    next();
  } else {
    return res.status(403).send({
      auth: "Failed",
      message: "Action Forbidden",
    });
  }
};

//[ERROR HANDLER]
// Used both as a helper (`.catch((e) => errorHandler(e, req, res))`) and as the app's final
// Express error middleware. Known client mistakes get a 4xx with a readable message; anything
// else is logged in full and answered with a generic 500, so database and Stripe internals never
// reach the browser.
module.exports.errorHandler = (err, req, res, next) => {
  if (res.headersSent) return;

  let status = 500;
  let message = "Internal Server Error";
  let errorCode = "SERVER_ERROR";

  if (err && err.type === "entity.parse.failed") {
    status = 400;
    message = "Request body is not valid JSON";
    errorCode = "INVALID_JSON";
  } else if (err && err.name === "ValidationError") {
    status = 400;
    message = Object.values(err.errors || {})
      .map((e) => e.message)
      .join(", ") || "Invalid data";
    errorCode = "VALIDATION_ERROR";
  } else if (err && err.name === "CastError") {
    status = 400;
    message = "Invalid id or value";
    errorCode = "INVALID_VALUE";
  } else if (err && err.code === 11000) {
    status = 409;
    message = "That already exists";
    errorCode = "DUPLICATE";
  } else if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    status = err.status;
    message = err.message || "Bad request";
  } else {
    console.error(err);
  }

  res.status(status).json({ error: { message, errorCode, details: null } });
};

// [VERIFY LOG IN]
module.exports.isLoggedIn = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.sendStatus(401);
  }
};
