const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save } = require("../utils");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const data = load();
  const mine = data.notifications
    .filter((n) => n.userId === req.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ notifications: mine });
});

router.post("/:id/read", requireAuth, (req, res) => {
  const data = load();
  const notif = data.notifications.find((n) => n.id === Number(req.params.id));
  if (!notif) return res.status(404).json({ error: "Notification not found." });
  if (notif.userId !== req.userId) return res.status(403).json({ error: "Not your notification." });
  notif.read = true;
  save(data);
  res.json({ notification: notif });
});

router.post("/read-all", requireAuth, (req, res) => {
  const data = load();
  data.notifications.filter((n) => n.userId === req.userId).forEach((n) => (n.read = true));
  save(data);
  res.json({ ok: true });
});

module.exports = router;
