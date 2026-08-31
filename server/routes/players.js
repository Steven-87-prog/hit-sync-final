const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, publicUser, userDistance, overlappingBlocks, getRatingSummary, currentAvailability } = require("../utils");

const router = express.Router();

// GET /api/players/find?utrMin=&utrMax=&ustaMin=&ustaMax=&surface=&maxDistance=&paidOnly=true&search=&sortBy=distance|utr|usta&hasRating=utr|usta&availabilityMode=overlap|set
router.get("/find", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  if (!me) return res.status(404).json({ error: "User not found." });

  const utrMin = req.query.utrMin ? Number(req.query.utrMin) : null;
  const utrMax = req.query.utrMax ? Number(req.query.utrMax) : null;
  const ustaMin = req.query.ustaMin ? Number(req.query.ustaMin) : null;
  const ustaMax = req.query.ustaMax ? Number(req.query.ustaMax) : null;
  const surface = req.query.surface || null;
  const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : null;
  const paidOnly = req.query.paidOnly === "true";
  const search = (req.query.search || "").trim().toLowerCase();
  const sortBy = ["utr", "usta", "distance"].includes(req.query.sortBy) ? req.query.sortBy : "distance";
  // Only show players who have specifically set this one rating — lets
  // someone say "just show me people with a real UTR" without also
  // requiring a min/max range.
  const hasRating = ["utr", "usta"].includes(req.query.hasRating) ? req.query.hasRating : null;
  // "overlap" = only people whose schedule overlaps mine; "set" = only
  // people who have saved any availability at all (whether or not it
  // overlaps with mine).
  const availabilityMode = ["overlap", "set"].includes(req.query.availabilityMode) ? req.query.availabilityMode : null;

  // Everyone shows up here regardless of friendship or schedule overlap —
  // overlapping availability is just extra info on the card, not a filter,
  // so you can request a hit with anyone either way, unless one of the
  // availability filters above is explicitly turned on.
  let candidates = data.users.filter((u) => u.id !== me.id);

  if (search) candidates = candidates.filter((u) => u.name.toLowerCase().includes(search));
  // Once a rating filter is actually set, only show players who have that
  // rating and fall in range — an unrated player shouldn't sneak through a
  // "minimum UTR 4" search just because they haven't entered a UTR at all.
  if (utrMin !== null) candidates = candidates.filter((u) => u.utr !== null && u.utr >= utrMin);
  if (utrMax !== null) candidates = candidates.filter((u) => u.utr !== null && u.utr <= utrMax);
  if (ustaMin !== null) candidates = candidates.filter((u) => u.usta && Number(u.usta) >= ustaMin);
  if (ustaMax !== null) candidates = candidates.filter((u) => u.usta && Number(u.usta) <= ustaMax);
  if (hasRating === "utr") candidates = candidates.filter((u) => u.utr !== null);
  if (hasRating === "usta") candidates = candidates.filter((u) => !!u.usta);
  if (availabilityMode === "set") candidates = candidates.filter((u) => currentAvailability(u).length > 0);
  // A player with no surface preference set ("Any surface") should show up
  // for every specific court-type search — they haven't restricted
  // themselves to one surface, so they're a match regardless of which one
  // someone is filtering for.
  if (surface) candidates = candidates.filter((u) => !u.surface || u.surface === surface);
  if (paidOnly) candidates = candidates.filter((u) => u.paidHits && u.paidHits.enabled);

  const myFriends = new Set(me.friends || []);
  const myOutgoingPending = new Set(
    data.friendRequests.filter((r) => r.fromId === me.id && r.status === "pending").map((r) => r.toId)
  );
  let results = candidates.map((u) => {
    const distance = userDistance(me, u);
    const overlappingTimes = overlappingBlocks(me.availability, u.availability);
    const friendStatus = myFriends.has(u.id) ? "friends" : myOutgoingPending.has(u.id) ? "pending" : "none";
    const { avgRating, ratingCount } = getRatingSummary(data, u.id);
    return {
      ...publicUser(u),
      distance,
      overlappingTimes,
      hasOverlap: overlappingTimes.length > 0,
      isFriend: myFriends.has(u.id),
      friendStatus,
      avgRating,
      ratingCount,
    };
  });

  if (availabilityMode === "overlap") results = results.filter((u) => u.hasOverlap);
  if (maxDistance !== null) {
    results = results.filter((u) => u.distance === null || u.distance <= maxDistance);
  }

  if (sortBy === "utr") {
    results.sort((a, b) => (b.utr ?? -Infinity) - (a.utr ?? -Infinity));
  } else if (sortBy === "usta") {
    results.sort((a, b) => (Number(b.usta) || -Infinity) - (Number(a.usta) || -Infinity));
  } else {
    results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  // Within whichever sort was picked, people you actually overlap with
  // float to the top — the whole point of showing overlap at all.
  results.sort((a, b) => (b.hasOverlap ? 1 : 0) - (a.hasOverlap ? 1 : 0));

  res.json({ results });
});

module.exports = router;
