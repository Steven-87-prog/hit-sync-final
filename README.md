# Hit Sync (local starter)

A working starter build of Hit Sync — a tennis matchmaking and scheduling app.

**Stack:** Node.js + Express backend, a small JSON-file database (zero setup,
no native modules to compile), and a plain HTML/CSS/JS frontend (no build
step, no bundler).

**Want to put this on the real internet with a domain name?** See
[`DEPLOY.md`](./DEPLOY.md) — this section below is just for running it
locally to develop/test.

## What's implemented

- Signup/login (JWT-based sessions)
- Profile: ratings (UTR/USTA), gender, surface, handedness, style, bio, paid-hits rate
- Weekly availability — add custom time ranges per day, or flip "Available
  at all times" to fill your whole week in one tap (great for testing —
  you'll match with everyone in Find Players)
- **Find Players** — only shows players whose availability overlaps yours,
  and shows exactly which days/times you're both free right on the card
- **Find Friends** — discovery regardless of schedule overlap; add friend or
  view their bio
- Friend requests (send/accept/decline)
- **Friends page** — see everyone you're friends with, expand their weekly
  availability inline, and message them directly
- Groups (create, invite, group messaging)
- Hit requests (send/accept/decline), auto-added to a monthly Calendar on
  acceptance. Requesters can type in a suggested court by name, optionally
  attach a Google Maps link, and check "I already booked this court" to
  notify the other player it's locked in.
- Cancel a hit (requires a reason, notifies the other player)
- Notifications bell
- Direct messages between friends
- First-time interactive tutorial: starts on your Profile right after
  signup, walks you through setting availability, then through every
  feature (Find Players, Find Friends, Friends, Calendar, Groups,
  Messages, Notifications), waiting for you to actually try a few of them.
  Only shown once per account (tracked server-side) — replay it anytime
  from the sidebar.
- Built mobile-first: touch-friendly tap targets, safe-area padding for
  notches, no input zoom-jump on iOS, full-screen sheets on phones, and a
  `manifest.json` + icon so it can be added to a phone's home screen like
  a real app.

## Prerequisites

- [Node.js](https://nodejs.org) version 18 or newer (v22 is fine). Check with:
  ```
  node -v
  ```
- [VS Code](https://code.visualstudio.com/) (or any editor)

## 1. Open the folder in VS Code

Unzip `hit-sync.zip` somewhere on your machine, then either:

- In VS Code: **File → Open Folder…** → select the unzipped `hit-sync` folder, or
- From a terminal, `cd` into the folder and run:
  ```
  code .
  ```

## 2. Install dependencies

Open a terminal in VS Code (**Terminal → New Terminal**) and run:

```bash
npm install
```

This pulls in Express, bcryptjs, jsonwebtoken, etc. (all pure-JS packages —
no native build tools required).

## 3. Set up your environment file

```bash
cp .env.example .env
```

The defaults work fine for local testing as-is.

## 4. Seed demo players (recommended)

This adds 4 pre-made accounts so Find Players, Find Friends, and Friends
have people to show immediately — no need to sign up multiple accounts by
hand:

```bash
npm run seed
```

Log in with any of these, password `password123` for all:
- `ava@example.com` — Hard court, UTR 8.5, free hits
- `marcus@example.com` — Hard court, UTR 9.1, **paid hits ($45/hr)**
- `priya@example.com` — Clay court, UTR 6.2
- `diego@example.com` — Hard court, UTR 5.4, weekend availability only

Demo accounts skip the onboarding tutorial (it's still there for real
signups). Run this again anytime after deleting `data/db.json` to reseed.

## 5. Run it

```bash
npm start
```

You should see:

```
🎾  Hit Sync server running at http://localhost:4000
```

Open **http://localhost:4000** in your browser.

For auto-restart on file changes while you develop, use:

```bash
npm run dev
```
(uses `nodemon`, included in devDependencies)

## 6. Try it out

If you seeded demo players, the fastest way to test is to log in as one
seeded account in your main window and a **different** seeded account in an
incognito/private window (sessions live in `localStorage`, so each window
stays logged in as a different user).

1. Log in as `ava@example.com` / `password123` in your main window.
2. Since this is a seeded account, the tutorial won't auto-launch — try it
   anytime via the sidebar ("↺ Replay tutorial"). It starts on **Profile**,
   walks through setting availability, then tours every feature, waiting
   for you to try a few things yourself. Exit early anytime with **End
   tutorial**.
3. Go to **Find Players** — you should immediately see Marcus and/or Priya
   since their availability overlaps Ava's (Tuesday 4–6pm, Saturday
   mornings). Each card shows exactly which days/times you're both free.
4. Click **Request hit** on Marcus's card. Add a suggested court name,
   optionally paste a Google Maps link, and try checking "I already booked
   this court" — send it.
5. Open an incognito window, log in as `marcus@example.com` /
   `password123`. His notification/dashboard entry should mention the
   court is booked (if you checked that box), with a Maps link if you added
   one. Accept the request — it'll show up on both calendars.
6. Add Priya as a friend from **Find Friends** (notice it only offers "Add
   friend" / "View bio" there, since schedules aren't guaranteed to
   overlap). Accept the request from her account, then check the new
   **Friends** page — expand her availability and send her a message.
7. On **Profile**, try toggling "Available at all times" — it fills your
   whole week instantly, so you'll match with every other player in Find
   Players. Toggle it off to clear it again.
8. Sign up for a brand-new (non-seeded) account to see the full first-time
   tutorial trigger automatically.

### Testing it like a phone app

- In Chrome DevTools, use device toolbar / responsive mode to preview at
  phone widths — everything from the nav to modals adapts below 860px.
- On an actual phone on the same Wi-Fi, visit `http://<your-computer's-local-IP>:4000`
  and use your browser's "Add to Home Screen" — the `manifest.json` and
  icon make it launch full-screen like an installed app.

### Resetting your data

All data lives in `data/db.json`. To start completely fresh:

```bash
rm data/db.json
npm run seed   # optional, re-adds the demo players
```

## Project structure

```
hit-sync/
├── server/
│   ├── index.js          # Express app entry point
│   ├── db.js              # tiny JSON-file database
│   ├── utils.js            # shared helpers (matching, notifications)
│   ├── seed.js              # demo data seeder
│   ├── middleware/auth.js  # JWT auth middleware
│   └── routes/              # one file per feature area
│       ├── auth.js
│       ├── profile.js
│       ├── players.js       # Find Players / Find Friends
│       ├── friends.js
│       ├── groups.js
│       ├── hits.js          # requests, accept/decline/cancel, calendar
│       ├── notifications.js
│       └── messages.js
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js           # fetch wrapper
│       ├── tutorial.js      # interactive tutorial controller
│       └── app.js           # page router + all UI logic
├── data/db.json             # created automatically on first run
├── .env.example
└── package.json
```

## Notes on scope / what's simplified for a local starter

- **Database:** a JSON file, not a real database. Fine for local dev and demos;
  swap in Postgres/SQLite/Mongo before deploying anywhere real.
- **Distance** is calculated from real coordinates — each user's ZIP is
  geocoded (free, via OpenStreetMap's Nominatim) into lat/lng when they
  save it on Profile or sign up, and distances between players use the
  actual Haversine formula on those coordinates, not a ZIP-digit guess.
- **Court booking** is informational, not a real reservation system —
  players type in a court name themselves and can attach a Google Maps
  link; there's no live availability check against an actual venue.

## Next steps if you want to keep building

- Swap the JSON file for a real database
- Add password reset / email verification
- Real geocoding for accurate distance (Find Players)
- WebSocket-based live notifications/messages instead of polling on page load
- Deploy (Render, Railway, Fly.io, or a VPS all work fine for this stack)
