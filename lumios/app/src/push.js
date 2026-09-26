/* ============================================================
   push.js — real Web Push (VAPID), zero dependencies
   ------------------------------------------------------------
   Lets LumiOS push a notification to a staff/owner phone even
   when the app is closed — so security alarms and power outages
   reach you when you're away.

   How it works:
   - We generate a VAPID key pair once (stored in data/vapid.json).
   - The phone's browser subscribes (service worker) and we store
     that subscription.
   - On an alarm/outage we send a signed, payload-less push to each
     subscription's endpoint. The service worker (public/sw.js) wakes
     and shows a generic notification; tapping it opens LumiOS, where
     the user signs in to see details. (No sensitive text on the lock
     screen — and no fragile payload encryption needed.)

   Requires HTTPS in production (localhost is fine for testing).
   ============================================================ */
const crypto = require("crypto");
const store = require("./store");
const bus = require("./bus");

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ---------- VAPID keys (generated once, persisted) ---------- */
function loadOrCreateVapid() {
  let v = store.read("vapid", null);
  if (v && v.publicKey && v.privatePem) return v;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });           // { x, y } base64url
  const raw = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);                                                         // 65-byte uncompressed point
  v = { publicKey: b64url(raw), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) };
  store.write("vapid", v);
  return v;
}
const VAPID = loadOrCreateVapid();
const SUBJECT = process.env.LUMIOS_PUSH_SUBJECT || "mailto:info@luminailsandmedspa.com";

function publicKey() { return VAPID.publicKey; }

/* ---------- subscriptions ---------- */
let SUBS = store.read("push-subs", []);
function persist() { store.write("push-subs", SUBS); }

function addSubscription(sub, username) {
  if (!sub || !sub.endpoint) throw new Error("Invalid subscription");
  SUBS = SUBS.filter((s) => s.endpoint !== sub.endpoint);
  SUBS.push({ endpoint: sub.endpoint, keys: sub.keys || {}, username, ts: new Date().toISOString() });
  persist();
  return { ok: true, count: SUBS.length };
}
function removeSubscription(endpoint) { SUBS = SUBS.filter((s) => s.endpoint !== endpoint); persist(); }
function count() { return SUBS.length; }

/* ---------- VAPID JWT for one endpoint ---------- */
function vapidAuthHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const signingInput = `${header}.${payload}`;
  // JWS ES256 needs a raw R||S signature (ieee-p1363), not DER.
  const sig = crypto.sign("sha256", Buffer.from(signingInput), {
    key: VAPID.privatePem, dsaEncoding: "ieee-p1363",
  });
  const jwt = `${signingInput}.${b64url(sig)}`;
  return `vapid t=${jwt}, k=${VAPID.publicKey}`;
}

/* ---------- send a (payload-less) push to every subscription ---------- */
async function sendToAll() {
  if (!SUBS.length) return { sent: 0 };
  let sent = 0;
  await Promise.all(SUBS.map(async (s) => {
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { "TTL": "120", "Authorization": vapidAuthHeader(s.endpoint), "Content-Length": "0" },
      });
      if (res.status === 404 || res.status === 410) removeSubscription(s.endpoint); // gone
      else if (res.ok) sent++;
    } catch (e) { /* network error — keep the sub, try next time */ }
  }));
  return { sent };
}

// Auto-send on every alarm / outage / security push event.
bus.on("push", () => { sendToAll().catch(() => {}); });

module.exports = { publicKey, addSubscription, removeSubscription, count, sendToAll };
