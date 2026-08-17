const { load, save, nextId } = require("./db");

// Strip sensitive/internal fields before sending a user object to clients.
// Also attaches a live-computed `age` from date of birth, if set.
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  // Strip any one-time availability block whose date has already passed —
  // applied here so it's guaranteed clean everywhere a user object goes
  // out (Profile, Find Players, Friends, bio modal, etc.), not just on save.
  // Uses *this user's own* timezone, not the server's, so someone west of
  // UTC doesn't have "today" silently roll over to tomorrow mid-evening.
  const today = todayISO(user.timezone);
  const availability = (rest.availability || []).filter(
    (a) => a.recurring !== false || !a.date || a.date >= today
  );
  return { ...rest, availability, age: calcAge(user.dob) };
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

// Turns real GPS coordinates (from the browser's Geolocation API, with the
// user's permission) into a ZIP code + city/state — this is what backs the
// "Use my current location" button on Profile. Far more accurate than
// IP-based lookup, especially on phones where carrier IPs often resolve to
// the wrong city entirely.
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`;
    const res = await fetch(url, { headers: OSM_HEADERS });
    if (!res.ok) {
      console.warn(`reverseGeocode: request failed (${res.status}) for ${lat},${lng}`);
      return null;
    }
    const json = await res.json();
    const addr = json.address || {};
    return {
      zip: addr.postcode || "",
      location: [addr.city || addr.town || addr.village, addr.state].filter(Boolean).join(", "),
    };
  } catch (e) {
    console.warn("reverseGeocode failed:", e.message);
    return null;
  }
}

// Optional SMS notifications via Twilio. Only active if TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are set as environment
// variables — without them this quietly does nothing, so the app works
// fully without ever setting up Twilio. See DEPLOY.md for setup.
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;
const SMS_ENABLED = !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);

// The public URL to link back to from a text message — set APP_URL in
// your environment to your real domain (or Render URL) once you have one.
// Falls back to localhost for local dev, which won't be clickable from a
// real phone but keeps things from crashing if it's unset.
function appUrl() {
  return (process.env.APP_URL || "http://localhost:4000").replace(/\/$/, "");
}

// Appends a tappable link back to the site to an SMS body, so someone who
// gets a text about a hit request can go straight to the app to respond.
function withAppLink(message) {
  return `${message} Open Hit Sync: ${appUrl()}`;
}

// Sends a text to `toPhone` (any reasonable US format — digits get
// normalized). Fire-and-forget from the caller's perspective: never throws,
// just logs. `toPhone` may be empty/undefined (no phone on file) — that's
// a normal no-op, not an error.
async function sendSMS(toPhone, body) {
  if (!SMS_ENABLED) return; // Twilio not configured — silently skip
  if (!toPhone) return; // this user hasn't added a phone number

  const digits = String(toPhone).replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+") ? digits : `+1${digits.replace(/^1/, "")}`;
  if (normalized.replace("+1", "").length !== 10) {
    console.warn(`sendSMS: "${toPhone}" doesn't look like a valid 10-digit US number, skipping.`);
    return;
  }

  try {
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: normalized, From: TWILIO_FROM, Body: body }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`sendSMS: Twilio returned ${res.status} for ${normalized}:`, text);
      return;
    }
    console.log(`sendSMS: sent to ${normalized}`);
  } catch (e) {
    console.error("sendSMS: request failed:", e.message);
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

// Computes today's date as YYYY-MM-DD in a specific timezone (falls back
// to the server's own timezone if none given). This matters a lot: Render
// runs in UTC, so a server-only "today" can silently be a whole day ahead
// of a US-based user's actual today — e.g. late Sunday evening in Central
// Time is already Monday in UTC, which was causing Sunday availability to
// look "already passed" and get pruned the moment it was saved.
function todayISO(timezone) {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const get = (type) => parts.find((p) => p.type === type).value;
      return `${get("year")}-${get("month")}-${get("day")}`;
    } catch (e) {
      // Invalid/unrecognized timezone string — fall through to server default.
    }
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A one-time block whose date has already passed no longer represents real
// availability — it shouldn't match new requests or count toward overlap.
function isPastBlock(block) {
  return !isRecurring(block) && !!block.date && block.date < todayISO();
}

// Do two blocks refer to the same actual occurrence? Same day-of-week is
// always required; if BOTH are one-time (not recurring), they additionally
// have to be the exact same calendar date — a one-time Monday slot this
// week should not match a one-time Monday slot three weeks from now. A
// one-time block whose date has already passed never matches anything.
function blocksCoOccur(a, b) {
  if (isPastBlock(a) || isPastBlock(b)) return false;
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

// Age from a "YYYY-MM-DD" date of birth — computed on the fly rather than
// stored, so it's always correct without any update job.
function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

// Free, keyless IP -> approximate location lookup, used to auto-fill a
// new/returning user's location on login if they haven't set one. Best
// effort only — local dev IPs (127.0.0.1, ::1, private ranges) won't
// resolve to anything real, so this quietly does nothing in that case.
async function fetchWithTimeout(url, options = {}, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function geolocateIp(ip) {
  if (!ip) {
    console.warn("geolocateIp: no IP address provided (req.ip was empty).");
    return null;
  }
  const clean = ip.replace("::ffff:", "");
  if (
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean.startsWith("10.") ||
    clean.startsWith("192.168.") ||
    clean.startsWith("172.")
  ) {
    console.warn(`geolocateIp: "${clean}" is a private/local address, can't resolve a real location (expected in local dev).`);
    return null;
  }

  // Primary: ipapi.co (HTTPS, generous free tier).
  try {
    const res = await fetchWithTimeout(`https://ipapi.co/${clean}/json/`, {
      headers: { "User-Agent": "HitSync/1.0" },
    });
    if (res.ok) {
      const json = await res.json();
      if (!json.error && json.latitude != null && json.longitude != null) {
        return {
          lat: Number(json.latitude),
          lng: Number(json.longitude),
          zip: json.postal || "",
          location: [json.city, json.region].filter(Boolean).join(", "),
        };
      }
      console.warn(`geolocateIp: ipapi.co had no usable data for ${clean} (${json.reason || json.error || "unknown"}), trying fallback.`);
    } else {
      console.warn(`geolocateIp: ipapi.co returned ${res.status} for ${clean}, trying fallback.`);
    }
  } catch (e) {
    console.warn("geolocateIp: ipapi.co request failed, trying fallback:", e.message);
  }

  // Fallback: ip-api.com (also free/keyless, different provider so an
  // outage or rate-limit on one doesn't take out IP-based location entirely).
  try {
    const res = await fetchWithTimeout(`http://ip-api.com/json/${clean}`, {
      headers: { "User-Agent": "HitSync/1.0" },
    });
    if (!res.ok) {
      console.error(`geolocateIp: fallback ip-api.com also failed (${res.status}) for ${clean}.`);
      return null;
    }
    const json = await res.json();
    if (json.status !== "success" || json.lat == null || json.lon == null) {
      console.error(`geolocateIp: fallback ip-api.com had no usable data for ${clean}.`);
      return null;
    }
    return {
      lat: Number(json.lat),
      lng: Number(json.lon),
      zip: json.zip || "",
      location: [json.city, json.regionName].filter(Boolean).join(", "),
    };
  } catch (e) {
    console.error("geolocateIp: fallback request failed:", e.message);
    return null;
  }
}

// Quick average + count for a user's ratings — used to show stars next to
// their name on cards without every list endpoint duplicating this math.
function getRatingSummary(data, userId) {
  const ratings = (data.ratings || []).filter((r) => r.toUserId === userId);
  if (!ratings.length) return { avgRating: null, ratingCount: 0 };
  const avgRating = ratings.reduce((sum, r) => sum + r.stars, 0) / ratings.length;
  return { avgRating, ratingCount: ratings.length };
}

module.exports = {
  load,
  save,
  nextId,
  publicUser,
  haversineMiles,
  userDistance,
  geocodeZip,
  reverseGeocode,
  geolocateIp,
  calcAge,
  todayISO,
  sendSMS,
  withAppLink,
  SMS_ENABLED,
  getRatingSummary,
  backfillMissingCoordinates,
  addNotification,
  availabilityOverlaps,
  overlappingBlocks,
};
