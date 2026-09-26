/* ============================================================
   LumiOS — central configuration & factory defaults
   ============================================================
   Everything here is the "out of the box" setup that is written
   to /data the first time the server boots. After that, the live
   values live in /data/*.json and are edited through the app /
   admin screen — you don't need to touch this file again unless
   you want to change factory defaults.
   ============================================================ */

module.exports = {
  // --- Server ---
  PORT: process.env.PORT || 4200,
  HOST: process.env.HOST || "0.0.0.0",

  // Which device driver to use: "mock" (simulator) or "real".
  // Switch to "real" only after wiring src/devices/drivers/realDriver.js
  // to your on-site hub. See docs/SETUP.md.
  DRIVER: process.env.LUMIOS_DRIVER || "mock",

  // --- Security ---
  SESSION_TIMEOUT_MIN: 30,        // auto sign-out after inactivity
  LOCK_RATE_LIMIT: { max: 8, windowSec: 60 }, // door lock/unlock throttle
  LOGIN_LOCKOUT: { max: 5, windowSec: 300 },  // per-ACCOUNT password lockout (5 fails → 5-min lock)
  PIN_THROTTLE:  { max: 10, windowSec: 60 },   // global PIN rate cap: tolerant of fumbles, heals in 60s, caps brute-force
  REQUIRE_OWNER_2FA: true,        // owner must pass a 2nd factor — even via PIN (no bypass)
  SYNC_INTERVAL_MS: 10000,        // real driver: how often to read device state back from the hub

  // Business hours used by the scheduler & after-hours triggers.
  HOURS: { openLabel: "9:00 AM", closeLabel: "7:00 PM", afterHoursStart: 20, afterHoursEnd: 7 },

  // --- Factory default users ---
  // Passwords/PINs here are ONLY used to seed /data/users.json on first
  // boot. CHANGE THEM immediately from the Admin screen. PINs are for the
  // wall-mounted front-desk tablet; passwords are for full sign-in.
  DEFAULT_USERS: [
    { username: "owner",   name: "Owner",   role: "owner",   password: "lumi-owner-change-me",   pin: "1234" },
    { username: "manager", name: "Manager", role: "manager", password: "lumi-manager-change-me", pin: "2345" },
    { username: "ana",     name: "Ana",     role: "staff",   password: "lumi-staff-change-me",    pin: "3456", zones: ["room1"] },
    { username: "guest",   name: "Guest",   role: "guest",   password: "lumi-guest",              pin: "4567", zones: ["reception"] },
  ],

  // --- Factory default physical layout (the "world" LumiOS controls) ---
  DEFAULT_STATE: {
    // shade = % open (100 = fully open, 0 = closed). hasShade=false for windowless
    // rooms (no shade hardware). treatment=true marks rooms the Treatment picker offers.
    zones: {
      reception: { name: "Reception / Waiting 101", emoji: "🛎️", light: true,  dim: 80,  temp: 72, music: "off", vol: 25, hasShade: false, cct: 3200 },
      pedicure:  { name: "Pedicure 102",             emoji: "💅", light: true,  dim: 70,  temp: 73, music: "off", vol: 20, hasShade: false, cct: 3000 },
      manicure:  { name: "Manicure 103",             emoji: "💎", light: true,  dim: 75,  temp: 73, music: "off", vol: 20, hasShade: false, cct: 4000 },
      room1:     { name: "Treatment Room 104",       emoji: "🌸", light: false, dim: 35,  temp: 74, music: "off", vol: 30, hasShade: false, treatment: true, cct: 2700 },
      room2:     { name: "Treatment Room 105",       emoji: "🌿", light: false, dim: 35,  temp: 74, music: "off", vol: 30, hasShade: false, treatment: true, cct: 2700 },
      bath1:     { name: "Restroom 107",             emoji: "🚻", light: false, dim: 100, temp: 72, music: "off", vol: 0,  hasShade: false, cct: 4000 },
      bath2:     { name: "Restroom 109",             emoji: "🚻", light: false, dim: 100, temp: 72, music: "off", vol: 0,  hasShade: false, cct: 4000 },
      break:     { name: "Break Room 106",           emoji: "☕", light: false, dim: 70,  temp: 71, music: "off", vol: 10, hasShade: false, cct: 3500 },
    },
    // Per door schedule A40: Door 01 glass entry, Doors 02/03 = Treatment 104/105
    // (all "coordinate hardware with tenant" → keyless). Rear = existing corridor exit.
    doors: {
      front: { name: "Front Entrance (glass) — Door 01", locked: true },
      back:  { name: "Rear / Corridor Exit",            locked: true },
      // room-level access, gated by per-staff room permissions (their assigned zone):
      room1: { name: "Treatment Room 104 — Door 02", locked: false, room: true, zone: "room1" },
      room2: { name: "Treatment Room 105 — Door 03", locked: false, room: true, zone: "room2" },
    },
    // 7 cameras — common areas + both entrances + break room. NONE in treatment
    // rooms or bathrooms (discreet / privacy by design).
    cams: {
      entry:     { name: "Front Entry (storefront)", alert: false, nightMode: false },
      reception: { name: "Reception 101",            alert: false, nightMode: false },
      retail:    { name: "Nail-Tech Floor",          alert: false, nightMode: false },
      pedicure:  { name: "Pedicure 102",             alert: false, nightMode: false },
      manicure:  { name: "Manicure 103",             alert: false, nightMode: false },
      back:      { name: "Corridor / Rear",          alert: false, nightMode: false },
      break:     { name: "Break Room 106",           alert: false, nightMode: false },
    },
    playlists: ["off", "Calm Spa", "Lofi Lounge", "Upbeat Pop", "Nature Sounds"],

    // Motorized shades as individual devices (each moves on its own). level = % open.
    // All 8 are in the reception / nail-tech area — numbered for easy reference.
    shades: [
      { id: "sh_1", name: "Shade 1", level: 100 },
      { id: "sh_2", name: "Shade 2", level: 100 },
      { id: "sh_3", name: "Shade 3", level: 100 },
      { id: "sh_4", name: "Shade 4", level: 100 },
      { id: "sh_5", name: "Shade 5", level: 100 },
      { id: "sh_6", name: "Shade 6", level: 100 },
      { id: "sh_7", name: "Shade 7", level: 100 },
      { id: "sh_8", name: "Shade 8", level: 100 },
    ],

    // Smart sound zoning: named audio groups, each plays its own source/volume.
    audioGroups: [
      { id: "front",     name: "Front of House",  zones: ["reception", "pedicure", "manicure"] },
      { id: "treatment", name: "Treatment Rooms", zones: ["room1", "room2"] },
      { id: "back",      name: "Break Room",      zones: ["break"] },
    ],

    // Unified security panel: disarmed | home (motion only inside off) | away (fully armed)
    security: { mode: "disarmed", alarm: false, siren: false, since: null },

    // Life-safety: smart smoke + CO detectors (alerts/automation; supplements the
    // code-required hardwired system, does not replace it).
    safety: [
      { id: "sf_reception", name: "Reception",    type: "Smoke + CO", status: "clear", battery: 100 },
      { id: "sf_back",      name: "Back Hallway",  type: "Smoke + CO", status: "clear", battery: 100 },
      { id: "sf_break",     name: "Break Room",    type: "Smoke + CO", status: "clear", battery: 100 },
    ],

    // Backup power: when onGrid flips false (outage), the UPS carries doors+security.
    power: { onGrid: true, battery: 100, rate: 0.16 },   // rate = $/kWh (Chicago ComEd ~$0.16)

    // Medical fridge temperature monitoring (compliance for refrigerated products).
    fridges: [
      { id: "fridge_1", name: "Product Fridge", temp: 38, min: 36, max: 46, status: "ok", readings: [] },
    ],

    // Room turnover board — Ready / In use / Needs cleaning.
    turnover: { room1: { status: "ready", since: null, by: null }, room2: { status: "ready", since: null, by: null } },

    // Opening / closing checklist (resets daily).
    checklist: {
      date: null,
      open:  [{ t: "Unlock front door", done: false }, { t: "Signs on / Open", done: false }, { t: "Run Open scene (lights, music, temp)", done: false }, { t: "Autoclave ready", done: false }, { t: "Disarm alarm", done: false }],
      close: [{ t: "Last client out", done: false }, { t: "Autoclave final load logged", done: false }, { t: "Lock all doors", done: false }, { t: "Signs off / Closed", done: false }, { t: "Arm cameras / Away", done: false }],
    },

    // Aromatherapy diffusers + reception welcome display.
    scents: ["Lavender", "Eucalyptus", "Citrus", "Vanilla", "Unscented"],
    diffusers: [
      { id: "dif_reception", name: "Reception",       on: false, scent: "Lavender",   intensity: 40 },
      { id: "dif_nailtech",  name: "Nail-Tech Area",   on: false, scent: "Eucalyptus", intensity: 40 },
      { id: "dif_treatment", name: "Treatment Rooms",  on: false, scent: "Lavender",   intensity: 35 },
    ],
    display: { on: true, message: "Welcome to Lumi Nails & Med Spa" },

    // Equipment / appliance uptime monitoring.
    equipment: [
      { id: "hub",        name: "Smart Hub",          type: "hub",       online: true, uptimePct: 99.98 },
      { id: "internet",   name: "Internet / Wi-Fi",   type: "network",   online: true, uptimePct: 99.9 },
      { id: "ups",        name: "UPS Battery Backup", type: "power",      online: true, uptimePct: 100 },
      { id: "nvr",        name: "Camera NVR",         type: "camera",     online: true, uptimePct: 99.95 },
      { id: "hvac",       name: "HVAC / Thermostats", type: "climate",    online: true, uptimePct: 99.8 },
      { id: "audio",      name: "Sonos Audio",        type: "audio",      online: true, uptimePct: 99.7 },
      { id: "lock_front", name: "Front Door Lock",    type: "lock",       online: true, uptimePct: 99.99 },
      { id: "lock_back",  name: "Back Door Lock",     type: "lock",       online: true, uptimePct: 99.99 },
      { id: "autoclave",  name: "Autoclave",          type: "appliance",  online: true, uptimePct: 99.5 },
    ],

    // Autoclave sterilization compliance log.
    sterilization: [],

    // Exterior signage — outdoor lit sign, Open/Closed sign, promo board.
    signage: [
      { id: "exterior",   name: "Exterior Sign",     on: true,  brightness: 100, mode: null },
      { id: "openclosed", name: "Open / Closed Sign", on: true,  brightness: 100, mode: "Open",            modes: ["Open", "Closed"] },
      { id: "promo",      name: "Promo Board",        on: false, brightness: 80,  mode: "Walk-ins Welcome", modes: ["Walk-ins Welcome", "Now Open", "Gift Cards Available", "Closed for Event"] },
    ],
  },

  // --- Factory default scenes (fully editable in Admin) ---
  // Each scene is a list of device actions. target "all" fans out to
  // every zone/door/camera. This makes scenes data-driven, so staff can
  // edit them without touching code.
  DEFAULT_SCENES: {
    open: {
      name: "Open", emoji: "☀️", cls: "open",
      desc: "Unlock front, warm lights, calm music, comfy temp",
      actions: [
        { device: "door",     target: "front", op: "unlock" },
        { device: "light",    target: "all",   on: true, dim: 80 },
        { device: "light",    target: "room1", on: true, dim: 40 },
        { device: "light",    target: "room2", on: true, dim: 40 },
        { device: "shade",    target: "all",   level: 100 },
        { device: "temp",     target: "all",   value: 72 },
        { device: "music",    target: "all",   playlist: "Calm Spa", vol: 22 },
        { device: "music",    target: "break", playlist: "off", vol: 0 },
        { device: "camera",   target: "all",   alert: false, nightMode: false },
        { device: "security", mode: "disarmed" },
        { device: "sign",     target: "exterior",   on: true },
        { device: "sign",     target: "openclosed", on: true, mode: "Open" },
      ],
    },
    treat: {
      name: "Treatment Mode", emoji: "🌸", cls: "treat",
      desc: "Dim a room, spa playlist, cozy & quiet (defaults to Room 1)",
      perRoom: true,            // voice/UI can target a specific room
      defaultRoom: "room1",
      actions: [
        { device: "light", target: "{room}", on: true, dim: 35 },
        { device: "cct",   target: "{room}", value: 2700 },
        { device: "music", target: "{room}", playlist: "Calm Spa", vol: 28 },
        { device: "temp",  target: "{room}", value: 74 },
      ],
    },
    goodnight: {
      name: "Goodnight", emoji: "🌛", cls: "close",
      desc: "Gentle wind-down — soft lights, shades down, locked, armed Home",
      actions: [
        { device: "door",     target: "all", op: "lock" },
        { device: "light",    target: "all", on: true, dim: 15 },
        { device: "shade",    target: "all", level: 0 },
        { device: "music",    target: "all", playlist: "off", vol: 0 },
        { device: "temp",     target: "all", value: 68 },
        { device: "camera",   target: "all", alert: false, nightMode: true },
        { device: "security", mode: "home" },
      ],
    },
    close: {
      name: "Close", emoji: "🌙", cls: "close",
      desc: "Lock up, lights off, music off, energy-save temp, night cameras",
      actions: [
        { device: "door",     target: "all", op: "lock" },
        { device: "light",    target: "all", on: false },
        { device: "shade",    target: "all", level: 0 },
        { device: "music",    target: "all", playlist: "off", vol: 0 },
        { device: "temp",     target: "all", value: 66 },
        { device: "camera",   target: "all", alert: true, nightMode: true },
        { device: "security", mode: "away" },
        { device: "sign",     target: "openclosed", on: true, mode: "Closed" },
        { device: "sign",     target: "exterior",   on: false },
      ],
    },
    away: {
      name: "Away / Alarm", emoji: "🛡️", cls: "away",
      desc: "Everything off & locked, security armed, alerts to owner",
      actions: [
        { device: "door",     target: "all", op: "lock" },
        { device: "light",    target: "all", on: false },
        { device: "shade",    target: "all", level: 0 },
        { device: "music",    target: "all", playlist: "off", vol: 0 },
        { device: "temp",     target: "all", value: 64 },
        { device: "camera",   target: "all", alert: true, nightMode: true },
        { device: "security", mode: "away" },
      ],
    },
  },

  // --- Factory default schedules & triggers (editable in Admin) ---
  DEFAULT_SCHEDULES: [
    { id: "sch_open",  time: "09:00", scene: "open",  enabled: true, days: [1,2,3,4,5,6], label: "Open the spa",   location: "main" },
    { id: "sch_close", time: "19:00", scene: "close", enabled: true, days: [1,2,3,4,5,6], label: "Close & lock up", location: "main" },
  ],
  DEFAULT_TRIGGERS: [
    { id: "trg_motion", type: "after_hours_motion", scene: "away", enabled: true,
      label: "Motion after hours → arm Away & alert Owner" },
  ],
};
