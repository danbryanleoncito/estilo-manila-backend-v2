// One-off, idempotent: gives every product that has no `stock` field a starting stock.
// Usage: node scripts/backfillStock.js [startingStock]   (default 25)
// Run it against the database you are about to deploy the stock feature to (MONGO_STRING).
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/product");

async function run() {
  const stock = Number(process.argv[2] ?? 25);
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error("startingStock must be a whole number of 0 or more");
  }

  await mongoose.connect(process.env.MONGO_STRING);
  const result = await Product.updateMany(
    { stock: { $exists: false } },
    { $set: { stock } }
  );
  console.log(
    `Set stock=${stock} on ${result.modifiedCount} product(s) that had none (${result.matchedCount} matched).`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
