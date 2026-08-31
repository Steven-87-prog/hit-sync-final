const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { load, save, nextId, publicUser, geolocateIp, getRatingSummary } = require("../utils");
const { JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone, timezone } = req.body || {};
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: "Name, email, phone number, and password are required." });
    }
    const data = load();
    const exists = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      return res.status(409).json({
        error: "That email is already registered. Log in instead, or use a different email address.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // No ZIP is collected at signup — location is detected automatically
    // from IP address (city/region name + coordinates). The person sees a
    // one-time consent notice after joining explaining this and can opt out
    // (see PUT /profile/me/location-consent).
    let coords = null;
    let location = "";
    const ipLoc = await geolocateIp(req.ip);
    if (ipLoc) {
      coords = { lat: ipLoc.lat, lng: ipLoc.lng };
      location = ipLoc.location || "";
      console.log(`Hit Sync: resolved initial location for new signup from IP ${req.ip} -> ${location || `${coords.lat},${coords.lng}`}`);
    }

    const user = {
      id: nextId(data, "users"),
      name,
      email,
      passwordHash,
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      location,
      locationSource: coords ? "ip" : null,
      gender: "",
      dob: "",
      timezone: timezone || "America/Chicago",
      avatarUrl: "",
      phone,
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
    res.status(201).json({ token, user: { ...publicUser(user), ...getRatingSummary(data, user.id) } });
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

    // Only fill in a location via IP if this account doesn't have one yet
    // at all — never refresh/overwrite an existing location on login. That
    // "refresh on every login" behavior was the actual bug behind wildly
    // wrong distances (two people standing together showing 100+ miles, or
    // even a smaller-but-still-wrong few miles apart): IP geolocation can
    // be meaningfully off depending on someone's carrier/ISP routing, and
    // it was silently degrading even an already-good location (GPS-set or
    // otherwise) on every single login. GPS updates now only ever happen
    // through an explicit refresh (see live-location), never automatically
    // here — so once a location is set, it stays exactly as accurate as it
    // was until the person deliberately updates it.
    const explicitlyDeclined = user.locationConsentGiven && user.lat == null;
    if (!explicitlyDeclined && user.lat == null) {
      const ipLoc = await geolocateIp(req.ip);
      if (ipLoc) {
        user.lat = ipLoc.lat;
        user.lng = ipLoc.lng;
        user.location = ipLoc.location || user.location || "";
        user.locationSource = "ip";
        save(data);
        console.log(`Hit Sync: refreshed location on login from IP ${req.ip} for ${user.email} -> ${user.location || `${user.lat},${user.lng}`}`);
      }
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { ...publicUser(user), ...getRatingSummary(data, user.id) } });
  } catch (e) {
    console.error("Login failed:", e);
    res.status(500).json({ error: "Something went wrong logging in. Please try again." });
  }
});

module.exports = router;
