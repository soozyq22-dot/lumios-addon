/* ============================================================
   auth.js — users, sign-in, PINs, sessions, owner 2FA
   ------------------------------------------------------------
   Zero external deps: passwords/PINs are hashed with Node's
   built-in scrypt (salted). Sessions are random tokens held in
   memory and expire after inactivity. The owner second factor
   is a one-time 6-digit code "delivered" to the server console
   (swap deliver2FA() for real SMS/email in production).
   ============================================================ */
const crypto = require("crypto");
const store = require("./store");
const CONFIG = require("../config");
const audit = require("./audit");

/* ---------- password hashing (scrypt) ---------- */
function hash(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = crypto.scryptSync(String(secret), salt, 32).toString("hex");
  return `${salt}:${dk}`;
}
function verify(secret, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, dk] = stored.split(":");
  const test = crypto.scryptSync(String(secret), salt, 32).toString("hex");
  const a = Buffer.from(dk, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- user store (seeded on first boot) ---------- */
function seedUsers() {
  return CONFIG.DEFAULT_USERS.map((u) => ({
    username: u.username,
    name: u.name,
    role: u.role,
    zones: u.zones || [],
    locations: u.locations || [],   // [] = all (owner/manager) or main (staff/guest), see permissions
    passwordHash: hash(u.password),
    pinHash: hash(u.pin),
    createdTs: new Date().toISOString(),
  }));
}
let USERS = store.read("users", seedUsers());
function persistUsers() { store.write("users", USERS); }

function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, zones: u.zones || [], locations: u.locations || [] };
}
function listUsers() { return USERS.map(publicUser); }
function findUser(username) { return USERS.find((u) => u.username === username); }

function addUser({ username, name, role, password, pin, zones }) {
  if (findUser(username)) throw new Error("Username already exists");
  if (!/^[a-z0-9_.-]{2,24}$/i.test(username)) throw new Error("Invalid username");
  if (!["owner", "manager", "staff", "guest"].includes(role)) throw new Error("Invalid role");
  const u = {
    username, name: name || username, role, zones: zones || [], locations: arguments[0].locations || [],
    passwordHash: hash(password || "change-me"),
    pinHash: hash(pin || "0000"),
    createdTs: new Date().toISOString(),
  };
  USERS.push(u);
  persistUsers();
  return publicUser(u);
}
function updateUser(username, patch) {
  const u = findUser(username);
  if (!u) throw new Error("No such user");
  if (patch.name != null) u.name = patch.name;
  if (patch.role != null) u.role = patch.role;
  if (patch.zones != null) u.zones = patch.zones;
  if (patch.locations != null) u.locations = patch.locations;
  if (patch.password) u.passwordHash = hash(patch.password);
  if (patch.pin) u.pinHash = hash(patch.pin);
  persistUsers();
  return publicUser(u);
}
function removeUser(username) {
  const before = USERS.length;
  USERS = USERS.filter((u) => u.username !== username);
  if (USERS.length === before) throw new Error("No such user");
  persistUsers();
}

/* ---------- sessions ---------- */
const SESSIONS = new Map();          // token -> { username, role, last }
const PENDING_2FA = new Map();       // challengeId -> { username, code, exp }

function newToken() { return crypto.randomBytes(24).toString("hex"); }

function startSession(user) {
  const token = newToken();
  SESSIONS.set(token, { username: user.username, role: user.role, last: Date.now() });
  return token;
}

function sessionUser(token) {
  const s = SESSIONS.get(token);
  if (!s) return null;
  const idleMs = Date.now() - s.last;
  if (idleMs > CONFIG.SESSION_TIMEOUT_MIN * 60 * 1000) {
    SESSIONS.delete(token);
    return null;
  }
  s.last = Date.now();                // sliding expiry
  const u = findUser(s.username);
  return u ? publicUser(u) : null;
}
function endSession(token) { SESSIONS.delete(token); }

/* ---------- 2FA delivery ---------- */
// If LUMIOS_2FA_WEBHOOK is set, POST the code there (wire it to your SMS/email
// service — Twilio/Zapier/etc.). Otherwise fall back to the console (demo only).
function deliver2FA(user, code) {
  const url = process.env.LUMIOS_2FA_WEBHOOK;
  if (url) {
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, name: user.name, code }) })
      .catch((e) => console.error("[2FA] webhook delivery failed:", e.message));
    return;
  }
  console.log("\n──────────────────────────────────────────────");
  console.log(`  🔐 LumiOS 2FA code for ${user.username}: ${code}`);
  console.log("  (Set LUMIOS_2FA_WEBHOOK to text/email this to the owner)");
  console.log("──────────────────────────────────────────────\n");
}

/* ---------- brute-force protection ----------
   Password: per-ACCOUNT lockout (no IP — works behind Tailscale/proxies).
   PIN: a global sliding-window rate limit that auto-heals, so a fumbled PIN on
   the shared front-desk tablet can't lock everyone out (and can't be evaded by
   spoofing X-Forwarded-For, since it doesn't use IP at all). */
const ACCT_FAILS = new Map();           // username -> { count, until }
function acctGuard(username) {
  const f = ACCT_FAILS.get(username);
  if (f && f.until && Date.now() < f.until) {
    const mins = Math.max(1, Math.ceil((f.until - Date.now()) / 60000));
    throw new Error(`Account locked ~${mins} min — too many attempts`);
  }
}
function acctFail(username) {
  const f = ACCT_FAILS.get(username) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= CONFIG.LOGIN_LOCKOUT.max) { f.until = Date.now() + CONFIG.LOGIN_LOCKOUT.windowSec * 1000; f.count = 0; }
  ACCT_FAILS.set(username, f);
}
function acctOk(username) { ACCT_FAILS.delete(username); }

let PIN_FAILS = [];                      // recent failed-PIN timestamps (global)
function pinGuard() {
  const now = Date.now();
  PIN_FAILS = PIN_FAILS.filter((t) => now - t < CONFIG.PIN_THROTTLE.windowSec * 1000);
  if (PIN_FAILS.length >= CONFIG.PIN_THROTTLE.max) throw new Error("Too many PIN attempts — wait a moment, then try again");
}
function pinFail() { PIN_FAILS.push(Date.now()); }
function pinOk() { PIN_FAILS = []; }

function issue2FA(u) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const challengeId = newToken();
  PENDING_2FA.set(challengeId, { username: u.username, code, exp: Date.now() + 5 * 60 * 1000 });
  deliver2FA(u, code);
  // In demo/mock mode there's no SMS/email wired, so surface the code to the UI.
  // In real mode it is NEVER returned — it goes out-of-band to the owner's phone.
  return { challengeId, demoCode: CONFIG.DRIVER === "mock" ? code : undefined };
}

/* ---------- sign-in flows ---------- */
// password login → owner also needs a 2nd factor
function loginPassword(username, password, ip) {
  acctGuard(username);
  const u = findUser(username);
  if (!u || !verify(password, u.passwordHash)) {
    acctFail(username);
    audit.record({ msg: `Failed sign-in for "${username}"`, who: ip || "unknown", category: "security" });
    throw new Error("Invalid username or password");
  }
  acctOk(username);
  if (u.role === "owner" && CONFIG.REQUIRE_OWNER_2FA) {
    const { challengeId, demoCode } = issue2FA(u);
    audit.record({ msg: `Owner "${username}" passed password, 2FA sent`, who: username, role: "owner", category: "security" });
    return { need2FA: true, challengeId, demoCode };
  }
  const token = startSession(u);
  audit.record({ msg: `${u.name} signed in (${u.role})`, who: username, role: u.role, category: "security" });
  return { token, user: publicUser(u) };
}

function verify2FA(challengeId, code, ip) {
  const ch = PENDING_2FA.get(challengeId);
  if (!ch || Date.now() > ch.exp) { PENDING_2FA.delete(challengeId); throw new Error("Code expired — sign in again"); }
  acctGuard(ch.username);
  if (String(code) !== ch.code) { acctFail(ch.username); throw new Error("Incorrect code"); }
  PENDING_2FA.delete(challengeId);
  acctOk(ch.username);
  const u = findUser(ch.username);
  const token = startSession(u);
  audit.record({ msg: `Owner "${u.username}" completed 2FA`, who: u.username, role: "owner", category: "security" });
  return { token, user: publicUser(u) };
}

// PIN login for the wall tablet. Owner PINs STILL require the 2nd factor (no bypass).
function loginPin(pin, ip) {
  pinGuard();
  const u = USERS.find((x) => verify(pin, x.pinHash));
  if (!u) {
    pinFail();
    audit.record({ msg: `Failed PIN at front desk`, who: ip || "tablet", category: "security" });
    throw new Error("PIN not recognized");
  }
  pinOk();
  if (u.role === "owner" && CONFIG.REQUIRE_OWNER_2FA) {
    const { challengeId, demoCode } = issue2FA(u);
    audit.record({ msg: `Owner "${u.username}" PIN accepted, 2FA sent`, who: u.username, role: "owner", category: "security" });
    return { need2FA: true, challengeId, demoCode };
  }
  const token = startSession(u);
  audit.record({ msg: `${u.name} signed in via PIN (${u.role})`, who: u.username, role: u.role, category: "security" });
  return { token, user: publicUser(u) };
}

/* ---------- rate limiting (door controls) ---------- */
const HITS = new Map();              // key -> [timestamps]
function rateOk(key, max, windowSec) {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < windowSec * 1000);
  if (arr.length >= max) { HITS.set(key, arr); return false; }
  arr.push(now);
  HITS.set(key, arr);
  return true;
}

module.exports = {
  listUsers, addUser, updateUser, removeUser, findUser, publicUser,
  loginPassword, verify2FA, loginPin, sessionUser, endSession,
  rateOk,
};
