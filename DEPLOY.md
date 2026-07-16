# Deploying Hit Sync (making it a real, public website)

This app is plain Node.js/Express, so it deploys almost anywhere. Below is
the easiest path (Render, free tier), plus a couple of alternatives and how
to attach a real domain name so people can just type it in.

## Before you deploy: put the code on GitHub

Hosting providers deploy from a Git repo, not a zip file.

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Create a new repository (e.g. `hit-sync`) — keep it private or public, either works.
3. In your project folder in VS Code, open the terminal and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/hit-sync.git
   git push -u origin main
   ```
   (`.gitignore` already excludes `node_modules`, `.env`, and `data/db.json` — you don't want those in the repo.)

## Making data persist on a free host

Free tiers on Render/Railway/etc. don't offer persistent disks — the
filesystem resets on every restart/redeploy. So instead of writing to a
local file in production, this app can write to a free **Upstash Redis**
database instead (genuinely free forever, not a trial). It falls back to
the local file automatically whenever those aren't configured, so local dev
is unaffected.

1. Go to [upstash.com](https://upstash.com) → sign up (free) → **Create Database**.
   Any region is fine; the free tier is plenty for this app.
2. On the database's page, find the **REST API** section. Copy the two
   values shown there: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. You'll paste these into your host's environment variables in the next
   section — keep this tab open.

## Option A: Render (recommended — easiest, has a free tier)

1. Go to [render.com](https://render.com) and sign up (you can sign in with GitHub).
2. Click **New +** → **Blueprint**, and connect the `hit-sync` GitHub repo.
   Render will detect the `render.yaml` file already in this project and
   pre-fill everything: build command, start command, and a random `JWT_SECRET`.
3. Click **Apply** / **Create**. Render builds and deploys automatically —
   takes a few minutes the first time.
4. Once it's live, go to the service → **Environment** tab, and add the two
   Upstash values you copied above:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   Save — Render will automatically redeploy with them.
5. You'll get a free URL like `https://hit-sync.onrender.com`. Open it —
   your app is live, and any account created there now survives restarts.

**No `render.yaml`?** You can set it up manually instead:
- New Web Service → connect your repo
- Build command: `npm install`
- Start command: `npm start`
- Add environment variables: `JWT_SECRET` (any long random string),
  `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

*Free-tier note:* Render's free web services spin down after inactivity and
take ~30 seconds to wake back up on the next visit. Fine for testing/sharing
with friends; upgrade to a paid instance ($7/mo tier) if you want it always-on.
Your data is unaffected by spin-down either way since it now lives in Redis,
not on the server's local disk.

## Option B: Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
2. Railway auto-detects Node and runs `npm install` / `npm start`.
3. Add environment variables: `JWT_SECRET`, `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN` (same Upstash setup as above — or use
   Railway's own Redis plugin if you'd rather stay entirely on Railway,
   just update those two env var names/values to match).
4. Railway gives you a live URL under **Settings → Networking → Generate Domain**.

## Option C: Fly.io / a VPS

Any place that runs Node 18+ works. The important parts are always the
same: run `npm install && npm start`, set `JWT_SECRET`, and either mount a
real persistent volume and set `DATA_DIR` to it, or set the two
`UPSTASH_REDIS_REST_*` variables as above.

## Getting a real domain (so people can just type in a name)

Your host gives you a free URL (`hit-sync.onrender.com`), but for something
like `hitsync.com`:

1. Buy a domain from a registrar — [Namecheap](https://namecheap.com),
   [Porkbun](https://porkbun.com), or [Google Domains via Squarespace](https://domains.squarespace.com)
   are all fine, usually $10–15/year for a `.com`.
2. In your host's dashboard (Render: service → **Settings → Custom Domains**),
   add your domain. It'll give you a CNAME or A record to add.
3. In your registrar's DNS settings, add that record. It usually takes
   15 minutes–a few hours to propagate.
4. Your host issues an HTTPS certificate for the domain automatically
   (Render and Railway both do this for free, no extra setup).

## Getting found on Google ("searchable")

Having a domain makes the site *reachable*; getting it to actually show up
in search results takes a bit more:

1. The app already has basic SEO tags (title, meta description, Open Graph)
   in `public/index.html` — edit these to match your final domain/branding.
2. Sign up for [Google Search Console](https://search.google.com/search-console),
   add your domain, verify ownership (they'll give you a DNS record or HTML
   file to add), and submit your homepage URL for indexing.
3. Realistically: expect it to take days to weeks to show up in search
   results, and longer to rank well. A domain that's been live longer, has
   real content, and gets real visits/links ranks better over time — there's
   no way to make Google index something instantly.

## Before going fully public: a few things worth doing first

- **Rotate `JWT_SECRET`** to a real random value in production (Render's
  blueprint auto-generates one; if you set it manually, use something like
  `openssl rand -hex 32`).
- **Consider a real relational database eventually.** Upstash Redis solves
  the "data disappears on restart" problem cheaply, but it's still a single
  JSON blob under the hood — fine for a small app, not built for heavy
  concurrent traffic. If the app grows a lot, migrate to Postgres (Render,
  Railway, [Neon](https://neon.tech), and [Supabase](https://supabase.com)
  all have free tiers).
- **Remove or change the seeded demo accounts** (`npm run seed`) before
  sharing publicly, or don't run that command against production at all —
  you don't want `ava@example.com` / `password123` sitting on a public site.
