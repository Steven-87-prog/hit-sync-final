const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, publicUser, userDistance, availabilityOverlaps, overlappingBlocks } = require("../utils");

const router = express.Router();

// GET /api/players/find?mode=players|friends&utrMin=&utrMax=&ustaMin=&ustaMax=&surface=&maxDistance=&paidOnly=true&search=
router.get("/find", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  if (!me) return res.status(404).json({ error: "User not found." });

  const mode = req.query.mode === "friends" ? "friends" : "players";
  const utrMin = req.query.utrMin ? Number(req.query.utrMin) : null;
  const utrMax = req.query.utrMax ? Number(req.query.utrMax) : null;
  const ustaMin = req.query.ustaMin ? Number(req.query.ustaMin) : null;
  const ustaMax = req.query.ustaMax ? Number(req.query.ustaMax) : null;
  const surface = req.query.surface || null;
  const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : null;
  const paidOnly = req.query.paidOnly === "true";
  const search = (req.query.search || "").trim().toLowerCase();

  let candidates = data.users.filter((u) => u.id !== me.id);

  // Find Players: only show people whose saved availability overlaps mine.
  if (mode === "players") {
    candidates = candidates.filter((u) => availabilityOverlaps(me.availability, u.availability));
  }

  if (search) candidates = candidates.filter((u) => u.name.toLowerCase().includes(search));
  if (utrMin !== null) candidates = candidates.filter((u) => u.utr === null || u.utr >= utrMin);
  if (utrMax !== null) candidates = candidates.filter((u) => u.utr === null || u.utr <= utrMax);
  if (ustaMin !== null) candidates = candidates.filter((u) => !u.usta || Number(u.usta) >= ustaMin);
  if (ustaMax !== null) candidates = candidates.filter((u) => !u.usta || Number(u.usta) <= ustaMax);
  // A player with no surface preference set ("Any surface") should show up
  // for every specific court-type search — they haven't restricted
  // themselves to one surface, so they're a match regardless of which one
  // someone is filtering for.
  if (surface) candidates = candidates.filter((u) => !u.surface || u.surface === surface);
  if (paidOnly) candidates = candidates.filter((u) => u.paidHits && u.paidHits.enabled);

  const myFriends = new Set(me.friends || []);
  let results = candidates.map((u) => {
    const distance = userDistance(me, u);
    const overlappingTimes = mode === "players" ? overlappingBlocks(me.availability, u.availability) : undefined;
    return { ...publicUser(u), distance, overlappingTimes, isFriend: myFriends.has(u.id) };
  });

  if (maxDistance !== null) {
    results = results.filter((u) => u.distance === null || u.distance <= maxDistance);
  }

  // Prioritize closer overlap / distance first.
  results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  res.json({ mode, results });
});

module.exports = router;
