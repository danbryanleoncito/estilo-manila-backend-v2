const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Product Name is Required"],
    // Add a text index for efficient searching
    index: true,
  },
  description: {
    type: String,
    required: [true, "Product Description is Required"],
  },
  price: {
    type: Number,
    required: [true, "Price is Required"],
  },
  image: {
    type: String,
    required: [true, "Image is required"],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdOn: {
    type: Date,
    default: Date.now,
  },
});

// Create a text index for the name field
productSchema.index({ name: "text" });

module.exports = mongoose.model("Product", productSchema);
