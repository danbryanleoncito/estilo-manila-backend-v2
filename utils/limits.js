// Hard cap on units of one product in a single cart line (two digits, per the spec).
const MAX_QTY_PER_LINE = 99;

// The most a customer can buy of a product right now: live stock, capped at 99.
const maxPurchasable = (stock) => Math.min(MAX_QTY_PER_LINE, Math.max(0, stock ?? 0));

module.exports = { MAX_QTY_PER_LINE, maxPurchasable };
