const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, addNotification } = require("../utils");

const router = express.Router();

// POST /api/ratings { hitId, toUserId, stars, review }
// Rate the other person on a finished hit — one rating per (hit, rater, ratee).
router.post("/", requireAuth, (req, res) => {
  const { hitId, toUserId, stars, review } = req.body || {};
  const starsNum = Number(stars);
  if (!hitId || !toUserId || !Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
    return res.status(400).json({ error: "hitId, toUserId, and stars (1-5) are required." });
  }
  const data = load();
  data.ratings = data.ratings || [];

  const hit = data.hits.find((h) => h.id === Number(hitId));
  if (!hit) return res.status(404).json({ error: "Hit not found." });
  const iCanRate =
    hit.status === "completed" ||
    (hit.finishedBy || []).includes(req.userId) ||
    (hit.status === "cancelled" && hit.everAccepted && hit.cancelledBy !== req.userId);
  if (!iCanRate) {
    if (hit.status === "cancelled" && hit.cancelledBy === req.userId) {
      return res.status(409).json({ error: "You can't rate a hit you cancelled." });
    }
    return res.status(409).json({ error: "You can only rate a hit once it's been confirmed and either finished or cancelled." });
  }
  const involved = new Set([hit.fromId, ...hit.toIds]);
  if (!involved.has(req.userId)) return res.status(403).json({ error: "You weren't part of this hit." });
  if (!involved.has(Number(toUserId)) || Number(toUserId) === req.userId) {
    return res.status(400).json({ error: "toUserId must be someone else who was part of this hit." });
  }

  const existing = data.ratings.find(
    (r) => r.hitId === Number(hitId) && r.fromUserId === req.userId && r.toUserId === Number(toUserId)
  );
  if (existing) {
    existing.stars = starsNum;
    existing.review = review || "";
    save(data);
    return res.json({ rating: existing });
  }

  const me = data.users.find((u) => u.id === req.userId);
  const rating = {
    id: nextId(data, "ratings"),
    hitId: Number(hitId),
    fromUserId: req.userId,
    fromName: me ? me.name : "A player",
    toUserId: Number(toUserId),
    stars: starsNum,
    review: review || "",
    createdAt: new Date().toISOString(),
  };
  data.ratings.push(rating);
  addNotification(data, Number(toUserId), "rating", `${rating.fromName} left you a ${starsNum}-star rating.`, hit.id);
  save(data);
  res.status(201).json({ rating });
});

// GET /api/ratings/user/:userId — average + count + individual reviews
// (reviewer name shown, since this mirrors an in-app review, not anonymous feedback)
router.get("/user/:userId", requireAuth, (req, res) => {
  const data = load();
  data.ratings = data.ratings || [];
  const userId = Number(req.params.userId);
  const mine = data.ratings.filter((r) => r.toUserId === userId);
  const average = mine.length ? mine.reduce((sum, r) => sum + r.stars, 0) / mine.length : null;
  const reviews = mine
    .filter((r) => r.review)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((r) => ({ stars: r.stars, review: r.review, fromName: r.fromName, createdAt: r.createdAt }));
  res.json({ average, count: mine.length, reviews });
});

// GET /api/ratings/pending — finished hits the current user hasn't rated yet,
// used to prompt "rate your last hit" if they skipped it in the moment.
router.get("/pending", requireAuth, (req, res) => {
  const data = load();
  data.ratings = data.ratings || [];
  const myFinished = data.hits.filter(
    (h) =>
      (h.fromId === req.userId || h.toIds.includes(req.userId)) &&
      (h.status === "completed" ||
        (h.finishedBy || []).includes(req.userId) ||
        (h.status === "cancelled" && h.everAccepted && h.cancelledBy !== req.userId))
  );
  const pending = [];
  for (const hit of myFinished) {
    const others = new Set([hit.fromId, ...hit.toIds]);
    others.delete(req.userId);
    for (const otherId of others) {
      const already = data.ratings.some(
        (r) => r.hitId === hit.id && r.fromUserId === req.userId && r.toUserId === otherId
      );
      if (!already) {
        const other = data.users.find((u) => u.id === otherId);
        if (other) pending.push({ hitId: hit.id, date: hit.date, toUserId: otherId, toName: other.name, reason: hit.status === "cancelled" ? "cancelled" : "finished" });
      }
    }
  }
  res.json({ pending });
});

module.exports = router;
