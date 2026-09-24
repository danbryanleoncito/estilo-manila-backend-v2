const { validAddress } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseShippingAddress } = require("../utils/address");

test("a complete address is accepted and normalised", () => {
  const r = parseShippingAddress(
    validAddress({ fullName: "  Ada   Lovelace ", phone: "+63 917-123-4567", city: "  Makati  " })
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.address, {
    fullName: "Ada Lovelace",
    phone: "09171234567",
    addressLine1: "12 Rizal Street",
    addressLine2: "Unit 4B",
    city: "Makati",
    province: "Metro Manila",
    postalCode: "1200",
    country: "Philippines",
  });
});

test("the second address line is optional and left out when blank", () => {
  const r = parseShippingAddress(validAddress({ addressLine2: "   " }));
  assert.equal(r.ok, true);
  assert.equal("addressLine2" in r.address, false);
});

test("the country defaults to the Philippines, and only the Philippines is accepted", () => {
  assert.equal(parseShippingAddress(validAddress({ country: undefined })).address.country, "Philippines");
  assert.equal(parseShippingAddress(validAddress({ country: "philippines" })).ok, true);
  const r = parseShippingAddress(validAddress({ country: "United Arab Emirates" }));
  assert.equal(r.ok, false);
  assert.equal(r.field, "country");
});

test("every required field is checked and named in the refusal", () => {
  const cases = [
    ["fullName", { fullName: "A" }],
    ["fullName", { fullName: "" }],
    ["phone", { phone: "12345" }],
    ["phone", { phone: "08171234567" }],
    ["addressLine1", { addressLine1: "x" }],
    ["addressLine2", { addressLine2: "y".repeat(101) }],
    ["city", { city: "" }],
    ["province", { province: "" }],
    ["postalCode", { postalCode: "12" }],
    ["postalCode", { postalCode: "12ab" }],
    ["postalCode", { postalCode: "12345" }],
  ];
  for (const [field, over] of cases) {
    const r = parseShippingAddress(validAddress(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.field, field, JSON.stringify(over));
    assert.ok(r.message);
  }
});

test("missing, null, a string or an array is refused, not a crash", () => {
  for (const input of [undefined, null, "12 Rizal St", 5, []]) {
    const r = parseShippingAddress(input);
    assert.equal(r.ok, false);
    assert.equal(r.field, "shippingAddress");
  }
});

test("non-text values in text fields are refused, not coerced", () => {
  assert.equal(parseShippingAddress(validAddress({ city: 5 })).ok, false);
  assert.equal(parseShippingAddress(validAddress({ fullName: { $ne: "" } })).ok, false);
  assert.equal(parseShippingAddress(validAddress({ postalCode: 1200 })).ok, false);
});

test("unknown fields are dropped", () => {
  const r = parseShippingAddress({ ...validAddress(), isAdmin: true, $where: "x" });
  assert.equal(r.ok, true);
  assert.equal("isAdmin" in r.address, false);
  assert.equal("$where" in r.address, false);
});
