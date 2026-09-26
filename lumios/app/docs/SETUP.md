# Going live with real hardware

LumiOS runs on a **simulator** out of the box. This guide turns it into a system
that controls real doors, lights, music, thermostats and cameras. The golden rule:
**nothing in the app changes** — you only wire one driver file.

## The architecture (local-first)

```
  Phones / tablets ─┐
  Voice ────────────┤
                    ▼
              ┌───────────┐      LAN       ┌──────────────┐   Zigbee/Z-Wave/Matter
              │  LumiOS   │ ─────────────▶ │  On-site hub │ ─────────────────────▶ locks,
              │  server   │                │ (Home Asst / │                        lights,
              └───────────┘                │  Hubitat /   │ ──▶ Sonos (music)      thermostats
                    │                      │  SmartThings)│ ──▶ ONVIF/RTSP (cameras)
              cloud sync (optional)        └──────────────┘
              for remote access + alerts
```

**Why local-first:** the hub and LumiOS live on-site, so doors and lights keep
working even if the internet drops. Cloud is only for remote access and push alerts.

## Steps

1. **Install an on-site hub.** Recommended: [Home Assistant](https://www.home-assistant.io/)
   on a small always-on box (e.g. Home Assistant Green / a mini PC). It speaks
   Matter, Zigbee and Z-Wave and exposes a clean local REST API.

2. **Pair your devices** to the hub (locks, dimmers/bulbs, thermostats, Sonos,
   cameras). Note each device's **entity id** (e.g. `lock.front_entrance`).

3. **Create a hub API token** (Home Assistant: Profile → Long-Lived Access Token).

4. **Wire the driver.** Open `src/devices/drivers/realDriver.js`:
   - paste your entity ids into the `MAP` object,
   - uncomment the `hub(...)` call in each method (they're written for Home
     Assistant's service API; adjust if you use a different hub),
   - delete the `NOT_WIRED(...)` guard lines as you finish each one.

5. **Point LumiOS at the hub and switch drivers:**
   ```bash
   LUMIOS_DRIVER=real \
   LUMIOS_HUB_URL=http://homeassistant.local:8123 \
   LUMIOS_HUB_TOKEN=eyJ...your-token... \
   node server.js
   ```

6. **Test one device first** (e.g. a single light) before wiring doors.

## Cameras

Set each camera's RTSP/ONVIF URL in `MAP.cams`. For live view in a browser you'll
typically run a small RTSP→HLS/WebRTC relay (the hub can do this, or use
`go2rtc`/MediaMTX). `getCameraFeed()` should return that playable URL.

## Security checklist (this controls physical doors — take it seriously)

- [ ] **Change all demo passwords and PINs** (Admin → Users) before go-live.
- [ ] Serve LumiOS over **HTTPS** (run it behind a reverse proxy such as Caddy or
      Nginx with a TLS cert; for remote access use a VPN or an authenticated tunnel).
- [ ] Keep **owner 2FA on** (`REQUIRE_OWNER_2FA`) and swap `deliver2FA()` in
      `src/auth.js` for a real SMS/email provider.
- [ ] Door lock/unlock is **rate-limited and fully audited** — review the log.
- [ ] **Fail-safe:** decide lock behavior on power/network loss with your
      installer, and **always keep a physical key override**. Smart locks should
      fail to a known safe state, never leave the salon unsecured or staff trapped.
- [ ] Never expose camera feeds or lock controls without a valid session.

## Where LumiOS runs

Run LumiOS on its **own small always-on device** (a mini-PC or Raspberry Pi) on the same LAN as the
hub — not on the hub appliance itself (Home Assistant OS doesn't easily host arbitrary Node apps).
Keep the device on, apply OS/Node updates, and **back up the `data/` folder** (users, PINs, scenes,
and `vapid.json`) — losing it means reconfiguring from scratch.

## Remote access (Tailscale / Cloudflare) — the HTTPS facts

Inside the salon on Wi-Fi, LumiOS works over plain `http://host:4200` for **control**. But **installing
the app and receiving push alerts require a real `https://` secure context** — a plain IP over `http`
(including a Tailscale `100.x` IP) will NOT enable install/push. So set up an HTTPS address and use it
everywhere (even the front-desk tablet):

- **Tailscale (recommended, free, no domain):** install on the host + each phone; run
  `tailscale serve https / http://localhost:4200` to get `https://lumios.<tailnet>.ts.net`. Private —
  nothing is exposed publicly. A phone needs the Tailscale app connected to *open* LumiOS remotely.
- **Cloudflare Tunnel (uses your existing domain):** point e.g. `lumios.luminailsandmedspa.com` at
  `http://localhost:4200`; keep it behind Cloudflare Access **and** LumiOS sign-in.

Never port-forward LumiOS or expose it on a plain public URL — it unlocks doors.

## Phone alerts (Web Push)

LumiOS sends alarms/outages to staff phones with no third-party service.

- It auto-generates a **VAPID key pair** on first boot (`data/vapid.json`) — keep/back up this file.
- Requires the **HTTPS** secure context above (or `http://localhost` for testing).
- **The LumiOS host needs outbound internet to send a push** (it posts to Apple/Google push services).
  Local control still works fully offline, but alerts won't go out during an internet outage.
- iPhone/iPad: requires **iOS 16.4+**, and you must **Add to Home Screen** before push can be enabled.
- On the phone: open LumiOS → **Add to Home Screen** → open it → **🔔 Alert my phone** (Security Panel) → allow.
- Set `LUMIOS_PUSH_SUBJECT` to a real contact `mailto:` (push services require it).
- We send **payload-less** pushes (no sensitive text on the lock screen); tapping opens LumiOS to sign in.

## Cameras — in-app live view needs a relay

Device control (locks/lights/shades/climate/music/security) goes straight through the hub. But showing
real **camera video inside LumiOS** also needs an RTSP→WebRTC/HLS relay (e.g. `go2rtc` or Frigate on the
hub/host); `getCameraFeed()` should return that playable URL and the camera tile needs a video element
wired in. Without the relay, recording + ONVIF motion still work — you just view footage in the NVR app.

## Moving off the JSON store

`src/store.js` reads/writes JSON files. To use PostgreSQL, reimplement `read()` and
`write()` against your database — no other file touches storage.
