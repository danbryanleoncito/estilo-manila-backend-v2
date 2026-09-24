const Order = require("../models/order");
const refund = require("./refund");
const incidents = require("./incidents");

// Finish a refund that was owed when the order was created (lines that were unavailable) but did
// not go through. Same refund key every time, and refund.js checks Stripe for it first, so it can
// never refund twice.
const reconcileOrder = async (order) => {
  if (order && order.pendingRefund > 0) {
    await refund.refundAmount(
      order.paymentIntentId,
      order.pendingRefund,
      `refund_${order.paymentIntentId}_instant`
    );
    await Order.updateOne({ _id: order._id }, { $set: { pendingRefund: 0 } });
    await incidents.resolve("refund-failed", order._id);
  }
  return order;
};

// Same, for callers that must not fail just because Stripe did: the order exists and the
// customer has paid, so a failed refund is recorded (and retried by the sweep) instead of
// turning a successful checkout into an error.
const safeReconcile = async (order) => {
  try {
    await reconcileOrder(order);
  } catch (err) {
    await incidents.report(
      "refund-failed",
      order._id,
      `Refund of ₱${order.pendingRefund} for order ${order._id} did not go through: ${err.message}`
    );
  }
  return order;
};

module.exports = { reconcileOrder, safeReconcile };
