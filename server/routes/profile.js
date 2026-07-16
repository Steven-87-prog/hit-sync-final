const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, publicUser, geocodeZip } = require("../utils");

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

const EDITABLE_FIELDS = [
  "name",
  "gender",
  "zip",
  "location",
  "utr",
  "usta",
  "surface",
  "handedness",
  "style",
  "bio",
];

router.put("/me", requireAuth, async (req, res) => {
  try {
    const data = load();
    const user = data.users.find((u) => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const oldZip = user.zip;
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) user[field] = req.body[field];
    }

    // Re-geocode whenever the ZIP changes, or whenever it's set but this
    // account never got coordinates in the first place (e.g. it was
    // created before geocoding existed) — so distance shows up for
    // everyone the next time they touch their profile, not just people
    // who happen to edit their ZIP specifically.
    if (user.zip && (user.zip !== oldZip || user.lat == null || user.lng == null)) {
      const coords = await geocodeZip(user.zip);
      if (coords) {
        user.lat = coords.lat;
        user.lng = coords.lng;
      } else {
        user.lat = null;
        user.lng = null;
      }
    } else if (!user.zip) {
      user.lat = null;
      user.lng = null;
    }

    save(data);
    res.json({ user: publicUser(user) });
  } catch (e) {
    console.error("Profile update failed:", e);
    res.status(500).json({ error: "Something went wrong saving your profile. Please try again." });
  }
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
  res.json({ user: publicUser(user) });
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

  user.availability = availability;
  save(data);
  res.json({ user: publicUser(user) });
});

router.put("/me/tutorial-seen", requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.tutorialSeen = true;
  save(data);
  res.json({ user: publicUser(user) });
});

router.get("/:id", requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

module.exports = router;
