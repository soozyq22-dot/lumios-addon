/* ============================================================
   audit.js — tamper-evident activity & security log
   ------------------------------------------------------------
   Records WHO did WHAT and WHEN, with a category so the
   security-sensitive events (doors, logins, scenes) can be
   filtered. Persisted to /data/audit.json.
   ============================================================ */
const store = require("./store");
const bus = require("./bus");

let LOG = store.read("audit", []);

function record({ msg, who = "system", role = "system", category = "info", loc = "main" }) {
  const entry = {
    id: "ev_" + Date.now().toString(36) + Math.floor(performance.now() % 1000).toString(36),
    ts: new Date().toISOString(),
    t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    msg, who, role, category, loc,
  };
  LOG.unshift(entry);
  LOG = LOG.slice(0, 500);
  store.write("audit", LOG);
  bus.emit("log", entry);
  return entry;
}

function list(limit = 80) {
  return LOG.slice(0, limit);
}

module.exports = { record, list };
