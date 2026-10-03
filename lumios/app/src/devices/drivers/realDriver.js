/* ============================================================
   realDriver.js — LIVE hardware driver (Home Assistant)
   ------------------------------------------------------------
   Pre-wired for Home Assistant's REST API. It implements the SAME
   contract as mockDriver.js, so switching CONFIG.DRIVER from "mock"
   to "real" is the only change the rest of LumiOS sees.

   ▶ TO GO LIVE, the installer/developer does just THREE things:
     1. Set env vars: LUMIOS_DRIVER=real, LUMIOS_HUB_URL, LUMIOS_HUB_TOKEN
        (token = a Home Assistant "Long-Lived Access Token").
     2. Fill in the MAP below with your hub's real entity ids.
     3. Test one light, then a door. Done — the app/voice/scenes don't change.

   Local-first: Home Assistant runs on-site, so doors & lights keep
   working even if the internet drops. The service calls are already
   written — you only supply the entity ids.
   ============================================================ */

// When LumiOS runs as a Home Assistant add-on, the Supervisor injects
// SUPERVISOR_TOKEN and proxies the Core API at http://supervisor/core — so no
// manual Long-Lived Access Token is needed. Falls back to an explicit hub URL +
// token when run stand-alone (outside the add-on).
const HUB_URL = process.env.LUMIOS_HUB_URL || (process.env.SUPERVISOR_TOKEN ? "http://supervisor/core" : "http://homeassistant.local:8123");
const TOKEN = process.env.LUMIOS_HUB_TOKEN || process.env.SUPERVISOR_TOKEN || "";

// Shades are Hunter Douglas PowerView **Gen 3**. Reserve the Gen 3 Gateway's IP
// in the router and set it here. Two ways to drive them (either works):
//   (A) via Home Assistant's PowerView integration (must be the **Gen 3** one) —
//       LumiOS calls the cover.* entities below (default; see setShade).
//   (B) directly against the Gen 3 Gateway's local REST API (see setShade comment).
// ⚠️ Gen 3 is NOT compatible with Gen 2. Do not copy Gen 2 (hub v2 /api/...) example
//    code — target the Gen 3 endpoints. Reference: the Home Assistant "hunterdouglas
//    _powerview" Gen 3 integration for the current endpoint shapes.
const POWERVIEW_GATEWAY = process.env.LUMIOS_POWERVIEW_IP || "http://192.168.1.50"; // Gen 3 Gateway (reserved IP)

/* ---- 1) FILL IN: map LumiOS ids -> your Home Assistant entity ids ---- */
const MAP = {
  // entry-door + treatment-room locks
  doors: {
    front: "lock.front_entrance",
    back:  "lock.back_door",
    room1: "lock.treatment_room_1",   // room-access lock (or switch for an electric strike)
    room2: "lock.treatment_room_2",
  },
  // tunable-white + RGB lights, per room
  lights: {
    reception: "light.reception", pedicure: "light.pedicure", manicure: "light.manicure",
    room1: "light.treatment_room_1", room2: "light.treatment_room_2",
    bath1: "light.bathroom_1", bath2: "light.bathroom_2", break: "light.break_room",
  },
  // 8 Hunter Douglas PowerView Gen 3 shades. Left = the HA cover entity (path A);
  // right (shadeGen3) = the Gateway's numeric shade id (path B). Fill both to match your install.
  shades: {
    sh_1: "cover.shade_1", sh_2: "cover.shade_2", sh_3: "cover.shade_3", sh_4: "cover.shade_4",
    sh_5: "cover.shade_5", sh_6: "cover.shade_6", sh_7: "cover.shade_7", sh_8: "cover.shade_8",
  },
  shadeGen3: { sh_1: 1, sh_2: 2, sh_3: 3, sh_4: 4, sh_5: 5, sh_6: 6, sh_7: 7, sh_8: 8 },
  // Both Honeywell T6 Z-Wave thermostats condition the WHOLE salon (one shared
  // HVAC / open space), so every room targets BOTH — a temp change from any room
  // sets both thermostats to the same value, keeping them in sync. (Home Assistant
  // accepts an array of entity_ids on a single service call.)
  temp: (function () {
    const both = ["climate.front_hallway_thermostat", "climate.back_hallway_thermostat"];
    return {
      reception: both, pedicure: both, manicure: both,
      room1: both, room2: both, bath1: both, bath2: both, break: both,
    };
  })(),
  music: {
    reception: "media_player.reception", pedicure: "media_player.pedicure", manicure: "media_player.manicure",
    room1: "media_player.treatment_room_1", room2: "media_player.treatment_room_2", break: "media_player.break_room",
  },
  cams: {
    entry: "rtsp://CAMERA-IP:554/entry", reception: "rtsp://CAMERA-IP:554/reception",
    retail: "rtsp://CAMERA-IP:554/retail", pedicure: "rtsp://CAMERA-IP:554/pedicure",
    manicure: "rtsp://CAMERA-IP:554/manicure", back: "rtsp://CAMERA-IP:554/back",
    break: "rtsp://CAMERA-IP:554/break",
  },
  // optional: switch/relay entity that arms motion detection on the NVR
  camMotion: "switch.nvr_motion_detection",
  alarm: "alarm_control_panel.lumi",
  siren: "switch.alarm_siren",        // Z-Wave/Zigbee siren relay
  // smoke/CO detectors report inbound to HA; an automation forwards alarms to LumiOS /api/safety/test
  // exterior signage: a switch/relay per sign; message signs can use an input_select + automation
  signs: { exterior: "switch.exterior_sign", openclosed: "switch.open_closed_sign", promo: "switch.promo_board" },
  signMessage: { openclosed: "input_select.open_closed_message", promo: "input_select.promo_message" },
};

/* ---- helpers ---- */
async function hub(path, body) {
  if (!TOKEN) throw new Error("Set LUMIOS_HUB_TOKEN (a Home Assistant Long-Lived Access Token) to use real mode.");
  const res = await fetch(`${HUB_URL}${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`Home Assistant error ${res.status} on ${path}`);
  return res.json().catch(() => ({}));
}
function ent(group, id) {
  const e = MAP[group] && MAP[group][id];
  if (!e) throw new Error(`No "${group}" entity mapped for "${id}" — add it to MAP in realDriver.js`);
  return e;
}
function svc(domain, service, body) { return hub(`/api/services/${domain}/${service}`, body); }
function hexToRgb(hex) {
  const h = String(hex || "#ffffff").replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

module.exports = {
  name: "real",

  /* doors + room-access locks */
  async lock(doorId)   { return svc("lock", "lock",   { entity_id: ent("doors", doorId) }); },
  async unlock(doorId) { return svc("lock", "unlock", { entity_id: ent("doors", doorId) }); },

  /* lighting: on/off + brightness */
  async setLight(zoneId, on, dim) {
    const entity_id = ent("lights", zoneId);
    return on
      ? svc("light", "turn_on",  { entity_id, brightness_pct: dim == null ? 100 : dim })
      : svc("light", "turn_off", { entity_id });
  },
  /* tunable white (Kelvin) */
  async setCct(zoneId, kelvin) {
    return svc("light", "turn_on", { entity_id: ent("lights", zoneId), color_temp_kelvin: kelvin });
  },
  /* RGB accent color */
  async setColor(zoneId, hex) {
    return svc("light", "turn_on", { entity_id: ent("lights", zoneId), rgb_color: hexToRgb(hex) });
  },

  /* Hunter Douglas PowerView **Gen 3** shades. level = 0 (closed) … 100 (open).
     Path A (default) — via HA's PowerView **Gen 3** integration (cover.* entities): */
  async setShade(shadeId, level) {
    return svc("cover", "set_cover_position", { entity_id: ent("shades", shadeId), position: level });
    /* Path B — direct to the Gen 3 Gateway's local REST API (no HA in the loop).
       ⚠️ Gen 3 endpoints only — positions are 0.0–1.0 floats, key "primary".
          Verify the exact path/orientation against the HA Gen 3 integration.
       const id = MAP.shadeGen3[shadeId];
       return fetch(`${POWERVIEW_GATEWAY}/home/shades/positions?ids=${id}`, {
         method: "PUT", headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ positions: { primary: level / 100 } }),
       }); */
  },

  /* thermostat */
  async setTemp(zoneId, value) {
    return svc("climate", "set_temperature", { entity_id: ent("temp", zoneId), temperature: value });
  },
  /* thermostat on/off + mode: "off" | "heat" | "cool" | "heat_cool" (auto) */
  async setTempMode(zoneId, mode) {
    return svc("climate", "set_hvac_mode", { entity_id: ent("temp", zoneId), hvac_mode: mode });
  },

  /* music: per-zone playlist + volume (Sonos / media_player) */
  async setMusic(zoneId, playlist, vol) {
    const entity_id = ent("music", zoneId);
    if (playlist === "off") return svc("media_player", "media_pause", { entity_id });
    if (vol != null) await svc("media_player", "volume_set", { entity_id, volume_level: vol / 100 });
    return svc("media_player", "play_media", { entity_id, media_content_id: playlist, media_content_type: "playlist" });
  },

  /* alarm siren */
  async setSiren(on) {
    return svc("switch", on ? "turn_on" : "turn_off", { entity_id: MAP.siren });
  },

  /* unified security panel */
  async setSecurity(mode) {
    const service = mode === "away" ? "alarm_arm_away" : mode === "home" ? "alarm_arm_home" : "alarm_disarm";
    return svc("alarm_control_panel", service, { entity_id: MAP.alarm });
  },

  /* exterior signage: on/off relay (+ optional message via input_select) */
  async setSign(id, sign) {
    if (MAP.signMessage && MAP.signMessage[id] && sign.mode)
      await svc("input_select", "select_option", { entity_id: MAP.signMessage[id], option: sign.mode }).catch(() => {});
    return svc("switch", sign.on ? "turn_on" : "turn_off", { entity_id: ent("signs", id) });
  },

  /* cameras: arm/disarm motion + night mode on the NVR */
  async setCamera(camId, opts) {
    if (opts && opts.alert != null && MAP.camMotion)
      return svc("switch", opts.alert ? "turn_on" : "turn_off", { entity_id: MAP.camMotion });
    return { ok: true };
  },
  async getCameraFeed(camId) {
    return { type: "rtsp", url: ent("cams", camId), camId };
  },

  /* ---- live cameras via Home Assistant ----
     Discover every camera.* entity HA knows about (Reolink adds several stream
     entities per camera; we prefer the lightweight "fluent"/sub stream for a
     smooth dashboard view), and proxy JPEG snapshots so the browser can show a
     near-live picture without RTSP/HLS. */
  async listCameras(opts = {}) {
    if (!TOKEN) throw new Error("Set a hub token to list cameras.");
    const res = await fetch(`${HUB_URL}/api/states`, { headers: { "Authorization": `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`Home Assistant /api/states ${res.status}`);
    const all = (await res.json()).filter((s) => s.entity_id.startsWith("camera."));
    // Debug: return every camera entity + state so we can see exactly what HA has.
    if (opts.all) return all.map((s) => ({ entity_id: s.entity_id, state: s.state, name: (s.attributes && s.attributes.friendly_name) || s.entity_id }));
    const avail = all.filter((s) => s.state !== "unavailable");
    // Reolink exposes several stream entities per camera; prefer the smooth
    // "fluent"/"sub" stream. HA appends _2/_3 to de-dupe identical camera names,
    // so allow an optional trailing number.
    const fluent = avail.filter((s) => /_(fluent|sub)(_\d+)?$/.test(s.entity_id));
    const pick = fluent.length ? fluent : avail;
    return pick
      .map((s) => ({
        entity_id: s.entity_id,
        name: ((s.attributes && s.attributes.friendly_name) || s.entity_id).replace(/ (Fluent|Sub)$/i, ""),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async cameraSnapshot(entityId) {
    if (!/^camera\.[a-z0-9_]+$/i.test(entityId)) throw new Error("Bad camera id");
    const res = await fetch(`${HUB_URL}/api/camera_proxy/${entityId}`, { headers: { "Authorization": `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`camera_proxy ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "image/jpeg" };
  },
  // Live MJPEG stream (continuous motion) via Home Assistant's camera_proxy_stream.
  // Returns the upstream fetch Response so the server can pipe it straight through.
  async cameraStream(entityId, signal) {
    if (!/^camera\.[a-z0-9_]+$/i.test(entityId)) throw new Error("Bad camera id");
    const res = await fetch(`${HUB_URL}/api/camera_proxy_stream/${entityId}`, { headers: { "Authorization": `Bearer ${TOKEN}` }, signal });
    if (!res.ok || !res.body) throw new Error(`camera_proxy_stream ${res.status}`);
    return res;
  },
  // Ask Home Assistant (over its WebSocket API) to start a real video stream for
  // this camera and return a playable HLS URL. HLS is short finite segment files,
  // so it proxies cleanly and plays as true full motion in a <video> element.
  async getStreamUrl(entityId, format = "hls") {
    if (!/^camera\.[a-z0-9_]+$/i.test(entityId)) throw new Error("Bad camera id");
    if (typeof WebSocket === "undefined") throw new Error("WebSocket unavailable (needs Node 22+)");
    const wsUrl = HUB_URL.replace(/^http/, "ws") + "/api/websocket";
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const reqId = 2;
      const finish = (fn, arg) => { clearTimeout(timer); try { ws.close(); } catch {} fn(arg); };
      const timer = setTimeout(() => finish(reject, new Error("stream request timed out")), 12000);
      ws.addEventListener("message", (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
        else if (m.type === "auth_ok") ws.send(JSON.stringify({ id: reqId, type: "camera/stream", entity_id: entityId, format }));
        else if (m.type === "auth_invalid") finish(reject, new Error("hub auth rejected"));
        else if (m.type === "result" && m.id === reqId) {
          if (m.success && m.result && m.result.url) finish(resolve, m.result.url);
          else finish(reject, new Error((m.error && m.error.message) || "camera/stream failed"));
        }
      });
      ws.addEventListener("error", () => finish(reject, new Error("hub websocket error")));
    });
  },
  // Fetch one HLS file (manifest or video segment) from Home Assistant. The path
  // may carry Low-Latency HLS query params (_HLS_msn/_HLS_part) which MUST be
  // forwarded so the hub blocks until the next part is ready (otherwise the
  // player spins in a tight loop). Returns manifest text to rewrite, or segment bytes.
  async hlsGet(haPathWithQuery) {
    const qi = haPathWithQuery.indexOf("?");
    const pathOnly = qi >= 0 ? haPathWithQuery.slice(0, qi) : haPathWithQuery;
    if (!/^\/api\/hls\/[A-Za-z0-9/_.\-]+$/.test(pathOnly)) throw new Error("Bad HLS path");
    const res = await fetch(`${HUB_URL}${haPathWithQuery}`, { headers: { "Authorization": `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`hls ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (pathOnly.endsWith(".m3u8") || ct.includes("mpegurl"))
      return { isManifest: true, text: await res.text(), contentType: "application/vnd.apple.mpegurl" };
    return { isManifest: false, buffer: Buffer.from(await res.arrayBuffer()), contentType: ct || "video/mp4" };
  },

  /* ---- state feedback: read device state BACK from Home Assistant ----
     So LumiOS reflects reality (wall switch, HA app, failed command) instead of
     only what it last sent. deviceManager polls this via startSync().
     NOTE: this maps to the "main" location; extend for multi-location. Test the
     attribute names against your HA (they vary by integration).                */
  async getStates() {
    if (!TOKEN) throw new Error("Set LUMIOS_HUB_TOKEN to sync state.");
    const res = await fetch(`${HUB_URL}/api/states`, { headers: { "Authorization": `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`Home Assistant /api/states ${res.status}`);
    const byId = {};
    for (const s of await res.json()) byId[s.entity_id] = s;
    return byId;
  },
  async startSync(onUpdate, intervalMs) {
    const mapBack = (states) => {
      const patch = { zones: {}, doors: {} };
      const z = (id) => (patch.zones[id] = patch.zones[id] || {});
      for (const id in MAP.lights) { const e = states[MAP.lights[id]]; if (!e) continue;
        z(id).light = e.state === "on";
        if (e.attributes && e.attributes.brightness != null) z(id).dim = Math.round(e.attributes.brightness / 255 * 100);
        if (e.attributes && e.attributes.color_temp_kelvin) z(id).cct = e.attributes.color_temp_kelvin; }
      for (const id in MAP.temp) { const key = Array.isArray(MAP.temp[id]) ? MAP.temp[id][0] : MAP.temp[id]; const e = states[key]; if (e && e.attributes && e.attributes.temperature != null) z(id).temp = Math.round(e.attributes.temperature); }
      for (const id in MAP.shades) { const e = states[MAP.shades[id]]; if (e && e.attributes && e.attributes.current_position != null) z(id).shade = e.attributes.current_position; }
      for (const id in MAP.doors) { const e = states[MAP.doors[id]]; if (e) patch.doors[id] = { locked: e.state === "locked" }; }
      return patch;
    };
    const poll = async () => {
      try { onUpdate("main", mapBack(await module.exports.getStates())); }
      catch (e) { /* hub unreachable — keep last known state, try next tick */ }
    };
    setInterval(poll, intervalMs || 10000);
    poll();
  },
};
