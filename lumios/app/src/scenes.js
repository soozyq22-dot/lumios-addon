/* ============================================================
   scenes.js — data-driven scenes
   ------------------------------------------------------------
   A scene is a named list of device actions. Running one fans the
   actions out through deviceManager. Because scenes are data (not
   code) they can be created/edited from the Admin screen.
   Persisted to /data/scenes.json.
   ============================================================ */
const CONFIG = require("../config");
const store = require("./store");
const dm = require("./devices/deviceManager");
const audit = require("./audit");
const bus = require("./bus");

let SCENES = store.read("scenes", JSON.parse(JSON.stringify(CONFIG.DEFAULT_SCENES)));
function persist() { store.write("scenes", SCENES); }

function list() { return SCENES; }
function get(key) { return SCENES[key]; }

function upsert(key, scene) {
  SCENES[key] = scene;
  persist();
  return SCENES[key];
}
function remove(key) {
  delete SCENES[key];
  persist();
}

// expand target "all" / "{room}" into concrete ids for a device type (per location)
function expandTargets(locId, device, target, room) {
  const state = dm.getState(locId);
  if (target === "{room}") return [room];
  if (target !== "all") return [target];
  if (device === "door") return Object.keys(state.doors);
  if (device === "camera") return Object.keys(state.cams);
  if (device === "shade") return Object.keys(state.zones).filter((z) => state.zones[z].hasShade !== false);
  return Object.keys(state.zones); // light / temp / music
}

async function applyAction(locId, a, room, ctx) {
  // Security is building-wide (no per-zone target).
  if (a.device === "security") {
    try { await dm.setSecurity(locId, a.mode, { ...ctx }); } catch (e) { console.error("[scene] security:", e.message); }
    return;
  }
  // Signage: target a sign id or "all".
  if (a.device === "sign") {
    const sigs = a.target === "all" ? (dm.getState(locId).signage || []).map((s) => s.id) : [a.target];
    for (const sid of sigs) {
      try { await dm.setSignage(locId, sid, { on: a.on, mode: a.mode, brightness: a.brightness }, { ...ctx, log: false }); }
      catch (e) { console.error("[scene] sign:", e.message); }
    }
    return;
  }
  // Shades are individual devices. target: "all", a shade id, "{room}", or a zone id (→ sh_<zone>).
  if (a.device === "shade") {
    const shades = dm.getState(locId).shades || [];
    let ids;
    if (a.target === "all") ids = shades.map((s) => s.id);
    else { const t = a.target === "{room}" ? room : a.target; ids = shades.filter((s) => s.id === t || s.id === "sh_" + t).map((s) => s.id); }
    for (const id of ids) {
      try { await dm.setOneShade(locId, id, a.level, { ...ctx, log: false }); } catch (e) { console.error("[scene] shade:", e.message); }
    }
    return;
  }
  const ids = expandTargets(locId, a.device, a.target, room);
  for (const id of ids) {
    try {
      if (a.device === "door") await dm.setDoor(locId, id, a.op === "lock", { ...ctx, log: false });
      else if (a.device === "light") await dm.setLight(locId, id, a.on, a.dim, { ...ctx, log: false });
      else if (a.device === "cct") await dm.setCct(locId, id, a.value, { ...ctx, log: false });
      else if (a.device === "temp") await dm.setTemp(locId, id, a.value, { ...ctx, log: false });
      else if (a.device === "music") await dm.setMusic(locId, id, a.playlist, a.vol, { ...ctx, log: false });
      else if (a.device === "camera") await dm.setCamera(locId, id, { alert: a.alert, nightMode: a.nightMode }, ctx);
    } catch (e) {
      console.error(`[scene] action failed (${a.device}/${id}):`, e.message);
    }
  }
}

async function run(key, ctx = {}, opts = {}) {
  const sc = SCENES[key];
  if (!sc) throw new Error("Unknown scene");
  const locId = opts.loc || "main";
  const room = opts.room || sc.defaultRoom || "room1";
  for (const a of sc.actions) await applyAction(locId, a, room, ctx);

  const label = sc.perRoom ? `${sc.name} — ${dm.getState(locId).zones[room]?.name || room}` : sc.name;
  audit.record({ msg: `Scene: ${label}`, who: ctx.who, role: ctx.role, category: "scene", loc: locId });
  bus.emit("scene", { loc: locId, key, label });
  return { key, label };
}

module.exports = { list, get, upsert, remove, run };
