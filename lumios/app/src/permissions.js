/* ============================================================
   permissions.js — role-based access control
   ------------------------------------------------------------
   owner   : full control, manage users, cameras, scenes, schedules
   manager : daily control + scenes, no user management
   staff   : control assigned zone(s), run Open/Close, no cameras
   ============================================================ */

const ROLES = {
  owner: {
    label: "Owner / Admin",
    cameras: true,
    doors: "all",            // lock/unlock any door
    scenes: "all",           // run any scene
    manageUsers: true,
    editScenes: true,
    editSchedules: true,
    security: true,
    allZones: true,
  },
  manager: {
    label: "Manager",
    cameras: true,
    doors: "all",
    scenes: "all",
    manageUsers: false,
    editScenes: true,
    editSchedules: true,
    security: false,
    allZones: true,
  },
  staff: {
    label: "Staff",
    cameras: false,
    doors: "openclose",      // may run Open/Close, not free door control
    scenes: ["open", "close"],
    manageUsers: false,
    editScenes: false,
    editSchedules: false,
    security: false,
    allZones: false,         // only their assigned zones
  },
  guest: {
    label: "Guest / Limited",
    cameras: false,
    doors: "none",           // no door control at all
    scenes: [],              // can't run scenes
    manageUsers: false,
    editScenes: false,
    editSchedules: false,
    security: false,
    allZones: false,         // only their assigned zone(s): lights/shades/music/temp
  },
};

function perms(role) {
  return ROLES[role] || ROLES.staff;
}

// Can this user touch this zone directly?
function canZone(user, zoneId) {
  const p = perms(user.role);
  if (p.allZones) return true;
  return Array.isArray(user.zones) && user.zones.includes(zoneId);
}

// Can this user run this scene?
function canScene(user, sceneKey) {
  const p = perms(user.role);
  if (p.scenes === "all") return true;
  return Array.isArray(p.scenes) && p.scenes.includes(sceneKey);
}

// Can this user directly control doors (free lock/unlock)?
function canDoors(user) {
  return perms(user.role).doors === "all";
}

// Which locations can this user access? Owner/manager → all; staff/guest → their list (default main).
function canLocation(user, locId) {
  if (user.role === "owner" || user.role === "manager") return true;
  const locs = (user.locations && user.locations.length) ? user.locations : ["main"];
  return locs.includes(locId);
}
function userLocations(user, allIds) {
  if (user.role === "owner" || user.role === "manager") return allIds;
  const locs = (user.locations && user.locations.length) ? user.locations : ["main"];
  return allIds.filter((id) => locs.includes(id));
}

module.exports = { ROLES, perms, canZone, canScene, canDoors, canLocation, userLocations };
