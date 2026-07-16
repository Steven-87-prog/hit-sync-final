const { load, save, nextId } = require("./db");

// Strip sensitive/internal fields before sending a user object to clients.
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

// Real distance between two lat/lng points, in miles (Haversine formula).
function haversineMiles(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined || Number.isNaN(v))) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Distance between two users, using their stored lat/lng (set via
// geocodeZip when they save their ZIP on Profile). Falls back to null if
// either user hasn't been geocoded yet (e.g. never set a ZIP).
function userDistance(userA, userB) {
  return haversineMiles(userA.lat, userA.lng, userB.lat, userB.lng);
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSM_HEADERS = { "User-Agent": "HitSync/1.0 (contact: local-dev@example.com)" };

// Look up real coordinates for a US ZIP code — free, no API key.
// Primary: Zippopotam.us, which is purpose-built for exactly this
// (postal code -> lat/lng) and much more reliable for it than a
// general-purpose geocoder. Falls back to Nominatim if that fails.
// Called when a user saves/changes their ZIP on Profile (or during the
// startup backfill), so distance uses actual geography instead of
// guessing from the ZIP code's digits.
async function geocodeZip(rawZip) {
  const match = String(rawZip || "").match(/\d{5}/);
  if (!match) return null;
  const zip = match[0];

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { headers: OSM_HEADERS });
    if (res.ok) {
      const json = await res.json();
      const place = json.places && json.places[0];
      if (place) {
        return { lat: Number(place.latitude), lng: Number(place.longitude) };
      }
      console.warn(`geocodeZip: Zippopotam had no results for ${zip}, trying fallback.`);
    } else {
      console.warn(`geocodeZip: Zippopotam returned ${res.status} for ${zip}, trying fallback.`);
    }
  } catch (e) {
    console.warn("geocodeZip: Zippopotam request failed, trying fallback:", e.message);
  }

  try {
    const url = `${NOMINATIM_URL}?postalcode=${zip}&country=us&format=json&limit=1`;
    const res = await fetch(url, { headers: OSM_HEADERS });
    if (!res.ok) {
      console.error(`geocodeZip: Nominatim fallback also failed (${res.status}) for ${zip}.`);
      return null;
    }
    const json = await res.json();
    if (!json.length) {
      console.error(`geocodeZip: Nominatim fallback had no results for ${zip}.`);
      return null;
    }
    return { lat: Number(json[0].lat), lng: Number(json[0].lon) };
  } catch (e) {
    console.error("geocodeZip: Nominatim fallback request failed:", e.message);
    return null;
  }
}

function addNotification(data, userId, type, message, relatedId = null) {
  const notif = {
    id: nextId(data, "notifications"),
    userId,
    type, // friend_request | hit_request | hit_accepted | hit_declined | hit_cancelled | group_invite | message
    message,
    relatedId,
    read: false,
    createdAt: new Date().toISOString(),
  };
  data.notifications.push(notif);
  return notif;
}

// Availability blocks now come in two flavors:
//  - Recurring:  { day: "Tue", start, end, recurring: true }  — applies every week
//  - One-time:   { day: "Tue", start, end, recurring: false, date: "2026-07-21" }
//    — applies only to that specific calendar date
// Older data saved before this distinction existed has no `recurring` field
// at all — treated as recurring (true), which preserves its original
// always-on behavior rather than silently dropping it.
function isRecurring(block) {
  return block.recurring !== false;
}

// Do two blocks refer to the same actual occurrence? Same day-of-week is
// always required; if BOTH are one-time (not recurring), they additionally
// have to be the exact same calendar date — a one-time Monday slot this
// week should not match a one-time Monday slot three weeks from now.
function blocksCoOccur(a, b) {
  if (a.day !== b.day) return false;
  if (!isRecurring(a) && !isRecurring(b)) {
    return !!a.date && !!b.date && a.date === b.date;
  }
  return true;
}

// Do two weekly availability schedules overlap at all?
function availabilityOverlaps(availA = [], availB = []) {
  for (const a of availA) {
    for (const b of availB) {
      if (!blocksCoOccur(a, b)) continue;
      if (a.start < b.end && b.start < a.end) return true;
    }
  }
  return false;
}

// Returns the actual overlapping time ranges between two schedules, e.g.
// [{ day: "Tue", start: "17:00", end: "18:00", date: "2026-07-21" }] — used
// to show "here's when you're both free" under a player card. Includes a
// specific date when the overlap comes from a one-time block, so the
// frontend can show exactly which day it applies to rather than implying
// it's a standing weekly thing.
function overlappingBlocks(availA = [], availB = []) {
  const blocks = [];
  for (const a of availA) {
    for (const b of availB) {
      if (!blocksCoOccur(a, b)) continue;
      const start = a.start > b.start ? a.start : b.start;
      const end = a.end < b.end ? a.end : b.end;
      if (start < end) {
        const date = (!isRecurring(a) && a.date) || (!isRecurring(b) && b.date) || null;
        blocks.push({ day: a.day, start, end, date });
      }
    }
  }
  return blocks;
}

// Fills in coordinates for any existing users who have a ZIP but never got
// geocoded (e.g. accounts created before this feature existed). Meant to be
// run once in the background at server startup — NOT awaited before the
// server starts listening, since it may take a while (Nominatim is rate
// limited to roughly 1 request/second, so this deliberately paces itself).
async function backfillMissingCoordinates() {
  const data = load();
  const missing = data.users.filter((u) => u.zip && (u.lat === undefined || u.lat === null));
  if (!missing.length) return;

  console.log(`Hit Sync: backfilling coordinates for ${missing.length} user(s) missing distance data...`);
  for (const user of missing) {
    const coords = await geocodeZip(user.zip);
    if (coords) {
      user.lat = coords.lat;
      user.lng = coords.lng;
    }
    // Be polite to the free Nominatim service — max ~1 request/second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  save(data);
  console.log("Hit Sync: coordinate backfill complete.");
}

module.exports = {
  load,
  save,
  nextId,
  publicUser,
  haversineMiles,
  userDistance,
  geocodeZip,
  backfillMissingCoordinates,
  addNotification,
  availabilityOverlaps,
  overlappingBlocks,
};
