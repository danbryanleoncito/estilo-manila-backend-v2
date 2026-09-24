const mongoose = require("mongoose");

// Something that needs a human (or a retry) and would otherwise only exist as a console line:
// a refund that keeps failing, a dispute stuck half way, a payment with no matching snapshot.
// One row per (type, refId), so a problem that keeps recurring is counted, not duplicated.
const incidentSchema = new mongoose.Schema({
  type: { type: String, required: true },
  refId: { type: String, required: true },
  message: { type: String },
  count: { type: Number, default: 1 },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  resolved: { type: Boolean, default: false },
});

incidentSchema.index({ type: 1, refId: 1 }, { unique: true });
incidentSchema.index({ resolved: 1, lastSeen: -1 });

module.exports = mongoose.model("Incident", incidentSchema);
