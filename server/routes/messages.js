const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, publicUser, addNotification } = require("../utils");

const router = express.Router();

// GET /api/messages — list everyone you have an existing conversation
// with, friend or not (e.g. someone you messaged about a hit request).
// This powers the Messages page thread list.
router.get("/", requireAuth, (req, res) => {
  const data = load();
  const me = data.users.find((u) => u.id === req.userId);
  if (!me) return res.status(404).json({ error: "User not found." });

  const partnerIds = new Set();
  data.messages.forEach((m) => {
    if (m.fromId === req.userId) partnerIds.add(m.toId);
    if (m.toId === req.userId) partnerIds.add(m.fromId);
  });
  (me.friends || []).forEach((id) => partnerIds.add(id));

  const myFriends = new Set(me.friends || []);
  const threads = [...partnerIds]
    .map((id) => data.users.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => {
      const lastMsg = data.messages
        .filter((m) => (m.fromId === u.id && m.toId === req.userId) || (m.fromId === req.userId && m.toId === u.id))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      return { ...publicUser(u), lastMessageAt: lastMsg ? lastMsg.createdAt : null, isFriend: myFriends.has(u.id) };
    })
    .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

  res.json({ threads });
});

router.get("/:userId", requireAuth, (req, res) => {
  const otherId = Number(req.params.userId);
  const data = load();
  const thread = data.messages
    .filter(
      (m) =>
        (m.fromId === req.userId && m.toId === otherId) ||
        (m.fromId === otherId && m.toId === req.userId)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages: thread });
});

router.post("/:userId", requireAuth, (req, res) => {
  const otherId = Number(req.params.userId);
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Message text is required." });
  if (otherId === req.userId) return res.status(400).json({ error: "You can't message yourself." });
  const data = load();
  const target = data.users.find((u) => u.id === otherId);
  if (!target) return res.status(404).json({ error: "User not found." });
  const me = data.users.find((u) => u.id === req.userId);

  const msg = {
    id: nextId(data, "messages"),
    fromId: req.userId,
    toId: otherId,
    text,
    createdAt: new Date().toISOString(),
  };
  data.messages.push(msg);
  const notifMsg = `${me.name} sent you a message: "${text.slice(0, 100)}${text.length > 100 ? "…" : ""}"`;
  addNotification(data, otherId, "message", notifMsg, msg.id);
  save(data);
  res.status(201).json({ message: msg });
});

module.exports = router;
