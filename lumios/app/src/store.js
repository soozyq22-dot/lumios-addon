/* ============================================================
   store.js — tiny zero-dependency JSON persistence layer
   ------------------------------------------------------------
   Reads/writes JSON files under /data. This stands in for a
   database so LumiOS runs with nothing installed. To move to
   PostgreSQL later, reimplement read()/write() against your DB
   — nothing else in the app touches the filesystem.
   ============================================================ */
const fs = require("fs");
const path = require("path");

// Where the JSON files live. Defaults next to the code, but the Home Assistant
// add-on sets LUMIOS_DATA_DIR=/data so settings survive updates + restarts.
const DATA_DIR = process.env.LUMIOS_DATA_DIR || path.join(__dirname, "..", "data");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read(name, fallback) {
  ensureDir();
  const file = path.join(DATA_DIR, name + ".json");
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[store] could not read ${name}.json:`, e.message);
  }
  if (fallback !== undefined) write(name, fallback);
  return fallback;
}

function write(name, obj) {
  ensureDir();
  const file = path.join(DATA_DIR, name + ".json");
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error(`[store] could not write ${name}.json:`, e.message);
  }
  return obj;
}

module.exports = { read, write, DATA_DIR };
