const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, publicUser, addNotification, userDistance } = require("../utils");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  if (!me) return res.status(404).json({ error: "User not found." });
  const friends = data.users
    .filter((u) => (me.friends || []).includes(u.id))
    .map((u) => ({ ...publicUser(u), distance: userDistance(me, u) }));
  res.json({ friends });
});

router.get("/requests", requireAuth, (req, res) => {
  const data = load();
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
  }
  save(data);
  res.json({ request });
});

module.exports = router;
