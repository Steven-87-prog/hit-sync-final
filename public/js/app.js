// Hit Sync — client-side app.
// Plain JS SPA: no build step needed, just open the page and go.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Which calendar week the Profile page is currently previewing, relative
// to the real current week (0 = this week, 1 = next week, etc.). Resets
// to 0 whenever the user navigates to Profile from the sidebar.
let profileWeekOffset = 0;

// A given week's actual calendar dates, Monday-first. weekOffset shifts by
// whole weeks (0 = this week, 1 = next week, -1 = last week). Recalculated
// on every call, so "this week" always rolls over automatically.
function getCurrentWeekDates(weekOffset = 0) {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7; // Sun=0..Sat=6 -> Mon=0..Sun=6
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - mondayOffset + weekOffset * 7);
  return DAYS.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}
function fmtMonthDay(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function allTimesAvailability() {
  return DAYS.map((day) => ({ day, start: "00:00", end: "23:59", recurring: true }));
}
function isAvailableAllTimes(availability) {
  return DAYS.every((day) =>
    (availability || []).some((a) => a.day === day && a.start === "00:00" && a.end === "23:59")
  );
}

let state = {
  user: null,
  page: "dashboard",
  notifications: [],
};

// ---------------------------------------------------------------
// Toast
// ---------------------------------------------------------------
function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.style.background = isError ? "var(--danger)" : "var(--ink)";
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function fmtDate(d) {
  // "2026-07-15" parsed as-is by `new Date()` is treated as UTC midnight,
  // which can display as the *previous* day once converted to local time
  // (e.g. shows Jul 14 for a hit actually saved as Jul 15). Appending a
  // local time-of-day forces it to parse in the local timezone instead.
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// "15:00" -> "3:00 PM". Falsy/unparseable input is returned as-is.
function fmtTime12(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return hhmm || "";
  const [hStr, mStr] = hhmm.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function escapeHtml(str) {
  return (str ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
function initAuthScreen() {
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const isLogin = tab.dataset.tab === "login";
      document.getElementById("login-form").classList.toggle("hidden", !isLogin);
      document.getElementById("signup-form").classList.toggle("hidden", isLogin);
      document.getElementById("auth-error").classList.add("hidden");
    });
  });

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { token, user } = await Api.post("/auth/login", {
        email: fd.get("email"),
        password: fd.get("password"),
      });
      Api.setToken(token);
      await boot(user);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { token, user } = await Api.post("/auth/register", {
        name: fd.get("name"),
        email: fd.get("email"),
        zip: fd.get("zip"),
        password: fd.get("password"),
      });
      Api.setToken(token);
      await boot(user);
    } catch (err) {
      showAuthError(err.message);
    }
  });
}

function showAuthError(message) {
  const el = document.getElementById("auth-error");
  el.textContent = message;
  el.classList.remove("hidden");
}

function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-shell").classList.add("hidden");
}

async function boot(user) {
  state.user = user;
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  await refreshNotifications();
  if (!user.tutorialSeen) {
    navigate("profile");
    setTimeout(() => Tutorial.start(), 500);
  } else {
    navigate("dashboard");
  }
}

// ---------------------------------------------------------------
// App shell: nav, notifications, logout
// ---------------------------------------------------------------
function initShell() {
  document.querySelectorAll(".nav-link[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
  });
  document.querySelector('[data-action="replay-tutorial"]').addEventListener("click", () => {
    closeMobileNav();
    navigate("profile");
    setTimeout(() => Tutorial.start(), 350);
  });

  document.getElementById("nav-toggle").addEventListener("click", () => {
    document.getElementById("side-nav").classList.add("open");
    document.getElementById("nav-scrim").classList.remove("hidden");
  });
  document.getElementById("nav-scrim").addEventListener("click", closeMobileNav);

  document.getElementById("logout-btn").addEventListener("click", () => {
    Api.clearToken();
    state.user = null;
    showAuthScreen();
  });

  document.getElementById("notif-bell").addEventListener("click", toggleNotifPanel);
}

function closeMobileNav() {
  document.getElementById("side-nav").classList.remove("open");
  document.getElementById("nav-scrim").classList.add("hidden");
}

function navigate(page) {
  state.page = page;
  if (page === "profile") profileWeekOffset = 0;
  closeMobileNav();
  document.querySelectorAll(".nav-link[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  render();
  window.dispatchEvent(new CustomEvent("tutorial:notify", { detail: `page:${page}` }));
}

async function refreshNotifications() {
  try {
    const { notifications } = await Api.get("/notifications");
    state.notifications = notifications;
    const unread = notifications.filter((n) => !n.read).length;
    const badge = document.getElementById("notif-count");
    badge.textContent = unread;
    badge.classList.toggle("hidden", unread === 0);
  } catch (e) {
    // not fatal
  }
}

function toggleNotifPanel() {
  let panel = document.getElementById("notif-panel");
  if (panel) {
    panel.remove();
    return;
  }
  panel = document.createElement("div");
  panel.id = "notif-panel";
  panel.className = "notif-panel";
  if (state.notifications.length === 0) {
    panel.innerHTML = `<div class="notif-item">No notifications yet.</div>`;
  } else {
    panel.innerHTML = state.notifications
      .map(
        (n) => `
      <div class="notif-item ${n.read ? "" : "unread"}" data-id="${n.id}">
        <div>${escapeHtml(n.message)}</div>
        <div class="notif-time">${timeAgo(n.createdAt)}</div>
      </div>`
      )
      .join("");
  }
  document.body.appendChild(panel);
  panel.querySelectorAll(".notif-item[data-id]").forEach((item) => {
    item.addEventListener("click", async () => {
      await Api.post(`/notifications/${item.dataset.id}/read`);
      await refreshNotifications();
    });
  });
  // Opening the panel counts as "checking" your notifications — clear the
  // unread badge now. The list you're currently looking at still shows
  // which ones were unread a moment ago (via the .unread highlight already
  // rendered above), so nothing visually disappears out from under you.
  Api.post("/notifications/read-all")
    .then(refreshNotifications)
    .catch(() => {});
  setTimeout(() => {
    document.addEventListener("click", closeNotifOnce, { once: true });
  });
}
function closeNotifOnce(e) {
  const panel = document.getElementById("notif-panel");
  if (panel && !panel.contains(e.target) && e.target.id !== "notif-bell") panel.remove();
}

// ---------------------------------------------------------------
// Router
// ---------------------------------------------------------------
const pageContent = () => document.getElementById("page-content");

async function render() {
  const el = pageContent();
  el.innerHTML = `<div class="empty-state">Loading…</div>`;
  try {
    switch (state.page) {
      case "dashboard": return renderDashboard();
      case "find-players": return renderFindPlayers("players");
      case "find-friends": return renderFindPlayers("friends");
      case "friends": return renderFriends();
      case "calendar": return renderCalendar();
      case "groups": return renderGroups();
      case "messages": return renderMessages();
      case "profile": return renderProfile();
      default: el.innerHTML = `<div class="empty-state">Not found.</div>`;
    }
  } catch (err) {
    el.innerHTML = `<div class="empty-state">Something went wrong: ${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------
// Shows a friendly reminder to keep Profile/Availability up to date, at
// most once per calendar day per account (tracked in localStorage, scoped
// to the user's id so switching accounts on the same browser doesn't skip
// or double-fire it).
function maybeShowDailyReminder() {
  if (!state.user) return;
  const key = `hitsync_last_reminder_${state.user.id}`;
  const today = new Date().toDateString();
  if (localStorage.getItem(key) === today) return;
  localStorage.setItem(key, today);

  showModal(`
    <div class="card" style="max-width:380px;margin:0 auto">
      <h3 style="margin-top:0">👋 Quick reminder</h3>
      <p style="color:var(--ink-soft);font-size:14px">
        Keep your profile and availability up to date so other players can find and match with you —
        it only takes a minute.
      </p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" id="reminder-dismiss">Maybe later</button>
        <button class="btn btn-primary" id="reminder-go">Update now</button>
      </div>
    </div>`);
  document.getElementById("reminder-dismiss").addEventListener("click", closeModal);
  document.getElementById("reminder-go").addEventListener("click", () => {
    closeModal();
    navigate("profile");
  });
}

async function renderDashboard() {
  const [{ hits }, { requests: friendReqs } = { requests: [] }] = await Promise.all([
    Api.get("/hits"),
    Api.get("/friends/requests").then((r) => ({ requests: r.incoming })).catch(() => ({ requests: [] })),
  ]);
  const upcoming = hits.filter((h) => h.status === "accepted").slice(0, 5);
  const pending = hits.filter((h) => h.status === "pending" && h.toIds.includes(state.user.id));
  const sentPending = hits.filter((h) => h.status === "pending" && h.fromId === state.user.id);

  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Welcome back, ${escapeHtml(state.user.name.split(" ")[0])} 👋</h1>
      <p>Here's what's happening with your tennis schedule.</p>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3 style="margin-top:0">Upcoming hits</h3>
        ${upcoming.length ? upcoming.map(hitRowHtml).join('<div class="net-divider"></div>') : `<p style="color:var(--ink-soft)">No hits on the calendar yet. Head to Find Players to line one up.</p>`}
      </div>
      <div class="card">
        <h3 style="margin-top:0">Awaiting your response</h3>
        ${pending.length ? pending.map(hitRowHtml).join('<div class="net-divider"></div>') : `<p style="color:var(--ink-soft)">Nothing pending. You're all caught up.</p>`}
      </div>
      <div class="card">
        <h3 style="margin-top:0">Requests you sent</h3>
        ${sentPending.length ? sentPending.map(hitRowHtml).join('<div class="net-divider"></div>') : `<p style="color:var(--ink-soft)">No pending requests waiting on someone else.</p>`}
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Friend requests</h3>
      ${friendReqs.length ? friendReqs.map((r) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
          <span>${escapeHtml(r.fromUser.name)}</span>
          <span>
            <button class="btn btn-secondary btn-sm" data-accept="${r.id}">Accept</button>
            <button class="btn btn-ghost btn-sm" data-decline="${r.id}">Decline</button>
          </span>
        </div>`).join("") : `<p style="color:var(--ink-soft)">No pending friend requests.</p>`}
    </div>
  `;

  maybeShowDailyReminder();

  pageContent().querySelectorAll("[data-accept]").forEach((b) =>
    b.addEventListener("click", () => respondFriend(b.dataset.accept, true))
  );
  pageContent().querySelectorAll("[data-decline]").forEach((b) =>
    b.addEventListener("click", () => respondFriend(b.dataset.decline, false))
  );
  wireHitActions();
}

// Populated each time hitRowHtml renders a batch of rows, so wireHitActions
// can look up the full "other party" user object (bio, UTR, etc.) for the
// View profile / Message buttons without a separate API round trip.
let hitUserCache = {};

function hitRowHtml(h) {
  const withWho = h.fromId === state.user.id
    ? h.toUsers.map((u) => u.name).join(", ")
    : h.fromUser.name;
  const isRecipient = h.toIds.includes(state.user.id);
  const canAddFriend = h.status === "pending" && isRecipient && h.fromId !== state.user.id;

  // The single other person on this hit, if there is exactly one (not a
  // multi-recipient group hit) — powers View profile / Message.
  const otherUser = isRecipient ? h.fromUser : (h.toUsers.length === 1 ? h.toUsers[0] : null);
  if (otherUser) hitUserCache[otherUser.id] = otherUser;

  return `
    <div class="hit-row" data-hit="${h.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div>
          <strong>${escapeHtml(withWho)}</strong>
          <div style="font-size:12.5px;color:var(--ink-soft)">${fmtDate(h.date)} · ${fmtTime12(h.startTime)}–${fmtTime12(h.endTime)} · ${escapeHtml(h.format)}${h.court ? " · " + escapeHtml(h.court) : ""}</div>
          ${h.courtBooked ? `<div style="font-size:12px;color:var(--court-green-dark);font-weight:700;margin-top:2px">✅ Court booked${h.mapsLink ? ` — <a href="${escapeHtml(h.mapsLink)}" target="_blank" rel="noopener">view on Google Maps</a>` : ""}</div>` : h.mapsLink ? `<div style="font-size:12px;margin-top:2px"><a href="${escapeHtml(h.mapsLink)}" target="_blank" rel="noopener">View court on Google Maps</a></div>` : ""}
          ${h.paid ? `<div style="font-size:12px;color:var(--clay-dark);font-weight:700;margin-top:2px">💰 Paid hit${h.paidRate ? ` — $${h.paidRate}/hr` : ""}${h.paidMethod ? ` via ${escapeHtml(h.paidMethod)}` : ""}</div>` : ""}
          ${h.message ? `<div style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;font-style:italic">💬 "${escapeHtml(h.message)}"</div>` : ""}
        </div>
        <span class="chip chip-${h.status}">${h.status}</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        ${h.status === "pending" && isRecipient ? `
          <button class="btn btn-secondary btn-sm" data-hit-accept="${h.id}">Accept</button>
          <button class="btn btn-ghost btn-sm" data-hit-decline="${h.id}">Decline</button>` : ""}
        ${otherUser ? `
          <button class="btn btn-ghost btn-sm" data-view-profile-hit="${otherUser.id}">View profile</button>
          <button class="btn btn-ghost btn-sm" data-message-hit="${otherUser.id}" data-name="${escapeHtml(otherUser.name)}">Message</button>` : ""}
        ${canAddFriend ? `<button class="btn btn-ghost btn-sm" data-add-friend-from-hit="${h.fromId}">Add friend</button>` : ""}
        ${h.status === "pending" && h.fromId === state.user.id ? `<button class="btn btn-ghost btn-sm" data-hit-cancel="${h.id}">Cancel request</button>` : ""}
        ${h.status === "accepted" ? `
          <button class="btn btn-secondary btn-sm" data-hit-finish="${h.id}">Finish hit</button>
          <button class="btn btn-ghost btn-sm" data-hit-cancel="${h.id}">Cancel</button>` : ""}
      </div>
    </div>`;
}

function wireHitActions() {
  pageContent().querySelectorAll("[data-hit-accept]").forEach((b) =>
    b.addEventListener("click", () => openHitResponseModal(b.dataset.hitAccept, true))
  );
  pageContent().querySelectorAll("[data-hit-decline]").forEach((b) =>
    b.addEventListener("click", () => openHitResponseModal(b.dataset.hitDecline, false))
  );
  pageContent().querySelectorAll("[data-hit-cancel]").forEach((b) =>
    b.addEventListener("click", () => openCancelHitModal(b.dataset.hitCancel))
  );
  pageContent().querySelectorAll("[data-hit-finish]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await Api.post(`/hits/${b.dataset.hitFinish}/finish`);
        toast("Hit marked as finished.");
        render();
        refreshNotifications();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  pageContent().querySelectorAll("[data-add-friend-from-hit]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await Api.post("/friends/request", { toId: Number(b.dataset.addFriendFromHit) });
        toast("Friend request sent.");
        b.disabled = true;
        b.textContent = "Request sent";
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  pageContent().querySelectorAll("[data-view-profile-hit]").forEach((b) =>
    b.addEventListener("click", () => {
      const user = hitUserCache[b.dataset.viewProfileHit];
      if (user) showBioModal(user);
    })
  );
  pageContent().querySelectorAll("[data-message-hit]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.messageHit;
      const name = b.dataset.name;
      navigate("messages");
      setTimeout(() => openChat(id, name), 300);
    })
  );
}

async function respondFriend(requestId, accept) {
  try {
    await Api.post("/friends/respond", { requestId: Number(requestId), accept });
    toast(accept ? "Friend request accepted." : "Friend request declined.");
    render();
    refreshNotifications();
  } catch (e) {
    toast(e.message, true);
  }
}

function openHitResponseModal(hitId, accept) {
  showModal(`
    <div class="card" style="max-width:400px;margin:0 auto">
      <h3 style="margin-top:0">${accept ? "Accept" : "Decline"} this hit request</h3>
      <form id="hit-response-form" class="form-stack">
        <label>Message (optional) <textarea name="message" maxlength="500" placeholder="${accept ? "e.g. See you there!" : "e.g. Can't make that time, how about Thursday?"}"></textarea></label>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" id="hit-response-cancel">Cancel</button>
          <button type="submit" class="btn ${accept ? "btn-secondary" : "btn-danger"}">${accept ? "Accept" : "Decline"}</button>
        </div>
      </form>
    </div>`);
  document.getElementById("hit-response-cancel").addEventListener("click", closeModal);
  document.getElementById("hit-response-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = new FormData(e.target).get("message");
    try {
      await Api.post(`/hits/${hitId}/respond`, { accept, message });
      toast(accept ? "Hit accepted — check your calendar." : "Hit declined.");
      closeModal();
      render();
      refreshNotifications();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openCancelHitModal(hitId) {
  showModal(`
    <div class="card" style="max-width:400px;margin:0 auto">
      <h3 style="margin-top:0">Cancel this hit</h3>
      <form id="cancel-hit-form" class="form-stack">
        <label>Reason (required — the other player will see this) <textarea name="reason" maxlength="500" required placeholder="e.g. Something came up, need to reschedule"></textarea></label>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" id="cancel-hit-close">Never mind</button>
          <button type="submit" class="btn btn-danger">Cancel hit</button>
        </div>
      </form>
    </div>`);
  document.getElementById("cancel-hit-close").addEventListener("click", closeModal);
  document.getElementById("cancel-hit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const reason = new FormData(e.target).get("reason");
    try {
      await Api.post(`/hits/${hitId}/cancel`, { reason });
      toast("Hit cancelled and the other player was notified.");
      closeModal();
      render();
      refreshNotifications();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------------------------------------------------------
// Find Players / Find Friends
// ---------------------------------------------------------------
async function renderFindPlayers(mode) {
  const isPlayers = mode === "players";
  pageContent().innerHTML = `
    <div class="page-header">
      <h1>${isPlayers ? "Find Players" : "Find Friends"}</h1>
      <p>${isPlayers
        ? "Only players whose saved availability overlaps with yours are shown."
        : "Discover players and build your network, even outside your current availability."}</p>
    </div>
    <div class="filter-bar">
      <label style="flex:1 1 100%">Search by name <input type="text" id="f-search" placeholder="Type a name…" /></label>
      <label>UTR min <input type="number" step="0.1" id="f-utrmin" placeholder="e.g. 4" /></label>
      <label>UTR max <input type="number" step="0.1" id="f-utrmax" placeholder="e.g. 10" /></label>
      <label>USTA min <select id="f-ustamin"><option value="">Any</option>${["2.5","3.0","3.5","4.0","4.5","5.0","5.5"].map(v => `<option>${v}</option>`).join("")}</select></label>
      <label>USTA max <select id="f-ustamax"><option value="">Any</option>${["2.5","3.0","3.5","4.0","4.5","5.0","5.5"].map(v => `<option>${v}</option>`).join("")}</select></label>
      <label>Court type <select id="f-surface"><option value="">Any</option>${["Hard","Clay","Grass","Indoor"].map(v => `<option>${v}</option>`).join("")}</select></label>
      <label>Max distance (mi) <input type="number" id="f-distance" placeholder="e.g. 20" /></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="f-paid" style="width:auto" /> Paid hits only</label>
      <button class="btn btn-primary btn-sm" id="f-apply" style="align-self:flex-end">Apply</button>
    </div>
    <div id="results" class="grid grid-2"><div class="empty-state">Loading players…</div></div>
  `;

  document.getElementById("f-apply").addEventListener("click", () => loadResults(mode));
  document.getElementById("f-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadResults(mode);
  });
  await loadResults(mode);
}

async function loadResults(mode) {
  const params = new URLSearchParams({ mode });
  const search = document.getElementById("f-search").value;
  const utrMin = document.getElementById("f-utrmin").value;
  const utrMax = document.getElementById("f-utrmax").value;
  const ustaMin = document.getElementById("f-ustamin").value;
  const ustaMax = document.getElementById("f-ustamax").value;
  const surface = document.getElementById("f-surface").value;
  const distance = document.getElementById("f-distance").value;
  const paid = document.getElementById("f-paid").checked;
  if (search) params.set("search", search);
  if (utrMin) params.set("utrMin", utrMin);
  if (utrMax) params.set("utrMax", utrMax);
  if (ustaMin) params.set("ustaMin", ustaMin);
  if (ustaMax) params.set("ustaMax", ustaMax);
  if (surface) params.set("surface", surface);
  if (distance) params.set("maxDistance", distance);
  if (paid) params.set("paidOnly", "true");

  try {
    const { results } = await Api.get(`/players/find?${params.toString()}`);
    const container = document.getElementById("results");
    if (results.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="display">No matches yet</div>Try widening your filters or updating your availability.</div>`;
      return;
    }
    container.innerHTML = results.map((p) => playerCardHtml(p, mode)).join("");
    const resultsById = {};
    results.forEach((p) => (resultsById[p.id] = p));
    wirePlayerCardActions(resultsById);
  } catch (e) {
    toast(e.message, true);
  }
}

function playerCardHtml(p, mode) {
  const rating = p.utr ? `UTR ${p.utr}` : p.usta ? `USTA ${p.usta}` : "Unrated";
  const isPlayers = mode === "players";
  return `
    <div class="player-card">
      <div class="player-card-head">
        <div>
          <p class="player-name">${escapeHtml(p.name)}</p>
          <p class="player-meta">${p.distance !== null ? Math.round(p.distance) + " mi away" : ""}${p.surface ? " · " + escapeHtml(p.surface) : ""}</p>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        ${p.gender ? `<span class="tag">${escapeHtml(p.gender)}</span>` : ""}
        ${p.usta ? `<span class="tag">USTA ${p.usta}</span>` : ""}
        ${p.style ? `<span class="tag">${escapeHtml(p.style)}</span>` : ""}
        ${p.paidHits && p.paidHits.enabled ? `<span class="tag paid">$${p.paidHits.rate}/hr</span>` : ""}
      </div>
      ${p.bio ? `<p class="bio-text">${escapeHtml(p.bio.slice(0, 130))}${p.bio.length > 130 ? "…" : ""}</p>` : ""}
      ${isPlayers ? `<div class="avail-summary">${overlapSummaryHtml(p.overlappingTimes)}</div>` : ""}
      <div class="player-card-actions">
        ${isPlayers ? `
          <button class="btn btn-primary btn-sm" data-request-hit="${p.id}" data-name="${escapeHtml(p.name)}">Request hit</button>
          ${p.paidHits && p.paidHits.enabled ? `<button class="btn btn-secondary btn-sm" data-request-paid-hit="${p.id}" data-name="${escapeHtml(p.name)}">Request paid hit</button>` : ""}
        ` : ""}
        ${p.isFriend
          ? `<button class="btn btn-ghost btn-sm" disabled>✓ Already friends</button>`
          : `<button class="btn btn-ghost btn-sm" data-add-friend="${p.id}">Add friend</button>`}
        <button class="btn btn-ghost btn-sm" data-view-bio="${p.id}">View bio</button>
      </div>
    </div>`;
}

function overlapSummaryHtml(overlappingTimes) {
  if (!overlappingTimes || !overlappingTimes.length) {
    return `<p style="color:var(--ink-soft);font-size:12.5px;margin:0">No overlapping times found.</p>`;
  }
  const thisWeek = getCurrentWeekDates(0);
  const groups = {};
  overlappingTimes.forEach((a) => {
    const key = `${a.day}|${a.date || "recurring"}`;
    (groups[key] = groups[key] || { day: a.day, date: a.date, items: [] }).items.push(a);
  });
  const rows = Object.values(groups)
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
    .map((g) => {
      const dateLabel = g.date ? fmtMonthDay(new Date(`${g.date}T00:00:00`)) : fmtMonthDay(thisWeek[DAYS.indexOf(g.day)]);
      const suffix = g.date ? "" : " (every week)";
      return `<div class="avail-summary-row"><strong>${g.day} ${dateLabel}${suffix}</strong> ${g.items
        .map((a) => `${fmtTime12(a.start)}–${fmtTime12(a.end)}`)
        .join(", ")}</div>`;
    })
    .join("");
  return `<p style="font-size:11.5px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin:0 0 4px">You're both free</p>${rows}`;
}

function wirePlayerCardActions(resultsById) {
  document.querySelectorAll("[data-request-hit]").forEach((b) =>
    b.addEventListener("click", () => openHitRequestModal(b.dataset.requestHit, b.dataset.name))
  );
  document.querySelectorAll("[data-request-paid-hit]").forEach((b) =>
    b.addEventListener("click", () => {
      const player = resultsById && resultsById[b.dataset.requestPaidHit];
      openHitRequestModal(b.dataset.requestPaidHit, b.dataset.name, player && player.paidHits);
    })
  );
  document.querySelectorAll("[data-add-friend]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await Api.post("/friends/request", { toId: Number(b.dataset.addFriend) });
        toast("Friend request sent.");
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  document.querySelectorAll("[data-view-bio]").forEach((b) =>
    b.addEventListener("click", () => {
      const player = resultsById && resultsById[b.dataset.viewBio];
      if (player) showBioModal(player);
    })
  );
}

function showBioModal(p) {
  const rating = p.utr ? `UTR ${p.utr}` : p.usta ? `USTA ${p.usta}` : "Unrated";
  showModal(`
    <div class="card" style="max-width:420px;margin:0 auto">
      <div class="player-card-head">
        <div>
          <p class="player-name" style="font-size:19px">${escapeHtml(p.name)}</p>
          <p class="player-meta">${escapeHtml(p.location || (p.zip ? "ZIP " + p.zip : ""))}</p>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        ${p.gender ? `<span class="tag">${escapeHtml(p.gender)}</span>` : ""}
        ${p.usta ? `<span class="tag">USTA ${p.usta}</span>` : ""}
        ${p.surface ? `<span class="tag">${escapeHtml(p.surface)}</span>` : ""}
        ${p.style ? `<span class="tag">${escapeHtml(p.style)}</span>` : ""}
        ${p.paidHits && p.paidHits.enabled ? `<span class="tag paid">$${p.paidHits.rate}/hr</span>` : ""}
      </div>
      <p class="bio-text">${p.bio ? escapeHtml(p.bio) : "This player hasn't written a bio yet."}</p>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" id="bio-close">Close</button>
      </div>
    </div>`);
  document.getElementById("bio-close").addEventListener("click", closeModal);
}

function openHitRequestModal(toId, name, paidHits) {
  const formats = ["Singles", "Doubles", "Drills only", "Practice sets"];
  const isPaid = !!paidHits;
  const html = `
    <div class="card" style="max-width:420px;margin:0 auto">
      <h3 style="margin-top:0">${isPaid ? "Request a paid hit" : "Request a hit"} with ${escapeHtml(name)}</h3>
      ${isPaid ? `<div class="tag paid" style="display:inline-block;margin-bottom:14px">$${paidHits.rate}/hr${paidHits.method ? ` via ${escapeHtml(paidHits.method)}` : ""}</div>` : ""}
      <form id="hit-request-form" class="form-stack">
        <label>Date <input type="date" name="date" required /></label>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <label>Start time <input type="time" name="startTime" required /></label>
          <label>End time <input type="time" name="endTime" required /></label>
        </div>
        <label>Format <select name="format">${formats.map((f) => `<option>${f}</option>`).join("")}</select></label>
        <label>Suggested court <input type="text" name="court" placeholder="e.g. Burleson Park Tennis Courts" /></label>
        <label>Google Maps link (optional) <input type="url" name="mapsLink" placeholder="https://maps.google.com/…" /></label>
        <label style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" name="courtBooked" style="width:auto" /> I already booked this court
        </label>
        <label>Message (optional) <textarea name="message" maxlength="500" placeholder="Anything you want them to know — e.g. bring extra balls, running a few minutes late, etc."></textarea></label>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" id="hit-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Send${isPaid ? " paid" : ""} request</button>
        </div>
      </form>
    </div>`;
  showModal(html);
  document.getElementById("hit-cancel").addEventListener("click", closeModal);
  document.getElementById("hit-request-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("startTime") >= fd.get("endTime")) {
      toast("End time must be after start time.", true);
      return;
    }
    try {
      await Api.post("/hits/request", {
        toId: Number(toId),
        date: fd.get("date"),
        startTime: fd.get("startTime"),
        endTime: fd.get("endTime"),
        format: fd.get("format"),
        court: fd.get("court"),
        mapsLink: fd.get("mapsLink"),
        courtBooked: fd.get("courtBooked") === "on",
        message: fd.get("message"),
        paid: isPaid,
      });
      toast(fd.get("courtBooked") === "on" ? "Hit request sent — they'll see the court is booked!" : "Hit request sent!");
      closeModal();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------------------------------------------------------
// Friends — your accepted network, at a glance
// ---------------------------------------------------------------
async function renderFriends() {
  const { friends } = await Api.get("/friends");
  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Friends</h1>
      <p>Your tennis network. Check their availability or message them directly.</p>
    </div>
    <div class="grid grid-2">
      ${friends.length ? friends.map(friendCardHtml).join("") : `
        <div class="empty-state">
          <div class="display">No friends yet</div>
          Add friends from Find Players or Find Friends and they'll show up here.
        </div>`}
    </div>
  `;
  wireFriendCardActions(friends);
}

function friendCardHtml(f) {
  const rating = f.utr ? `UTR ${f.utr}` : f.usta ? `USTA ${f.usta}` : "Unrated";
  return `
    <div class="player-card">
      <div class="player-card-head">
        <div>
          <p class="player-name">${escapeHtml(f.name)}</p>
          <p class="player-meta">${f.distance !== null && f.distance !== undefined ? Math.round(f.distance) + " mi away" : escapeHtml(f.location || (f.zip ? "ZIP " + f.zip : ""))}</p>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        ${f.gender ? `<span class="tag">${escapeHtml(f.gender)}</span>` : ""}
        ${f.surface ? `<span class="tag">${escapeHtml(f.surface)}</span>` : ""}
        ${f.style ? `<span class="tag">${escapeHtml(f.style)}</span>` : ""}
        ${f.paidHits && f.paidHits.enabled ? `<span class="tag paid">$${f.paidHits.rate}/hr</span>` : ""}
      </div>
      ${f.bio ? `<p class="bio-text">${escapeHtml(f.bio.slice(0, 110))}${f.bio.length > 110 ? "…" : ""}</p>` : ""}
      <div id="avail-${f.id}" class="avail-summary hidden"></div>
      <div class="player-card-actions">
        <button class="btn btn-primary btn-sm" data-request-hit="${f.id}" data-name="${escapeHtml(f.name)}">Request hit</button>
        ${f.paidHits && f.paidHits.enabled ? `<button class="btn btn-secondary btn-sm" data-request-paid-hit="${f.id}" data-name="${escapeHtml(f.name)}">Request paid hit</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-toggle-avail="${f.id}">View availability</button>
        <button class="btn btn-ghost btn-sm" data-view-bio="${f.id}">View bio</button>
        <button class="btn btn-ghost btn-sm" data-message-friend="${f.id}" data-name="${escapeHtml(f.name)}">Message</button>
      </div>
    </div>`;
}

function availabilitySummaryHtml(availability) {
  if (!availability || !availability.length) {
    return `<p style="color:var(--ink-soft);font-size:12.5px;margin:0">No availability set yet.</p>`;
  }
  const thisWeek = getCurrentWeekDates(0);
  const groups = {};
  availability.forEach((a) => {
    const isRecurring = a.recurring !== false;
    const key = `${a.day}|${isRecurring ? "recurring" : a.date}`;
    (groups[key] = groups[key] || { day: a.day, date: isRecurring ? null : a.date, items: [] }).items.push(a);
  });
  return Object.values(groups)
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
    .map((g) => {
      const dateLabel = g.date ? fmtMonthDay(new Date(`${g.date}T00:00:00`)) : fmtMonthDay(thisWeek[DAYS.indexOf(g.day)]);
      const suffix = g.date ? "" : " (every week)";
      return `<div class="avail-summary-row"><strong>${g.day} ${dateLabel}${suffix}</strong> ${g.items
        .map((a) => `${fmtTime12(a.start)}–${fmtTime12(a.end)}`)
        .join(", ")}</div>`;
    })
    .join("");
}

function wireFriendCardActions(friends) {
  document.querySelectorAll("[data-request-hit]").forEach((btn) =>
    btn.addEventListener("click", () => openHitRequestModal(btn.dataset.requestHit, btn.dataset.name))
  );
  document.querySelectorAll("[data-request-paid-hit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const friend = friends.find((f) => String(f.id) === String(btn.dataset.requestPaidHit));
      openHitRequestModal(btn.dataset.requestPaidHit, btn.dataset.name, friend && friend.paidHits);
    })
  );
  document.querySelectorAll("[data-view-bio]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const friend = friends.find((f) => String(f.id) === String(btn.dataset.viewBio));
      if (friend) showBioModal(friend);
    })
  );
  document.querySelectorAll("[data-toggle-avail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleAvail;
      const box = document.getElementById(`avail-${id}`);
      if (box.classList.contains("hidden") && !box.dataset.filled) {
        const friend = friends.find((f) => String(f.id) === String(id));
        box.innerHTML = availabilitySummaryHtml(friend.availability);
        box.dataset.filled = "1";
      }
      box.classList.toggle("hidden");
      btn.textContent = box.classList.contains("hidden") ? "View availability" : "Hide availability";
    });
  });
  document.querySelectorAll("[data-message-friend]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.messageFriend;
      const name = btn.dataset.name;
      navigate("messages");
      setTimeout(() => openChat(id, name), 300);
    });
  });
}

// ---------------------------------------------------------------
// Simple modal helper
// ---------------------------------------------------------------
function showModal(innerHtml) {
  closeModal();
  const wrap = document.createElement("div");
  wrap.id = "modal-backdrop";
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(15,30,27,0.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;";
  wrap.innerHTML = innerHtml;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeModal(); });
  document.body.appendChild(wrap);
}
function closeModal() {
  const el = document.getElementById("modal-backdrop");
  if (el) el.remove();
}

// ---------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------
async function renderCalendar() {
  const { hits } = await Api.get("/hits/calendar");
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // make Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const hitsByDate = {};
  hits.forEach((h) => {
    (hitsByDate[h.date] = hitsByDate[h.date] || []).push(h);
  });

  let cells = "";
  for (let i = 0; i < startOffset; i++) cells += `<div class="calendar-cell" style="opacity:0.35"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayHits = hitsByDate[dateStr] || [];
    cells += `
      <div class="calendar-cell">
        <div class="date-num">${d}</div>
        ${dayHits.map((h) => `<div class="calendar-event" title="${escapeHtml(fmtTime12(h.startTime))}–${escapeHtml(fmtTime12(h.endTime))} · ${escapeHtml(h.format)}">${fmtTime12(h.startTime)}–${fmtTime12(h.endTime)} ${escapeHtml(h.court || h.format)}</div>`).join("")}
      </div>`;
  }

  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Calendar</h1>
      <p>${firstDay.toLocaleDateString(undefined, { month: "long", year: "numeric" })} — accepted hits only.</p>
    </div>
    <div class="calendar-grid" style="margin-bottom:6px">
      ${DAYS.map((d) => `<div style="text-align:center;font-weight:700;font-size:12px;color:var(--ink-soft)">${d}</div>`).join("")}
    </div>
    <div class="calendar-grid">${cells}</div>

    <h3 style="margin-top:28px">All upcoming hits</h3>
    <div class="grid grid-2">
      ${hits.length ? hits.map(hitRowHtml).join("") : `<p style="color:var(--ink-soft)">Nothing accepted yet.</p>`}
    </div>
  `;
  wireHitActions();
}

// ---------------------------------------------------------------
// Groups
// ---------------------------------------------------------------
async function renderGroups() {
  const { groups } = await Api.get("/groups");
  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Groups</h1>
      <p>Doubles teams, school teammates, or a regular practice crew.</p>
    </div>
    <div class="card">
      <form id="new-group-form" style="display:flex;gap:10px">
        <input type="text" id="new-group-name" placeholder="Group name" required style="flex:1;border:1.5px solid var(--line);border-radius:6px;padding:9px 12px" />
        <button class="btn btn-primary" type="submit">Create group</button>
      </form>
    </div>
    <div class="grid grid-2">
      ${groups.length ? groups.map((g) => `
        <div class="player-card">
          <p class="player-name">${escapeHtml(g.name)}</p>
          <p class="player-meta">${g.memberIds.length} member${g.memberIds.length === 1 ? "" : "s"}</p>
          <div class="player-card-actions">
            <button class="btn btn-secondary btn-sm" data-open-group="${g.id}">Open</button>
          </div>
        </div>`).join("") : `<div class="empty-state">No groups yet — create one above.</div>`}
    </div>
    <div id="group-detail"></div>
  `;

  document.getElementById("new-group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-group-name").value.trim();
    if (!name) return;
    try {
      await Api.post("/groups", { name });
      toast("Group created.");
      renderGroups();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.querySelectorAll("[data-open-group]").forEach((b) =>
    b.addEventListener("click", () => openGroupDetail(b.dataset.openGroup))
  );
}

async function openGroupDetail(groupId) {
  const [{ group, members }, { friends }] = await Promise.all([
    Api.get(`/groups/${groupId}`),
    Api.get("/friends"),
  ]);
  const memberIds = new Set(members.map((m) => m.id));
  const invitableFriends = friends.filter((f) => !memberIds.has(f.id));

  const detail = document.getElementById("group-detail");
  detail.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${escapeHtml(group.name)}</h3>
      <p style="color:var(--ink-soft);font-size:13px">Members: ${members.map((m) => escapeHtml(m.name)).join(", ")}</p>

      <form id="invite-form" style="display:flex;gap:8px;margin:14px 0">
        <select id="invite-friend-select" style="flex:1;border:1.5px solid var(--line);border-radius:6px;padding:8px 10px">
          ${invitableFriends.length
            ? `<option value="">Select a friend to invite…</option>${invitableFriends.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("")}`
            : `<option value="">No friends left to invite</option>`}
        </select>
        <button class="btn btn-secondary btn-sm" type="submit" ${invitableFriends.length ? "" : "disabled"}>Invite</button>
      </form>
      ${invitableFriends.length === 0 ? `<p style="font-size:12px;color:var(--ink-soft);margin-top:-8px">All your friends are already in this group, or you haven't added any yet — add some from Find Players/Find Friends first.</p>` : ""}

      <div class="net-divider"></div>
      <div id="group-messages" style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
        ${group.messages.map((m) => `<div><strong>${escapeHtml(m.fromName)}:</strong> ${escapeHtml(m.text)}</div>`).join("") || `<p style="color:var(--ink-soft)">No messages yet.</p>`}
      </div>
      <form id="group-msg-form" style="display:flex;gap:8px;margin-top:10px">
        <input type="text" id="group-msg-input" placeholder="Message the group…" style="flex:1;border:1.5px solid var(--line);border-radius:20px;padding:8px 14px" />
        <button class="btn btn-primary btn-sm" type="submit">Send</button>
      </form>
    </div>`;

  document.getElementById("invite-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = document.getElementById("invite-friend-select").value;
    if (!userId) return;
    try {
      await Api.post(`/groups/${groupId}/invite`, { userId: Number(userId) });
      toast("Friend invited to the group.");
      openGroupDetail(groupId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("group-msg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = document.getElementById("group-msg-input").value.trim();
    if (!text) return;
    try {
      await Api.post(`/groups/${groupId}/message`, { text });
      openGroupDetail(groupId);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------------------------------------------------------
// Messages
// ---------------------------------------------------------------
async function renderMessages() {
  const { friends } = await Api.get("/friends");
  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Messages</h1>
      <p>Chat with your friends to line up the details.</p>
    </div>
    <div class="grid" style="grid-template-columns: 240px 1fr; align-items:start">
      <div class="card thread-list">
        ${friends.length ? friends.map((f) => `<button class="thread-item" data-thread="${f.id}" style="border:none;background:none;text-align:left;width:100%">${escapeHtml(f.name)}</button>`).join("") : `<p style="color:var(--ink-soft);font-size:13px">Add friends to start messaging.</p>`}
      </div>
      <div id="chat-area" class="empty-state">Select a friend to start chatting.</div>
    </div>
  `;
  document.querySelectorAll("[data-thread]").forEach((b) =>
    b.addEventListener("click", () => openChat(b.dataset.thread, b.textContent))
  );
}

async function openChat(userId, name) {
  const area = document.getElementById("chat-area");
  area.className = "chat-window";
  area.innerHTML = `
    <div class="chat-messages" id="chat-messages"></div>
    <form id="chat-form" class="chat-input-row">
      <input type="text" id="chat-input" placeholder="Message ${escapeHtml(name)}…" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Send</button>
    </form>
  `;
  await loadChatMessages(userId);
  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await Api.post(`/messages/${userId}`, { text });
      await loadChatMessages(userId);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function loadChatMessages(userId) {
  const { messages } = await Api.get(`/messages/${userId}`);
  const box = document.getElementById("chat-messages");
  box.innerHTML = messages.map((m) => `
    <div class="msg-bubble ${m.fromId === state.user.id ? "mine" : "theirs"}">${escapeHtml(m.text)}</div>
  `).join("") || `<p style="color:var(--ink-soft)">Say hello 👋</p>`;
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------
// Profile
// ---------------------------------------------------------------
async function renderProfile() {
  const { user } = await Api.get("/profile/me");
  state.user = user;

  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Your Profile</h1>
      <p>Other players see this when deciding whether to request a hit.</p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Basics</h3>
      <form id="profile-form" class="form-grid">
        <label>Name <input name="name" value="${escapeHtml(user.name)}" /></label>
        <label>ZIP code <input name="zip" value="${escapeHtml(user.zip || "")}" /></label>
        <label>Location <input name="location" value="${escapeHtml(user.location || "")}" placeholder="e.g. Dallas, TX" /></label>
        <label>Gender
          <select name="gender">
            ${["", "Male", "Female"].map((v) => `<option value="${v}" ${user.gender === v ? "selected" : ""}>${v || "Prefer not to say"}</option>`).join("")}
          </select>
        </label>
        <label>Handedness
          <select name="handedness">
            ${["", "Right", "Left"].map((v) => `<option ${user.handedness === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label>UTR <input name="utr" type="number" step="0.1" value="${user.utr ?? ""}" /></label>
        <label>USTA rating
          <select name="usta">
            ${["", "2.5","3.0","3.5","4.0","4.5","5.0","5.5"].map((v) => `<option ${user.usta === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label>Preferred surface
          <select name="surface">
            ${["", "Hard","Clay","Grass","Indoor"].map((v) => `<option value="${v}" ${user.surface === v ? "selected" : ""}>${v || "Any surface"}</option>`).join("")}
          </select>
        </label>
        <label>Playing style <input name="style" value="${escapeHtml(user.style || "")}" placeholder="e.g. Aggressive baseliner" /></label>
        <label class="full">Bio <textarea name="bio" placeholder="Tennis background, goals, what you enjoy about the game…">${escapeHtml(user.bio || "")}</textarea></label>
        <div class="full"><button class="btn btn-primary" type="submit">Save profile</button></div>
      </form>
    </div>

    <div class="card" id="availability-section">
      <h3 style="margin-top:0">Availability</h3>
      <p style="color:var(--ink-soft);font-size:13px;margin-top:-6px">
        A time you add only applies to <strong>that specific week</strong> — it won't carry over to other weeks.
        Use the week navigation below to add different times for different weeks.
      </p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0">
        <button type="button" class="btn btn-ghost btn-sm" id="avail-prev-week" ${profileWeekOffset <= 0 ? "disabled" : ""}>← Previous week</button>
        <span style="font-weight:700;font-size:13.5px;color:var(--court-green-dark)">
          Week of ${fmtMonthDay(getCurrentWeekDates(profileWeekOffset)[0])} – ${fmtMonthDay(getCurrentWeekDates(profileWeekOffset)[6])}
          ${profileWeekOffset === 0 ? "(this week)" : profileWeekOffset === 1 ? "(next week)" : ""}
        </span>
        <button type="button" class="btn btn-ghost btn-sm" id="avail-next-week">Next week →</button>
        ${profileWeekOffset !== 0 ? `<button type="button" class="btn btn-ghost btn-sm" id="avail-today-week">Back to this week</button>` : ""}
      </div>
      <label style="display:flex;align-items:center;gap:8px;background:var(--chalk);padding:12px;border-radius:8px;margin-bottom:14px;cursor:pointer">
        <input type="checkbox" id="avail-all-times" ${isAvailableAllTimes(user.availability) ? "checked" : ""} style="width:auto" />
        <span style="font-size:13.5px;font-weight:600">Available at all times, every week (see everyone in Find Players)</span>
      </label>
      ${DAYS.map((day, i) => {
        const weekDate = toISODate(getCurrentWeekDates(profileWeekOffset)[i]);
        const dateLabel = fmtMonthDay(getCurrentWeekDates(profileWeekOffset)[i]);
        // Show blocks for this weekday that belong to the week currently
        // being viewed (plus any legacy always-on blocks from before this
        // was one-time-by-default, so nothing older silently disappears).
        const blocks = (user.availability || []).filter(
          (a) => a.day === day && (a.recurring !== false || a.date === weekDate)
        );
        return `
        <div class="avail-day-row">
          <div class="avail-day-name">${day}<span class="avail-day-date">${dateLabel}</span></div>
          <div class="avail-chips">
            ${blocks.map((b) => {
              const isRecurring = b.recurring !== false;
              return `
              <span class="avail-chip ${isRecurring ? "recurring" : ""}">
                ${fmtTime12(b.start)} – ${fmtTime12(b.end)}
                <button type="button" class="chip-remove" data-remove-day="${day}" data-remove-start="${b.start}" data-remove-end="${b.end}" data-remove-recurring="${isRecurring}" data-remove-date="${b.date || ""}" aria-label="Remove time">✕</button>
              </span>`;
            }).join("")}
            <button type="button" class="btn btn-ghost btn-sm avail-add-btn" data-add-day="${day}">+ Add time</button>
          </div>
          <div class="avail-add-form hidden" id="add-form-${day}">
            <input type="time" class="avail-start" value="09:00" />
            <span>to</span>
            <input type="time" class="avail-end" value="11:00" />
            <button type="button" class="btn btn-primary btn-sm" data-confirm-day="${day}">Add</button>
            <button type="button" class="btn btn-ghost btn-sm" data-cancel-day="${day}">Cancel</button>
          </div>
        </div>`;
      }).join("")}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Paid hits</h3>
      <form id="paid-hits-form" class="form-grid">
        <label style="flex-direction:row;align-items:center;gap:8px" class="full">
          <input type="checkbox" name="enabled" ${user.paidHits?.enabled ? "checked" : ""} style="width:auto" /> Offer paid hitting sessions
        </label>
        <label>Hourly rate ($) <input type="number" name="rate" value="${user.paidHits?.rate ?? ""}" /></label>
        <label>Payment method <input name="method" value="${escapeHtml(user.paidHits?.method || "")}" placeholder="Venmo, Zelle, cash…" /></label>
        <div class="full"><button class="btn btn-secondary" type="submit">Save</button></div>
      </form>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:0">We only show your rate and method to interested players — never card numbers or bank details.</p>
    </div>
  `;

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (payload.utr === "") payload.utr = null; else payload.utr = Number(payload.utr);
    try {
      await Api.put("/profile/me", payload);
      toast("Profile saved.");
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("avail-prev-week").addEventListener("click", () => {
    profileWeekOffset = Math.max(0, profileWeekOffset - 1);
    renderProfile();
  });
  document.getElementById("avail-next-week").addEventListener("click", () => {
    profileWeekOffset += 1;
    renderProfile();
  });
  const todayWeekBtn = document.getElementById("avail-today-week");
  if (todayWeekBtn) {
    todayWeekBtn.addEventListener("click", () => {
      profileWeekOffset = 0;
      renderProfile();
    });
  }

  document.getElementById("avail-all-times").addEventListener("change", async (e) => {
    const availability = e.target.checked ? allTimesAvailability() : [];
    try {
      const { user: updated } = await Api.put("/profile/me/availability", { availability });
      state.user = updated;
      toast(e.target.checked ? "You're now available at all times." : "Availability cleared.");
      renderProfile();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.querySelectorAll("[data-add-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".avail-add-form").forEach((f) => f.classList.add("hidden"));
      document.getElementById(`add-form-${btn.dataset.addDay}`).classList.remove("hidden");
    });
  });
  document.querySelectorAll("[data-cancel-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`add-form-${btn.dataset.cancelDay}`).classList.add("hidden");
    });
  });
  document.querySelectorAll("[data-confirm-day]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const day = btn.dataset.confirmDay;
      const dayIndex = DAYS.indexOf(day);
      const form = document.getElementById(`add-form-${day}`);
      const start = form.querySelector(".avail-start").value;
      const end = form.querySelector(".avail-end").value;
      if (!start || !end) return toast("Pick a start and end time.", true);
      if (start >= end) return toast("End time must be after start time.", true);
      const newBlock = { day, start, end, recurring: false, date: toISODate(getCurrentWeekDates(profileWeekOffset)[dayIndex]) };
      const availability = [...(state.user.availability || []), newBlock];
      try {
        const { user: updated } = await Api.put("/profile/me/availability", { availability });
        state.user = updated;
        toast("Added for this week.");
        window.dispatchEvent(new CustomEvent("tutorial:notify", { detail: "action:availability-added" }));
        renderProfile();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
  document.querySelectorAll("[data-remove-day]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { removeDay, removeStart, removeEnd, removeRecurring, removeDate } = btn.dataset;
      const wasRecurring = removeRecurring === "true";
      const availability = (state.user.availability || []).filter((a) => {
        const aRecurring = a.recurring !== false;
        const sameCore = a.day === removeDay && a.start === removeStart && a.end === removeEnd;
        if (!sameCore) return true;
        if (wasRecurring) return !aRecurring; // keep everything except the matching recurring one
        return !(!aRecurring && (a.date || "") === removeDate); // keep everything except the matching one-time one
      });
      try {
        const { user: updated } = await Api.put("/profile/me/availability", { availability });
        state.user = updated;
        toast("Availability updated.");
        renderProfile();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  document.getElementById("paid-hits-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await Api.put("/profile/me/paid-hits", {
        enabled: fd.get("enabled") === "on",
        rate: fd.get("rate"),
        method: fd.get("method"),
      });
      toast("Paid hits settings saved.");
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
window.addEventListener("tutorial:notify", (e) => Tutorial.notify(e.detail));

document.addEventListener("DOMContentLoaded", async () => {
  initAuthScreen();
  initShell();
  Tutorial.init();

  if (Api.hasToken()) {
    try {
      const { user } = await Api.get("/profile/me");
      await boot(user);
      return;
    } catch (e) {
      Api.clearToken();
    }
  }
  showAuthScreen();
});
