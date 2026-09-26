# Hardware shopping list — what to look for

LumiOS is built on **open standards** (Matter, Zigbee, Z-Wave, ONVIF) so you're
never locked into one brand, installer or pricing. Below are **device categories
and the features that matter** — buy whatever reputable model fits, as long as it
ticks the boxes. The simulator lets you confirm the whole system works *before*
you spend anything.

> Quantity guide for a salon like Lumi: ~2 smart locks, ~6 dimmable zones,
> ~3–4 thermostat zones, ~3 cameras, 1 hub, plus a wall tablet.

### 1. On-site hub / controller — **buy this first**
The brain everything connects to. Keep control on-site so doors/lights work if the
internet drops.
- ✅ Speaks **Matter + Thread**, **Zigbee**, and ideally **Z-Wave**
- ✅ **Local API** (so LumiOS talks to it over your LAN)
- ✅ Always-on, wired Ethernet, low power
- _Category examples: Home Assistant hub, Hubitat, SmartThings hub._

### 2. Smart locks (front & back doors)
- ✅ **Matter** or Z-Wave; commercial-grade if it's a main entrance
- ✅ **Physical key override** (non-negotiable) + defined **fail-safe** behavior
- ✅ Auto-lock support, battery + low-battery alerts, tamper detection
- ⚠️ For glass/commercial doors you may need an **electric strike or maglock**
  with a relay module instead of a residential deadbolt — ask your installer.

### 3. Dimmable lighting (per zone)
Two ways to go — prefer in-wall switches for a clean salon look:
- ✅ **In-wall smart dimmer switches** (Matter/Zigbee/Z-Wave) for existing fixtures, **or**
- ✅ **Dimmable smart bulbs** for lamps/accent lighting
- ✅ True **dimming** (not just on/off), neutral wire if using switches
- Plan one controllable group per zone: lobby, each treatment room, pedicure, restroom, office.

### 3b. Motorized shades / blinds (per zone)
- ✅ **Matter** or Z-Wave motorized roller shades, or a smart **shade motor/controller**
- ✅ Reports **position %** (so LumiOS can set "30% open"), not just open/close
- ✅ Battery or hardwired; quiet motors for treatment rooms
- Scenes already drive these: shades up at Open, down for Treatment Mode and Close.

### 4. Smart thermostats (per HVAC zone)
- ✅ **Matter** or a documented **local API**
- ✅ **Scheduling / setback** support (for the Close scene's energy savings)
- ✅ Matches your HVAC (check C-wire / number of zones with an HVAC tech)

### 5. Security cameras
- ✅ **ONVIF + RTSP** (open standards — avoids cloud-only lock-in)
- ✅ **PoE** (power + data over one Ethernet cable) into a small switch/NVR
- ✅ Motion detection, night vision (IR), adequate resolution (2K+)
- ✅ **Local recording** (NVR or SD) so footage isn't hostage to a subscription
- Cover: front entry, retail floor, back hallway/door.

### 6. Music / audio (per zone)
- ✅ **Sonos** (well-supported) **or** any player with a **generic/local media API**
- ✅ Independent **per-zone volume**

### 7. Front-desk tablet
- ✅ Any modern iPad/Android tablet on a **wall mount**
- ✅ Kept on the salon Wi-Fi; staff sign in with their **PIN**

### 8. Security / alarm panel (optional but recommended)
- ✅ A hub-integrated **alarm panel** with door/window contacts and motion sensors
- ✅ Exposes **arm away / arm home / disarm** to the hub (so LumiOS's Security Panel drives it)
- ✅ Audible siren + monitored or self-monitored alerts

### 9. Networking & power (don't skip)
- ✅ Reliable Wi-Fi + a small **PoE switch** for cameras
- ✅ A **UPS** (battery backup) for the hub, network gear and door controllers, so
  doors and security survive a power outage. LumiOS's Energy tile shows the UPS charge —
  pick a UPS sized to run the hub + locks for a couple of hours.

---

## What to ask any installer (e.g. before signing with a vendor)

Use LumiOS's feature set as your checklist — a good proposal should already cover:

1. **Open standards?** Matter/Zigbee/Z-Wave/ONVIF — or are you locked to their brand/app?
2. **Local-first?** Do doors and lights work if the internet is down?
3. **Door fail-safe & key override?** What happens on power/network loss?
4. **Roles & PINs?** Owner vs. manager vs. staff; per-user front-desk PINs.
5. **Scenes & schedules?** Open/Treatment/Close/Away; auto open & close times.
6. **Audit log?** Who unlocked which door, and when.
7. **Cameras:** ONVIF/RTSP + **local recording** you own (no forced cloud subscription)?
8. **Ownership:** if you switch installers later, do you keep the hub, devices and footage?

If a proposal can't answer these, those are exactly the questions to push on.
