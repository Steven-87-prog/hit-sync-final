const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { load, save, nextId, publicUser, geocodeZip } = require("../utils");
const { JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, zip } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required." });
    }
    const data = load();
    const exists = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      return res.status(409).json({
        error: "That email is already registered. Log in instead, or use a different email address.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const coords = zip ? await geocodeZip(zip) : null;
    const user = {
      id: nextId(data, "users"),
      name,
      email,
      passwordHash,
      zip: zip || "",
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      location: "",
      gender: "",
      utr: null,
      usta: null,
      surface: "",
      handedness: "",
      style: "",
      bio: "",
      availability: [], // [{day, start, end}]
      paidHits: { enabled: false, rate: null, method: "" },
      friends: [], // array of user ids
      tutorialSeen: false,
      createdAt: new Date().toISOString(),
    };
    data.users.push(user);
    save(data);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    console.error("Register failed:", e);
    res.status(500).json({ error: "Something went wrong creating your account. Please try again." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const data = load();
    const user = data.users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());
    if (!user) return res.status(401).json({ error: "Invalid email or password." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error("Login failed:", e);
    res.status(500).json({ error: "Something went wrong logging in. Please try again." });
  }
});

module.exports = router;
