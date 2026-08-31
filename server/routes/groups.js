const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { load, save, nextId, publicUser, addNotification } = require("../utils");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const data = load();
  const groups = data.groups.filter((g) => g.memberIds.includes(req.userId));
  res.json({ groups });
});

router.post("/", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Group name is required." });
  const data = load();
  const group = {
    id: nextId(data, "groups"),
    name,
    ownerId: req.userId,
    memberIds: [req.userId],
    messages: [],
    createdAt: new Date().toISOString(),
  };
  data.groups.push(group);
  save(data);
  res.status(201).json({ group });
});

router.put("/:id", requireAuth, (req, res) => {
  const { name } = req.body || {};
  const data = load();
  const group = data.groups.find((g) => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (group.ownerId !== req.userId) return res.status(403).json({ error: "Only the group owner can rename it." });
  if (name) group.name = name;
  save(data);
  res.json({ group });
});

router.delete("/:id", requireAuth, (req, res) => {
  const data = load();
  const group = data.groups.find((g) => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (group.ownerId !== req.userId) return res.status(403).json({ error: "Only the group owner can delete it." });
  data.groups = data.groups.filter((g) => g.id !== group.id);
  save(data);
  res.json({ ok: true });
});

router.get("/:id", requireAuth, (req, res) => {
  const data = load();
  const group = data.groups.find((g) => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (!group.memberIds.includes(req.userId)) return res.status(403).json({ error: "You are not in this group." });
  const members = data.users.filter((u) => group.memberIds.includes(u.id)).map(publicUser);
  res.json({ group, members });
});

router.post("/:id/invite", requireAuth, (req, res) => {
  const { userId } = req.body || {};
  const data = load();
  const group = data.groups.find((g) => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (!group.memberIds.includes(req.userId)) return res.status(403).json({ error: "You are not in this group." });

  const target = data.users.find((u) => u.id === Number(userId));
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!group.memberIds.includes(target.id)) group.memberIds.push(target.id);

  const me = data.users.find((u) => u.id === req.userId);
  addNotification(data, target.id, "group_invite", `${me.name} added you to the group "${group.name}".`, group.id);
  save(data);
  res.json({ group });
});

// Remove a member — the group owner can remove anyone; anyone else can
// only remove themselves (i.e. leave the group).
router.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const data = load();
  const group = data.groups.find((g) => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found." });
  const targetId = Number(req.params.userId);
  const isOwner = group.ownerId === req.userId;
  if (!isOwner && targetId !== req.userId) {
    return res.status(403).json({ error: "Only the group owner can remove other members." });
  }
  if (targetId === group.ownerId) {
    return res.status(400).json({ error: "The group owner can't be removed — delete the group instead." });
  }
  group.memberIds = group.memberIds.filter((id) => id !== targetId);
  save(data);
  res.json({ group });
});

router.post("/:id/message", requireAuth, (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Message text is required." });
  const data = load();
  const group = data.groups.find((g) => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (!group.memberIds.includes(req.userId)) return res.status(403).json({ error: "You are not in this group." });

  const me = data.users.find((u) => u.id === req.userId);
  const msg = { id: Date.now(), fromId: req.userId, fromName: me.name, text, createdAt: new Date().toISOString() };
  group.messages.push(msg);

  const notifMsg = `${me.name} sent a message in ${group.name}: "${text.slice(0, 100)}${text.length > 100 ? "…" : ""}"`;
  for (const memberId of group.memberIds) {
    if (memberId === req.userId) continue;
    addNotification(data, memberId, "message", notifMsg, group.id);
  }

  save(data);
  res.status(201).json({ message: msg });
});

module.exports = router;
