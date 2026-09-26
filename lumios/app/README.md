# LumiOS — Smart-Building Control for Lumi Nails & Med Spa

LumiOS controls the physical environment of the spa — **doors, lights, music,
thermostats and security cameras** — from a phone/tablet app and by voice.

It ships with a **device simulator**, so the whole system runs and demos
**right now with zero hardware and zero installs** (just Node.js). When you're
ready, you swap one driver file to control real devices through an on-site hub.

---

## Quick start (60 seconds)

You need [Node.js 18+](https://nodejs.org). Then:

```bash
cd "LumiOS"
node server.js
```

Open **http://localhost:4200**.

**Sign in (demo accounts):**

| How | Owner | Manager | Staff | Guest |
|-----|-------|---------|-------|-------|
| Front-desk **PIN** | `1234` | `2345` | `3456` | `4567` |
| **Username / password** | `owner` / `lumi-owner-change-me` | `manager` / `lumi-manager-change-me` | `ana` / `lumi-staff-change-me` | — |

> **Manager / Staff / Guest sign in directly.** The **Owner** (PIN *or* password)
> also passes a **2-factor code**. In demo/mock mode the code **auto-fills** on the
> 2FA screen; in real mode it's sent out-of-band — set **`LUMIOS_2FA_WEBHOOK`** to
> your SMS/email endpoint (or set `REQUIRE_OWNER_2FA=false`) so the owner isn't stranded.
> For everyday front-desk use, sign in as **Manager**.

**Change these credentials immediately** in **⚙️ Admin → Users**.

No `npm install` needed — LumiOS uses only built-in Node modules.

---

## What you can do

- **Quick Scenes** — one tap (or one phrase): **Open**, **Treatment Mode**, **Close**, **Away/Alarm**.
- **Per-zone control** — lights on/off + dim, **motorized shades**, thermostat, music + volume,
  for the Lobby, Pedicure area, Treatment Rooms, Restroom and Back Office.
- **Whole-spa audio & shades** — group all zones to the same playlist/volume, or raise/lower
  every shade, in one tap.
- **Treatment Mode picker** — tap Treatment Mode and pick the room from a clean on-screen list.
- **Doors** — lock/unlock the front and back doors (rate-limited, audited).
- **Security panel** — unified **arm/disarm** (Disarmed / Home / Away) with live alarm state;
  motion while armed raises a real alarm and pushes an alert.
- **Energy & backup power** — live power draw per zone + total, and **UPS battery** status so
  you can see the spa stays on doors/security through an outage.
- **Cameras** — live tiles, motion alerts, night mode (owner/manager only).
- **Voice** — press 🎙️ and say *"Good morning Lumi"*, *"Lock up for the night"*,
  *"Dim treatment room 2 to 40%"*, *"Set lobby to 72"*, *"Show the back camera"*.
- **Automation** — schedules (Open 9:00, Close 19:00) and triggers
  (after-hours motion → Away + owner alert).
- **Admin** — manage users/roles/PINs; add zones and set which are Treatment rooms / have shades;
  a **visual Scene Builder** (no JSON — pick devices from dropdowns); a **weekly schedule editor**
  (per-day on/off times); and a printable **LumiOS-vs-vendor comparison sheet** (`/compare.html`).
- **Phone alerts (Web Push)** — install LumiOS to your phone's Home Screen and tap
  "Alert my phone"; alarms and power outages push to you even when the app is closed.
  (Works over HTTPS or localhost — see docs/SETUP.md.)
- **Multi-location** — run one or many spas from the same LumiOS. Each location has its own
  zones, doors, cameras, security and energy; switch with the 📍 menu in the header. Scenes are
  shared, schedules can target a location, and staff/guests can be limited to specific locations.
- **Audit log** — who locked/unlocked doors, ran scenes and signed in, with timestamps and location;
  tap 🕘 on any zone or door for its recent change history, or **export the whole log to CSV**.

Everything updates **live across every open screen** (front-desk tablet, phone,
office) over Server-Sent Events.

---

## Roles

| | Owner/Admin | Manager | Staff | Guest |
|---|---|---|---|---|
| All zones | ✅ | ✅ | assigned only | assigned only |
| Doors (free lock/unlock) | ✅ | ✅ | via Open/Close only | ❌ |
| Cameras & security | ✅ | ✅ | ❌ | ❌ |
| Run scenes | all | all | Open / Close | ❌ |
| Edit scenes & schedules | ✅ | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ | ❌ |
| Activity log + CSV export | ✅ | ✅ | ❌ | ❌ |

*Guest/Limited* is for temps or contractors — control of an assigned zone's lights/shades/music/temp only.

---

## Project layout

```
LumiOS/
├── server.js                 # HTTP API, SSE real-time, static UI, auth, RBAC
├── config.js                 # factory defaults (users, layout, scenes, schedules)
├── src/
│   ├── store.js              # JSON persistence (swap for Postgres later)
│   ├── auth.js               # sign-in, PINs, sessions, owner 2FA, rate-limit
│   ├── permissions.js        # role definitions
│   ├── audit.js              # activity & security log
│   ├── scenes.js             # data-driven scene engine
│   ├── scheduler.js          # time schedules + after-hours triggers
│   ├── bus.js                # event bus (drives real-time updates)
│   ├── voice/intentParser.js # natural-language → action
│   └── devices/
│       ├── deviceManager.js  # the device-abstraction layer (clean internal API)
│       └── drivers/
│           ├── mockDriver.js     # the simulator (default)
│           └── realDriver.js     # TEMPLATE for live hardware
├── public/                   # the app (index) + admin screen
├── data/                     # created on first run (state, users, audit…)
└── docs/
    ├── SETUP.md              # going live with real hardware
    └── HARDWARE.md           # what to buy (categories, not brands)
```

## How real hardware plugs in

LumiOS talks to devices only through `src/devices/deviceManager.js`, which calls
a **driver**. The simulator (`mockDriver.js`) is the default. To go live you wire
`realDriver.js` to your on-site hub and set `LUMIOS_DRIVER=real`. The app, voice,
scenes and UI don't change. See **[docs/SETUP.md](docs/SETUP.md)** and the
shopping list in **[docs/HARDWARE.md](docs/HARDWARE.md)**.

## Configuration (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4200` | web port |
| `LUMIOS_DRIVER` | `mock` | `mock` or `real` |
| `LUMIOS_HUB_URL` | `http://homeassistant.local:8123` | your hub (real driver) |
| `LUMIOS_HUB_TOKEN` | — | hub API token (real driver) |
| `LUMIOS_PUSH_SUBJECT` | `mailto:info@luminailsandmedspa.com` | contact for Web Push (VAPID) |
| `LUMIOS_2FA_WEBHOOK` | — | URL the owner's 2FA code is POSTed to (wire to SMS/email) |
| `LUMIOS_HUB_URL` / `LUMIOS_HUB_TOKEN` | — | Home Assistant address + token (real driver + state-sync) |

## Reset the demo

Stop the server and delete the `data/` folder — it re-seeds from `config.js` on
the next start.

---

*Built for Lumi Nails & Med Spa. The simulator lets you evaluate the whole system —
and any installer's proposal — before buying a single device.*
