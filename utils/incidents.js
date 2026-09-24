const Incident = require("../models/incident");

// Recording a problem must never be able to cause another one, so both functions swallow their
// own errors (and say so on the console).

module.exports.report = async (type, refId, message) => {
  console.error(`[incident] ${type} ${refId}: ${message}`);
  try {
    await Incident.findOneAndUpdate(
      { type, refId: String(refId) },
      {
        $set: { message: String(message).slice(0, 500), lastSeen: new Date(), resolved: false },
        $inc: { count: 1 },
        $setOnInsert: { firstSeen: new Date() },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error("[incident] could not be recorded:", err.message);
  }
};

module.exports.resolve = async (type, refId) => {
  try {
    await Incident.updateOne({ type, refId: String(refId), resolved: false }, { $set: { resolved: true } });
  } catch (err) {
    console.error("[incident] could not be resolved:", err.message);
  }
};
