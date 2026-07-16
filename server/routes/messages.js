const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId } = require("../utils");

const router = express.Router();

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
  const data = load();
  const target = data.users.find((u) => u.id === otherId);
  if (!target) return res.status(404).json({ error: "User not found." });

  const msg = {
    id: nextId(data, "messages"),
    fromId: req.userId,
    toId: otherId,
    text,
    createdAt: new Date().toISOString(),
  };
  data.messages.push(msg);
  save(data);
  res.status(201).json({ message: msg });
});

module.exports = router;
