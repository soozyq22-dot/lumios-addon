/* ============================================================
   LumiOS — server
   ------------------------------------------------------------
   Zero-dependency Node HTTP server: REST API, Server-Sent Events
   for real-time device state, static app + admin UI, auth, RBAC,
   rate-limiting, scenes, scheduler and the voice endpoint.

   Run:  node server.js     →  http://localhost:4200
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const CONFIG = require("./config");
const auth = require("./src/auth");
const perms = require("./src/permissions");
const dm = require("./src/devices/deviceManager");
const scenes = require("./src/scenes");
const scheduler = require("./src/scheduler");
const automation = scheduler;
const audit = require("./src/audit");
const bus = require("./src/bus");
const push = require("./src/push");
const voice = require("./src/voice/intentParser");

/* ---------------- helpers ---------------- */
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}
function err(res, code, message) { send(res, code, { error: message }); }

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

function tokenFrom(req, url) {
  const h = req.headers["authorization"];
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return url.searchParams.get("token");
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}
// Rewrite the URLs inside an HLS manifest so the player fetches every variant,
// init and segment back through our own /api/hls proxy (carrying the token).
// Rewritten refs are query-only ("?path=...&token=...") so they resolve relative
// to the manifest's own URL — which keeps working under Home Assistant ingress.
function rewriteHls(text, manifestHaPath, token) {
  const dir = manifestHaPath.slice(0, manifestHaPath.lastIndexOf("/") + 1);
  const resolve = (ref) => {
    if (/^https?:\/\//i.test(ref)) { try { const u = new URL(ref); return u.pathname + u.search; } catch { return ref; } }
    if (ref.startsWith("/")) return ref;
    return dir + ref;
  };
  const wrap = (ref) => "?path=" + encodeURIComponent(resolve(ref)) + "&token=" + encodeURIComponent(token);
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => `URI="${wrap(u)}"`);
    return wrap(t);
  }).join("\n");
}

// resolve the location for a request: ?loc= or X-Location header, default main,
// constrained to what the user may access.
function resolveLoc(user, url, req) {
  const all = dm.listLocations().map((l) => l.id);
  const allowed = perms.userLocations(user, all);
  let want = url.searchParams.get("loc") || req.headers["x-location"] || allowed[0] || "main";
  if (!allowed.includes(want)) want = allowed[0] || "main";
  return want;
}

// build the state payload a given user is allowed to see, for one location
function statePayload(user, locId) {
  const s = dm.getState(locId);
  const p = perms.perms(user.role);
  const all = dm.listLocations();
  return {
    location: locId,
    locationName: s.name,
    locations: all.filter((l) => perms.canLocation(user, l.id)),
    zones: s.zones,
    hvac: s.hvac || { mode: "heat_cool" },
    doors: s.doors,
    shades: s.shades || [],
    playlists: s.playlists,
    audioGroups: s.audioGroups || [],
    cams: p.cameras ? s.cams : {},          // hide cameras from staff/guest
    aiEvents: p.cameras ? (s.aiEvents || []).slice(0, 30) : [],
    security: s.security,
    safety: p.cameras ? (s.safety || []) : [],
    power: dm.powerSnapshot(locId),
    equipment: p.allZones ? (s.equipment || []) : [],
    sterilization: p.allZones ? (s.sterilization || []).slice(0, 60) : [],
    fridges: p.allZones ? (s.fridges || []).map((f) => ({ ...f, readings: (f.readings || []).slice(0, 24) })) : [],
    turnover: s.turnover || {},
    checklist: s.checklist || { open: [], close: [] },
    diffusers: s.diffusers || [],
    scents: s.scents || [],
    display: s.display || {},
    signage: s.signage || [],
    scenes: scenes.list(),
    automation: automation.getAll(),
    driver: dm.driverName,
    me: user,
    perms: {
      cameras: p.cameras, doors: p.doors, manageUsers: p.manageUsers,
      editScenes: p.editScenes, editSchedules: p.editSchedules, allZones: p.allZones,
      scenes: p.scenes, zones: user.zones || [], role: user.role, security: p.security,
    },
    hours: { open: CONFIG.HOURS.openLabel, close: CONFIG.HOURS.closeLabel },
  };
}

/* ---------------- monthly compliance report (printable HTML) ---------------- */
function complianceReport(user, locId) {
  const s = dm.getState(locId);
  const esc = (v) => String(v == null ? "" : v).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const since = (e) => new Date(e.ts).getTime() >= cutoff;
  const steril = (s.sterilization || []).filter(since);
  const fridge = dm.listFridgeReadings(locId).filter(since).slice(0, 120);
  const secEvents = audit.list(500).filter((e) => (e.loc || "main") === locId && since(e) && ["access", "door", "alert", "security"].includes(e.category));
  const row = (cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
  const dt = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lumi Compliance Report</title>
  <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:900px;margin:24px auto;padding:0 20px;line-height:1.5}
  h1{color:#2b2018;font-size:22px}h2{color:#9a6f35;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin-top:26px;border-bottom:2px solid #c9a96e;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}th,td{border-bottom:1px solid #eee;padding:6px 8px;text-align:left}th{background:#faf4f7}
  .bad{color:#bf5b50;font-weight:700}.ok{color:#6f9e7e}.btn{background:#2b2018;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer}
  @media print{.btn{display:none}}</style></head><body>
  <div style="text-align:right"><button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button></div>
  <h1>Lumi Nails &amp; Med Spa — Compliance Report</h1>
  <p style="color:#8a7f70">${esc(s.name || "Main")} · last 30 days · generated ${new Date().toLocaleString()} · by ${esc(user.name)}</p>
  <h2>Autoclave sterilization (${steril.length} cycles)</h2>
  <table><tr><th>When</th><th>Operator</th><th>Load</th><th>Cycle</th><th>Result</th><th>Spore</th></tr>
  ${steril.map((r) => `<tr><td>${dt(r.ts)}</td><td>${esc(r.operator)}</td><td>${esc(r.load)}</td><td>${esc(r.cycleType)}</td><td class="${r.result === "Pass" ? "ok" : "bad"}">${esc(r.result)}</td><td>${esc(r.spore)}</td></tr>`).join("") || row(["— none logged —"])}</table>
  <h2>Medical fridge temperature log (${fridge.length} readings)</h2>
  <table><tr><th>When</th><th>Fridge</th><th>Temp °F</th><th>Safe range</th><th>Status</th></tr>
  ${fridge.map((r) => `<tr><td>${dt(r.ts)}</td><td>${esc(r.fridge)}</td><td>${r.temp}</td><td>${r.min}–${r.max}</td><td class="${r.ok === "OK" ? "ok" : "bad"}">${r.ok}</td></tr>`).join("") || row(["— none logged —"])}</table>
  <h2>Access &amp; security events (${secEvents.length})</h2>
  <table><tr><th>When</th><th>Event</th><th>User</th></tr>
  ${secEvents.slice(0, 200).map((e) => `<tr><td>${dt(e.ts)}</td><td>${esc(e.msg)}</td><td>${esc(e.who)}</td></tr>`).join("") || row(["— none —"])}</table>
  <p style="color:#8a7f70;font-size:11px;margin-top:24px">Generated by LumiOS. Retain for your records / inspections.</p>
  </body></html>`;
}

/* ---------------- SSE (real-time state) ---------------- */
const sseClients = new Set();
function sseBroadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) { try { c.write(payload); } catch {} }
}
bus.on("change", (d) => sseBroadcast("change", { scope: d.scope, loc: d.loc }));
bus.on("log", (e) => sseBroadcast("log", e));
bus.on("scene", (e) => sseBroadcast("scene", { key: e.key, label: e.label, loc: e.loc }));
bus.on("alert", (e) => sseBroadcast("alert", { name: e.name, loc: e.loc, locName: e.locName, ai: e.ai }));
bus.on("push", (e) => sseBroadcast("push", e));
bus.on("locations", (list) => sseBroadcast("locations", list));

/* ---------------- static files ---------------- */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.join(__dirname, "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(path.join(__dirname, "public"))) return err(res, 403, "Forbidden");
  fs.readFile(file, (e, buf) => {
    if (e) { err(res, 404, "Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

/* ---------------- request router ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const method = req.method;

  // --- public auth routes ---
  if (method === "POST" && pathname === "/api/login") {
    const b = await readBody(req);
    try { return send(res, 200, auth.loginPassword(b.username, b.password, clientIp(req))); }
    catch (e) { return err(res, 401, e.message); }
  }
  if (method === "POST" && pathname === "/api/2fa") {
    const b = await readBody(req);
    try { return send(res, 200, auth.verify2FA(b.challengeId, b.code, clientIp(req))); }
    catch (e) { return err(res, 401, e.message); }
  }
  if (method === "POST" && pathname === "/api/pin") {
    const b = await readBody(req);
    try { return send(res, 200, auth.loginPin(b.pin, clientIp(req))); }
    catch (e) { return err(res, 401, e.message); }
  }

  // --- everything below /api requires a session ---
  if (pathname.startsWith("/api")) {
    const user = auth.sessionUser(tokenFrom(req, url));
    if (!user) return err(res, 401, "Not signed in");
    const p = perms.perms(user.role);
    const locId = resolveLoc(user, url, req);
    const ctx = { who: user.username, role: user.role, loc: locId };

    // me / logout
    if (method === "GET" && pathname === "/api/me") return send(res, 200, { user, perms: statePayload(user, locId).perms });
    if (method === "POST" && pathname === "/api/logout") { auth.endSession(tokenFrom(req, url)); return send(res, 200, { ok: true }); }

    // full state (for the active location)
    if (method === "GET" && pathname === "/api/state") return send(res, 200, statePayload(user, locId));

    // ---- locations ----
    if (method === "GET" && pathname === "/api/locations")
      return send(res, 200, dm.listLocations().filter((l) => perms.canLocation(user, l.id)));
    if (method === "POST" && pathname === "/api/locations") {
      if (!p.manageUsers) return err(res, 403, "Only the owner can add locations");
      const b = await readBody(req);
      try { const r = dm.addLocation(b.id, b.name); audit.record({ msg: `Location "${r.name}" added`, ...ctx, category: "config" }); return send(res, 200, r); }
      catch (e) { return err(res, 400, e.message); }
    }
    if (method === "PUT" && pathname.startsWith("/api/locations/")) {
      if (!p.manageUsers) return err(res, 403, "Only the owner can edit locations");
      const id = decodeURIComponent(pathname.split("/")[3]); const b = await readBody(req);
      try { dm.renameLocation(id, b.name); return send(res, 200, { ok: true }); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "DELETE" && pathname.startsWith("/api/locations/")) {
      if (!p.manageUsers) return err(res, 403, "Only the owner can remove locations");
      const id = decodeURIComponent(pathname.split("/")[3]);
      try { dm.removeLocation(id); audit.record({ msg: `Location "${id}" removed`, ...ctx, category: "config" }); return send(res, 200, { ok: true }); }
      catch (e) { return err(res, 400, e.message); }
    }

    // SSE stream
    if (method === "GET" && pathname === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
      req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }

    // ---- device control ----
    if (method === "POST" && pathname === "/api/door") {
      if (!auth.rateOk("door:" + user.username, CONFIG.LOCK_RATE_LIMIT.max, CONFIG.LOCK_RATE_LIMIT.windowSec))
        return err(res, 429, "Too many lock/unlock attempts — slow down");
      const b = await readBody(req);
      const door = dm.getState(locId).doors[b.door];
      if (!door) return err(res, 400, "Unknown door");
      if (door.room) {
        if (!perms.canZone(user, door.zone)) return err(res, 403, "You don't have access to this room");
      } else if (!perms.canDoors(user)) {
        return err(res, 403, "Your role can't control entry doors");
      }
      try { return send(res, 200, await dm.setDoor(locId, b.door, !!b.lock, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/light") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.setLight(locId, b.zone, b.on, b.dim, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/shade") {
      if (user.role === "guest") return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, await dm.setOneShade(locId, b.id, b.level, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/cct") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.setCct(locId, b.zone, b.value, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/color") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.setColor(locId, b.zone, b.color, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/light/auto") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, dm.setAutoLight(locId, b.zone, b.on, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/zone/motion") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.motion(locId, b.zone, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/light/preset/apply") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.applyLightPreset(locId, b.zone, b.name, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/light/preset/save") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, dm.saveLightPreset(locId, b.zone, b.name, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/light/preset/delete") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, dm.deleteLightPreset(locId, b.zone, b.name, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/shade/all") {
      if (!p.allZones) return err(res, 403, "Whole-spa shades need manager or owner");
      const b = await readBody(req);
      try { await dm.setShadeGroup(locId, b.level, b.shades, ctx); return send(res, 200, { ok: true }); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/temp") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.setTemp(locId, b.zone, b.value, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/temp/salon") {
      if (!p.allZones) return err(res, 403, "Salon temperature needs manager or owner");
      const b = await readBody(req);
      try { return send(res, 200, await dm.setSalonTemp(locId, b.value, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/temp/salon/mode") {
      if (!p.allZones) return err(res, 403, "Salon temperature needs manager or owner");
      const b = await readBody(req);
      try { return send(res, 200, await dm.setSalonMode(locId, b.mode, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/music") {
      const b = await readBody(req);
      if (!perms.canZone(user, b.zone)) return err(res, 403, "Not your assigned zone");
      try { return send(res, 200, await dm.setMusic(locId, b.zone, b.playlist, b.vol, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/music/all") {
      if (!p.allZones) return err(res, 403, "Whole-spa audio needs manager or owner");
      const b = await readBody(req);
      try { await dm.setMusicGroup(locId, b.playlist, b.vol, b.zones, ctx); return send(res, 200, { ok: true }); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/audio/group") {
      if (!p.allZones) return err(res, 403, "Sound zones need manager or owner");
      const b = await readBody(req);
      try { await dm.setAudioGroup(locId, b.groupId, b.playlist, b.vol, ctx); return send(res, 200, { ok: true }); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "PUT" && pathname === "/api/audio/groups") {
      if (!p.editScenes) return err(res, 403, "Can't edit sound zones");
      const b = await readBody(req);
      try { return send(res, 200, dm.updateAudioGroups(locId, b.groups, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/security") {
      if (!p.cameras) return err(res, 403, "Only owner/manager can arm or disarm");
      const b = await readBody(req);
      try { return send(res, 200, await dm.setSecurity(locId, b.mode, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/security/panic") {
      if (!p.cameras) return err(res, 403, "Owner/manager only");
      try { return send(res, 200, await dm.panic(locId, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/security/silence") {
      if (!p.cameras) return err(res, 403, "Owner/manager only");
      try { return send(res, 200, await dm.silence(locId, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/safety/test") {
      if (!p.cameras) return err(res, 403, "Owner/manager only");
      const b = await readBody(req);
      try { return send(res, 200, await dm.triggerSafety(locId, b.id, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/safety/clear") {
      if (!p.cameras) return err(res, 403, "Owner/manager only");
      const b = await readBody(req);
      try { return send(res, 200, dm.clearSafety(locId, b.id, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/simulate/outage") {
      const b = await readBody(req);
      dm.setGrid(locId, b.onGrid === undefined ? false : !!b.onGrid, ctx);
      return send(res, 200, dm.powerSnapshot(locId));
    }
    if (method === "POST" && pathname.startsWith("/api/camera/") && pathname.endsWith("/feed")) {
      if (!p.cameras) return err(res, 403, "No camera access");
      const camId = pathname.split("/")[3];
      try { return send(res, 200, await dm.getCameraFeed(locId, camId)); } catch (e) { return err(res, 400, e.message); }
    }
    // Live cameras discovered from the hub (Home Assistant)
    if (method === "GET" && pathname === "/api/cameras/live") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const allDbg = url.searchParams.get("all") === "1";
      try { return send(res, 200, { cameras: await dm.listLiveCameras(locId, { all: allDbg }) }); } catch (e) { return err(res, 400, e.message); }
    }
    // Proxy a live JPEG snapshot from the hub so the browser can show the feed.
    // Token may come via ?token= so it works as an <img> src.
    if (method === "GET" && pathname === "/api/camera_proxy") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const entity = url.searchParams.get("entity") || "";
      try {
        const { buffer, contentType } = await dm.cameraSnapshot(entity);
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
        return res.end(buffer);
      } catch (e) { return err(res, 502, e.message); }
    }
    // Full-motion HLS: ask the hub to start a video stream, return the playable URL.
    if (method === "GET" && pathname === "/api/camera_hls") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const entity = url.searchParams.get("entity") || "";
      try { return send(res, 200, { url: await dm.cameraStreamUrl(entity, "hls") }); } catch (e) { return err(res, 502, e.message); }
    }
    // Proxy one HLS file (manifest or segment) from the hub. Manifests get their
    // inner URLs rewritten back through this same endpoint so the player follows
    // them. The token rides in the query so the <video> player can send it.
    if (method === "GET" && pathname === "/api/hls") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const haPath = url.searchParams.get("path") || "";
      const tok = url.searchParams.get("token") || tokenFrom(req, url) || "";
      try {
        const out = await dm.hlsGet(haPath);
        if (out.isManifest) {
          res.writeHead(200, { "Content-Type": out.contentType, "Cache-Control": "no-store" });
          return res.end(rewriteHls(out.text, haPath, tok));
        }
        res.writeHead(200, { "Content-Type": out.contentType, "Cache-Control": "no-store" });
        return res.end(out.buffer);
      } catch (e) { return err(res, 502, e.message); }
    }
    // Live MJPEG video stream (continuous motion), piped from the hub.
    if (method === "GET" && pathname === "/api/camera_stream") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const entity = url.searchParams.get("entity") || "";
      const ac = new AbortController();
      req.on("close", () => ac.abort());
      try {
        const upstream = await dm.cameraStream(entity, ac.signal);
        res.writeHead(200, { "Content-Type": upstream.headers.get("content-type") || "multipart/x-mixed-replace", "Cache-Control": "no-store", "Connection": "close" });
        const { Readable } = require("stream");
        Readable.fromWeb(upstream.body).pipe(res);
        return;
      } catch (e) { if (!res.headersSent) return err(res, 502, e.message); try { res.destroy(); } catch {} return; }
    }

    // ---- AI camera detection ----
    if (method === "POST" && pathname === "/api/camera/ai") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const b = await readBody(req);
      try { return send(res, 200, dm.setCamAI(locId, b.camId, b.enabled, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/camera/detect") {
      if (!p.cameras) return err(res, 403, "No camera access");
      const b = await readBody(req);
      try { return send(res, 200, dm.detectAI(locId, b.camId, b.type, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- scenes ----
    if (method === "POST" && pathname === "/api/scene") {
      const b = await readBody(req);
      if (!perms.canScene(user, b.scene)) return err(res, 403, "Your role can't run this scene");
      try { return send(res, 200, await scenes.run(b.scene, ctx, { room: b.room, loc: locId })); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "GET" && pathname === "/api/scenes") return send(res, 200, scenes.list());
    if (method === "PUT" && pathname.startsWith("/api/scenes/")) {
      if (!p.editScenes) return err(res, 403, "Can't edit scenes");
      const key = decodeURIComponent(pathname.split("/")[3]);
      const b = await readBody(req);
      audit.record({ msg: `Scene "${key}" edited`, ...ctx, category: "config" });
      return send(res, 200, scenes.upsert(key, b));
    }
    if (method === "DELETE" && pathname.startsWith("/api/scenes/")) {
      if (!p.editScenes) return err(res, 403, "Can't edit scenes");
      const key = decodeURIComponent(pathname.split("/")[3]);
      scenes.remove(key);
      audit.record({ msg: `Scene "${key}" deleted`, ...ctx, category: "config" });
      return send(res, 200, { ok: true });
    }

    // ---- voice ----
    if (method === "POST" && pathname === "/api/voice") {
      const b = await readBody(req);
      const intent = voice.parse(b.text);
      const result = await executeIntent(intent, user, ctx, locId);
      audit.record({ msg: `🎙️ "${b.text}" → ${result.message}`, ...ctx, category: "voice" });
      return send(res, 200, { said: b.text, intent, message: result.message, ok: result.ok });
    }

    // ---- automation ----
    if (method === "GET" && pathname === "/api/automation") return send(res, 200, automation.getAll());
    if (method === "PUT" && pathname === "/api/automation") {
      if (!p.editSchedules) return err(res, 403, "Can't edit schedules");
      const b = await readBody(req);
      if (b.schedules) automation.setSchedules(b.schedules);
      if (b.triggers) automation.setTriggers(b.triggers);
      audit.record({ msg: "Automation schedule updated", ...ctx, category: "config" });
      return send(res, 200, automation.getAll());
    }

    // ---- users (owner only) ----
    if (pathname === "/api/users" || pathname.startsWith("/api/users/")) {
      if (!p.manageUsers) return err(res, 403, "Only the owner can manage users");
      if (method === "GET" && pathname === "/api/users") return send(res, 200, auth.listUsers());
      if (method === "POST" && pathname === "/api/users") {
        const b = await readBody(req);
        try { const u = auth.addUser(b); audit.record({ msg: `User "${u.username}" added (${u.role})`, ...ctx, category: "security" }); return send(res, 200, u); }
        catch (e) { return err(res, 400, e.message); }
      }
      if (method === "PUT" && pathname.startsWith("/api/users/")) {
        const un = decodeURIComponent(pathname.split("/")[3]); const b = await readBody(req);
        try { const u = auth.updateUser(un, b); audit.record({ msg: `User "${un}" updated`, ...ctx, category: "security" }); return send(res, 200, u); }
        catch (e) { return err(res, 400, e.message); }
      }
      if (method === "DELETE" && pathname.startsWith("/api/users/")) {
        const un = decodeURIComponent(pathname.split("/")[3]);
        if (un === user.username) return err(res, 400, "You can't delete your own account");
        try { auth.removeUser(un); audit.record({ msg: `User "${un}" removed`, ...ctx, category: "security" }); return send(res, 200, { ok: true }); }
        catch (e) { return err(res, 400, e.message); }
      }
    }

    // ---- zones / doors / cameras layout (owner/manager) ----
    if (method === "POST" && pathname === "/api/layout/zone") {
      if (!p.editScenes) return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, dm.addZone(locId, b.id, b, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "PUT" && pathname === "/api/layout/zone") {
      if (!p.editScenes) return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, dm.updateZone(locId, b.id, b, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- web push (phone alerts) ----
    if (method === "GET" && pathname === "/api/push/key") return send(res, 200, { key: push.publicKey() });
    if (method === "POST" && pathname === "/api/push/subscribe") {
      const b = await readBody(req);
      try { const r = push.addSubscription(b.subscription, user.username);
        audit.record({ msg: `Phone alerts enabled for ${user.name}`, ...ctx, category: "security" });
        return send(res, 200, r); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/push/test") {
      const r = await push.sendToAll();
      return send(res, 200, { ok: true, ...r, subscribers: push.count() });
    }

    // ---- audit log ----
    if (method === "GET" && pathname === "/api/audit") {
      if (user.role === "staff" || user.role === "guest") return err(res, 403, "No access to audit log");
      return send(res, 200, audit.list(120));
    }
    if (method === "GET" && pathname === "/api/audit.csv") {
      if (!p.cameras) return err(res, 403, "No access to audit log");
      const rows = audit.list(500);
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csv = ["Timestamp,Time,Location,Category,User,Role,Event",
        ...rows.map((l) => [l.ts, l.t, l.loc || "main", l.category, l.who, l.role, l.msg].map(esc).join(","))].join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lumios-audit-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end(csv);
    }

    // ---- exterior signage ----
    if (method === "POST" && pathname === "/api/signage") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      const b = await readBody(req);
      try { return send(res, 200, await dm.setSignage(locId, b.id, b, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- equipment / uptime ----
    if (method === "POST" && pathname === "/api/equipment") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      const b = await readBody(req);
      try { return send(res, 200, dm.setEquipment(locId, b.id, b.online, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- autoclave sterilization log ----
    if (method === "POST" && pathname === "/api/sterilization") {
      if (user.role === "guest") return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, dm.addSterilization(locId, b, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "GET" && pathname === "/api/sterilization.csv") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      const rows = dm.listSterilization(locId);
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csv = ["Timestamp,Operator,Load,Cycle,Result,SporeTest,Notes",
        ...rows.map((r) => [r.ts, r.operator, r.load, r.cycleType, r.result, r.spore, r.notes].map(esc).join(","))].join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lumios-sterilization-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end(csv);
    }

    // ---- medical fridge ----
    if (method === "POST" && pathname === "/api/fridge/reading") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      const b = await readBody(req);
      try { return send(res, 200, dm.recordFridgeTemp(locId, b.id, b.temp, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "GET" && pathname === "/api/fridge.csv") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      const rows = dm.listFridgeReadings(locId);
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csv = ["Timestamp,Fridge,Temp_F,SafeMin,SafeMax,Status", ...rows.map((r) => [r.ts, r.fridge, r.temp, r.min, r.max, r.ok].map(esc).join(","))].join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lumios-fridge-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end(csv);
    }

    // ---- room turnover ----
    if (method === "POST" && pathname === "/api/turnover") {
      if (user.role === "guest") return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, dm.setRoomStatus(locId, b.room, b.status, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- open/close checklist ----
    if (method === "POST" && pathname === "/api/checklist") {
      if (user.role === "guest") return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, dm.toggleChecklist(locId, b.which, b.index, b.done, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- aromatherapy + reception display ----
    if (method === "POST" && pathname === "/api/diffuser") {
      if (user.role === "guest") return err(res, 403, "Not allowed");
      const b = await readBody(req);
      try { return send(res, 200, await dm.setDiffuser(locId, b.id, b, ctx)); } catch (e) { return err(res, 400, e.message); }
    }
    if (method === "POST" && pathname === "/api/display") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      const b = await readBody(req);
      try { return send(res, 200, dm.setDisplay(locId, b, ctx)); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- owner digest + compliance report ----
    if (method === "GET" && pathname === "/api/digest") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      return send(res, 200, dm.buildDigest(locId));
    }
    if (method === "GET" && pathname === "/api/compliance.html") {
      if (!p.allZones) return err(res, 403, "Manager or owner only");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(complianceReport(user, locId));
    }

    // ---- demo: simulate motion ----
    if (method === "POST" && pathname === "/api/simulate/motion") {
      const b = await readBody(req);
      dm.raiseMotion(locId, b.camId || "back", { who: "demo" });
      return send(res, 200, { ok: true });
    }

    return err(res, 404, "Unknown endpoint");
  }

  // --- static UI ---
  if (method === "GET") return serveStatic(req, res, pathname);
  return err(res, 404, "Not found");
});

/* ---------------- voice intent executor ---------------- */
async function executeIntent(intent, user, ctx, locId = "main") {
  const S = () => dm.getState(locId);
  try {
    switch (intent.type) {
      case "scene":
        if (!perms.canScene(user, intent.scene)) return { ok: false, message: "Your role can't run that scene" };
        await scenes.run(intent.scene, ctx, { room: intent.room, loc: locId });
        return { ok: true, message: `Ran the ${scenes.get(intent.scene)?.name || intent.scene} scene` };
      case "temp":
        if (!perms.canZone(user, intent.zone)) return { ok: false, message: "Not your zone" };
        await dm.setTemp(locId, intent.zone, intent.value, ctx);
        return { ok: true, message: `${S().zones[intent.zone].name} set to ${intent.value}°F` };
      case "light":
        if (!perms.canZone(user, intent.zone)) return { ok: false, message: "Not your zone" };
        await dm.setLight(locId, intent.zone, intent.on, intent.dim, ctx);
        return { ok: true, message: `${S().zones[intent.zone].name} lights ${intent.on ? (intent.dim != null ? intent.dim + "%" : "on") : "off"}` };
      case "shade": {
        if (user.role === "guest") return { ok: false, message: "Not allowed" };
        const shades = S().shades || [];
        if (intent.zone === "all") { await dm.setShadeGroup(locId, intent.level, null, ctx); return { ok: true, message: `Shades ${intent.level === 0 ? "closed" : intent.level === 100 ? "opened" : intent.level + "%"} spa-wide` }; }
        const num = String(intent.zone || "").startsWith("num:") ? intent.zone.slice(4) : null;
        const match = num ? shades.find((s) => s.id === "sh_" + num)
          : shades.find((s) => s.id === "sh_" + intent.zone || s.id === intent.zone || s.name.toLowerCase().includes(String(intent.zone).toLowerCase()));
        if (!match) return { ok: false, message: "Which shade? Try a room name or 'all'." };
        await dm.setOneShade(locId, match.id, intent.level, ctx);
        return { ok: true, message: `Shade "${match.name}" ${intent.level === 0 ? "closed" : intent.level === 100 ? "opened" : intent.level + "%"}` };
      }
      case "musicAll":
        if (!perms.perms(user.role).allZones) return { ok: false, message: "Need manager or owner for whole-spa audio" };
        await dm.setMusicGroup(locId, intent.on ? intent.playlist : "off", intent.on ? intent.vol : 0, null, ctx);
        return { ok: true, message: intent.on ? `Playing ${intent.playlist} everywhere` : "Music off everywhere" };
      case "security":
        if (!perms.perms(user.role).cameras) return { ok: false, message: "Only owner/manager can arm/disarm" };
        await dm.setSecurity(locId, intent.mode, ctx);
        return { ok: true, message: intent.mode === "disarmed" ? "Security disarmed" : `Security armed (${intent.mode})` };
      case "music":
        if (!perms.canZone(user, intent.zone)) return { ok: false, message: "Not your zone" };
        await dm.setMusic(locId, intent.zone, intent.on ? intent.playlist : "off", intent.on ? 25 : 0, ctx);
        return { ok: true, message: `${S().zones[intent.zone].name} music ${intent.on ? "on" : "off"}` };
      case "door":
        if (!perms.canDoors(user)) return { ok: false, message: "Your role can't control doors" };
        await dm.setDoor(locId, intent.door, intent.lock, ctx);
        return { ok: true, message: `${S().doors[intent.door].name} ${intent.lock ? "locked" : "unlocked"}` };
      case "camera":
        if (!perms.perms(user.role).cameras) return { ok: false, message: "Your role can't view cameras" };
        return { ok: true, message: "Showing cameras" };
      default:
        return { ok: false, message: "Sorry, I didn't understand that" };
    }
  } catch (e) { return { ok: false, message: e.message }; }
}

/* ---------------- boot ---------------- */
scheduler.start();
dm.startDriverSync();   // real driver: read device state back from the hub (no-op with mock)

// Guard against stranding the owner: real mode + owner 2FA with no delivery channel.
if (CONFIG.DRIVER === "real" && CONFIG.REQUIRE_OWNER_2FA && !process.env.LUMIOS_2FA_WEBHOOK) {
  console.warn("\n  ⚠️  REAL mode + owner 2FA is on, but LUMIOS_2FA_WEBHOOK is not set.");
  console.warn("     The 2FA code will only print to this console — the owner could be unable to sign in.");
  console.warn("     Fix: set LUMIOS_2FA_WEBHOOK to your SMS/email endpoint, or set REQUIRE_OWNER_2FA=false.\n");
}
server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log("\n  ╭─────────────────────────────────────────────╮");
  console.log("  │   LumiOS — Lumi Nails & Med Spa               │");
  console.log("  ╰─────────────────────────────────────────────╯");
  console.log(`  ▸ App:    http://localhost:${CONFIG.PORT}`);
  console.log(`  ▸ Admin:  http://localhost:${CONFIG.PORT}/admin.html`);
  console.log(`  ▸ Driver: ${dm.driverName.toUpperCase()} ${dm.driverName === "mock" ? "(simulator — no hardware needed)" : ""}`);
  console.log(`  ▸ Sign in: owner / ${CONFIG.DEFAULT_USERS[0].password}  (or PIN ${CONFIG.DEFAULT_USERS[0].pin})`);
  console.log("    Change these in Admin → Users right away.\n");
});
