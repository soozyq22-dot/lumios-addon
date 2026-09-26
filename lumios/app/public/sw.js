/* LumiOS service worker — handles Web Push + lets the app install as a PWA. */
const VERSION = "lumios-v1";

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// A push wakes the worker. We send payload-less pushes, so show a generic,
// privacy-safe notification; details live behind sign-in once the app opens.
self.addEventListener("push", (e) => {
  let body = "Security or power event at the spa — tap to view.";
  try { if (e.data) { const t = e.data.text(); if (t) body = t; } } catch (_) {}
  e.waitUntil(self.registration.showNotification("🛡️ LumiOS Alert", {
    body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: "lumios-alert",
    renotify: true,
    requireInteraction: true,
    vibrate: [120, 60, 120],
  }));
});

// Tapping the notification focuses an open LumiOS tab, or opens one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
    for (const c of cls) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow("/");
  }));
});
