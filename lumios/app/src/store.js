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

// Read and parse one JSON file, or return undefined if it's missing/corrupt.
function tryRead(file) {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return undefined;          // empty/truncated = treat as corrupt
  return JSON.parse(raw);
}

function read(name, fallback) {
  ensureDir();
  const file = path.join(DATA_DIR, name + ".json");
  const bak = file + ".bak";
  // Primary file first; if it's missing or was left half-written by a power
  // cut, fall back to the last good backup BEFORE ever resetting to defaults.
  try {
    const v = tryRead(file);
    if (v !== undefined) return v;
  } catch (e) {
    console.error(`[store] ${name}.json unreadable (${e.message}) — trying backup`);
  }
  try {
    const v = tryRead(bak);
    if (v !== undefined) {
      console.error(`[store] recovered ${name}.json from backup`);
      write(name, v);                          // heal the primary from the backup
      return v;
    }
  } catch (e) {
    console.error(`[store] ${name}.json.bak also unreadable:`, e.message);
  }
  if (fallback !== undefined) write(name, fallback);
  return fallback;
}

function write(name, obj) {
  ensureDir();
  const file = path.join(DATA_DIR, name + ".json");
  const tmp = file + ".tmp";
  const bak = file + ".bak";
  try {
    // Atomic swap: write a temp file, flush it to disk, keep the current good
    // copy as .bak, then rename temp over the real file. A crash at any point
    // leaves either the old file or the .bak intact — never a half-written one.
    const data = JSON.stringify(obj, null, 2);
    const fd = fs.openSync(tmp, "w");
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(file)) { try { fs.copyFileSync(file, bak); } catch {} }
    fs.renameSync(tmp, file);
    // Guarantee a backup exists even after the very first write, so a corruption
    // before the second write still has a good copy to recover from.
    if (!fs.existsSync(bak)) { try { fs.copyFileSync(file, bak); } catch {} }
  } catch (e) {
    console.error(`[store] could not write ${name}.json:`, e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
  return obj;
}

module.exports = { read, write, DATA_DIR };
