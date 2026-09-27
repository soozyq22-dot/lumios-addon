/* ============================================================
   LumiOS front-end — talks to the backend over REST + SSE.
   ============================================================ */
let TOKEN = localStorage.getItem("lumios_token") || null;
let STATE = null;
let challengeId = null;
let activeLoc = localStorage.getItem("lumios_loc") || "main";

/* ---------- API helper (location-scoped) ---------- */
function withLoc(path) {
  if (!path.startsWith("/api") || /\/api\/(login|2fa|pin)\b/.test(path)) return path;
  return path + (path.includes("?") ? "&" : "?") + "loc=" + encodeURIComponent(activeLoc);
}
async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const res = await fetch(withLoc(path), { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function setActiveLoc(loc) {
  activeLoc = loc; localStorage.setItem("lumios_loc", loc);
  refresh().then(renderLog);
  toast("📍 " + (STATE?.locations.find((l) => l.id === loc)?.name || loc));
}

/* ============ LOGIN ============ */
function showTab(which) {
  document.getElementById("tabPin").classList.toggle("active", which === "pin");
  document.getElementById("tabPw").classList.toggle("active", which === "pw");
  document.getElementById("pinPane").style.display = which === "pin" ? "block" : "none";
  document.getElementById("pwPane").style.display = which === "pw" ? "block" : "none";
  document.getElementById("twoPane").style.display = "none";
}

let pinBuf = "";
function renderPad() {
  const pad = document.getElementById("keypad");
  pad.innerHTML = "";
  ["1","2","3","4","5","6","7","8","9","⌫","0","✓"].forEach((k) => {
    const b = document.createElement("button");
    b.textContent = k;
    b.onclick = () => pinPress(k);
    pad.appendChild(b);
  });
  renderDots();
}
function renderDots() {
  const d = document.getElementById("pinDots");
  d.innerHTML = "";
  for (let i = 0; i < 4; i++) { const s = document.createElement("span"); if (i < pinBuf.length) s.classList.add("on"); d.appendChild(s); }
}
function pinPress(k) {
  if (k === "⌫") pinBuf = pinBuf.slice(0, -1);
  else if (k === "✓") return submitPin();
  else if (pinBuf.length < 4) pinBuf += k;
  renderDots();
  if (pinBuf.length === 4) submitPin();
}
async function submitPin() {
  try {
    const r = await api("/api/pin", { method: "POST", body: { pin: pinBuf } });
    if (r.need2FA) {                       // owner PIN → still needs the 2nd factor
      challengeId = r.challengeId;
      document.getElementById("pinPane").style.display = "none";
      document.getElementById("twoPane").style.display = "block";
      show2FADemoCode(r.demoCode);
      pinBuf = ""; renderDots();
      return;
    }
    onLoggedIn(r.token);
  } catch (e) {
    document.getElementById("pinErr").textContent = e.message;
    pinBuf = ""; renderDots();
  }
}
async function doPasswordLogin() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  document.getElementById("pwErr").textContent = "";
  try {
    const r = await api("/api/login", { method: "POST", body: { username, password } });
    if (r.need2FA) {
      challengeId = r.challengeId;
      document.getElementById("pwPane").style.display = "none";
      document.getElementById("twoPane").style.display = "block";
      show2FADemoCode(r.demoCode);
      return;
    }
    onLoggedIn(r.token);
  } catch (e) { document.getElementById("pwErr").textContent = e.message; }
}
function show2FADemoCode(code) {
  if (!code) return;                       // real mode: code goes to the owner's phone
  document.getElementById("twoCode").value = code;
  document.getElementById("twoErr").textContent = "Demo mode — code auto-filled. (Live: it's texted to the owner.)";
}
async function do2FA() {
  try {
    const r = await api("/api/2fa", { method: "POST", body: { challengeId, code: document.getElementById("twoCode").value.trim() } });
    onLoggedIn(r.token);
  } catch (e) { document.getElementById("twoErr").textContent = e.message; }
}

function onLoggedIn(token) {
  TOKEN = token;
  localStorage.setItem("lumios_token", token);
  document.getElementById("loginOverlay").style.display = "none";
  document.getElementById("appHeader").style.display = "flex";
  document.getElementById("appMain").style.display = "block";
  boot();
}
async function logout() {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  TOKEN = null; localStorage.removeItem("lumios_token");
  location.reload();
}

/* ============ STATE + RENDER ============ */
async function refresh() {
  STATE = await api("/api/state");
  activeLoc = STATE.location;                 // stay in sync with what the server allowed
  localStorage.setItem("lumios_loc", activeLoc);
  renderAll();
}
function P() { return STATE.perms; }

/* ---- clean line-icon set (replaces emoji) ---- */
const sv = (p) => `<svg class="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  bulb: sv('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .9 1.6l.1.6h5.2l.1-.6c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3Z"/>'),
  shade: sv('<rect x="3.5" y="3.5" width="17" height="3.5" rx="1"/><path d="M6 7v9M18 7v9M6 16h12M9.5 16v3M14.5 16v3"/>'),
  temp: sv('<path d="M14 14.5V5a2 2 0 1 0-4 0v9.5a3.5 3.5 0 1 0 4 0Z"/>'),
  music: sv('<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17" cy="15.5" r="2.5"/><path d="M9 17.5V6l10.5-2v9.5"/>'),
  volume: sv('<path d="M11 5 6.5 9H3.5v6h3L11 19V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>'),
  lock: sv('<rect x="4.5" y="11" width="15" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
  unlock: sv('<rect x="4.5" y="11" width="15" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8"/>'),
  shield: sv('<path d="M12 3 5 5.5v5c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9v-5L12 3Z"/>'),
  sun: sv('<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.2M12 18.8V21M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M3 12h2.2M18.8 12H21M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"/>'),
  moon: sv('<path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z"/>'),
  tone: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
  drop: sv('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>'),
  motion: sv('<path d="M12 12.5v.01"/><path d="M8.8 9.3a4.5 4.5 0 0 1 6.4 0"/><path d="M6 6.5a8.5 8.5 0 0 1 12 0"/>'),
  star: sv('<path d="M12 3.5l2.5 5.4 5.9.8-4.3 4.1 1 5.9-5.1-2.8-5.1 2.8 1-5.9L3.6 9.7l5.9-.8L12 3.5Z"/>'),
  sign: sv('<rect x="3.5" y="4" width="17" height="10" rx="2"/><path d="M12 14v6M8.5 20h7"/>'),
  leaf: sv('<path d="M11 20.5C6 20.5 4 16 4 12 4 6 9.5 3.5 20 3.5c0 9.5-4 17-9 17Z"/><path d="M4 20.5C7 16 10 14.5 13 13.5"/>'),
  clock: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  bolt: sv('<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/>'),
  battery: sv('<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3"/>'),
  bell: sv('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10.4 20a1.6 1.6 0 0 0 3.2 0"/>'),
  alert: sv('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.4"/>'),
  updown: sv('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>'),
};
const sceneIcon = (sc) => ({ open: ICON.sun, treat: ICON.leaf, close: ICON.moon, away: ICON.shield })[sc.cls] || ICON.sun;
function cctLabel(k) { k = k || 3000; const t = k <= 3000 ? "Warm" : k >= 4600 ? "Cool" : "Neutral"; return `${t} · ${k}K`; }

function renderAll() {
  renderHeader(); renderScenes(); renderSalonTemp(); renderZones(); renderSoundZones(); renderGroupAudio(); renderShades(); renderGroupShades(); renderDoors();
  renderTurnover(); renderChecklist(); renderAroma();
  renderSignage(); renderRoomAccess(); renderSecurity(); renderSafety(); renderCams(); renderEnergy();
  renderEquipment(); renderFridge(); renderReports(); renderSterilization(); renderSchedule();
  document.getElementById("driverName").textContent = STATE.driver;
}

/* ---- whole-spa shades quick control ---- */
function renderGroupShades() {
  const wrap = document.getElementById("groupShades");
  if (!P().allZones) { wrap.innerHTML = '<div class="hint">Whole-spa shades are available to managers and owners.</div>'; return; }
  wrap.innerHTML = `
    <div class="row" style="border:none"><span class="lbl"><span class="e">${ICON.shade}</span> Move every shade at once</span></div>
    <div class="form-line">
      <button class="btn btn-lock" id="gs_up">Raise all</button>
      <button class="btn btn-unlock" id="gs_down">Lower all</button>
      <span class="e">${ICON.updown}</span>
      <input type="range" min="0" max="100" value="60" id="gs_lvl" style="flex:1;accent-color:var(--gold)">
      <span class="pct" id="gs_lvlpct">60%</span>
      <button class="btn btn-unlock" id="gs_set">Set all</button>
    </div>`;
  document.getElementById("gs_lvl").oninput = (e) => document.getElementById("gs_lvlpct").textContent = e.target.value + "%";
  document.getElementById("gs_up").onclick = () => cmd("/api/shade/all", { level: 100 });
  document.getElementById("gs_down").onclick = () => cmd("/api/shade/all", { level: 0 });
  document.getElementById("gs_set").onclick = () => cmd("/api/shade/all", { level: +document.getElementById("gs_lvl").value });
}

/* ---- individual shades (move one at a time) ---- */
function renderShades() {
  const wrap = document.getElementById("shades");
  if (!wrap) return;
  if (P().role === "guest") { wrap.innerHTML = '<div class="hint">Shade control is available to staff, managers and owners.</div>'; return; }
  const shades = STATE.shades || [];
  wrap.innerHTML = shades.length ? shades.map((s) => `
    <div class="shade-row">
      <span class="shade-name">${s.name}</span>
      <button class="btn btn-unlock sh-btn" data-sh="${s.id}" data-lv="0">Close</button>
      <input type="range" min="0" max="100" value="${s.level}" data-shslider="${s.id}">
      <span class="pct">${s.level}%</span>
      <button class="btn btn-lock sh-btn" data-sh="${s.id}" data-lv="100">Open</button>
    </div>`).join("") : '<div class="hint">No shades configured.</div>';
  wrap.querySelectorAll("[data-shslider]").forEach((el) => {
    el.oninput = (e) => e.target.nextElementSibling.textContent = e.target.value + "%";
    el.onchange = (e) => cmd("/api/shade", { id: e.target.dataset.shslider, level: +e.target.value });
  });
  wrap.querySelectorAll("[data-sh]").forEach((b) => b.onclick = (e) => cmd("/api/shade", { id: e.currentTarget.dataset.sh, level: +e.currentTarget.dataset.lv }));
}

/* ---- whole-spa grouped audio ---- */
function renderGroupAudio() {
  const wrap = document.getElementById("groupAudio");
  if (!P().allZones) { wrap.innerHTML = '<div class="hint">Whole-spa audio is available to managers and owners.</div>'; return; }
  const opts = STATE.playlists.map((p) => `<option ${p === "Calm Spa" ? "selected" : ""}>${p}</option>`).join("");
  wrap.innerHTML = `
    <div class="row" style="border:none">
      <span class="lbl"><span class="e">${ICON.music}</span> Play the same thing everywhere</span>
    </div>
    <div class="form-line">
      <select class="mini" id="ga_pl">${opts}</select>
      <span class="e">${ICON.volume}</span>
      <input type="range" min="0" max="100" value="25" id="ga_vol" style="flex:1;accent-color:var(--gold)">
      <span class="pct" id="ga_volpct">25%</span>
      <button class="btn btn-lock" id="ga_play">Play everywhere</button>
      <button class="btn btn-unlock" id="ga_stop">Stop all</button>
    </div>`;
  document.getElementById("ga_vol").oninput = (e) => document.getElementById("ga_volpct").textContent = e.target.value + "%";
  document.getElementById("ga_play").onclick = () => cmd("/api/music/all", { playlist: document.getElementById("ga_pl").value, vol: +document.getElementById("ga_vol").value });
  document.getElementById("ga_stop").onclick = () => cmd("/api/music/all", { playlist: "off", vol: 0 });
}

/* ---- smart sound zoning ---- */
function renderSoundZones() {
  const wrap = document.getElementById("soundZones");
  if (!wrap) return;
  if (!P().allZones) { wrap.innerHTML = '<div class="card"><div class="hint">Sound zones are available to managers and owners.</div></div>'; return; }
  const groups = STATE.audioGroups || [];
  wrap.innerHTML = groups.map((g) => {
    const members = g.zones.map((id) => STATE.zones[id]).filter(Boolean);
    const playing = members.map((m) => m.music);
    const allSame = members.length && playing.every((p) => p === playing[0]);
    const cur = allSame ? (playing[0] || "off") : "__mixed";
    const vol = members[0] ? members[0].vol : 0;
    const opts = STATE.playlists.map((p) => `<option value="${p}" ${p === cur ? "selected" : ""}>${p}</option>`).join("") + (allSame ? "" : `<option value="__mixed" selected>Mixed</option>`);
    return `<div class="card">
      <h3>${g.name}</h3>
      <div class="zone-meta">${members.map((m) => m.name).join(" · ") || "No rooms"}</div>
      <div class="row" style="border:none"><span class="lbl"><span class="e">${ICON.music}</span> Source</span>
        <select class="mini" data-sgpl="${g.id}">${opts}</select></div>
      <div class="dim"><span class="e">${ICON.volume}</span>
        <input type="range" min="0" max="100" value="${vol}" data-sgvol="${g.id}"><span class="pct">${vol}%</span></div>
      <div class="form-line">
        <button class="btn btn-lock" data-sgplay="${g.id}">Play</button>
        <button class="btn btn-unlock" data-sgstop="${g.id}">Stop</button>
      </div></div>`;
  }).join("") || '<div class="card"><div class="hint">No sound zones yet — add them in Admin.</div></div>';
  const plOf = (g) => { const v = wrap.querySelector(`[data-sgpl="${g}"]`)?.value; return v && v !== "__mixed" ? v : null; };
  const volOf = (g) => +(wrap.querySelector(`[data-sgvol="${g}"]`)?.value || 25);
  wrap.querySelectorAll("[data-sgpl]").forEach((el) => el.onchange = (e) => { const g = e.target.dataset.sgpl; if (e.target.value === "__mixed") return; cmd("/api/audio/group", { groupId: g, playlist: e.target.value, vol: volOf(g) }); });
  wrap.querySelectorAll("[data-sgvol]").forEach((el) => { el.oninput = (e) => e.target.nextElementSibling.textContent = e.target.value + "%"; el.onchange = (e) => cmd("/api/audio/group", { groupId: e.target.dataset.sgvol, playlist: plOf(e.target.dataset.sgvol), vol: +e.target.value }); });
  wrap.querySelectorAll("[data-sgplay]").forEach((el) => el.onclick = (e) => { const g = e.target.dataset.sgplay; cmd("/api/audio/group", { groupId: g, playlist: plOf(g) || "Calm Spa", vol: volOf(g) }); });
  wrap.querySelectorAll("[data-sgstop]").forEach((el) => el.onclick = (e) => cmd("/api/audio/group", { groupId: e.target.dataset.sgstop, playlist: "off", vol: 0 }));
}

/* ---- unified security panel ---- */
function renderSecurity() {
  const secEls = document.querySelectorAll("[data-secure]");
  const wrap = document.getElementById("security");
  if (!P().cameras) { return; } // visibility handled in renderCams() (shares [data-secure])
  const s = STATE.security || { mode: "disarmed", alarm: false };
  const armed = s.mode !== "disarmed";
  const cls = s.alarm ? "alarm" : armed ? "armed" : "disarmed";
  const label = s.alarm ? `<span class="si">${ICON.alert}</span> ALARM` : armed ? `<span class="si">${ICON.lock}</span> Armed — ${s.mode === "away" ? "Away" : "Home"}` : `<span class="si">${ICON.unlock}</span> Disarmed`;
  wrap.innerHTML = `
    <div class="sec-panel ${cls}">
      <div class="sec-state">${label}</div>
      <div class="sec-btns">
        <button class="btn ${s.mode === "disarmed" ? "btn-lock" : "btn-unlock"}" data-arm="disarmed">Disarm</button>
        <button class="btn ${s.mode === "home" ? "btn-lock" : "btn-unlock"}" data-arm="home">Arm — Home</button>
        <button class="btn ${s.mode === "away" ? "btn-lock" : "btn-unlock"}" data-arm="away">Arm — Away</button>
      </div>
    </div>
    <div class="form-line" style="margin-top:12px">
      <button class="btn btn-panic" id="panicBtn">🚨 Panic</button>
      ${s.siren ? '<button class="btn btn-lock" id="silenceBtn">🔕 Silence siren</button>' : ""}
      <span class="siren-state ${s.siren ? "on" : ""}">Siren: ${s.siren ? "SOUNDING" : "off"}</span>
    </div>
    <div class="form-line" style="margin-top:10px">
      <button class="btn btn-ghost" id="enableAlerts"><span class="bi">${ICON.bell}</span> ${pushEnabled ? "Phone alerts on" : "Alert my phone"}</button>
      ${pushEnabled ? '<button class="btn btn-unlock" id="testAlert">Send test alert</button>' : ""}
      <span class="hint" style="margin:0">Get alarms &amp; outages pushed to your phone when you're away.</span>
    </div>`;
  wrap.querySelectorAll("[data-arm]").forEach((b) => b.onclick = async () => {
    try { await api("/api/security", { method: "POST", body: { mode: b.dataset.arm } });
      toast(b.dataset.arm === "disarmed" ? "🔓 Disarmed" : "🔒 Armed (" + b.dataset.arm + ")"); }
    catch (e) { toast("🔒 " + e.message); }
  });
  document.getElementById("panicBtn").onclick = async () => {
    if (!confirm("Trigger the panic alarm and sound the siren?")) return;
    try { await api("/api/security/panic", { method: "POST" }); toast("🚨 Panic alarm triggered"); } catch (e) { toast(e.message); }
  };
  const sb = document.getElementById("silenceBtn");
  if (sb) sb.onclick = async () => { try { await api("/api/security/silence", { method: "POST" }); toast("🔕 Siren silenced"); } catch (e) { toast(e.message); } };
  document.getElementById("enableAlerts").onclick = enablePush;
  const tb = document.getElementById("testAlert");
  if (tb) tb.onclick = async () => { await api("/api/push/test", { method: "POST" }); toast("🔔 Test alert sent to subscribed phones"); };
}

/* ---- life-safety: smoke + CO ---- */
function renderSafety() {
  const wrap = document.getElementById("safety");
  if (!wrap) return;
  if (!P().cameras) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  const det = STATE.safety || [];
  const alarming = det.filter((d) => d.status === "alarm");
  const banner = alarming.length ? `<div class="fire-banner">🔥 LIFE-SAFETY ALARM — ${alarming.map((d) => d.name).join(", ")} · egress doors unlocked — evacuate</div>` : "";
  wrap.innerHTML = banner +
    `<div class="zone-meta">Smart smoke + CO detectors — alerts &amp; automation. Supplements (does not replace) your code-required hardwired system.</div>` +
    det.map((d) => `<div class="eqrow">
        <span class="dot ${d.status === "alarm" ? "off" : "on"}"></span>
        <span class="eqname">${d.name}</span>
        <span class="equp">${d.type} · ${d.status === "alarm" ? "⚠️ ALARM" : "clear"} · 🔋${d.battery}%</span>
        <button class="btn ${d.status === "alarm" ? "btn-lock" : "btn-unlock"}" data-safety="${d.id}" data-act="${d.status === "alarm" ? "clear" : "test"}">${d.status === "alarm" ? "Clear" : "Test"}</button>
      </div>`).join("");
  wrap.querySelectorAll("[data-safety]").forEach((b) => b.onclick = (e) => {
    const id = e.currentTarget.dataset.safety, act = e.currentTarget.dataset.act;
    cmd(act === "test" ? "/api/safety/test" : "/api/safety/clear", { id });
  });
}

/* ---- energy & backup power ---- */
function renderEnergy() {
  const wrap = document.getElementById("energy");
  const pw = STATE.power || { onGrid: true, battery: 100, totalW: 0, perZoneW: {} };
  const maxW = Math.max(60, ...Object.values(pw.perZoneW || {}));
  const bars = Object.entries(pw.perZoneW || {}).map(([id, w]) =>
    `<div class="erow"><span class="elbl">${STATE.zones[id]?.name || id}</span>
       <span class="ebar"><span style="width:${Math.round(w / maxW * 100)}%"></span></span>
       <span class="ewatt">${w} W</span></div>`).join("");
  const onGrid = pw.onGrid;
  document.getElementById("simOutage").textContent = onGrid ? "Simulate outage" : "Restore power";
  wrap.innerHTML = `
    <div class="erow erow-top">
      <span class="elbl"><b>Total draw</b> <span class="muted" style="font-weight:400">· $${(pw.rate ?? 0.16).toFixed(2)}/kWh</span></span>
      <span class="ewatt" style="font-size:18px"><b>${(pw.totalW / 1000).toFixed(2)} kW</b> <span class="muted" style="font-size:12px">≈ $${pw.monthlyEstimate ?? "—"}/mo</span></span>
    </div>
    <div class="backup ${onGrid ? "ok" : "battery"}">
      <span class="bk-lbl">${onGrid ? ICON.bolt + " On grid power" : ICON.battery + " On battery backup"}</span>
      <span class="batt"><span class="batt-fill" style="width:${pw.battery}%"></span></span>
      <span>${pw.battery}%</span>
    </div>
    ${onGrid ? "" : '<div class="hint" style="color:var(--bad)">Mains power lost — doors & security stay online on the UPS.</div>'}
    <div style="margin-top:10px">${bars}</div>`;
}

/* ---- equipment / uptime monitoring ---- */
function renderEquipment() {
  const mgr = P().allZones;
  document.querySelectorAll("[data-mgr]").forEach((el) => el.style.display = mgr ? (el.classList.contains("card") ? "block" : (el.tagName === "A" ? "inline" : "flex")) : "none");
  if (!mgr) return;
  const wrap = document.getElementById("equipment");
  const eq = STATE.equipment || [];
  const down = eq.filter((d) => !d.online).length;
  wrap.innerHTML = `<div class="zone-meta">${eq.length} devices monitored${down ? ` · <span style="color:var(--bad)">${down} offline</span>` : " · all online"}</div>` +
    eq.map((d) => `
      <div class="eqrow">
        <span class="dot ${d.online ? "on" : "off"}"></span>
        <span class="eqname">${d.name}</span>
        <span class="equp">${d.online ? "Online" : "Offline"} · ${d.uptimePct}% uptime</span>
        <button class="btn ${d.online ? "btn-unlock" : "btn-lock"}" data-eq="${d.id}" data-on="${d.online ? 0 : 1}">${d.online ? "Simulate down" : "Restore"}</button>
      </div>`).join("");
  wrap.querySelectorAll("[data-eq]").forEach((b) => b.onclick = (e) => cmd("/api/equipment", { id: e.currentTarget.dataset.eq, online: e.currentTarget.dataset.on === "1" }));
}

/* ---- autoclave sterilization log ---- */
function val2(id) { return document.getElementById(id).value; }
function renderSterilization() {
  if (!P().allZones) return;
  const wrap = document.getElementById("sterilization");
  const list = STATE.sterilization || [];
  const lastSpore = list.find((r) => r.spore !== "—");
  const form = `
    <div class="form-line">
      <input id="st_op" placeholder="Operator" style="max-width:120px">
      <input id="st_load" placeholder="Load (e.g. pedicure tools)" style="flex:1;min-width:140px">
      <select class="mini" id="st_cycle"><option>Unwrapped 270°F / 4 min</option><option>Wrapped 250°F / 30 min</option><option>Pouches 270°F / 15 min</option></select>
      <select class="mini" id="st_result"><option>Pass</option><option>Fail</option></select>
      <select class="mini" id="st_spore" title="Spore test"><option>—</option><option>Pass</option><option>Fail</option></select>
      <button class="btn btn-lock" id="st_add">Log cycle</button>
    </div>`;
  const rows = list.length ? list.slice(0, 20).map((r) => `
    <div class="sched-item">
      <span><span class="when">${new Date(r.ts).toLocaleDateString([], { month: "short", day: "numeric" })} ${new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        &nbsp;${r.cycleType} · ${r.load || "—"} · <span class="muted">${r.operator}</span></span>
      <span><span class="cat ${r.result === "Pass" ? "scene" : "alert"}">${r.result}</span>${r.spore !== "—" ? ` <span class="muted">spore ${r.spore}</span>` : ""}</span>
    </div>`).join("") : '<div class="hint">No cycles logged yet.</div>';
  wrap.innerHTML = `<div class="zone-meta">Last spore test: ${lastSpore ? new Date(lastSpore.ts).toLocaleDateString() + " (" + lastSpore.spore + ")" : "none recorded — weekly test recommended"}</div>${form}<div style="margin-top:8px">${rows}</div>`;
  document.getElementById("st_add").onclick = async () => {
    try { await api("/api/sterilization", { method: "POST", body: { operator: val2("st_op"), load: val2("st_load"), cycleType: val2("st_cycle"), result: val2("st_result"), spore: val2("st_spore") } }); toast("✅ Autoclave cycle logged"); }
    catch (e) { toast("⚠️ " + e.message); }
  };
  const csv = document.getElementById("sterilCsv");
  if (csv) csv.onclick = exportSterilCsv;
}
async function exportSterilCsv(e) {
  if (e) e.preventDefault();
  try {
    const res = await fetch(withLoc("/api/sterilization.csv"), { headers: { "Authorization": "Bearer " + TOKEN } });
    if (!res.ok) throw new Error("export failed");
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "lumios-sterilization.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast("⬇ Sterilization log exported");
  } catch (err) { toast("⚠️ " + err.message); }
}

/* ---- generic authed file download ---- */
async function downloadAuth(path, filename) {
  try {
    const res = await fetch(withLoc(path), { headers: { "Authorization": "Bearer " + TOKEN } });
    if (!res.ok) throw new Error("export failed");
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast("⬇ Exported");
  } catch (e) { toast("⚠️ " + e.message); }
}

/* ---- room turnover board ---- */
function renderTurnover() {
  const wrap = document.getElementById("turnover"); if (!wrap) return;
  if (P().role === "guest") { wrap.innerHTML = '<div class="card"><div class="hint">Room status is for staff and managers.</div></div>'; return; }
  const t = STATE.turnover || {};
  const rooms = Object.keys(STATE.zones).filter((id) => STATE.zones[id].treatment || /^room/.test(id));
  const LABEL = { ready: "Ready", inuse: "In use", cleaning: "Needs cleaning" };
  wrap.innerHTML = rooms.map((id) => {
    const st = (t[id] && t[id].status) || "ready";
    return `<div class="card turnover-card ${st}">
      <h3>${STATE.zones[id].name}</h3>
      <div class="tstatus ${st}">${LABEL[st]}</div>
      <div class="form-line">
        <button class="btn ${st === "ready" ? "btn-lock" : "btn-unlock"}" data-turn="${id}" data-s="ready">Ready</button>
        <button class="btn ${st === "inuse" ? "btn-lock" : "btn-unlock"}" data-turn="${id}" data-s="inuse">In use</button>
        <button class="btn ${st === "cleaning" ? "btn-lock" : "btn-unlock"}" data-turn="${id}" data-s="cleaning">Clean</button>
      </div></div>`;
  }).join("");
  wrap.querySelectorAll("[data-turn]").forEach((b) => b.onclick = (e) => cmd("/api/turnover", { room: e.currentTarget.dataset.turn, status: e.currentTarget.dataset.s }));
}

/* ---- opening / closing checklist ---- */
function renderChecklist() {
  const wrap = document.getElementById("checklist"); if (!wrap) return;
  if (P().role === "guest") { wrap.innerHTML = '<div class="hint">Checklist is for staff and managers.</div>'; return; }
  const cl = STATE.checklist || { open: [], close: [] };
  const col = (which) => `<div class="cl-col"><b>${which === "open" ? "Opening" : "Closing"}</b>${(cl[which] || []).map((it, i) => `
      <label class="cl-item"><input type="checkbox" ${it.done ? "checked" : ""} data-cl="${which}" data-i="${i}"> <span class="${it.done ? "done" : ""}">${it.t}</span></label>`).join("")}</div>`;
  wrap.innerHTML = `<div class="cl-wrap">${col("open")}${col("close")}</div>`;
  wrap.querySelectorAll("[data-cl]").forEach((el) => el.onchange = (e) => cmd("/api/checklist", { which: e.target.dataset.cl, index: +e.target.dataset.i, done: e.target.checked }));
}

/* ---- aromatherapy + reception display ---- */
function renderAroma() {
  const wrap = document.getElementById("aroma"); if (!wrap) return;
  if (P().role === "guest") { wrap.innerHTML = '<div class="hint">Aromatherapy is for staff and managers.</div>'; return; }
  const difs = STATE.diffusers || [], scents = STATE.scents || [];
  const rows = difs.map((d) => `
    <div class="row"><span class="lbl"><span class="e">${ICON.drop}</span> ${d.name}${d.on ? ` <span class="muted">· ${d.scent}</span>` : ""}</span>
      <span style="display:flex;align-items:center;gap:10px">
        <select class="mini" data-difscent="${d.id}">${scents.map((s) => `<option ${s === d.scent ? "selected" : ""}>${s}</option>`).join("")}</select>
        <label class="toggle"><input type="checkbox" ${d.on ? "checked" : ""} data-difon="${d.id}"><span class="slider-t"></span></label>
      </span></div>`).join("");
  const disp = STATE.display || {};
  const dispRow = P().allZones ? `<div class="row" style="border-top:1px solid #f1ebe0"><span class="lbl"><span class="e">${ICON.sign}</span> Reception display</span>
      <span style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end">
        <input class="mini" style="flex:1;max-width:280px" id="dispMsg" value="${(disp.message || "").replace(/"/g, "&quot;")}">
        <button class="btn btn-unlock" id="dispSave">Set</button>
        <label class="toggle"><input type="checkbox" ${disp.on ? "checked" : ""} id="dispOn"><span class="slider-t"></span></label>
      </span></div>` : "";
  wrap.innerHTML = rows + dispRow;
  wrap.querySelectorAll("[data-difon]").forEach((el) => el.onchange = (e) => cmd("/api/diffuser", { id: e.target.dataset.difon, on: e.target.checked }));
  wrap.querySelectorAll("[data-difscent]").forEach((el) => el.onchange = (e) => cmd("/api/diffuser", { id: e.target.dataset.difscent, scent: e.target.value }));
  const dOn = document.getElementById("dispOn"); if (dOn) dOn.onchange = (e) => cmd("/api/display", { on: e.target.checked });
  const dSave = document.getElementById("dispSave"); if (dSave) dSave.onclick = () => cmd("/api/display", { message: document.getElementById("dispMsg").value });
}

/* ---- medical fridge ---- */
function renderFridge() {
  const wrap = document.getElementById("fridge"); if (!wrap) return;
  if (!P().allZones) return;
  const fr = STATE.fridges || [];
  wrap.innerHTML = fr.map((f) => {
    const bad = f.status === "alarm";
    const last = (f.readings && f.readings[0]) ? new Date(f.readings[0].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
    return `<div class="eqrow">
      <span class="dot ${bad ? "off" : "on"}"></span>
      <span class="eqname">${f.name} — <b style="color:${bad ? "var(--bad)" : "var(--ink)"}">${f.temp}°F</b></span>
      <span class="equp">safe ${f.min}–${f.max}°F · ${bad ? "⚠️ OUT OF RANGE" : "in range"} · ${last}</span>
      <span style="display:flex;gap:6px"><button class="btn btn-unlock" data-fr="${f.id}" data-d="-2">−</button><button class="btn btn-unlock" data-fr="${f.id}" data-d="2">+</button></span>
    </div>`;
  }).join("") || '<div class="hint">No fridges configured.</div>';
  wrap.querySelectorAll("[data-fr]").forEach((b) => b.onclick = (e) => { const id = e.currentTarget.dataset.fr; const f = STATE.fridges.find((x) => x.id === id); cmd("/api/fridge/reading", { id, temp: f.temp + (+e.currentTarget.dataset.d) }); });
  const csv = document.getElementById("fridgeCsv"); if (csv) csv.onclick = (e) => { e.preventDefault(); downloadAuth("/api/fridge.csv", "lumios-fridge.csv"); };
}

/* ---- reports: digest + compliance ---- */
function renderReports() {
  const wrap = document.getElementById("reports"); if (!wrap) return;
  if (!P().allZones) return;
  wrap.innerHTML = `<div class="form-line">
      <button class="btn btn-lock" id="viewDigest">📋 Today's digest</button>
      <button class="btn btn-unlock" id="compBtn">🖨️ Compliance report (30-day)</button>
      <span class="hint" style="margin:0">A nightly digest auto-sends to the owner at close.</span>
    </div><div id="digestOut" style="margin-top:10px"></div>`;
  document.getElementById("viewDigest").onclick = async () => {
    try { const g = await api("/api/digest"); document.getElementById("digestOut").innerHTML = digestHtml(g); } catch (e) { toast("⚠️ " + e.message); }
  };
  document.getElementById("compBtn").onclick = async () => {
    try { const res = await fetch(withLoc("/api/compliance.html"), { headers: { "Authorization": "Bearer " + TOKEN } }); const html = await res.text(); const w = window.open("", "_blank"); w.document.write(html); w.document.close(); } catch (e) { toast("⚠️ " + e.message); }
  };
}
function digestHtml(g) {
  const row = (n, v, bad) => `<div class="eqrow"><span class="eqname"${bad ? ' style="color:var(--bad)"' : ""}>${n}</span><span class="equp">${v}</span></div>`;
  return `<div class="zone-meta">${g.location} · ${g.date}</div>` +
    row("Scenes run", g.scenesRun) + row("Door / access events", g.doorEvents) + row("Alerts", g.alerts) +
    row("Sterilization cycles", g.sterilizationToday) + row("Security", g.security) +
    row("Est. energy cost", `~$${g.monthlyCost}/mo (${g.powerkW} kW)`) +
    (g.equipmentOffline.length ? row("Equipment offline", g.equipmentOffline.join(", "), true) : "") +
    (g.fridgeAlarms.length ? row("Fridge alarms", g.fridgeAlarms.join(", "), true) : "");
}

const ROLE_LABEL = { owner: "Owner / Admin", manager: "Manager", staff: "Staff", guest: "Guest / Limited" };
function renderHeader() {
  document.getElementById("whoName").textContent = STATE.me.name;
  document.getElementById("whoRole").textContent = ROLE_LABEL[STATE.me.role] || STATE.me.role;
  document.getElementById("adminLink").style.display = P().manageUsers || P().editScenes ? "inline-block" : "none";
  const sw = document.getElementById("locSwitch");
  if (sw) {
    const locs = STATE.locations || [];
    sw.style.display = locs.length > 1 ? "inline-block" : "none";
    sw.innerHTML = locs.map((l) => `<option value="${l.id}" ${l.id === activeLoc ? "selected" : ""}>${l.name}</option>`).join("");
    sw.onchange = (e) => setActiveLoc(e.target.value);
  }
}

function canZone(id) { return P().allZones || (P().zones || []).includes(id); }

function renderScenes() {
  const wrap = document.getElementById("scenes");
  wrap.innerHTML = "";
  for (const key in STATE.scenes) {
    const sc = STATE.scenes[key];
    const allowed = P().scenes === "all" || (Array.isArray(P().scenes) && P().scenes.includes(key));
    const b = document.createElement("button");
    b.className = "scene " + (sc.cls || "");
    if (!allowed) b.disabled = true;
    b.innerHTML = `<div class="ic">${sceneIcon(sc)}</div><div class="nm">${sc.name}</div><div class="ds">${sc.desc || ""}</div>`;
    b.onclick = () => runScene(key, sc);
    wrap.appendChild(b);
  }
}
async function runScene(key, sc, room) {
  if (sc.perRoom && !room) return pickTreatmentRoom(key, sc);   // show the picker first
  try { const r = await api("/api/scene", { method: "POST", body: { scene: key, room } }); toast("✨ " + r.label); }
  catch (e) { toast("🔒 " + e.message); }
}

/* ---- per-room Treatment picker (replaces the old prompt) ---- */
function pickTreatmentRoom(key, sc) {
  const rooms = Object.entries(STATE.zones).filter(([id, z]) => z.treatment || /^room/.test(id));
  const list = (rooms.length ? rooms : Object.entries(STATE.zones))
    .map(([id, z]) => `<button class="btn btn-primary room-pick" data-room="${id}" style="margin:6px 0">${z.name}</button>`).join("");
  showModal(`<div class="logo">${sceneIcon(sc)}</div><h2>${sc.name}</h2>
    <p>Which room are you prepping?</p>${list}
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>`);
  document.querySelectorAll(".room-pick").forEach((b) => b.onclick = () => { closeModal(); runScene(key, sc, b.dataset.room); });
}
function showModal(html) { document.getElementById("modalCard").innerHTML = html; document.getElementById("modal").style.display = "flex"; }
function closeModal() { document.getElementById("modal").style.display = "none"; }

function renderSalonTemp() {
  const wrap = document.getElementById("salonTemp");
  if (!wrap) return;
  if (!P().allZones) { wrap.innerHTML = '<div class="hint">Salon temperature is available to managers and owners.</div>'; return; }
  const ids = Object.keys(STATE.zones || {});
  const cur = ids.length ? STATE.zones[ids[0]].temp : 72;
  const mode = (STATE.hvac && STATE.hvac.mode) || "heat_cool";
  const off = mode === "off";
  const modes = [["off", "Off"], ["heat", "Heat"], ["cool", "Cool"], ["heat_cool", "Auto"]];
  const modeBtns = modes.map(([m, label]) =>
    `<button class="hvac-mode${m === mode ? " active" : ""}${m === "off" ? " off" : ""}" data-mode="${m}">${label}</button>`).join("");
  wrap.innerHTML = `
    <div class="salon-temp">
      <div class="salon-temp-lbl"><span class="e">${ICON.temp}</span> Whole salon — both thermostats</div>
      <div class="salon-temp-ctrl">
        <button class="tstep" data-salon="-1" aria-label="Cooler" ${off ? "disabled" : ""}>−</button>
        <span class="salon-temp-val${off ? " is-off" : ""}">${off ? "Off" : `${cur}°<span class="salon-temp-unit">F</span>`}</span>
        <button class="tstep" data-salon="1" aria-label="Warmer" ${off ? "disabled" : ""}>+</button>
      </div>
    </div>
    <div class="hvac-modes">${modeBtns}</div>`;
  wrap.querySelectorAll("[data-salon]").forEach((b) => b.onclick = () => {
    const now = STATE.zones[Object.keys(STATE.zones)[0]].temp;
    cmd("/api/temp/salon", { value: now + (+b.dataset.salon) });
  });
  wrap.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
    cmd("/api/temp/salon/mode", { mode: b.dataset.mode });
  });
}

const expandedZones = new Set();
function renderZones() {
  const wrap = document.getElementById("zones");
  wrap.innerHTML = "";
  for (const id in STATE.zones) {
    const z = STATE.zones[id];
    const editable = canZone(id);
    const card = document.createElement("div");
    card.className = "card" + (editable ? "" : " locked-out") + (expandedZones.has(id) ? " expanded" : "");
    const plOpts = STATE.playlists.map((p) => `<option ${p === z.music ? "selected" : ""}>${p}</option>`).join("");
    card.innerHTML = `
      <h3>${z.name} ${P().cameras ? `<button class="hist" data-hist="${id}" title="Recent changes">${ICON.clock}</button>` : ""}</h3>
      <div class="zone-meta">${z.light ? `Lights ${z.dim}%` : "Lights off"} · ${z.music === "off" ? "No music" : z.music}</div>
      <div class="row"><span class="lbl"><span class="e">${ICON.bulb}</span> Lights</span>
        <label class="toggle"><input type="checkbox" ${z.light ? "checked" : ""} data-light="${id}"><span class="slider-t"></span></label></div>
      <div class="dim"><span class="e">${ICON.sun}</span>
        <input type="range" min="0" max="100" value="${z.dim}" data-dim="${id}" ${z.light ? "" : "disabled"}>
        <span class="pct">${z.dim}%</span></div>
      <button class="morebtn" data-more="${id}"><span class="mlbl">More</span> <span class="chev">▾</span></button>
      <div class="zone-extra">
      <div class="row"><span class="lbl"><span class="e">${ICON.tone}</span> Light tone</span></div>
      <div class="dim"><span class="e">${ICON.tone}</span>
        <input type="range" class="cct" min="2200" max="6500" step="100" value="${z.cct || 3000}" data-cct="${id}" ${z.light ? "" : "disabled"}>
        <span class="pct" style="width:auto">${cctLabel(z.cct)}</span></div>
      ${z.hasColor === false ? "" : `
      <div class="row"><span class="lbl"><span class="e">${ICON.drop}</span> Accent color</span>
        <span class="swatches">
          ${["#ffffff","#ffd9b3","#ffd1e3","#d7c5ff","#bfe6ff","#cfeccf"].map((c) => `<button class="swatch" style="background:${c}" data-swatch="${id}" data-c="${c}" title="${c}"></button>`).join("")}
          <input type="color" class="color-pick" value="${z.color || "#ffffff"}" data-color="${id}">
        </span></div>`}
      <div class="row"><span class="lbl"><span class="e">${ICON.star}</span> Looks</span>
        <span class="presets">
          ${(z.presets || []).map((p) => `<button class="chip" data-preset="${id}" data-pn="${p.name}">${p.name}</button>`).join("")}
          <button class="chip add" data-presetsave="${id}" title="Save current as a preset">＋</button>
        </span></div>
      <div class="row"><span class="lbl"><span class="e">${ICON.motion}</span> Motion lighting</span>
        <span style="display:flex;align-items:center;gap:10px">
          <a href="#" class="mini-link" data-motiontest="${id}">test</a>
          <label class="toggle"><input type="checkbox" ${z.autoLight ? "checked" : ""} data-auto="${id}"><span class="slider-t"></span></label>
        </span></div>
      <div class="row"><span class="lbl"><span class="e">${ICON.music}</span> Music</span>
        <select class="mini" data-music="${id}">${plOpts}</select></div>
      <div class="dim"><span class="e">${ICON.volume}</span>
        <input type="range" min="0" max="100" value="${z.vol}" data-vol="${id}"><span class="pct">${z.vol}%</span></div>
      </div>`;
    wrap.appendChild(card);
  }
  bindZoneEvents();
}

function bindZoneEvents() {
  document.querySelectorAll("[data-light]").forEach((el) => el.onchange = (e) =>
    cmd("/api/light", { zone: e.target.dataset.light, on: e.target.checked }));
  document.querySelectorAll("[data-dim]").forEach((el) => {
    el.oninput = (e) => e.target.nextElementSibling.textContent = e.target.value + "%";
    el.onchange = (e) => cmd("/api/light", { zone: e.target.dataset.dim, on: true, dim: +e.target.value });
  });
  document.querySelectorAll("[data-cct]").forEach((el) => {
    el.oninput = (e) => e.target.nextElementSibling.textContent = cctLabel(+e.target.value);
    el.onchange = (e) => cmd("/api/cct", { zone: e.target.dataset.cct, value: +e.target.value });
  });
  document.querySelectorAll("[data-swatch]").forEach((el) => el.onclick = (e) => cmd("/api/color", { zone: e.currentTarget.dataset.swatch, color: e.currentTarget.dataset.c }));
  document.querySelectorAll("[data-color]").forEach((el) => el.onchange = (e) => cmd("/api/color", { zone: e.target.dataset.color, color: e.target.value }));
  document.querySelectorAll("[data-auto]").forEach((el) => el.onchange = (e) => cmd("/api/light/auto", { zone: e.target.dataset.auto, on: e.target.checked }));
  document.querySelectorAll("[data-motiontest]").forEach((el) => el.onclick = (e) => { e.preventDefault(); api("/api/zone/motion", { method: "POST", body: { zone: e.currentTarget.dataset.motiontest } }).then(() => toast("🚶 Motion — auto lights respond")); });
  document.querySelectorAll("[data-preset]").forEach((el) => el.onclick = (e) => cmd("/api/light/preset/apply", { zone: e.currentTarget.dataset.preset, name: e.currentTarget.dataset.pn }));
  document.querySelectorAll("[data-presetsave]").forEach((el) => el.onclick = (e) => { const n = prompt("Name this lighting look (e.g. Facial):"); if (n) cmd("/api/light/preset/save", { zone: e.currentTarget.dataset.presetsave, name: n }); });
  document.querySelectorAll("[data-temp]").forEach((el) => el.onclick = (e) => {
    const id = e.currentTarget.dataset.temp;
    cmd("/api/temp", { zone: id, value: STATE.zones[id].temp + (+e.currentTarget.dataset.d) });
  });
  document.querySelectorAll("[data-music]").forEach((el) => el.onchange = (e) =>
    cmd("/api/music", { zone: e.target.dataset.music, playlist: e.target.value }));
  document.querySelectorAll("[data-hist]").forEach((el) => el.onclick = () => {
    const z = STATE.zones[el.dataset.hist]; showHistory(z.name + " — history", z.name);
  });
  document.querySelectorAll("[data-more]").forEach((el) => el.onclick = (e) => {
    const id = e.currentTarget.dataset.more;
    const card = e.currentTarget.closest(".card");
    const open = card.classList.toggle("expanded");
    if (open) expandedZones.add(id); else expandedZones.delete(id);
    e.currentTarget.querySelector(".mlbl").textContent = open ? "Less" : "More";
  });
  document.querySelectorAll("[data-vol]").forEach((el) => {
    el.oninput = (e) => e.target.nextElementSibling.textContent = e.target.value + "%";
    el.onchange = (e) => cmd("/api/music", { zone: e.target.dataset.vol, vol: +e.target.value });
  });
}

async function cmd(path, body) {
  try { await api(path, { method: "POST", body }); }
  catch (e) { toast("🔒 " + e.message); refresh(); }
}

function renderDoors() {
  const wrap = document.getElementById("doors");
  wrap.innerHTML = "";
  const inner = document.createElement("div"); inner.className = "doors";
  for (const id in STATE.doors) {
    const d = STATE.doors[id];
    if (d.room) continue;                       // room doors render in renderRoomAccess()
    const el = document.createElement("div"); el.className = "door";
    el.innerHTML = `<div>
        <div class="door-name"><span class="di">${d.locked ? ICON.lock : ICON.unlock}</span> ${d.name} ${P().cameras ? `<button class="hist" data-doorhist="${id}" title="Recent changes">${ICON.clock}</button>` : ""}</div>
        <span class="state ${d.locked ? "locked" : "unlocked"}">${d.locked ? "LOCKED" : "UNLOCKED"}</span></div>
      <button class="btn ${d.locked ? "btn-unlock" : "btn-lock"}" data-door="${id}">${d.locked ? "Unlock" : "Lock"}</button>`;
    inner.appendChild(el);
  }
  wrap.appendChild(inner);
  const canDoors = P().doors === "all";
  wrap.classList.toggle("locked-out", !canDoors);
  if (!canDoors) {
    const note = document.createElement("div");
    note.className = "hint"; note.style.pointerEvents = "auto";
    note.textContent = "Your role runs doors through the Open/Close scenes, not individually.";
    wrap.appendChild(note);
  }
  wrap.querySelectorAll("[data-door]").forEach((b) => b.onclick = async (e) => {
    const id = e.target.dataset.door;
    try { const d = await api("/api/door", { method: "POST", body: { door: id, lock: !STATE.doors[id].locked } });
      toast(`${d.locked ? "🔒" : "🔓"} ${d.name} ${d.locked ? "locked" : "unlocked"}`); }
    catch (err) { toast("🔒 " + err.message); }
  });
  wrap.querySelectorAll("[data-doorhist]").forEach((el) => el.onclick = () => {
    const d = STATE.doors[el.dataset.doorhist]; showHistory(d.name + " — history", d.name);
  });
}

/* ---- exterior signage ---- */
function renderSignage() {
  const wrap = document.getElementById("signage");
  if (!wrap) return;
  if (!P().allZones) { wrap.innerHTML = '<div class="hint">Signage control is available to managers and owners.</div>'; return; }
  const signs = STATE.signage || [];
  wrap.innerHTML = signs.map((s) => `
    <div class="row"><span class="lbl"><span class="e">${ICON.sign}</span> ${s.name}${s.mode ? ` <span class="muted">· ${s.mode}</span>` : ""}</span>
      <span style="display:flex;align-items:center;gap:10px">
        ${s.modes ? `<select class="mini" data-signmode="${s.id}">${s.modes.map((m) => `<option ${m === s.mode ? "selected" : ""}>${m}</option>`).join("")}</select>` : ""}
        <label class="toggle"><input type="checkbox" ${s.on ? "checked" : ""} data-signon="${s.id}"><span class="slider-t"></span></label>
      </span></div>`).join("") || '<div class="hint">No signs configured.</div>';
  wrap.querySelectorAll("[data-signon]").forEach((el) => el.onchange = (e) => cmd("/api/signage", { id: e.target.dataset.signon, on: e.target.checked }));
  wrap.querySelectorAll("[data-signmode]").forEach((el) => el.onchange = (e) => cmd("/api/signage", { id: e.target.dataset.signmode, mode: e.target.value }));
}

/* ---- room-level access ---- */
function renderRoomAccess() {
  const wrap = document.getElementById("roomAccess");
  if (!wrap) return;
  const rooms = Object.entries(STATE.doors).filter(([id, d]) => d.room);
  if (!rooms.length) { wrap.innerHTML = '<div class="hint">No room locks configured.</div>'; return; }
  wrap.innerHTML = `<div class="doors">` + rooms.map(([id, d]) => {
    const can = canZone(d.zone);
    const last = d.lastAccessTs ? `Last entry: ${d.lastAccessBy || "—"} · ${new Date(d.lastAccessTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No recent access";
    return `<div class="door ${can ? "" : "locked-out"}">
      <div><div class="door-name"><span class="di">${d.locked ? ICON.lock : ICON.unlock}</span> ${d.name} ${P().cameras ? `<button class="hist" data-rmhist="${id}" title="Access log">${ICON.clock}</button>` : ""}</div>
        <span class="state ${d.locked ? "locked" : "unlocked"}">${d.locked ? "LOCKED" : "UNLOCKED"}</span>
        <div class="zone-meta" style="margin:5px 0 0">${last}</div></div>
      <button class="btn ${d.locked ? "btn-unlock" : "btn-lock"}" data-rmdoor="${id}" ${can ? "" : "disabled"}>${d.locked ? "Unlock" : "Lock"}</button></div>`;
  }).join("") + `</div>`;
  wrap.querySelectorAll("[data-rmdoor]").forEach((b) => b.onclick = async (e) => {
    const id = e.currentTarget.dataset.rmdoor;
    try { const d = await api("/api/door", { method: "POST", body: { door: id, lock: !STATE.doors[id].locked } });
      toast(`${d.locked ? "🔒" : "🔓"} ${d.name} ${d.locked ? "locked" : "unlocked"}`); }
    catch (err) { toast("🔒 " + err.message); }
  });
  wrap.querySelectorAll("[data-rmhist]").forEach((el) => el.onclick = () => { const d = STATE.doors[el.dataset.rmhist]; showHistory(d.name + " — access log", d.name); });
}

function renderCams() {
  const secEls = document.querySelectorAll("[data-secure]");
  if (!P().cameras) { secEls.forEach((el) => el.style.display = "none"); return; }
  secEls.forEach((el) => el.style.display = el.classList.contains("cams") ? "grid" : (el.tagName === "A" ? "inline" : "flex"));
  renderLiveCams();
}

/* ---- Live cameras (real feeds from Home Assistant) ----
   Built once, then each tile's image refreshes on a timer for a near-live view. */
let liveCamsLoaded = false;
let liveCamsTimer = null;
async function renderLiveCams() {
  const wrap = document.getElementById("liveCams");
  if (!wrap) return;
  if (!P().cameras) { clearInterval(liveCamsTimer); liveCamsTimer = null; liveCamsLoaded = false; wrap.innerHTML = ""; return; }
  if (liveCamsLoaded) return;            // already built; images self-refresh
  liveCamsLoaded = true;
  wrap.innerHTML = `<div class="hint">Finding your cameras…</div>`;
  let cams = [];
  try { cams = (await api("/api/cameras/live")).cameras || []; }
  catch (e) { wrap.innerHTML = `<div class="hint">Couldn't reach the cameras: ${e.message}</div>`; liveCamsLoaded = false; return; }
  if (!cams.length) { wrap.innerHTML = `<div class="hint">No live cameras found on the hub yet.</div>`; liveCamsLoaded = false; return; }
  const src = (e) => `/api/camera_proxy?entity=${encodeURIComponent(e)}&token=${encodeURIComponent(TOKEN)}&t=${Date.now()}`;
  wrap.innerHTML = cams.map((c) => `
    <div class="cam livecam">
      <div class="feed"><img data-cament="${c.entity_id}" src="${src(c.entity_id)}" alt="${c.name}"
        onerror="this.classList.add('camerr')"></div>
      <div class="tag"><span>${c.name}</span><span class="live">● LIVE</span></div>
    </div>`).join("");
  clearInterval(liveCamsTimer);
  liveCamsTimer = setInterval(() => {
    if (document.hidden) return;         // don't hammer the hub while hidden
    wrap.querySelectorAll("img[data-cament]").forEach((img) => { img.src = src(img.dataset.cament); });
  }, 2000);
}

/* ---- AI events feed (discreet monitoring) ---- */
function renderAIEvents() {
  const wrap = document.getElementById("aiEvents");
  if (!wrap) return;
  if (!P().cameras) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  const evs = STATE.aiEvents || [];
  const cams = Object.entries(STATE.cams);
  const sim = `<div class="form-line">
      <span class="lbl"><b>AI detection</b></span>
      <select class="mini" id="ai_cam">${cams.map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("")}</select>
      <select class="mini" id="ai_type"><option>person</option><option>loitering</option><option>package</option><option>vehicle</option></select>
      <button class="btn btn-lock" id="ai_go">Simulate detection</button>
    </div>`;
  const list = evs.length ? evs.slice(0, 12).map((e) => `
      <div class="sched-item"><span><span class="when">${new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        &nbsp;🤖 <b style="text-transform:capitalize">${e.type}</b> · ${e.camName} <span class="muted">${e.confidence}% conf.</span></span></div>`).join("")
    : '<div class="hint">No AI detections yet.</div>';
  wrap.innerHTML = `<div class="zone-meta">🔒 Discreet by design — AI covers common areas &amp; entrances only; never treatment rooms or bathrooms.</div>${sim}<div style="margin-top:8px">${list}</div>`;
  document.getElementById("ai_go").onclick = () => cmd("/api/camera/detect", { camId: document.getElementById("ai_cam").value, type: document.getElementById("ai_type").value });
}

function renderSchedule() {
  const wrap = document.getElementById("schedule");
  const a = STATE.automation;
  const rows = [];
  a.schedules.forEach((s) => rows.push(`<div class="sched-item"><span><span class="when">${fmt(s.time)}</span> &nbsp;${s.label || s.scene}${s.enabled ? "" : " (off)"}</span>
    <button class="btn btn-unlock" data-run="${s.scene}">Run now</button></div>`));
  a.triggers.forEach((t) => rows.push(`<div class="sched-item"><span><span class="when">Trigger</span> &nbsp;${t.label}${t.enabled ? "" : " (off)"}</span></div>`));
  wrap.innerHTML = rows.join("") || '<div class="hint">No automations yet.</div>';
  wrap.querySelectorAll("[data-run]").forEach((b) => b.onclick = () => runScene(b.dataset.run, STATE.scenes[b.dataset.run] || {}));
}
function fmt(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

async function renderLog() {
  const wrap = document.getElementById("log");
  const exportLink = document.getElementById("exportCsv");
  if (!P().cameras) {
    if (exportLink) exportLink.style.display = "none";
    wrap.innerHTML = '<div class="hint">The activity log is visible to managers and owners.</div>';
    return;
  }
  if (exportLink) { exportLink.style.display = "inline"; exportLink.onclick = exportAuditCsv; }
  try {
    const log = await api("/api/audit");
    AUDIT_CACHE = log;
    wrap.innerHTML = log.length ? log.map((l) =>
      `<div><span class="t">${l.t}</span><span class="cat ${l.category}">${l.category}</span>${l.msg}<span class="who">${l.who !== "system" ? "· " + l.who : ""}</span></div>`).join("")
      : '<div class="hint">No activity yet today.</div>';
  } catch {}
}
let AUDIT_CACHE = [];
async function exportAuditCsv(e) {
  if (e) e.preventDefault();
  try {
    const res = await fetch("/api/audit.csv", { headers: { "Authorization": "Bearer " + TOKEN } });
    if (!res.ok) throw new Error("export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "lumios-audit.csv"; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
    toast("⬇ Audit log exported as CSV");
  } catch (err) { toast("⚠️ " + err.message); }
}

/* ---- per-device "what changed" history ---- */
async function showHistory(label, matchName) {
  let log = AUDIT_CACHE;
  if (!log.length) { try { log = await api("/api/audit"); AUDIT_CACHE = log; } catch { log = []; } }
  const hits = log.filter((l) => l.msg.includes(matchName)).slice(0, 25);
  const rows = hits.length ? hits.map((l) =>
    `<div style="text-align:left;padding:7px 0;border-top:1px solid #f0e7ec;font-size:13px">
       <span class="t" style="color:var(--gold)">${l.t}</span> ${l.msg}
       <span class="who" style="color:var(--rose)">${l.who !== "system" ? "· " + l.who : ""}</span></div>`).join("")
    : '<p class="muted">No recent changes recorded.</p>';
  showModal(`<div class="logo">🕘</div><h2>${label}</h2><p>Recent changes</p>
    <div style="max-height:340px;overflow:auto">${rows}</div>
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:10px">Close</button>`);
}

/* ============ VOICE ============ */

/* ============ VOICE ============ */
const VOICE_SUPPORTED = ("webkitSpeechRecognition" in window) || ("SpeechRecognition" in window);
let recog = null, listening = false;
function setupVoice() {
  const btn = document.getElementById("voiceBtn");
  if (!VOICE_SUPPORTED) { btn.onclick = () => promptType(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR(); recog.lang = "en-US"; recog.interimResults = false; recog.maxAlternatives = 1;
  recog.onresult = (e) => handleVoice(e.results[0][0].transcript);
  recog.onerror = (e) => { toast("🎙️ Didn't catch that (" + e.error + ")"); stopListen(); };
  recog.onend = () => stopListen();
  btn.onclick = () => listening ? stopListen() : startListen();
}
function startListen() { try { recog.start(); listening = true;
  document.getElementById("voiceBtn").classList.add("listening");
  document.getElementById("voiceLbl").textContent = "Listening…"; toast("🎙️ Listening… speak a command"); } catch {} }
function stopListen() { listening = false;
  document.getElementById("voiceBtn").classList.remove("listening");
  document.getElementById("voiceLbl").textContent = "Voice"; try { recog.stop(); } catch {} }
function promptType() {
  const t = prompt('Type a command (voice needs Chrome/Edge/Safari):\ne.g. "Good morning Lumi", "Dim room 1 to 30%"');
  if (t) handleVoice(t);
}
async function handleVoice(said) {
  toast(`🎙️ "${said}"`);
  try {
    const r = await api("/api/voice", { method: "POST", body: { text: said } });
    toast((r.ok ? "✅ " : "🤔 ") + r.message);
    if (r.intent && r.intent.type === "camera") document.getElementById("liveCams")?.scrollIntoView({ behavior: "smooth" });
  } catch (e) { toast("🔒 " + e.message); }
}

/* ============ INSTALL (PWA) BANNER ============ */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; showInstallBanner(); });
window.addEventListener("appinstalled", () => { hideInstallBanner(); toast("📲 LumiOS installed — open it from your Home Screen."); });
function showInstallBanner() {
  if (localStorage.getItem("lumios_install_dismissed")) return;
  const el = document.getElementById("installBanner"); if (el) el.style.display = "flex";
}
function hideInstallBanner() { const el = document.getElementById("installBanner"); if (el) el.style.display = "none"; }
function bindInstall() {
  const btn = document.getElementById("installBtn"), dis = document.getElementById("installDismiss");
  if (btn) btn.onclick = async () => {
    if (!deferredPrompt) return toast("Use your browser menu → Add to Home Screen.");
    deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; hideInstallBanner();
  };
  if (dis) dis.onclick = () => { localStorage.setItem("lumios_install_dismissed", "1"); hideInstallBanner(); };
}

/* ============ WEB PUSH (phone alerts) ============ */
let pushEnabled = false;
let swReg = null;

function urlB64ToUint8(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register("/sw.js");
    if (swReg.pushManager) {
      const sub = await swReg.pushManager.getSubscription();
      pushEnabled = !!sub;
      if (STATE) renderSecurity();
    }
  } catch (e) { /* SW needs https or localhost */ }
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return toast("🔔 This browser can't do push. On iPhone, add LumiOS to your Home Screen first.");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("🔔 Notifications were blocked — enable them in browser settings.");
    if (!swReg) swReg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const { key } = await api("/api/push/key");
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub } });
    pushEnabled = true; renderSecurity();
    toast("🔔 Phone alerts enabled. You'll get alarms & outages even when away.");
  } catch (e) { toast("🔔 Couldn't enable alerts: " + e.message); }
}

/* ============ REAL-TIME (SSE) ============
   Keeps every device (phone, computer, iPad) showing the same live state.
   A change on any device is broadcast to all the others, which resync.     */
let es = null;
let streamRetry = null;
function connectStream() {
  try { if (es) es.close(); } catch {}
  clearTimeout(streamRetry);
  es = new EventSource("/api/stream?token=" + encodeURIComponent(TOKEN));
  // The server sends "hello" on every (re)connect — pull fresh state so a device
  // that was asleep or briefly offline catches up on anything it missed.
  es.addEventListener("hello", () => { refresh().catch(() => {}); });
  es.addEventListener("change", (e) => { const d = JSON.parse(e.data); if (!d.loc || d.loc === activeLoc) refresh().catch(() => {}); });
  es.addEventListener("log", () => renderLog());
  es.addEventListener("locations", () => refresh().catch(() => {}));
  es.addEventListener("scene", (e) => { const d = JSON.parse(e.data); if (d.loc === activeLoc) toast("✨ " + d.label); });
  es.addEventListener("alert", (e) => { const d = JSON.parse(e.data); const at = (d.locName && d.loc !== activeLoc ? " @ " + d.locName : ""); toast((d.ai ? `🤖 AI: ${d.ai} at ` : "🚨 Motion: ") + d.name + at); });
  es.addEventListener("push", (e) => { const d = JSON.parse(e.data); notify(d.title, d.body); });
  es.onerror = () => {
    // If the browser gave up entirely (readyState 2 = CLOSED), reconnect ourselves
    // so the device never gets stuck showing stale state (common on iOS after sleep).
    if (es && es.readyState === 2) { clearTimeout(streamRetry); streamRetry = setTimeout(connectStream, 3000); }
  };
}
// Whenever a device becomes active again — wake from sleep, tab refocus, network
// restored — immediately resync so all screens match.
function resync() {
  if (!TOKEN) return;
  refresh().catch(() => {});
  if (!es || es.readyState === 2) connectStream();
}
let resyncBound = false;
function bindResync() {
  if (resyncBound) return; resyncBound = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resync(); });
  window.addEventListener("focus", resync);
  window.addEventListener("online", resync);
}
function notify(title, body) {
  toast("🔔 " + body);
  if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
}

/* ============ misc ============ */
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function tick() { document.getElementById("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

async function boot() {
  await refresh();
  await renderLog();
  connectStream();
  bindResync();
  setupVoice();
  registerSW();
  document.getElementById("simOutage").onclick = (e) => { e.preventDefault(); api("/api/simulate/outage", { method: "POST", body: { onGrid: !(STATE.power && STATE.power.onGrid) } }); };
}

/* ---------- init ---------- */
renderPad();
bindInstall();
setInterval(tick, 1000); tick();
document.getElementById("twoCode")?.addEventListener("keydown", (e) => { if (e.key === "Enter") do2FA(); });
document.getElementById("password")?.addEventListener("keydown", (e) => { if (e.key === "Enter") doPasswordLogin(); });

// auto-resume an existing session
if (TOKEN) {
  api("/api/me").then((r) => onLoggedIn(TOKEN)).catch(() => { TOKEN = null; localStorage.removeItem("lumios_token"); });
}
