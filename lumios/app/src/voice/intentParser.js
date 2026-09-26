/* ============================================================
   intentParser.js — natural-language → intent
   ------------------------------------------------------------
   Maps a spoken/typed phrase to a structured intent the server
   can execute. Pure & dependency-free so it's easy to test and
   could be swapped for an LLM-backed parser later.

   Returns one of:
     { type:"scene",  scene, room? }
     { type:"temp",   zone, value }
     { type:"light",  zone, on, dim? }
     { type:"music",  zone, on, playlist? }
     { type:"door",   door, lock }
     { type:"camera", action:"show", camId? }
     { type:"unknown" }
   ============================================================ */

// ids must match the real zone ids in config (Reception/Waiting 101 … Break Room 106).
const ZONE_WORDS = [
  { id: "room1",     re: /\b(room\s*(1|one)|treatment\s*(1|one|104))\b/ },
  { id: "room2",     re: /\b(room\s*(2|two)|treatment\s*(2|two|105))\b/ },
  { id: "pedicure",  re: /\b(pedi|pedicure)\b/ },
  { id: "manicure",  re: /\b(mani|manicure)\b/ },
  { id: "reception", re: /\b(reception|lobby|front desk|waiting)\b/ },
  { id: "break",     re: /\b(break\s*room|breakroom|break)\b/ },
  { id: "bath1",     re: /\b(restroom|bathroom|washroom)\b/ },
];

function findZone(t) {
  for (const z of ZONE_WORDS) if (z.re.test(t)) return z.id;
  return null;
}

function parse(said) {
  const t = String(said || "").toLowerCase().trim();
  if (!t) return { type: "unknown" };

  // --- scenes ---
  if (/(good\s*morning|open up|open the spa|opening time|we'?re open)/.test(t)) return { type: "scene", scene: "open" };
  if (/(lock up|close up|good\s*night|closing time|shut down|end of day)/.test(t)) return { type: "scene", scene: "close" };
  // Security: handle "disarm" and "arm home" BEFORE the Away scene (note "disarm"
  // contains the substring "arm", so these specific cases must win first).
  if (/\bdisarm\b|alarm off|turn off the alarm/.test(t)) return { type: "security", mode: "disarmed" };
  if (/\barm\b.*(home|stay)|arm.*at home|home mode/.test(t)) return { type: "security", mode: "home" };
  if (/\barm\b|away mode|alarm on|i'?m leaving|set the alarm/.test(t)) return { type: "scene", scene: "away" };

  const zone = findZone(t);

  // "Treatment mode" scene — but only when it's NOT actually a control verb
  // like "dim treatment room 2 to 40%" (there "treatment room 2" is the room name).
  const isControlVerb = /(dim|bright|light|shade|blind|temp|degree|thermostat|music|play|volume|lock|unlock|%)/.test(t);
  if (/treatment/.test(t) && !isControlVerb) return { type: "scene", scene: "treat", room: zone || "room1" };

  // --- whole-spa / grouped audio ---  "play calm spa everywhere", "music everywhere off"
  const everywhere = /(everywhere|whole spa|all zones|all rooms|across the spa|the whole salon)/.test(t);
  if (/(music|play|playlist|volume|audio)/.test(t) && everywhere) {
    if (/\b(off|stop|pause|silence|quiet)\b/.test(t)) return { type: "musicAll", on: false };
    const vm = t.match(/(\d{1,3})\s*(?:%|percent)/) || t.match(/\bto\s+(\d{1,3})\b/);
    const pl = ["Calm Spa", "Lofi Lounge", "Upbeat Pop", "Nature Sounds"].find((p) => t.includes(p.toLowerCase().split(" ")[0]));
    return { type: "musicAll", on: true, playlist: pl || "Calm Spa", vol: vm ? Math.min(100, +vm[1]) : 25 };
  }

  // --- motorized shades ---  "close shade 5", "shade 3 to 40%", "raise all shades"
  if (/(shade|blind|curtain)/.test(t)) {
    const numM = t.match(/\b(?:shade|blind|curtain)s?\s*(?:number|no\.?)?\s*([1-8])\b/);
    const target = numM ? "num:" + numM[1] : (zone || "all");
    const sm = t.match(/(\d{1,3})\s*(?:%|percent)/) || t.match(/\bto\s+(\d{1,3})\b/);
    let level;
    if (sm) level = Math.min(100, +sm[1]);
    else if (/\b(open|raise|up)\b/.test(t)) level = 100;
    else if (/\b(close|lower|down|shut)\b/.test(t)) level = 0;
    else level = 100;
    return { type: "shade", zone: target, level };
  }

  // --- doors ---  e.g. "lock the back door", "unlock front"
  if (/(lock|unlock|open|close)\b/.test(t) && /(door|entrance|front|back)/.test(t)) {
    const door = /back/.test(t) ? "back" : "front";
    const lock = /\bunlock\b|\bopen\b/.test(t) ? false : true;
    return { type: "door", door, lock };
  }

  // --- temperature ---  "set lobby to 72", "make room 2 warmer/74 degrees"
  const tempM = t.match(/\b(\d{2})\b/);
  if (/(temp|degree|thermostat|warmer|cooler|heat|cool|set .* to \d{2})/.test(t) && zone && tempM) {
    return { type: "temp", zone, value: +tempM[1] };
  }

  // --- dim / brightness ---  "dim pedicure to 40%", "brighten room 1"
  if (/(dim|bright|brighten)/.test(t) && zone) {
    // prefer a number tied to "%/percent" or "to NN", not a room number like "room 2"
    const m = t.match(/(\d{1,3})\s*(?:%|percent)/) || t.match(/\bto\s+(\d{1,3})\b/);
    const dim = m ? Math.min(100, +m[1]) : (/dim/.test(t) ? 35 : 90);
    return { type: "light", zone, on: true, dim };
  }

  // --- lights on/off ---
  if (/light/.test(t) && zone) {
    return { type: "light", zone, on: !/\boff\b/.test(t) };
  }

  // --- music ---
  if (/(music|play|playlist|song|volume)/.test(t) && zone) {
    if (/\b(off|stop|pause|quiet)\b/.test(t)) return { type: "music", zone, on: false };
    return { type: "music", zone, on: true, playlist: "Calm Spa" };
  }

  // --- cameras ---
  if (/(show|view|pull up|check).*(camera|cam|feed)/.test(t)) {
    let camId = null;
    if (/back/.test(t)) camId = "back";
    else if (/(retail|floor|shop)/.test(t)) camId = "retail";
    else if (/(front|entry|entrance)/.test(t)) camId = "entry";
    return { type: "camera", action: "show", camId };
  }

  return { type: "unknown" };
}

module.exports = { parse, findZone };
