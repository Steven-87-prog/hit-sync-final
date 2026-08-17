const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, publicUser, addNotification, userDistance, getRatingSummary } = require("../utils");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  if (!me) return res.status(404).json({ error: "User not found." });
  const friends = data.users
    .filter((u) => (me.friends || []).includes(u.id))
    .map((u) => ({ ...publicUser(u), distance: userDistance(me, u), ...getRatingSummary(data, u.id) }));
  res.json({ friends });
});

router.get("/requests", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);

  // Self-heal: if a "pending" request exists between two people who are
  // already friends (leftover from before the mutual-request fix above),
  // silently resolve it now instead of showing a confusing stuck request.
  data.friendRequests.forEach((r) => {
    if (r.status !== "pending") return;
    const fromUser = data.users.find((u) => u.id === r.fromId);
    if (fromUser && (fromUser.friends || []).includes(r.toId)) r.status = "accepted";
  });
  save(data);

  const incoming = data.friendRequests
    .filter((r) => r.toId === req.userId && r.status === "pending")
    .map((r) => ({ ...r, fromUser: publicUser(data.users.find((u) => u.id === r.fromId)) }));
  const outgoing = data.friendRequests
    .filter((r) => r.fromId === req.userId && r.status === "pending")
    .map((r) => ({ ...r, toUser: publicUser(data.users.find((u) => u.id === r.toId)) }));
  res.json({ incoming, outgoing });
});

router.post("/request", requireAuth, (req, res) => {
  const { toId } = req.body || {};
  const targetId = Number(toId);
  if (!targetId || targetId === req.userId) {
    return res.status(400).json({ error: "A valid target user id is required." });
  }
  const data = load();
  const target = data.users.find((u) => u.id === targetId);
  if (!target) return res.status(404).json({ error: "User not found." });

  const me = data.users.find((u) => u.id === req.userId);
  if ((me.friends || []).includes(targetId)) {
    return res.status(409).json({ error: "You are already friends with this player." });
  }
  const existing = data.friendRequests.find(
    (r) => r.fromId === req.userId && r.toId === targetId && r.status === "pending"
  );
  if (existing) return res.status(409).json({ error: "Friend request already sent." });

  // They already sent *me* a pending request — instead of creating a second,
  // separate request that would sit there forever after I accept theirs,
  // just accept theirs right now. This is the actual bug fix: two mutual
  // pending requests used to get created if both people requested each
  // other before either responded, and accepting one left the other
  // permanently stuck as "pending" even though you were already friends.
  const reverseRequest = data.friendRequests.find(
    (r) => r.fromId === targetId && r.toId === req.userId && r.status === "pending"
  );
  if (reverseRequest) {
    reverseRequest.status = "accepted";
    me.friends = Array.from(new Set([...(me.friends || []), targetId]));
    target.friends = Array.from(new Set([...(target.friends || []), req.userId]));
    addNotification(data, targetId, "friend_request", `${me.name} accepted your friend request.`, reverseRequest.id);
    save(data);
    return res.status(200).json({ request: reverseRequest, autoAccepted: true });
  }

  const request = {
    id: nextId(data, "friendRequests"),
    fromId: req.userId,
    toId: targetId,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  data.friendRequests.push(request);
  addNotification(data, targetId, "friend_request", `${me.name} sent you a friend request.`, request.id);
  save(data);
  res.status(201).json({ request });
});

router.post("/respond", requireAuth, (req, res) => {
  const { requestId, accept } = req.body || {};
  const data = load();
  const request = data.friendRequests.find((r) => r.id === Number(requestId));
  if (!request) return res.status(404).json({ error: "Friend request not found." });
  if (request.toId !== req.userId) return res.status(403).json({ error: "This request is not addressed to you." });
  if (request.status !== "pending") return res.status(409).json({ error: "This request has already been handled." });

  request.status = accept ? "accepted" : "declined";

  if (accept) {
    const me = data.users.find((u) => u.id === req.userId);
    const from = data.users.find((u) => u.id === request.fromId);
    me.friends = Array.from(new Set([...(me.friends || []), from.id]));
    from.friends = Array.from(new Set([...(from.friends || []), me.id]));
    addNotification(data, from.id, "friend_request", `${me.name} accepted your friend request.`, request.id);

    // Clean up any other stale pending request between these same two
    // people (from data created before the fix above existed) so it
    // doesn't linger and show as "pending" even though you're now friends.
    data.friendRequests.forEach((r) => {
      if (
        r.id !== request.id &&
        r.status === "pending" &&
        ((r.fromId === me.id && r.toId === from.id) || (r.fromId === from.id && r.toId === me.id))
      ) {
        r.status = "accepted";
      }
    });
  }
  save(data);
  res.json({ request });
});

module.exports = router;
