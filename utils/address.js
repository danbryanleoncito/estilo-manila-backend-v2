// Delivery address on an order. Validated and normalised here, once, for both payment paths
// (Cash on Delivery at checkout, card at payment-intent creation).
//
// Fields: fullName, phone, addressLine1, addressLine2 (optional), city, province, postalCode, country.
// The store delivers within the Philippines only.

const COUNTRY = "Philippines";

const text = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

// Accepts 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes allowed) and stores 09XXXXXXXXX.
const normalisePhone = (value) => {
  const digits = text(value).replace(/[\s-]/g, "");
  if (/^\+639\d{9}$/.test(digits)) return "0" + digits.slice(3);
  if (/^09\d{9}$/.test(digits)) return digits;
  return null;
};

const fail = (field, message) => ({ ok: false, field, message });

module.exports.parseShippingAddress = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("shippingAddress", "A delivery address is required");
  }

  const fullName = text(input.fullName);
  if (fullName.length < 2 || fullName.length > 100) {
    return fail("fullName", "Enter the recipient's full name");
  }

  const phone = normalisePhone(input.phone);
  if (!phone) {
    return fail("phone", "Enter a Philippine mobile number, like 0917 123 4567");
  }

  const addressLine1 = text(input.addressLine1);
  if (addressLine1.length < 5 || addressLine1.length > 200) {
    return fail("addressLine1", "Enter the street address (house number and street)");
  }

  const addressLine2 = text(input.addressLine2);
  if (addressLine2.length > 100) {
    return fail("addressLine2", "Apartment, suite or building is too long");
  }

  const city = text(input.city);
  if (city.length < 2 || city.length > 80) {
    return fail("city", "Enter the city or municipality");
  }

  const province = text(input.province);
  if (province.length < 2 || province.length > 80) {
    return fail("province", "Enter the province or region");
  }

  const postalCode = text(input.postalCode);
  if (!/^\d{4}$/.test(postalCode)) {
    return fail("postalCode", "Enter the 4-digit postal code");
  }

  const country = text(input.country) || COUNTRY;
  if (country.toLowerCase() !== COUNTRY.toLowerCase()) {
    return fail("country", `We only deliver within ${COUNTRY}`);
  }

  return {
    ok: true,
    address: {
      fullName,
      phone,
      addressLine1,
      ...(addressLine2 ? { addressLine2 } : {}),
      city,
      province,
      postalCode,
      country: COUNTRY,
    },
  };
};

// The mongoose sub-schema, shared by Order and PaymentSnapshot so they cannot drift apart.
module.exports.addressSchemaDefinition = {
  fullName: { type: String },
  phone: { type: String },
  addressLine1: { type: String },
  addressLine2: { type: String },
  city: { type: String },
  province: { type: String },
  postalCode: { type: String },
  country: { type: String },
};

module.exports.COUNTRY = COUNTRY;
