const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/user.js");

//[SECTION] Activity: Allows access to routes defined within our application
const productRoutes = require("./routes/product");

const cartRoutes = require("./routes/cart");

const orderRoutes = require("./routes/order");

const app = express();
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

mongoose.connect(process.env.MONGO_STRING);
mongoose.connection.once("open", () =>
  console.log("Now connected to MongoDB.")
);

// [ROUTERS]
app.use("/b4/users", userRoutes);

//[SECTION] Activity: Add course routes
app.use("/b4/product", productRoutes);

//[SECTION] Cart routes
app.use("/b4/cart", cartRoutes);

//[SECTION] Order routes
app.use("/b4/order", orderRoutes);

// https.createServer(sslOptions, app).listen(443, () => {
//   console.log("HTTPS Server running on port 443");
// });

if (require.main === module) {
  app.listen(process.env.PORT || 3004, () => {
    console.log(`API is now online on port ${process.env.PORT || 3004}`);
  });
}

module.exports = { app, mongoose };
