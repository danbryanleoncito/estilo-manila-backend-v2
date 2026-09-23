const Product = require("../models/product");

const User = require("../models/user");
const { errorHandler } = require("../auth");

const mongoose = require("mongoose");
const { maxPurchasable } = require("../utils/limits");

// Live stock for the quantity limiter. Advisory only (the atomic decrement at purchase time
// is what actually prevents overselling), so a short in-memory cache is safe and keeps a
// crowd of viewers from hammering MongoDB. Single-instance only; use Redis if scaled out.
const STOCK_CACHE_TTL_MS = 2000;
const MAX_STOCK_IDS = 50;
const stockCache = new Map(); // id -> { stock, at }

// GET /product/stock?ids=a,b,c  ->  { [id]: { stock, maxPurchasable } }
module.exports.getStockBatch = async (req, res) => {
  try {
    const ids = [
      ...new Set(
        String(req.query.ids || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
    if (ids.length === 0 || ids.length > MAX_STOCK_IDS) {
      return res
        .status(400)
        .send({ message: `Provide between 1 and ${MAX_STOCK_IDS} product ids` });
    }
    if (!ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).send({ message: "Invalid product id" });
    }

    const now = Date.now();
    const missing = ids.filter((id) => {
      const hit = stockCache.get(id);
      return !hit || now - hit.at > STOCK_CACHE_TTL_MS;
    });
    if (missing.length > 0) {
      const docs = await Product.find({ _id: { $in: missing } }, "stock").lean();
      const found = new Set();
      for (const d of docs) {
        stockCache.set(String(d._id), { stock: d.stock ?? 0, at: now });
        found.add(String(d._id));
      }
      // Unknown products are not cached, so a later-created id is picked up immediately.
      for (const id of missing) if (!found.has(id)) stockCache.delete(id);
    }

    const result = {};
    for (const id of ids) {
      const hit = stockCache.get(id);
      if (hit) result[id] = { stock: hit.stock, maxPurchasable: maxPurchasable(hit.stock) };
    }
    res.set("Cache-Control", "public, max-age=2");
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to load stock", error: error.message });
  }
};

// Returns the stock as a number, undefined when not supplied, or null when invalid.
const parseStock = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

module.exports.addProduct = (req, res) => {
  const stock = parseStock(req.body.stock);
  if (stock === null) {
    return res
      .status(400)
      .send({ message: "Stock must be a whole number of 0 or more" });
  }

  // Creates a variable "newProduct" and instantiates a new "Product" object using the mongoose model
  // Uses the information from the request body to provide all the necessary information

  let newProduct = new Product({
    name: req.body.name,
    description: req.body.description,
    price: req.body.price,
    image: req.body.image,
    stock,
  });

  //[SECTION] Activity: Validate if product already exists
  //Check if product exists using the findOne() method
  Product.findOne({ name: req.body.name })
    .then((existingProduct) => {
      //if existing product return true

      // Notice that we didn't response directly in string, instead we added an object with a value of a string. This is a proper response from API to Client. Direct string will only cause an error when connecting it to your frontend.

      // using res.send({ key: value }) is a common and appropriate way to structure a response from an API to the client. This approach allows you to send structured data back to the client in the form of a JSON object, where "key" represents a specific piece of data or a property, and "value" is the corresponding value associated with that key.
      if (existingProduct) {
        return res.status(409).send({ message: "Product Already Exists" });
      } else {
        //if not duplicate, save the product
        return (
          newProduct
            .save()
            /*
            Response Body: The response body is a JSON object containing key-value pairs. It can be:

                - success: true - sending a boolean value of true indicates that the product was added successfully.
                
                - message: A descriptive message indicating that the product was added successfully. This provides clear feedback to the client about the outcome of their request.

                - result: Additional details about the newly created product. Including the result of the creation operation in the response allows the client to immediately access information about the newly created resource without needing to make an additional request.
            */
            .then((result) =>
              res.status(201).send({
                success: true,
                message: "Product Added Successfully",
                result: result,
              })
            )
            .catch((error) => errorHandler(error, req, res))
        );
      }
    })
    .catch((error) => errorHandler(error, req, res));
};

module.exports.getAllProduct = (req, res) => {
  return Product.find({})
    .then((result) => {
      //always return an array, even when empty, so the frontend
      //can rely on a consistent shape regardless of catalog state.
      return res.status(200).send(result);
    })
    .catch((error) => errorHandler(error, req, res));
};

module.exports.getAllActive = (req, res) => {
  Product.find({ isActive: true })
    .then((result) => {
      //always return an array, even when empty, so the frontend
      //can rely on a consistent shape regardless of catalog state.
      return res.status(200).send(result);
    })
    .catch((err) => errorHandler(err, req, res));
};

module.exports.getProduct = (req, res) => {
  Product.findById(req.params.productId)
    .then((product) => {
      if (product) {
        //if the product is found, return the product.
        return res.status(200).send(product);
      } else {
        //if the product is not found, return 'Product not found'.
        return res.status(404).send({ message: "Product not found" });
      }
    })
    .catch((error) => errorHandler(error, req, res));
};

module.exports.updateProduct = (req, res) => {
  const stock = parseStock(req.body.stock);
  if (stock === null) {
    return res
      .status(400)
      .send({ message: "Stock must be a whole number of 0 or more" });
  }

  let updatedProduct = {
    name: req.body.name,
    description: req.body.description,
    price: req.body.price,
    image: req.body.image,
    stock,
  };

  // findByIdandUpdate() finds the the document in the db and updates it automatically
  // req.body is used to retrieve data from the request body, commonly through form submission
  // req.params is used to retrieve data from the request parameters or the url
  // req.params.productId - the id used as the reference to find the document in the db retrieved from the url
  // updatedCourse - the updates to be made in the document
  return Product.findByIdAndUpdate(req.params.productId, updatedProduct)
    .then((product) => {
      if (product) {
        //add status 200
        res
          .status(200)
          .send({ success: true, message: "Product updated successfully" });
      } else {
        // add status 404
        res.status(404).send({ message: "Product not found" });
      }
    })
    .catch((error) => errorHandler(error, req, res));
};

// [SECTION] For archiving a product
module.exports.archiveProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findByIdAndUpdate(
      productId,
      { isActive: false },
      { new: true }
    );

    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    res.status(200).send({
      message: "Product archived successfully",
      product,
    });
  } catch (error) {
    res.status(500).send({ message: "Server error", error: error.message });
  }
};

module.exports.activateProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findByIdAndUpdate(
      productId,
      { isActive: true },
      { new: true }
    );

    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    res.status(200).send({
      message: "Product activated successfully",
      product,
    });
  } catch (error) {
    res.status(500).send({ message: "Server error", error: error.message });
  }
};

module.exports.searchByName = (req, res) => {
  const { name } = req.body;

  // Validate the input
  if (!name || typeof name !== "string") {
    return res.status(400).send({ message: "Invalid product name" });
  }

  // Search for products with names containing the search term
  Product.find({ name: { $regex: name, $options: "i" } })
    .then((products) => {
      if (products.length > 0) {
        return res.status(200).send(products);
      } else {
        return res.status(404).send({ message: "No products found" });
      }
    })
    .catch((error) => errorHandler(error, req, res));
};

module.exports.searchByPrice = (req, res) => {
  const { minPrice, maxPrice } = req.body;

  // Validate the input
  if (minPrice == null || maxPrice == null) {
    return res.status(400).send({ message: "Min and Max price are required" });
  }

  // Ensure minPrice and maxPrice are numbers
  const min = parseFloat(minPrice);
  const max = parseFloat(maxPrice);

  if (isNaN(min) || isNaN(max)) {
    return res.status(400).send({ message: "Invalid price values" });
  }

  Product.find({ price: { $gte: min, $lte: max } })
    .then((products) => {
      if (products.length > 0) {
        return res.status(200).send(products);
      } else {
        return res
          .status(404)
          .send({ message: "No products found in this price range" });
      }
    })
    .catch((error) => errorHandler(error, req, res));
};