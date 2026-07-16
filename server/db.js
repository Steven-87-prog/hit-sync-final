// Tiny JSON "database" with two backends:
//  - Local file (server/../data/db.json) — used automatically for local dev.
//  - Upstash Redis (free, persists forever) — used automatically in
//    production when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
//    set. This exists because most free hosting tiers (e.g. Render's free
//    plan) don't offer a persistent disk, so a local file would get wiped
//    on every restart/redeploy there.
//
// Route code everywhere else stays untouched: load()/save() are still
// synchronous, backed by an in-memory cache that's hydrated once at boot
// (see hydrate(), called from server/index.js before the server starts
// listening) and pushed to Upstash in the background on every save().

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REMOTE = !!(UPSTASH_URL && UPSTASH_TOKEN);
const REDIS_KEY = "hitsync:db";

const DEFAULT_SHAPE = {
  users: [],
  friendRequests: [],
  groups: [],
  hits: [],
  notifications: [],
  messages: [],
  _seq: {
    users: 1,
    friendRequests: 1,
    groups: 1,
    hits: 1,
    notifications: 1,
    messages: 1,
  },
};

let cache = null; // hydrated once at boot; every load()/save() reads/writes this

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_SHAPE, null, 2));
  }
}

// Must be awaited once before the server starts handling requests.
async function hydrate() {
  if (USE_REMOTE) {
    try {
      const res = await fetch(`${UPSTASH_URL}/get/${REDIS_KEY}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
      const json = await res.json();
      let parsed = json.result ? JSON.parse(json.result) : null;

      // Self-heal: an earlier version of this file double-encoded values on
      // save (JSON.stringify'd twice), so existing data may come back as a
      // JSON string instead of the expected {users, ...} object. Parse it
      // once more to recover it — the very next save() call will re-store
      // it correctly encoded, so this only ever needs to run once per record.
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          parsed = null;
        }
      }

      cache = parsed && Array.isArray(parsed.users) ? parsed : JSON.parse(JSON.stringify(DEFAULT_SHAPE));
      console.log("Hit Sync: loaded data from Upstash Redis.");
    } catch (e) {
      console.error("Hit Sync: failed to load from Upstash, starting with empty data.", e.message);
      cache = JSON.parse(JSON.stringify(DEFAULT_SHAPE));
    }
  } else {
    ensureFile();
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    } catch (e) {
      console.error("Hit Sync: failed to parse db.json, resetting to default shape.", e.message);
      cache = JSON.parse(JSON.stringify(DEFAULT_SHAPE));
    }
    console.log(`Hit Sync: using local file database at ${DB_FILE}`);
  }
}

function load() {
  if (cache === null) {
    throw new Error("Database not hydrated yet — call db.hydrate() before starting the server.");
  }
  return cache;
}

function save(data) {
  cache = data;
  if (USE_REMOTE) {
    // Fire-and-forget: don't make every request wait on the network round
    // trip to Redis. Logged if it fails, but the in-memory cache (and thus
    // the response already sent to the client) is unaffected either way.
    fetch(`${UPSTASH_URL}/set/${REDIS_KEY}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cache),
    }).catch((e) => console.error("Hit Sync: failed to persist to Upstash:", e.message));
  } else {
    ensureFile();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }
}

// Simple id generator per-collection
function nextId(data, collection) {
  const id = data._seq[collection]++;
  return id;
}

module.exports = { hydrate, load, save, nextId, DB_FILE, USE_REMOTE };
