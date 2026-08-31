const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, publicUser, todayISO, reverseGeocode, getRatingSummary, geocodeZip } = require("../utils");

// Attaches rating info to a user response — used everywhere this file
// returns your own profile, so state.user always has fresh star data.
function withRating(data, user) {
  const { avgRating, ratingCount } = getRatingSummary(data, user.id);
  return { ...publicUser(user), avgRating, ratingCount };
}

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: withRating(data, user) });
});

const EDITABLE_FIELDS = [
  "name",
  "gender",
  "dob",
  "phone",
  "utr",
  "usta",
  "surface",
  "handedness",
  "style",
  "bio",
  "avatarUrl",
  "timezone",
];

router.put("/me", requireAuth, async (req, res) => {
  try {
    const data = load();
    const user = data.users.find((u) => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) user[field] = req.body[field];
    }

    save(data);
    res.json({ user: withRating(data, user) });
  } catch (e) {
    console.error("Profile update failed:", e);
    res.status(500).json({ error: "Something went wrong saving your profile. Please try again." });
  }
});

// Records the person's answer to the one-time "we detected your location
// from your IP" notice. Accepting is a no-op (location was already
// resolved automatically); declining clears it so they're opting out of
// distance-based matching entirely.
router.put("/me/location-consent", requireAuth, (req, res) => {
  const { accepted } = req.body || {};
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  user.locationConsentGiven = true; // just means "they've seen and answered the notice"
  if (!accepted) {
    user.lat = null;
    user.lng = null;
    user.location = "";
    user.locationSource = null;
  }
  save(data);
  res.json({ user: withRating(data, user) });
});

// Saves real GPS coordinates from the browser's Geolocation API (only ever
// called after the person explicitly grants permission client-side) —
// significantly more accurate than IP-based location, which can resolve to
// the wrong city entirely (e.g. a carrier's regional hub, or wherever an
// account is registered rather than where the phone actually is).
router.put("/me/live-location", requireAuth, async (req, res) => {
  const { lat, lng, location } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng (numbers) are required." });
  }
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  user.lat = lat;
  user.lng = lng;
  user.locationSource = "gps";
  // Prefer a city name the browser already resolved (more reliable — not
  // subject to a shared server IP getting rate-limited). Only fall back to
  // resolving it server-side if the client didn't send one.
  if (location) {
    user.location = location;
  } else {
    const resolved = await reverseGeocode(lat, lng);
    if (resolved && resolved.location) user.location = resolved.location;
  }
  save(data);
  res.json({ user: withRating(data, user) });
});

// Fallback for anyone who declines/can't grant GPS (denied permission,
// device safety restrictions, etc.) — a zip code still gets them usable
// distance-based matching instead of nothing at all.
router.put("/me/zip-location", requireAuth, async (req, res) => {
  const { zip } = req.body || {};
  if (!zip || !String(zip).trim()) {
    return res.status(400).json({ error: "A zip code is required." });
  }
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  const resolved = await geocodeZip(zip);
  if (!resolved) {
    return res.status(400).json({ error: "Couldn't find that zip code — double check it and try again." });
  }
  user.lat = resolved.lat;
  user.lng = resolved.lng;
  const cityInfo = await reverseGeocode(resolved.lat, resolved.lng);
  user.location = (cityInfo && cityInfo.location) || user.location || "";
  user.locationSource = "zip";
  user.locationConsentGiven = true;
  save(data);
  res.json({ user: withRating(data, user) });
});

router.put("/me/paid-hits", requireAuth, (req, res) => {
  const { enabled, rate, method } = req.body || {};
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  user.paidHits = {
    enabled: !!enabled,
    rate: enabled ? Number(rate) || 0 : null,
    method: enabled ? method || "" : "",
  };
  save(data);
  res.json({ user: withRating(data, user) });
});

// availability: [{ day: "Mon"|"Tue"|..., start: "HH:MM", end: "HH:MM" }]
router.put("/me/availability", requireAuth, (req, res) => {
  const { availability } = req.body || {};
  if (!Array.isArray(availability)) {
    return res.status(400).json({ error: "availability must be an array of {day, start, end}." });
  }
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  // Drop any one-time block whose date has already passed — it's no longer
  // real availability, so there's no reason to keep storing it. Uses this
  // user's own timezone, not the server's UTC clock.
  const today = todayISO(user.timezone);
  user.availability = availability.filter((a) => a.recurring !== false || !a.date || a.date >= today);
  save(data);
  res.json({ user: withRating(data, user) });
});

// Permanently deletes the account and cleans up references to it
// elsewhere — friend lists, pending requests, group memberships, hits,
// ratings, and this account's own notifications. This is irreversible.
router.delete("/me", requireAuth, (req, res) => {
  const data = load();
  const userId = req.userId;
  const user = data.users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  data.users = data.users.filter((u) => u.id !== userId);
  data.users.forEach((u) => {
    if (u.friends) u.friends = u.friends.filter((id) => id !== userId);
  });
  data.friendRequests = data.friendRequests.filter((r) => r.fromId !== userId && r.toId !== userId);

  data.groups = data.groups
    .filter((g) => g.ownerId !== userId) // delete groups they owned
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => id !== userId) }));

  data.hits = data.hits
    .filter((h) => h.fromId !== userId) // remove hits they requested
    .map((h) => ({ ...h, toIds: h.toIds.filter((id) => id !== userId) }))
    .filter((h) => h.toIds.length > 0); // drop hits that had no one left after removing them

  data.ratings = (data.ratings || []).filter((r) => r.fromUserId !== userId && r.toUserId !== userId);
  data.notifications = data.notifications.filter((n) => n.userId !== userId);

  save(data);
  res.json({ ok: true });
});

router.put("/me/tutorial-seen", requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.tutorialSeen = true;
  save(data);
  res.json({ user: withRating(data, user) });
});

router.get("/:id", requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: withRating(data, user) });
});

module.exports = router;
