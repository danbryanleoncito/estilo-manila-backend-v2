require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/user.js");

//[SECTION] Activity: Allows access to routes defined within our application
const productRoutes = require("./routes/product");

const cartRoutes = require("./routes/cart");

const orderRoutes = require("./routes/order");

const paymentRoutes = require("./routes/payment");
const paymentController = require("./controllers/payment");
const { expireDisputes } = require("./utils/disputes");
const { errorHandler } = require("./auth");
const incidents = require("./utils/incidents");

const app = express();

// Stripe webhook needs the raw request body for signature verification, so it must be
// registered before the global express.json() parser below.
app.post(
  "/b4/payment/webhook",
  express.raw({ type: "application/json" }),
  paymentController.handleWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://estillo-manila.vercel.app"
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Tests (NODE_ENV=test) connect to their own in-memory database instead.
if (process.env.NODE_ENV !== "test") {
  mongoose.connect(process.env.MONGO_STRING).catch((err) => {
    // Without a database nothing works: say so and stop, so the host restarts us, instead of
    // serving errors forever.
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
  mongoose.connection.once("open", () =>
    console.log("Now connected to MongoDB.")
  );
}

// A promise nobody caught must never take the server down silently; it is logged.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

// [ROUTERS]
app.use("/b4/users", userRoutes);

//[SECTION] Activity: Add course routes
app.use("/b4/product", productRoutes);

//[SECTION] Cart routes
app.use("/b4/cart", cartRoutes);

//[SECTION] Order routes
app.use("/b4/order", orderRoutes);

//[SECTION] Payment routes
app.use("/b4/payment", paymentRoutes);

// Anything that matched no route, and anything a route threw, answers in JSON like the rest of
// the API (the Express default is an HTML page, with a stack trace outside production).
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});
app.use(errorHandler);

// https.createServer(sslOptions, app).listen(443, () => {
//   console.log("HTTPS Server running on port 443");
// });

if (require.main === module) {
  app.listen(process.env.PORT || 3004, () => {
    console.log(`API is now online on port ${process.env.PORT || 3004}`);
  });

  // Auto-cancel + refund shortfall disputes the customer never resolved (24h), and finish
  // any that got stuck. Runs at boot (Render may have slept through an expiry) and every
  // 5 minutes. Only when run directly, never when imported.
  const sweepDisputes = () =>
    expireDisputes()
      .then((r) => {
        if (r.expired || r.retried || r.refundsRetried) console.log("Dispute sweep:", r);
        return incidents.resolve("sweep-failed", "dispute-sweep");
      })
      .catch((err) => incidents.report("sweep-failed", "dispute-sweep", err.message));
  sweepDisputes();
  setInterval(sweepDisputes, 5 * 60 * 1000);
}

module.exports = { app, mongoose };
