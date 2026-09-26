/* ============================================================
   bus.js — in-process event bus
   ------------------------------------------------------------
   Device changes, scene runs and alerts are emitted here.
   The HTTP layer subscribes and pushes them to connected apps
   over Server-Sent Events, so every screen shows true device
   state in real time.
   ============================================================ */
const { EventEmitter } = require("events");
const bus = new EventEmitter();
bus.setMaxListeners(100);
module.exports = bus;
