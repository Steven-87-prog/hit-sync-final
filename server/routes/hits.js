const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, publicUser, addNotification, sendSMS, withAppLink, todayISO, getRatingSummary, trimAvailabilityForHit } = require("../utils");

const router = express.Router();

// Attaches rating info to a user embedded in a hit response (fromUser/toUsers)
function withRating(data, user) {
  if (!user) return user;
  const { avgRating, ratingCount } = getRatingSummary(data, user.id);
  return { ...user, avgRating, ratingCount };
}

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
  // Uses the requester's own timezone, not the server's — otherwise this
  // is the exact same bug we fixed for availability: late evening in a US
  // timezone can already be "tomorrow" in the server's UTC clock, which
  // would wrongly reject a valid same-day request.
  if (date < todayISO(me && me.timezone)) {
    return res.status(400).json({ error: "You can't request a hit for a date that's already passed." });
  }
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
    const recipientMessage = `${me.name} requested a${hit.paid ? " PAID" : ""} hit on ${date} from ${startTime} to ${endTime}${court ? ` at ${court}` : ""}.${hit.paid && paidRate ? ` ($${paidRate}/hr${paidMethod ? ` via ${paidMethod}` : ""})` : ""}${courtBooked ? " I booked the court!" : ""}${hit.message ? ` "${hit.message}"` : ""}`;
    addNotification(data, id, "hit_request", recipientMessage, hit.id);
    const recipient = data.users.find((u) => u.id === id);
    sendSMS(recipient && recipient.phone, withAppLink(`Hit Sync: ${recipientMessage}`));
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
  // Gate on whether *this specific person* already responded, not on the
  // overall hit status — for a group hit, one person declining used to
  // flip hit.status to "declined" immediately, which then blocked every
  // other invitee from ever submitting their own accept/decline at all.
  if (hit.responses[req.userId]) {
    return res.status(409).json({ error: "You've already responded to this hit." });
  }
  if (hit.status === "cancelled") {
    return res.status(409).json({ error: "This hit was cancelled." });
  }

  hit.responses[req.userId] = accept ? "accepted" : "declined";
  const me = data.users.find((u) => u.id === req.userId);
  const note = (message || "").trim().slice(0, 500);
  const quoted = note ? ` "${note}"` : "";

  if (!accept) {
    hit.status = "declined";
    const msg = `${me.name} declined your hit request.${quoted}`;
    addNotification(data, hit.fromId, "hit_declined", msg, hit.id);
    const requester = data.users.find((u) => u.id === hit.fromId);
    sendSMS(requester && requester.phone, withAppLink(`Hit Sync: ${msg}`));
  } else {
    const allResponded = hit.toIds.every((id) => hit.responses[id]);
    const anyDeclined = Object.values(hit.responses).includes("declined");
    const requester = data.users.find((u) => u.id === hit.fromId);
    if (allResponded && !anyDeclined) {
      hit.status = "accepted";
      hit.everAccepted = true; // tracked separately so ratings stay allowed even if this later gets cancelled
      // They're no longer "available" during this exact confirmed slot —
      // trim it out of everyone's saved availability so it reflects reality.
      const everyone = new Set([hit.fromId, ...hit.toIds]);
      for (const id of everyone) {
        const participant = data.users.find((u) => u.id === id);
        if (participant) trimAvailabilityForHit(participant, hit);
      }
      const msg = `${me.name} accepted your hit request. It's on the calendar!${quoted}`;
      addNotification(data, hit.fromId, "hit_accepted", msg, hit.id);
      sendSMS(requester && requester.phone, withAppLink(`Hit Sync: ${msg}`));
    } else {
      const msg = `${me.name} accepted your hit request.${quoted}`;
      addNotification(data, hit.fromId, "hit_accepted", msg, hit.id);
      sendSMS(requester && requester.phone, withAppLink(`Hit Sync: ${msg}`));
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
  if (["cancelled", "declined", "completed"].includes(hit.status)) {
    return res.status(409).json({ error: "This hit can't be cancelled — it's already " + hit.status + "." });
  }

  // hit.everAccepted may not be set on hits that were confirmed before this
  // flag existed — the hit's status right now, just before we overwrite it,
  // is an equally reliable signal, so use it as a fallback.
  const wasAccepted = hit.status === "accepted";
  hit.status = "cancelled";
  hit.cancelReason = reason;
  hit.cancelledBy = req.userId;
  hit.everAccepted = hit.everAccepted || wasAccepted;
  const me = data.users.find((u) => u.id === req.userId);
  const others = new Set([hit.fromId, ...hit.toIds]);
  others.delete(req.userId);
  for (const id of others) {
    const msg = `${me.name} cancelled the hit on ${hit.date}: "${reason}"`;
    addNotification(data, id, "hit_cancelled", msg, hit.id);
    const person = data.users.find((u) => u.id === id);
    sendSMS(person && person.phone, withAppLink(`Hit Sync: ${msg}`));
  }
  save(data);
  res.json({ hit });
});

// Mark an accepted hit as finished — it drops off the Dashboard/Calendar
// for everyone involved (fromId + all toIds), not just the person who
// clicked it. Either side can mark it finished.
// Only the original requester can propose a change, and only once the hit
// is actually confirmed ("accepted") — the change doesn't take effect
// immediately, it sits as a pending proposal until everyone else confirms.
router.post("/:id/propose-edit", requireAuth, (req, res) => {
  const data = load();
  const hit = data.hits.find((h) => h.id === Number(req.params.id));
  if (!hit) return res.status(404).json({ error: "Hit not found." });
  const everyone = new Set([hit.fromId, ...hit.toIds]);
  if (!everyone.has(req.userId)) return res.status(403).json({ error: "You're not part of this hit." });
  if (!["pending", "accepted"].includes(hit.status)) {
    return res.status(409).json({ error: "This hit can no longer be edited." });
  }
  if (hit.pendingEdit) return res.status(409).json({ error: "There's already a change waiting for confirmation on this hit." });

  const { date, startTime, endTime, court, mapsLink, message } = req.body || {};
  const changes = {};
  if (date !== undefined) changes.date = date;
  if (startTime !== undefined) changes.startTime = startTime;
  if (endTime !== undefined) changes.endTime = endTime;
  if (court !== undefined) changes.court = court;
  if (mapsLink !== undefined) changes.mapsLink = mapsLink;
  if (message !== undefined) changes.message = message;
  if (Object.keys(changes).length === 0) {
    return res.status(400).json({ error: "No changes provided." });
  }

  hit.pendingEdit = { proposedBy: req.userId, changes, responses: {}, createdAt: new Date().toISOString() };
  const me = data.users.find((u) => u.id === req.userId);
  const others = new Set(everyone);
  others.delete(req.userId);
  for (const id of others) {
    addNotification(data, id, "hit_edit_proposed", `${me.name} proposed a change to your hit on ${hit.date} — please review.`, hit.id);
  }
  save(data);
  res.json({ hit });
});

// The other participant(s) confirm or decline the proposed change. Any
// single decline cancels the proposal entirely (nothing changes). It only
// actually applies once every recipient has confirmed.
router.post("/:id/respond-edit", requireAuth, (req, res) => {
  const { accept } = req.body || {};
  const data = load();
  const hit = data.hits.find((h) => h.id === Number(req.params.id));
  if (!hit) return res.status(404).json({ error: "Hit not found." });
  if (!hit.pendingEdit) return res.status(409).json({ error: "There's no pending change on this hit." });
  const everyone = new Set([hit.fromId, ...hit.toIds]);
  const confirmers = new Set(everyone);
  confirmers.delete(hit.pendingEdit.proposedBy);
  if (!confirmers.has(req.userId)) return res.status(403).json({ error: "You're not able to confirm this change." });
  if (hit.pendingEdit.responses[req.userId]) {
    return res.status(409).json({ error: "You've already responded to this change." });
  }

  const me = data.users.find((u) => u.id === req.userId);

  if (!accept) {
    addNotification(data, hit.pendingEdit.proposedBy, "hit_edit_declined", `${me.name} declined your proposed change to the hit on ${hit.date}.`, hit.id);
    hit.pendingEdit = null;
    save(data);
    return res.json({ hit });
  }

  hit.pendingEdit.responses[req.userId] = "accepted";
  const allConfirmed = [...confirmers].every((id) => hit.pendingEdit.responses[id]);
  if (allConfirmed) {
    const proposerId = hit.pendingEdit.proposedBy;
    Object.assign(hit, hit.pendingEdit.changes);
    hit.pendingEdit = null;
    const notifyList = new Set(everyone);
    notifyList.delete(req.userId);
    for (const id of notifyList) {
      addNotification(data, id, "hit_edit_confirmed", `The change to your hit on ${hit.date} was confirmed by everyone.`, hit.id);
    }

    // If the proposer was a recipient of a still-pending hit invite,
    // proposing a change already shows clear intent to play — don't also
    // make them separately click "Accept" on the original invite.
    if (hit.status === "pending" && hit.toIds.includes(proposerId)) {
      hit.responses[proposerId] = "accepted";
      const inviteFullyAccepted = hit.toIds.every((id) => hit.responses[id]) && !Object.values(hit.responses).includes("declined");
      if (inviteFullyAccepted) {
        hit.status = "accepted";
        hit.everAccepted = true;
        const everyone = new Set([hit.fromId, ...hit.toIds]);
        for (const id of everyone) {
          const participant = data.users.find((u) => u.id === id);
          if (participant) trimAvailabilityForHit(participant, hit);
        }
        const requester = data.users.find((u) => u.id === hit.fromId);
        const proposerUser = data.users.find((u) => u.id === proposerId);
        const msg = `${proposerUser.name} accepted your hit request (via their proposed change). It's on the calendar!`;
        addNotification(data, hit.fromId, "hit_accepted", msg, hit.id);
        sendSMS(requester && requester.phone, withAppLink(`Hit Sync: ${msg}`));
      }
    }
  }
  save(data);
  res.json({ hit });
});

router.post("/:id/finish", requireAuth, (req, res) => {
  const data = load();
  const hit = data.hits.find((h) => h.id === Number(req.params.id));
  if (!hit) return res.status(404).json({ error: "Hit not found." });
  const involved = hit.fromId === req.userId || hit.toIds.includes(req.userId);
  if (!involved) return res.status(403).json({ error: "You are not part of this hit." });
  if (hit.status !== "accepted") {
    return res.status(409).json({ error: "Only an accepted hit can be marked finished." });
  }

  hit.finishedBy = hit.finishedBy || [];
  const alreadyConfirmed = hit.finishedBy.includes(req.userId);
  if (!alreadyConfirmed) hit.finishedBy.push(req.userId);

  const me = data.users.find((u) => u.id === req.userId);
  const everyone = new Set([hit.fromId, ...hit.toIds]);
  const allConfirmed = [...everyone].every((id) => hit.finishedBy.includes(id));

  if (allConfirmed) {
    hit.status = "completed";
    hit.finishedAt = new Date().toISOString();
  } else if (!alreadyConfirmed) {
    // Let everyone else know this person is done — they still need to
    // press Finish hit themselves before it fully closes out for both.
    const others = new Set(everyone);
    others.delete(req.userId);
    for (const id of others) {
      addNotification(
        data,
        id,
        "hit_finished",
        `${me.name} marked your hit on ${hit.date} as finished — tap Finish hit to confirm.`,
        hit.id
      );
    }
  }
  save(data);
  res.json({ hit });
});

// GET /api/hits/calendar?month=7&year=2026  (only accepted hits, and only
// ones whose date hasn't already passed — a past hit just quietly drops
// off instead of lingering, same as an expired availability slot)
router.get("/calendar", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  const today = todayISO(me && me.timezone);
  const mine = data.hits.filter(
    (h) =>
      (h.fromId === req.userId || h.toIds.includes(req.userId)) &&
      (h.status === "accepted" || h.status === "pending") &&
      h.date >= today
  );
  const enriched = mine.map((h) => ({
    ...h,
    fromUser: withRating(data, publicUser(data.users.find((u) => u.id === h.fromId))),
    toUsers: h.toIds.map((id) => withRating(data, publicUser(data.users.find((u) => u.id === id)))),
  }));
  res.json({ hits: enriched });
});

router.get("/", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  const today = todayISO(me && me.timezone);
  const mine = data.hits.filter(
    (h) => (h.fromId === req.userId || h.toIds.includes(req.userId)) && h.date >= today
  );
  const enriched = mine
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((h) => ({
      ...h,
      fromUser: withRating(data, publicUser(data.users.find((u) => u.id === h.fromId))),
      toUsers: h.toIds.map((id) => withRating(data, publicUser(data.users.find((u) => u.id === id)))),
    }));
  res.json({ hits: enriched });
});

module.exports = router;
