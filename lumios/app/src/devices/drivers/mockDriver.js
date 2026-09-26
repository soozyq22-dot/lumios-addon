/* ============================================================
   mockDriver.js — the simulator
   ------------------------------------------------------------
   Implements the device-driver contract with no hardware, so
   the entire system is demoable immediately. Every method just
   resolves successfully (with a tiny delay to mimic a real hub
   round-trip). deviceManager applies the result to app state.

   THE CONTRACT (every driver must implement these):
     lock(doorId)            -> Promise
     unlock(doorId)          -> Promise
     setLight(zoneId, on, dim)        -> Promise
     setShade(zoneId, level)          -> Promise   (level = % open)
     setTemp(zoneId, value)           -> Promise
     setMusic(zoneId, playlist, vol)  -> Promise
     setCamera(camId, { alert, nightMode }) -> Promise
     setSecurity(mode)       -> Promise   (disarmed|home|away)
     getCameraFeed(camId)    -> Promise<{ url, type }>
   ============================================================ */

function delay(ms = 60) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  name: "mock",

  async lock(doorId) { await delay(); return { ok: true }; },
  async unlock(doorId) { await delay(); return { ok: true }; },

  async setLight(zoneId, on, dim) { await delay(); return { ok: true }; },
  async setShade(zoneId, level) { await delay(); return { ok: true }; },
  async setCct(zoneId, kelvin) { await delay(); return { ok: true }; },
  async setColor(zoneId, hex) { await delay(); return { ok: true }; },
  async setTemp(zoneId, value) { await delay(); return { ok: true }; },
  async setMusic(zoneId, playlist, vol) { await delay(); return { ok: true }; },
  async setCamera(camId, opts) { await delay(); return { ok: true }; },
  async setSecurity(mode) { await delay(); return { ok: true }; },
  async setSign(id, sign) { await delay(); return { ok: true }; },
  async setSiren(on) { await delay(); return { ok: true }; },

  // In the simulator we hand back a placeholder "feed" the UI renders
  // as an animated tile. A real driver returns an RTSP/HLS URL.
  async getCameraFeed(camId) {
    await delay();
    return { type: "simulated", url: null, camId };
  },
};
