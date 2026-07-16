require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const db = require("./db");
const { backfillMissingCoordinates } = require("./utils");

const authRoutes = require("./routes/auth");
const profileRoutes = require("./routes/profile");
const playerRoutes = require("./routes/players");
const friendRoutes = require("./routes/friends");
const groupRoutes = require("./routes/groups");
const hitRoutes = require("./routes/hits");
const notificationRoutes = require("./routes/notifications");
const messageRoutes = require("./routes/messages");

// Modern Node.js crashes the whole process on an unhandled promise
// rejection by default (e.g. an error thrown inside an `async` route
// handler that isn't caught). For a small server like this, one bad
// request crashing and restarting the entire app for everyone is worse
// than logging the error and staying up — so we log instead of crashing.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/hits", hitRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/messages", messageRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "hit-sync" }));

// Serve the frontend
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Catch errors thrown by any route (including inside async handlers) and
// return a normal JSON error instead of letting them crash the process or
// hang the request forever.
app.use((err, req, res, next) => {
  console.error("Request error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

// Load existing data (from Upstash Redis in production, or the local file
// in dev) before accepting any requests.
db.hydrate().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎾  Hit Sync server running at http://localhost:${PORT}\n`);
    console.log(db.USE_REMOTE ? "Storage: Upstash Redis (persistent)" : "Storage: local JSON file");
  });

  // Backfill coordinates for any pre-existing accounts that never got
  // geocoded, so distance shows up for everyone without them having to
  // touch their profile. Runs in the background — doesn't delay startup.
  backfillMissingCoordinates().catch((e) =>
    console.error("Hit Sync: coordinate backfill failed:", e.message)
  );
});
