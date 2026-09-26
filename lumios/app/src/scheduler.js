/* ============================================================
   scheduler.js — time schedules + after-hours triggers
   ------------------------------------------------------------
   - Schedules run a scene at a set time on set weekdays
     (e.g. Open at 09:00, Close at 19:00).
   - Triggers react to events (after-hours motion → Away + alert).
   Both are data-driven and editable from the Admin screen.
   Persisted to /data/automation.json.
   ============================================================ */
const CONFIG = require("../config");
const store = require("./store");
const scenes = require("./scenes");
const dm = require("./devices/deviceManager");
const bus = require("./bus");
const audit = require("./audit");

let AUTO = store.read("automation", {
  schedules: JSON.parse(JSON.stringify(CONFIG.DEFAULT_SCHEDULES)),
  triggers: JSON.parse(JSON.stringify(CONFIG.DEFAULT_TRIGGERS)),
});
function persist() { store.write("automation", AUTO); }

let lastRunKey = "";  // guards against double-firing within the same minute

function getAll() { return AUTO; }
function setSchedules(list) { AUTO.schedules = list; persist(); }
function setTriggers(list) { AUTO.triggers = list; persist(); }

function isAfterHours(d = new Date()) {
  const h = d.getHours();
  const { afterHoursStart, afterHoursEnd } = CONFIG.HOURS;
  return h >= afterHoursStart || h < afterHoursEnd;
}

// Called every tick (~30s). Fires any schedule whose time matches now.
async function tick() {
  dm.powerTick(); // drain/charge the UPS battery so the energy tile stays live
  dm.autoLightTick(); // motion-lighting: auto-off quiet rooms
  dm.fridgeTick(); // log medical-fridge temperature
  dm.checklistTick(); // reset the open/close checklist on a new day

  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const dow = now.getDay(); // 0=Sun..6=Sat
  const minuteKey = now.toDateString() + " " + hhmm;
  if (minuteKey === lastRunKey) return;

  for (const s of AUTO.schedules) {
    if (!s.enabled) continue;
    if (s.time !== hhmm) continue;
    if (Array.isArray(s.days) && !s.days.includes(dow)) continue;
    const locId = s.location || "main";
    if (!dm.hasLocation(locId)) continue;
    lastRunKey = minuteKey;
    try {
      await scenes.run(s.scene, { who: "scheduler", role: "system" }, { loc: locId });
      audit.record({ msg: `⏰ Scheduled "${s.label || s.scene}" ran`, who: "scheduler", role: "system", category: "scene", loc: locId });
      if (s.scene === "close" || s.scene === "away") dm.pushDigest(locId); // owner daily digest at close
    } catch (e) {
      console.error("[scheduler] failed:", e.message);
    }
  }
}

// Called by deviceManager.raiseMotion via the bus.
async function onMotion({ loc = "main", camId, name }) {
  if (!isAfterHours()) return;
  const trg = AUTO.triggers.find((t) => t.enabled && t.type === "after_hours_motion");
  if (!trg) return;
  audit.record({ msg: `🚨 After-hours motion at ${name} → running "${trg.scene}"`, who: "trigger", role: "system", category: "alert", loc });
  try { await scenes.run(trg.scene, { who: "trigger", role: "system" }, { loc }); } catch (e) {}
  bus.emit("push", { title: "LumiOS Security Alert", body: `Motion detected at ${name} after hours.` });
}

let timer = null;
function start() {
  if (timer) return;
  bus.on("alert", (a) => onMotion(a));
  timer = setInterval(() => tick().catch(() => {}), 30 * 1000);
  tick().catch(() => {});
  console.log("[scheduler] running (checks every 30s)");
}

module.exports = { start, getAll, setSchedules, setTriggers, isAfterHours };
