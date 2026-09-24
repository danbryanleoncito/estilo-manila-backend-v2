const helpers = require("./helpers");
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mongoose } = helpers;
const User = require("../models/user");
const Product = require("../models/product");
const Cart = require("../models/cart");
const Incident = require("../models/incident");

let server;
let base;

before(async () => {
  await helpers.startDb();
  const { app } = require("../index");
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/b4`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await helpers.stopDb();
});
beforeEach(() => helpers.clearDb());

async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(raw === undefined && body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(raw !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { notJson: text.slice(0, 80) };
  }
  return { status: res.status, data };
}

const newUser = (over = {}) => ({
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  mobileNo: "09171234567",
  password: "Secret123!",
  image: "",
  ...over,
});

async function signUp(over) {
  const u = newUser(over);
  await call("POST", "/users/register", { body: u });
  const login = await call("POST", "/users/login", { body: { email: u.email, password: u.password } });
  return login.data.access;
}
async function signUpAdmin() {
  await call("POST", "/users/register", { body: newUser({ email: "admin@example.com" }) });
  await User.updateOne({ email: "admin@example.com" }, { isAdmin: true });
  const login = await call("POST", "/users/login", {
    body: { email: "admin@example.com", password: "Secret123!" },
  });
  return login.data.access;
}
const makeProduct = (over = {}) =>
  Product.create({ name: `P${Math.random()}`, description: "d", price: 100, image: "http://x/y", stock: 10, ...over });

describe("every failure answers in JSON", () => {
  it("malformed JSON body -> 400 JSON, not an HTML page", async () => {
    const r = await call("POST", "/users/login", { raw: "{not json" });
    assert.equal(r.status, 400);
    assert.ok(r.data.error && r.data.error.message, JSON.stringify(r.data));
  });
  it("unknown route -> 404 JSON", async () => {
    const r = await call("GET", "/nope");
    assert.equal(r.status, 404);
    assert.equal(r.data.message, "Route not found");
  });
});

describe("registration and login", () => {
  it("registers, stores the email lower-cased, and applies the default avatar", async () => {
    const r = await call("POST", "/users/register", { body: newUser({ email: "Ada@Example.com" }) });
    assert.equal(r.status, 201);
    const u = await User.findOne({});
    assert.equal(u.email, "ada@example.com");
    assert.match(u.image, /placehold/);
  });

  it("refuses a second account for the same email, whatever the case", async () => {
    await call("POST", "/users/register", { body: newUser() });
    const r = await call("POST", "/users/register", { body: newUser({ email: "ADA@example.com" }) });
    assert.equal(r.status, 409);
    assert.equal(await User.countDocuments(), 1);
  });

  it("missing or wrong-typed fields are a 400, not a crash", async () => {
    for (const body of [{}, { email: "a@b.c" }, newUser({ mobileNo: 9171234567 }), newUser({ firstName: "" })]) {
      const r = await call("POST", "/users/register", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok(r.data.message);
    }
  });

  it("enforces the password rules", async () => {
    for (const password of ["short1!", "nodigits!!", "NoSpecial123"]) {
      const r = await call("POST", "/users/register", { body: newUser({ password }) });
      assert.equal(r.status, 400, password);
    }
  });

  it("login always answers: no '@', wrong password, unknown email, missing fields", async () => {
    await call("POST", "/users/register", { body: newUser() });
    assert.equal((await call("POST", "/users/login", { body: { email: "no-at-sign", password: "x" } })).status, 404);
    assert.equal((await call("POST", "/users/login", { body: { email: "ada@example.com", password: "wrong" } })).status, 401);
    assert.equal((await call("POST", "/users/login", { body: { email: "who@example.com", password: "x" } })).status, 404);
    assert.equal((await call("POST", "/users/login", { body: {} })).status, 400);
  });

  it("login ignores the case of the email", async () => {
    await call("POST", "/users/register", { body: newUser() });
    const r = await call("POST", "/users/login", { body: { email: "ADA@EXAMPLE.COM", password: "Secret123!" } });
    assert.equal(r.status, 200);
    assert.ok(r.data.access);
  });

  it("details never contains a password hash", async () => {
    const token = await signUp();
    const r = await call("GET", "/users/details", { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.password, "");
    assert.ok(!JSON.stringify(r.data).includes("$2"));
  });
});

describe("listing users", () => {
  it("needs a login, then admin rights, and never returns password hashes", async () => {
    assert.equal((await call("GET", "/users/")).status, 401);
    const customer = await signUp();
    assert.equal((await call("GET", "/users/", { token: customer })).status, 403);
    const admin = await signUpAdmin();
    const r = await call("GET", "/users/", { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.data.length, 2);
    assert.ok(!JSON.stringify(r.data).includes("password"));
  });
});

describe("products", () => {
  it("a malformed id is a 404 (read) or 400 (write), never a 500", async () => {
    const admin = await signUpAdmin();
    assert.equal((await call("GET", "/product/not-an-id")).status, 404);
    assert.equal((await call("PATCH", "/product/not-an-id/update", { token: admin, body: { name: "x" } })).status, 400);
    assert.equal((await call("PATCH", "/product/not-an-id/archive", { token: admin })).status, 400);
    assert.equal((await call("PATCH", "/product/not-an-id/activate", { token: admin })).status, 400);
  });

  it("validates the price", async () => {
    const admin = await signUpAdmin();
    const good = { name: "Tee", description: "d", image: "http://x/y", stock: 1 };
    for (const price of [0, -5, "abc", undefined]) {
      const r = await call("POST", "/product", { token: admin, body: { ...good, price } });
      assert.equal(r.status, 400, String(price));
    }
    assert.equal((await call("POST", "/product", { token: admin, body: { ...good, price: 199.5 } })).status, 201);
    const p = await Product.findOne({});
    assert.equal((await call("PATCH", `/product/${p._id}/update`, { token: admin, body: { price: -1 } })).status, 400);
    assert.equal((await Product.findById(p._id)).price, 199.5);
  });

  it("search refuses an invalid or oversized pattern instead of failing", async () => {
    assert.equal((await call("POST", "/product/search-by-name", { body: { name: "(" } })).status, 400);
    assert.equal((await call("POST", "/product/search-by-name", { body: { name: "a".repeat(101) } })).status, 400);
  });
});

describe("the cart after a product was deleted", () => {
  async function cartWithDeletedProduct() {
    const token = await signUp();
    const keep = await makeProduct();
    const gone = await makeProduct();
    await call("POST", "/cart/add-to-cart", { token, body: { productId: String(keep._id), quantity: 1 } });
    await call("POST", "/cart/add-to-cart", { token, body: { productId: String(gone._id), quantity: 2 } });
    await Product.deleteOne({ _id: gone._id });
    return { token, keep, gone };
  }

  it("adding something else still works", async () => {
    const { token } = await cartWithDeletedProduct();
    const another = await makeProduct();
    const r = await call("POST", "/cart/add-to-cart", { token, body: { productId: String(another._id), quantity: 1 } });
    assert.equal(r.status, 200);
    const cart = await Cart.findOne({});
    assert.equal(cart.totalPrice, 200, "the dead line is not counted");
  });

  it("the dead line can be removed, and the stored total is right", async () => {
    const { token, gone } = await cartWithDeletedProduct();
    const r = await call("PATCH", `/cart/${gone._id}/remove-from-cart`, { token, body: {} });
    assert.equal(r.status, 200);
    const cart = await Cart.findOne({});
    assert.equal(cart.cartItems.length, 1);
    assert.equal(cart.totalPrice, 100, "recomputed, then saved");
  });

  it("changing a quantity drops the dead line instead of failing", async () => {
    const { token, keep } = await cartWithDeletedProduct();
    const r = await call("PATCH", "/cart/update-cart-quantity", { token, body: { productId: String(keep._id), quantity: 3 } });
    assert.equal(r.status, 200);
    const cart = await Cart.findOne({});
    assert.equal(cart.cartItems.length, 1);
    assert.equal(cart.totalPrice, 300);
  });

  it("a malformed product id on remove is a 400", async () => {
    const { token } = await cartWithDeletedProduct();
    assert.equal((await call("PATCH", "/cart/bad-id/remove-from-cart", { token, body: {} })).status, 400);
  });
});

describe("incidents", () => {
  it("are visible to admins only, unresolved ones only", async () => {
    await Incident.create({ type: "refund-failed", refId: "a", message: "open" });
    await Incident.create({ type: "refund-failed", refId: "b", message: "done", resolved: true });
    const customer = await signUp();
    assert.equal((await call("GET", "/order/incidents", { token: customer })).status, 403);
    const admin = await signUpAdmin();
    const r = await call("GET", "/order/incidents", { token: admin });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.incidents.map((i) => i.refId), ["a"]);
  });
});

it("a checkout server error does not leak internals", async () => {
  const token = await signUp();
  // Break the database call the handler makes, then check what the client is told.
  const original = Cart.findOneAndDelete;
  Cart.findOneAndDelete = () => {
    throw new Error("E11000 internal mongo detail");
  };
  let r;
  try {
    r = await call("POST", "/order/checkout", { token, body: { shippingAddress: helpers.validAddress() } });
  } finally {
    Cart.findOneAndDelete = original;
  }
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.data).includes("mongo detail"));
  assert.ok(r.data.message);
});

