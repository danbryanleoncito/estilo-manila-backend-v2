const Product = require("../models/product");

const User = require("../models/user");
const { errorHandler } = require("../auth");

module.exports.addProduct = (req, res) => {
  // Creates a variable "newProduct" and instantiates a new "Product" object using the mongoose model
  // Uses the information from the request body to provide all the necessary information

  let newProduct = new Product({
    name: req.body.name,
    description: req.body.description,
    price: req.body.price,
    image: req.body.image,
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
      // if the result is not null send status 30 and its result
      if (result.length > 0) {
        return res.status(200).send(result);
      } else {
        // 404 for not found product
        return res.status(404).send({ message: "No Products Found" });
      }
    })
    .catch((error) => errorHandler(error, req, res));
};

module.exports.getAllActive = (req, res) => {
  Product.find({ isActive: true })
    .then((result) => {
      if (result.length > 0) {
        //if the product is active, return the product.
        return res.status(200).send(result);
      } else {
        //if there is no active product, return 'No active product found'.
        return res.status(200).send({ message: "No active product found" });
      }
    })
    .catch((err) => res.status(500).send(err));
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
  let updatedProduct = {
    name: req.body.name,
    description: req.body.description,
    price: req.body.price,
    image: req.body.image,
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
