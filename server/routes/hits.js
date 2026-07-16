const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, publicUser, addNotification } = require("../utils");

const router = express.Router();

// POST /api/hits/request { toId, groupId, date, startTime, endTime, format, court, mapsLink, courtBooked, message, paid }
router.post("/request", requireAuth, (req, res) => {
  const { toId, groupId, date, startTime, endTime, format, court, mapsLink, courtBooked, message, paid } = req.body || {};
  if (!date || !startTime || !endTime || !format) {
    return res.status(400).json({ error: "date, startTime, endTime, and format are required." });
  }
  if (startTime >= endTime) {
    return res.status(400).json({ error: "End time must be after start time." });
  }
  if (!toId && !groupId) {
    return res.status(400).json({ error: "Either toId (a player) or groupId is required." });
  }
  if (paid && !toId) {
    return res.status(400).json({ error: "Paid hits can only be requested from a single player." });
  }

  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  const recipients = [];
  let paidRate = null;
  let paidMethod = null;

  if (toId) {
    const target = data.users.find((u) => u.id === Number(toId));
    if (!target) return res.status(404).json({ error: "Player not found." });
    // Server-side enforcement: only allow a paid-hit request if the target
    // actually opted into paid hits on their profile — mirrors the frontend
    // only showing the button in that case, but doesn't trust the client.
    if (paid) {
      if (!target.paidHits || !target.paidHits.enabled) {
        return res.status(400).json({ error: "This player hasn't enabled paid hits." });
      }
      paidRate = target.paidHits.rate;
      paidMethod = target.paidHits.method;
    }
    recipients.push(target.id);
  }
  if (groupId) {
    const group = data.groups.find((g) => g.id === Number(groupId));
    if (!group) return res.status(404).json({ error: "Group not found." });
    if (!group.memberIds.includes(req.userId)) return res.status(403).json({ error: "You are not in this group." });
    for (const id of group.memberIds) if (id !== req.userId) recipients.push(id);
  }

  const hit = {
    id: nextId(data, "hits"),
    fromId: req.userId,
    toIds: recipients,
    groupId: groupId ? Number(groupId) : null,
    date,
    startTime,
    endTime,
    format,
    court: court || "",
    mapsLink: mapsLink || "",
    courtBooked: !!courtBooked,
    paid: !!paid,
    paidRate,
    paidMethod,
    message: (message || "").slice(0, 500),
    status: "pending", // pending | accepted | declined | cancelled
    responses: {}, // userId -> "accepted"|"declined"
    cancelReason: null,
    createdAt: new Date().toISOString(),
  };
  data.hits.push(hit);

  for (const id of recipients) {
    addNotification(
      data,
      id,
      "hit_request",
      `${me.name} requested a${hit.paid ? " PAID" : ""} hit on ${date} from ${startTime} to ${endTime}${court ? ` at ${court}` : ""}.${hit.paid && paidRate ? ` ($${paidRate}/hr${paidMethod ? ` via ${paidMethod}` : ""})` : ""}${courtBooked ? " I booked the court!" : ""}${hit.message ? ` "${hit.message}"` : ""}`,
      hit.id
    );
  }
  save(data);
  res.status(201).json({ hit });
});

// POST /api/hits/:id/respond { accept, message }
// message is optional either way — e.g. "See you there!" on accept, or a
// reason on decline — and is always sent to the requester as a notification.
router.post("/:id/respond", requireAuth, (req, res) => {
  const { accept, message } = req.body || {};
  const data = load();
  const hit = data.hits.find((h) => h.id === Number(req.params.id));
  if (!hit) return res.status(404).json({ error: "Hit request not found." });
  if (!hit.toIds.includes(req.userId)) return res.status(403).json({ error: "This request was not sent to you." });
  if (hit.status !== "pending") return res.status(409).json({ error: "This hit has already been resolved." });

  hit.responses[req.userId] = accept ? "accepted" : "declined";
  const me = data.users.find((u) => u.id === req.userId);
  const note = (message || "").trim().slice(0, 500);
  const quoted = note ? ` "${note}"` : "";

  if (!accept) {
    hit.status = "declined";
    addNotification(data, hit.fromId, "hit_declined", `${me.name} declined your hit request.${quoted}`, hit.id);
  } else {
    const allResponded = hit.toIds.every((id) => hit.responses[id]);
    const anyDeclined = Object.values(hit.responses).includes("declined");
    if (allResponded && !anyDeclined) {
      hit.status = "accepted";
      addNotification(data, hit.fromId, "hit_accepted", `${me.name} accepted your hit request. It's on the calendar!${quoted}`, hit.id);
    } else {
      addNotification(data, hit.fromId, "hit_accepted", `${me.name} accepted your hit request.${quoted}`, hit.id);
    }
  }
  save(data);
  res.json({ hit });
});

router.post("/:id/cancel", requireAuth, (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: "A cancellation reason is required." });

  const data = load();
  const hit = data.hits.find((h) => h.id === Number(req.params.id));
  if (!hit) return res.status(404).json({ error: "Hit not found." });
  const involved = hit.fromId === req.userId || hit.toIds.includes(req.userId);
  if (!involved) return res.status(403).json({ error: "You are not part of this hit." });

  hit.status = "cancelled";
  hit.cancelReason = reason;
  const me = data.users.find((u) => u.id === req.userId);
  const others = new Set([hit.fromId, ...hit.toIds]);
  others.delete(req.userId);
  for (const id of others) {
    addNotification(data, id, "hit_cancelled", `${me.name} cancelled the hit on ${hit.date}: "${reason}"`, hit.id);
  }
  save(data);
  res.json({ hit });
});

// Mark an accepted hit as finished — it drops off the Dashboard/Calendar
// for everyone involved (fromId + all toIds), not just the person who
// clicked it. Either side can mark it finished.
router.post("/:id/finish", requireAuth, (req, res) => {
  const data = load();
  const hit = data.hits.find((h) => h.id === Number(req.params.id));
  if (!hit) return res.status(404).json({ error: "Hit not found." });
  const involved = hit.fromId === req.userId || hit.toIds.includes(req.userId);
  if (!involved) return res.status(403).json({ error: "You are not part of this hit." });
  if (hit.status !== "accepted") {
    return res.status(409).json({ error: "Only an accepted hit can be marked finished." });
  }

  hit.status = "completed";
  hit.finishedAt = new Date().toISOString();
  const me = data.users.find((u) => u.id === req.userId);
  const others = new Set([hit.fromId, ...hit.toIds]);
  others.delete(req.userId);
  for (const id of others) {
    addNotification(data, id, "hit_finished", `${me.name} marked your hit on ${hit.date} as finished.`, hit.id);
  }
  save(data);
  res.json({ hit });
});

// GET /api/hits/calendar?month=7&year=2026  (only accepted hits)
router.get("/calendar", requireAuth, (req, res) => {
  const data = load();
  const mine = data.hits.filter(
    (h) => (h.fromId === req.userId || h.toIds.includes(req.userId)) && h.status === "accepted"
  );
  const enriched = mine.map((h) => ({
    ...h,
    fromUser: publicUser(data.users.find((u) => u.id === h.fromId)),
    toUsers: h.toIds.map((id) => publicUser(data.users.find((u) => u.id === id))),
  }));
  res.json({ hits: enriched });
});

router.get("/", requireAuth, (req, res) => {
  const data = load();
  const mine = data.hits.filter((h) => h.fromId === req.userId || h.toIds.includes(req.userId));
  const enriched = mine
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((h) => ({
      ...h,
      fromUser: publicUser(data.users.find((u) => u.id === h.fromId)),
      toUsers: h.toIds.map((id) => publicUser(data.users.find((u) => u.id === id))),
    }));
  res.json({ hits: enriched });
});

module.exports = router;
