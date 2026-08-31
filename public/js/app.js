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

// A small set of on-brand colors to cycle through for avatar backgrounds,
// picked deterministically from the name so the same person always gets
// the same color.
const AVATAR_PALETTE = ["#4F46E5", "#334155", "#6366F1", "#475569", "#4338CA", "#64748B"];
function initials(name) {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}
function avatarColor(name) {
  let hash = 0;
  for (const ch of name || "?") hash = (hash * 31 + ch.charCodeAt(0)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
function starsHtml(avgRating, ratingCount) {
  if (!ratingCount) return "";
  return `<span style="color:#FFC72C;font-size:12px;font-weight:700;white-space:nowrap">★ ${avgRating.toFixed(1)}</span>`;
}

function avatarHtml(name, size = 40, avatarUrl) {
  if (avatarUrl) {
    return `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" style="width:${size}px;height:${size}px;object-fit:cover" />`;
  }
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:${avatarColor(name)}">${escapeHtml(initials(name))}</span>`;
}

// Resizes and compresses a picked image file client-side (down to at most
// maxDim x maxDim, JPEG) before it ever gets sent to the server — keeps
// profile photos to a reasonable size (a few dozen KB) regardless of how
// large the original camera photo was.
function resizeImageToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
function initAuthScreen() {
  document.getElementById("landing-login-btn").addEventListener("click", () => showAuthScreen("login"));
  document.getElementById("landing-signup-btn").addEventListener("click", () => showAuthScreen("signup"));
  document.getElementById("auth-back-to-landing").addEventListener("click", () => showLandingScreen());

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
        phone: fd.get("phone"),
        password: fd.get("password"),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

function showLandingScreen() {
  renderLandingScreen();
  document.getElementById("landing-screen").classList.remove("hidden");
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.add("hidden");
}

function showAuthScreen(tab) {
  document.getElementById("landing-screen").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-shell").classList.add("hidden");
  if (tab) {
    const tabBtn = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
    if (tabBtn) tabBtn.click();
  }
}

function isProfileIncomplete(user) {
  return !user.dob || !user.phone;
}

function unlockProfileIfComplete() {
  if (state.profileLocked && !isProfileIncomplete(state.user)) {
    state.profileLocked = false;
    if (!state.user.tutorialSeen) {
      toast("Profile complete — let's show you around!");
      renderProfile();
      setTimeout(() => Tutorial.start(), 500);
    } else {
      toast("Profile complete — you're all set!");
      renderProfile();
    }
  }
}

async function boot(user) {
  state.user = user;
  state.profileLocked = isProfileIncomplete(user);
  document.getElementById("landing-screen").classList.add("hidden");
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  await refreshNotifications();
  if (!user.tutorialSeen && !state.profileLocked) {
    // Already complete (rare, but possible for a re-imported account) —
    // go straight into the tutorial.
    navigate("profile");
    setTimeout(() => Tutorial.start(), 500);
  } else if (state.profileLocked) {
    // Covers both new signups (missing DOB) and existing incomplete
    // accounts — the tutorial itself starts once they finish this, via
    // unlockProfileIfComplete().
    navigate("profile");
    if (user.tutorialSeen) toast("Please finish setting up your profile to continue.");
  } else {
    navigate("dashboard");
  }
  maybeShowLocationConsent();
  // Once someone has granted GPS access, track their position continuously
  // in the background while the app is open — like Snapchat's Snap Map —
  // instead of only checking once per visit.
  if (localStorage.getItem(`hitsync_gps_enabled_${user.id}`)) {
    startLocationWatch();
  }
  syncTimezone();
}

// Detects the device's actual timezone and saves it silently — no
// selection needed from the user, ever. Runs on every boot so it (a) fixes
// accounts that predate this feature entirely, since they'd otherwise have
// no timezone saved at all and fall back to the server's UTC clock, and
// (b) keeps it current automatically if someone travels.
async function syncTimezone() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== state.user.timezone) {
      const { user: updated } = await Api.put("/profile/me", { timezone: detected });
      state.user = updated;
      if (state.page === "profile") renderProfile();
      if (state.page === "availability") renderAvailability();
    }
  } catch (e) { /* non-critical — worst case, availability pruning falls back to server UTC */ }
}

// Shown once per account, the first time someone lands in the app (new
// signup or an existing account that hasn't seen it yet) — explains that
// location is detected automatically from IP address, and lets them opt
// out. Purely a transparency/consent step: the detection itself already
// happened silently on login/signup; declining here just clears it.
// Requests real GPS from the browser (with permission) and saves it —
// far more accurate than IP, especially while traveling, since IP location
// often resolves to a carrier hub or home billing address instead of
// wherever the device actually is right now. `onDone` re-renders whatever
// screen called this once it finishes.
// Resolves GPS coordinates to a city/state name directly in the browser
// (BigDataCloud's free reverse-geocoding endpoint — no key needed, and
// built specifically for client-side use, so it isn't subject to the same
// rate-limiting a shared server IP can run into). Returns "" on any
// failure rather than throwing — a missing city name shouldn't block
// saving the coordinates themselves.
async function resolveCityFromCoords(lat, lng) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    );
    if (!res.ok) return "";
    const json = await res.json();
    const city = json.city || json.locality || "";
    const state = json.principalSubdivisionCode ? json.principalSubdivisionCode.split("-").pop() : (json.principalSubdivision || "");
    return [city, state].filter(Boolean).join(", ");
  } catch (e) {
    console.warn("resolveCityFromCoords failed:", e.message);
    return "";
  }
}

function updateLocationFromGps(onDone, silent) {
  if (!navigator.geolocation) {
    if (!silent) toast("Location isn't supported in this browser.", true);
    return;
  }
  if (!silent) toast("Getting your current location…");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const location = await resolveCityFromCoords(latitude, longitude);
      try {
        const { user: updated } = await Api.put("/profile/me/live-location", { lat: latitude, lng: longitude, location });
        state.user = updated;
        if (!silent) toast(updated.location ? `Location updated to ${updated.location}.` : "Location updated.");
        if (onDone) onDone();
      } catch (err) {
        if (!silent) toast(err.message, true);
      }
    },
    (err) => {
      if (silent) return; // background refresh failing quietly is fine — IP-based location is still there as a baseline
      if (err.code === err.PERMISSION_DENIED) {
        toast("Location permission denied — check your browser/phone settings to allow it for this site.", true);
      } else {
        toast("Couldn't get your location. Try again in a moment.", true);
      }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Continuous background tracking, like Snapchat's Snap Map — while the app
// is open, the browser watches your position and this updates the server
// automatically as you move, no manual re-check needed. Throttled so it
// isn't hammering the server (and the reverse-geocoding API) on every tiny
// GPS jitter: only actually pushes an update if you've moved a meaningful
// distance or enough time has passed since the last one.
let locationWatchId = null;
let lastTrackedFix = null; // { lat, lng, at }

function startLocationWatch() {
  if (!navigator.geolocation || locationWatchId !== null) return; // already running, or unsupported
  const actuallyStart = () => {
    locationWatchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const now = Date.now();
        if (lastTrackedFix) {
          const movedMiles = haversineMilesClient(lastTrackedFix.lat, lastTrackedFix.lng, latitude, longitude);
          const minutesSinceLast = (now - lastTrackedFix.at) / 60000;
          // Skip this update unless they've moved a meaningful amount, or a
          // few minutes have passed anyway (keeps it fresh even if idle).
          if (movedMiles < 0.2 && minutesSinceLast < 3) return;
        }
        lastTrackedFix = { lat: latitude, lng: longitude, at: now };
        const location = await resolveCityFromCoords(latitude, longitude);
        try {
          const { user: updated } = await Api.put("/profile/me/live-location", { lat: latitude, lng: longitude, location });
          state.user = updated;
          if (state.page === "profile") renderProfile();
        } catch (e) { /* background update — fail silently */ }
      },
      () => { /* background — a denied/failed watch just means tracking stays off, no need to alert */ },
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
  };

  // Only auto-start silently if the browser confirms permission is already
  // truly granted — otherwise calling watchPosition here would trigger a
  // fresh native "Allow location?" prompt on every single login, which is
  // exactly the annoying repeat-prompt bug this is fixing. If permission
  // isn't already granted, we simply don't auto-start; the person can
  // still turn it on explicitly from Profile whenever they want.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then((status) => {
      if (status.state === "granted") actuallyStart();
    }).catch(() => actuallyStart()); // Permissions API not supported here — fall back to the old behavior
  } else {
    actuallyStart();
  }
}

function stopLocationWatch() {
  if (locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
  }
  locationWatchId = null;
  lastTrackedFix = null;
}

function haversineMilesClient(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function maybeShowLocationConsent() {
  if (!state.user) return;
  const key = `hitsync_location_consent_seen_${state.user.id}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  sessionStorage.setItem("hitsync_skip_reminder_once", "1"); // don't also pop the daily reminder on top of this

  setTimeout(() => {
    showModal(`
      <div class="card" style="max-width:380px;margin:0 auto">
        <h3 style="margin-top:0">Allow location?</h3>
        <p style="color:var(--ink-soft);font-size:14px">
          Hit Sync uses your location to show accurate distances to other players.
        </p>
        <p style="color:var(--ink-soft);font-size:12px">This information is protected — it's never shown to other players, only your distance in miles is.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-ghost" id="location-consent-decline">Not now</button>
          <button class="btn btn-primary" id="location-consent-gps">Allow location</button>
        </div>
        <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px">
          <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px">Can't or don't want to share GPS? Use your zip code instead:</p>
          <div style="display:flex;gap:6px">
            <input type="text" id="location-consent-zip" placeholder="e.g. 75201" maxlength="10" style="flex:1;border:1.5px solid var(--line);border-radius:6px;padding:8px 10px;font-size:13px" />
            <button class="btn btn-secondary btn-sm" id="location-consent-zip-submit">Use zip</button>
          </div>
        </div>
      </div>`, true);
    document.getElementById("location-consent-gps").addEventListener("click", () => {
      localStorage.setItem(`hitsync_gps_enabled_${state.user.id}`, "1");
      updateLocationFromGps(() => closeModal());
      startLocationWatch();
    });
    document.getElementById("location-consent-decline").addEventListener("click", async () => {
      try {
        const { user: updated } = await Api.put("/profile/me/location-consent", { accepted: false });
        state.user = updated;
        toast("Location is off — you can turn it on anytime from Profile.");
      } catch (e) {
        toast(e.message, true);
      }
      closeModal();
    });
    document.getElementById("location-consent-zip-submit").addEventListener("click", async () => {
      const zip = document.getElementById("location-consent-zip").value.trim();
      if (!zip) { toast("Enter a zip code first.", true); return; }
      try {
        const { user: updated } = await Api.put("/profile/me/zip-location", { zip });
        state.user = updated;
        toast(updated.location ? `Location set to ${updated.location}.` : "Location set.");
        closeModal();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }, 500);
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
    if (!confirm("Log out of Hit Sync?")) return;
    stopLocationWatch();
    Api.clearToken();
    state.user = null;
    knownNotifIds = null;
    showLandingScreen();
  });

  document.getElementById("notif-bell").addEventListener("click", toggleNotifPanel);
  document.getElementById("brand-home-link").addEventListener("click", () => navigate("home"));
  document.getElementById("app-about-btn").addEventListener("click", () => navigate("about"));
}

function closeMobileNav() {
  document.getElementById("side-nav").classList.remove("open");
  document.getElementById("nav-scrim").classList.add("hidden");
}

function navigate(page) {
  // Hard gate: while DOB/phone are missing, every nav attempt bounces back
  // to Profile — this is what "forces" completion instead of just
  // suggesting it.
  if (state.profileLocked && page !== "profile") {
    toast("Please add your date of birth and phone number to continue.", true);
    page = "profile";
  }
  state.page = page;
  if (page === "profile" || page === "availability") profileWeekOffset = 0;
  closeMobileNav();
  document.querySelectorAll(".nav-link[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  render();
  window.dispatchEvent(new CustomEvent("tutorial:notify", { detail: `page:${page}` }));
}

let knownNotifIds = null; // null = haven't checked yet (first load shouldn't toast anything)

async function refreshNotifications() {
  try {
    const { notifications } = await Api.get("/notifications");
    state.notifications = notifications;
    const unread = notifications.filter((n) => !n.read).length;
    const badge = document.getElementById("notif-count");
    badge.textContent = unread;
    badge.classList.toggle("hidden", unread === 0);

    // Pop a toast for anything genuinely new since the last check — this is
    // what makes something like "they cancelled the hit" actually visible
    // in the moment, instead of silently sitting unread in the bell until
    // you happen to click it.
    if (knownNotifIds === null) {
      knownNotifIds = new Set(notifications.map((n) => n.id));
    } else {
      const freshOnes = notifications.filter((n) => !knownNotifIds.has(n.id));
      freshOnes.forEach((n) => knownNotifIds.add(n.id));
      // Newest first in the API response — show oldest-of-the-new-batch
      // last so the most recent ends up the most visible toast.
      freshOnes.slice().reverse().forEach((n) => toast(n.message));
    }
  } catch (e) {
    // not fatal
  }
}

// Poll periodically so notifications from other people's actions (someone
// cancelling a hit, accepting a friend request, etc.) actually show up
// while you're sitting on a page, not just after your own next action.
setInterval(() => {
  if (state.user) refreshNotifications();
}, 30000);

function navigateFromNotification(n) {
  const pageByType = {
    friend_request: "friends",
    rating: "profile",
    hit_request: "dashboard",
    hit_accepted: "dashboard",
    hit_declined: "dashboard",
    hit_cancelled: "dashboard",
    hit_finished: "dashboard",
    hit_edit_proposed: "dashboard",
    hit_edit_declined: "dashboard",
    hit_edit_confirmed: "dashboard",
    group_invite: "messages",
    message: "messages",
  };
  navigate(pageByType[n.type] || "dashboard");
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
  const header = `<div class="notif-panel-header"><span>Notifications</span></div>`;
  if (state.notifications.length === 0) {
    panel.innerHTML = `${header}<div class="notif-item">You're all caught up — no notifications yet.</div>`;
  } else {
    panel.innerHTML = header + state.notifications
      .map(
        (n) => `
      <div class="notif-item ${n.read ? "" : "unread"}" data-id="${n.id}">
        <span class="notif-icon"><svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.2c-.66 0-1.2.54-1.2 1.2v.62C7.5 4.7 5.6 7.3 5.6 10.6v3.5c0 1.05-.42 2.05-1.16 2.79l-.55.55c-.66.66-.19 1.79.74 1.79h14.74c.93 0 1.4-1.13.74-1.79l-.55-.55a3.95 3.95 0 0 1-1.16-2.79v-3.5c0-3.3-1.9-5.9-5.2-6.58v-.62c0-.66-.54-1.2-1.2-1.2z" fill="#FFC72C" stroke="#1B1A2E" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.1 19.9a2.9 2.9 0 0 0 5.8 0" fill="none" stroke="#1B1A2E" stroke-width="1.5" stroke-linecap="round"/></svg></span>
        <div>
          <div>${escapeHtml(n.message)}</div>
          <div class="notif-time">${timeAgo(n.createdAt)}</div>
        </div>
      </div>`
      )
      .join("");
  }
  document.body.appendChild(panel);
  panel.querySelectorAll(".notif-item[data-id]").forEach((item) => {
    item.addEventListener("click", async () => {
      const id = item.dataset.id;
      const notif = state.notifications.find((n) => String(n.id) === String(id));
      await Api.post(`/notifications/${id}/read`);
      await refreshNotifications();
      panel.remove();
      if (notif) navigateFromNotification(notif);
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
      case "find-hits": return renderFindHits();
      case "find-paid-hits": return renderFindPaidHits();
      case "friends": return renderFriends();
      case "calendar": return renderCalendar();
      case "messages": return renderMessages();
      case "profile": return renderProfile();
      case "availability": return renderAvailability();
      case "home": return renderHome();
      case "about": return renderAboutPageInApp();
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
  if (sessionStorage.getItem("hitsync_skip_reminder_once")) {
    sessionStorage.removeItem("hitsync_skip_reminder_once");
    return;
  }
  const key = `hitsync_last_reminder_${state.user.id}`;
  const today = new Date().toDateString();
  if (localStorage.getItem(key) === today) return;
  localStorage.setItem(key, today);

  showModal(`
    <div class="card" style="max-width:380px;margin:0 auto">
      <h3 style="margin-top:0">Quick reminder</h3>
      <p style="color:var(--ink-soft);font-size:14px">
        Keep your profile up to date — especially your <strong>availability</strong> — so other players see an accurate
        match. Also worth double-checking your UTR is updated.
      </p>
      <div style="display:flex;gap:6px;margin-top:16px">
        <button class="btn btn-ghost" id="reminder-avail" style="font-size:13.5px;padding:8px 12px;min-height:unset;flex:1">Availability</button>
        <button class="btn btn-primary" id="reminder-profile" style="font-size:13.5px;padding:8px 12px;min-height:unset;flex:1">Profile</button>
        <button class="btn btn-ghost" id="reminder-dismiss" style="font-size:13.5px;padding:8px 12px;min-height:unset;flex:0 0 auto">Maybe later</button>
      </div>
    </div>`);
  document.getElementById("reminder-dismiss").addEventListener("click", closeModal);
  document.getElementById("reminder-avail").addEventListener("click", () => {
    closeModal();
    navigate("availability");
  });
  document.getElementById("reminder-profile").addEventListener("click", () => {
    closeModal();
    navigate("profile");
  });
}

async function renderDashboard() {
  const [{ hits }, { requests: friendReqs } = { requests: [] }, { friends } = { friends: [] }] = await Promise.all([
    Api.get("/hits"),
    Api.get("/friends/requests").then((r) => ({ requests: r.incoming })).catch(() => ({ requests: [] })),
    Api.get("/friends").catch(() => ({ friends: [] })),
  ]);
  const upcoming = hits.filter((h) => h.status === "accepted").slice(0, 5);
  const pending = hits.filter((h) => h.status === "pending" && h.toIds.includes(state.user.id));
  const sentPending = hits.filter((h) => h.status === "pending" && h.fromId === state.user.id);

  pageContent().innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:14px">
      <div>
        <span class="eyebrow">Welcome back</span>
        <h1>${escapeHtml(state.user.name)} ${starsHtml(state.user.avgRating, state.user.ratingCount)}</h1>
        <p>Here's what's happening with your tennis schedule.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="dash-goto-calendar">Calendar</button>
        <button class="btn btn-ghost" id="dash-goto-availability">Set availability</button>
        <button class="btn btn-primary" id="dash-goto-find-players">Find a partner</button>
      </div>
    </div>

    <div class="stats-strip">
      <div class="stat-card">
        <div class="stat-num">${hits.filter((h) => h.status === "accepted").length}</div>
        <div class="stat-label">Upcoming hits</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${pending.length}</div>
        <div class="stat-label">Awaiting you</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${friends.length}</div>
        <div class="stat-label">Friends</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${friendReqs.length}</div>
        <div class="stat-label">Friend requests</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3 style="margin-top:0">Upcoming hits</h3>
        ${upcoming.length ? upcoming.map(hitRowHtml).join('<div class="net-divider"></div>') : `<p style="color:var(--ink-soft)">No hits on the calendar yet. Head to Find Hits to line one up.</p>`}
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
      ${friendReqs.length ? friendReqs.map((r) => {
        friendReqUserCache[r.fromUser.id] = r.fromUser;
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
          <span>${escapeHtml(r.fromUser.name)}</span>
          <span>
            <button class="btn btn-ghost btn-sm" data-view-profile-friendreq="${r.fromUser.id}">View profile</button>
            <button class="btn btn-secondary btn-sm" data-accept="${r.id}">Accept</button>
            <button class="btn btn-ghost btn-sm" data-decline="${r.id}">Decline</button>
          </span>
        </div>`;
      }).join("") : `<p style="color:var(--ink-soft)">No pending friend requests.</p>`}
    </div>
  `;

  document.getElementById("dash-goto-calendar").addEventListener("click", () => navigate("calendar"));
  document.getElementById("dash-goto-availability").addEventListener("click", () => navigate("availability"));
  document.getElementById("dash-goto-find-players").addEventListener("click", () => navigate("find-hits"));
  maybeShowDailyReminder();
  maybeOfferPendingRatings();
  maybeShowCancelledHitPrompt(hits);

  pageContent().querySelectorAll("[data-view-profile-friendreq]").forEach((b) =>
    b.addEventListener("click", () => {
      const user = friendReqUserCache[Number(b.dataset.viewProfileFriendreq)];
      if (user) showBioModal(user);
    })
  );
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
let friendReqUserCache = {};
let hitDetailsCache = {};

function hitRowHtml(h) {
  const withWho = h.fromId === state.user.id
    ? h.toUsers.map((u) => u.name).join(", ")
    : h.fromUser.name;
  const isRecipient = h.toIds.includes(state.user.id);
  const alreadyFriends = (state.user.friends || []).includes(h.fromId);
  hitDetailsCache[h.id] = h;

  // The single other person on this hit, if there is exactly one (not a
  // multi-recipient group hit) — powers View profile / Message.
  const otherUser = isRecipient ? h.fromUser : (h.toUsers.length === 1 ? h.toUsers[0] : null);
  if (otherUser) hitUserCache[otherUser.id] = otherUser;

  return `
    <div class="hit-row" data-hit="${h.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div>
          <strong>${escapeHtml(withWho)}</strong> ${otherUser ? starsHtml(otherUser.avgRating, otherUser.ratingCount) : ""}
          <div style="font-size:12.5px;color:var(--ink-soft)">${fmtDate(h.date)} · ${fmtTime12(h.startTime)}–${fmtTime12(h.endTime)}</div>
        </div>
        <span class="chip chip-${h.status}">${h.status}</span>
      </div>
      ${h.status === "cancelled" && h.cancelReason ? `<p style="font-size:12.5px;color:var(--ink-soft);margin:6px 0 0;font-style:italic">"${escapeHtml(h.cancelReason)}"</p>` : ""}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        ${h.status === "pending" && isRecipient ? `
          <button class="btn btn-secondary btn-sm" data-hit-accept="${h.id}">Accept</button>
          <button class="btn btn-ghost btn-sm" data-hit-decline="${h.id}">Decline</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-view-hit-details="${h.id}">View hit details</button>
        ${otherUser ? `
          <button class="btn btn-ghost btn-sm" data-view-profile-hit="${otherUser.id}">View profile</button>
          <button class="btn btn-ghost btn-sm" data-message-hit="${otherUser.id}" data-name="${escapeHtml(otherUser.name)}">Message</button>` : ""}
        ${h.status === "pending" && isRecipient && h.fromId !== state.user.id
          ? alreadyFriends
            ? `<button class="btn btn-ghost btn-sm" disabled>Already friends</button>`
            : `<button class="btn btn-ghost btn-sm" data-add-friend-from-hit="${h.fromId}">Add friend</button>`
          : ""}
        ${["pending", "accepted"].includes(h.status) && !h.pendingEdit
          ? `<button class="btn btn-ghost btn-sm" data-edit-hit="${h.id}">${h.status === "accepted" ? "Edit hit" : "Propose change"}</button>`
          : ""}
        ${h.status === "pending" && h.fromId === state.user.id ? `<button class="btn btn-ghost btn-sm" data-hit-cancel="${h.id}">Cancel request</button>` : ""}
        ${h.status === "accepted" ? `
          ${(h.finishedBy || []).includes(state.user.id)
            ? `<button class="btn btn-ghost btn-sm" disabled>You finished — waiting on them</button>`
            : `<button class="btn btn-secondary btn-sm" data-hit-finish="${h.id}">Finish hit</button>`}
          <button class="btn btn-ghost btn-sm" data-hit-cancel="${h.id}">Cancel</button>` : ""}
        ${h.status === "cancelled" && h.everAccepted && h.cancelledBy !== state.user.id ? `<button class="btn btn-ghost btn-sm" data-leave-review="${h.id}">Leave a review</button>` : ""}
      </div>
      ${h.pendingEdit ? pendingEditBannerHtml(h) : ""}
    </div>`;
}

function pendingEditBannerHtml(h) {
  const isProposer = h.pendingEdit.proposedBy === state.user.id;
  const proposerName = h.pendingEdit.proposedBy === h.fromId ? h.fromUser.name : (h.toUsers.find(u => u.id === h.pendingEdit.proposedBy) || {}).name || "They";
  return `
    <div class="callout callout-sage" style="margin-top:10px;margin-bottom:0">
      <h4>Change proposed by ${isProposer ? "you" : escapeHtml(proposerName)}</h4>
      <div>${editSummaryHtml(h)}</div>
      ${!isProposer ? `
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" data-edit-accept="${h.id}">Accept change</button>
          <button class="btn btn-ghost btn-sm" data-edit-decline="${h.id}">Decline</button>
        </div>` : `<p style="font-size:12px;margin-top:4px">Waiting for them to confirm.</p>`}
    </div>`;
}

function editSummaryHtml(h) {
  const c = h.pendingEdit.changes;
  const rows = [];
  const changeRow = (label, oldVal, newVal) => `
    <div style="padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.06)">
      <div style="font-size:11px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em">${label}</div>
      <div style="font-size:13px;margin-top:2px">
        <span style="color:var(--ink-soft);text-decoration:line-through">${oldVal}</span>
        <span style="margin:0 4px">→</span>
        <span style="font-weight:700;color:var(--court-green-dark)">${newVal}</span>
      </div>
    </div>`;

  if (c.date && c.date !== h.date) rows.push(changeRow("Date", fmtDate(h.date), fmtDate(c.date)));
  if ((c.startTime && c.startTime !== h.startTime) || (c.endTime && c.endTime !== h.endTime)) {
    rows.push(changeRow("Time", `${fmtTime12(h.startTime)}–${fmtTime12(h.endTime)}`, `${fmtTime12(c.startTime || h.startTime)}–${fmtTime12(c.endTime || h.endTime)}`));
  }
  if (c.court !== undefined && c.court !== h.court) {
    rows.push(changeRow("Court / location", h.court ? escapeHtml(h.court) : "(none set)", c.court ? escapeHtml(c.court) : "(none)"));
  }
  if (c.mapsLink !== undefined && c.mapsLink !== h.mapsLink) {
    const newLinkHtml = c.mapsLink
      ? `<a href="${escapeHtml(c.mapsLink)}" target="_blank" rel="noopener" style="font-weight:700">${escapeHtml(c.mapsLink)}</a>`
      : `<span style="font-weight:700;color:var(--court-green-dark)">(removed)</span>`;
    rows.push(`
      <div style="padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.06)">
        <div style="font-size:11px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em">Google Maps link</div>
        <div style="font-size:13px;margin-top:2px;word-break:break-all">${newLinkHtml}</div>
      </div>`);
  }
  if (c.message !== undefined && c.message !== h.message) {
    rows.push(changeRow("Note", h.message ? `"${escapeHtml(h.message)}"` : "(none)", c.message ? `"${escapeHtml(c.message)}"` : "(none)"));
  }
  return rows.length ? rows.join("") : `<p style="margin:0;font-size:13px">Details updated.</p>`;
}

function openEditHitModal(h) {
  const isPending = h.status === "pending";
  showModal(`
    <div class="card" style="max-width:420px;margin:0 auto">
      <h3 style="margin-top:0">${isPending ? "Propose change" : "Edit hit"}</h3>
      <p style="color:var(--ink-soft);font-size:13px;margin-top:-6px">
        ${isPending ? "They'll need to confirm this before the hit request can be accepted." : "The other player will need to confirm this change before it takes effect."}
      </p>
      <form id="edit-hit-form" class="form-stack">
        <label>Date <input type="date" name="date" value="${h.date}" min="${toISODate(new Date())}" required /></label>
        <label>Start time <input type="time" name="startTime" value="${h.startTime}" required /></label>
        <label>End time <input type="time" name="endTime" value="${h.endTime}" required /></label>
        <label>Court / location <input type="text" name="court" value="${escapeHtml(h.court || "")}" placeholder="e.g. Burleson Park, Court 3" /></label>
        <label>Google Maps link <input type="url" name="mapsLink" value="${escapeHtml(h.mapsLink || "")}" placeholder="https://maps.google.com/…" /></label>
        <label>Note <textarea name="message" placeholder="Optional note">${escapeHtml(h.message || "")}</textarea></label>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
          <button type="button" class="btn btn-ghost" id="edit-hit-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Propose change</button>
        </div>
      </form>
    </div>`);
  document.getElementById("edit-hit-cancel").addEventListener("click", closeModal);
  document.getElementById("edit-hit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await Api.post(`/hits/${h.id}/propose-edit`, payload);
      toast("Change proposed — waiting for them to confirm.");
      closeModal();
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function showHitDetailsModal(h) {
  const withWho = h.fromId === state.user.id
    ? h.toUsers.map((u) => u.name).join(", ")
    : h.fromUser.name;
  const allParticipants = [h.fromUser, ...h.toUsers];
  const infoRow = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--line)">
      <span style="color:var(--ink-soft);font-size:13px">${label}</span>
      <span style="font-weight:600;font-size:13.5px;text-align:right">${value}</span>
    </div>`;

  showModal(`
    <div class="card" style="max-width:440px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
          ${allParticipants.slice(0, 3).map((u, i) => `<span style="margin-left:${i > 0 ? "-14px" : "0"};border:2px solid var(--chalk-panel);border-radius:50%;display:inline-flex;flex-shrink:0">${avatarHtml(u.name, 40, u.avatarUrl)}</span>`).join("")}
          <div style="min-width:0">
            <p style="margin:0;font-weight:700;font-size:16px;overflow-wrap:break-word">Hit with ${escapeHtml(withWho)}</p>
            <p style="margin:2px 0 0;font-size:12.5px;color:var(--ink-soft)">${fmtDate(h.date)}</p>
          </div>
        </div>
        <span class="chip chip-${h.status}" style="flex-shrink:0">${h.status}</span>
      </div>

      <div style="background:var(--chalk);border-radius:12px;padding:4px 14px;margin-bottom:14px">
        ${infoRow("Booked by", escapeHtml(h.fromUser.name) + (h.fromId === state.user.id ? " (you)" : ""))}
        ${infoRow("Participants", escapeHtml(allParticipants.map(u => u.name).join(", ")))}
        ${infoRow("Time", `${fmtTime12(h.startTime)} – ${fmtTime12(h.endTime)}`)}
        ${infoRow("Format", escapeHtml(h.format))}
        ${infoRow("Court / location", h.court ? escapeHtml(h.court) : `<span style="color:var(--ink-soft);font-weight:500">Not specified yet</span>`)}
        ${infoRow("Court booked", h.courtBooked
          ? `<span style="color:var(--court-green-dark)">Yes</span>`
          : `<span style="color:var(--ink-soft);font-weight:500">Not yet</span>`)}
        ${h.paid ? infoRow("Paid hit", `$${h.paidRate}/hr${h.paidMethod ? ` · ${escapeHtml(h.paidMethod)}` : ""}`) : ""}
      </div>

      ${h.mapsLink ? `<a href="${escapeHtml(h.mapsLink)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="width:100%;margin-bottom:12px">View court on Google Maps →</a>` : ""}

      ${h.message ? `
        <div style="background:var(--ball);border-radius:12px;padding:12px 14px;margin-bottom:12px">
          <p style="margin:0;font-size:11px;font-weight:700;color:var(--court-green-dark);text-transform:uppercase;letter-spacing:0.03em">Note</p>
          <p style="margin:4px 0 0;font-style:italic;font-size:13.5px">"${escapeHtml(h.message)}"</p>
        </div>` : ""}

      <p style="margin:4px 0 0;font-size:11.5px;color:var(--ink-soft)">Requested ${timeAgo(h.createdAt)}${h.finishedAt ? ` · Finished ${timeAgo(h.finishedAt)}` : ""}</p>

      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" id="hit-details-close">Close</button>
      </div>
    </div>`);
  document.getElementById("hit-details-close").addEventListener("click", closeModal);
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
  pageContent().querySelectorAll("[data-view-hit-details]").forEach((b) =>
    b.addEventListener("click", () => {
      const hit = hitDetailsCache[Number(b.dataset.viewHitDetails)];
      if (hit) showHitDetailsModal(hit);
    })
  );
  pageContent().querySelectorAll("[data-edit-hit]").forEach((b) =>
    b.addEventListener("click", () => {
      const hit = hitDetailsCache[Number(b.dataset.editHit)];
      if (hit) openEditHitModal(hit);
    })
  );
  pageContent().querySelectorAll("[data-edit-accept]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await Api.post(`/hits/${b.dataset.editAccept}/respond-edit`, { accept: true });
        toast("Change confirmed.");
        render();
        refreshNotifications();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  pageContent().querySelectorAll("[data-edit-decline]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await Api.post(`/hits/${b.dataset.editDecline}/respond-edit`, { accept: false });
        toast("Change declined.");
        render();
        refreshNotifications();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  pageContent().querySelectorAll("[data-hit-finish]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        const hitId = Number(b.dataset.hitFinish);
        await Api.post(`/hits/${hitId}/finish`);
        toast("Hit marked as finished.");
        render();
        refreshNotifications();
        const hit = hitDetailsCache[hitId];
        if (hit) {
          const others = [hit.fromUser, ...hit.toUsers].filter((u) => u && u.id !== state.user.id);
          openRatingQueue(hitId, others);
        }
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  pageContent().querySelectorAll("[data-leave-review]").forEach((b) =>
    b.addEventListener("click", () => {
      const hitId = Number(b.dataset.leaveReview);
      const hit = hitDetailsCache[hitId];
      if (hit) {
        const others = [hit.fromUser, ...hit.toUsers].filter((u) => u && u.id !== state.user.id);
        openRatingQueue(hitId, others);
      }
    })
  );
  pageContent().querySelectorAll("[data-add-friend-from-hit]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        const res = await Api.post("/friends/request", { toId: Number(b.dataset.addFriendFromHit) });
        if (res.autoAccepted) {
          try {
            const { user } = await Api.get("/profile/me");
            state.user = user;
          } catch (e) { /* non-critical */ }
          toast("You're now friends!");
          b.textContent = "Already friends";
        } else {
          toast("Friend request sent.");
          b.textContent = "Request sent";
        }
        b.disabled = true;
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
      const otherUser = hitUserCache[Number(id)];
      navigate("messages");
      setTimeout(() => openChat(id, name), 300);
    })
  );
}

async function respondFriend(requestId, accept) {
  try {
    await Api.post("/friends/respond", { requestId: Number(requestId), accept });
    if (accept) {
      // Refresh our own profile so state.user.friends immediately includes
      // the new friend — otherwise messaging them right after accepting
      // would still incorrectly show "Add friend" until next login.
      try {
        const { user } = await Api.get("/profile/me");
        state.user = user;
      } catch (e) { /* non-critical, state.user just stays one step behind until reload */ }
    }
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
// Find Hits — combined Find Players + Find Friends into one page
// ---------------------------------------------------------------
// Filters persist across tab switches within a session (reset on page
// reload).
const savedFilters = { hits: {} };

async function renderFindHits() {
  const f = savedFilters.hits;
  pageContent().innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:14px">
      <div>
        <span class="eyebrow">Discover the community</span>
        <h1>Find hits</h1>
        <p>Everyone shows up here — friend or not. Matching availability is shown right on their card when you have it.</p>
      </div>
      <button class="btn btn-ghost" id="fp-goto-availability">Set availability</button>
    </div>
    ${state.user.lat == null ? `
    <div class="callout" style="border-left-color:var(--danger)">
      <h4 style="color:var(--danger)">Your location is off</h4>
      <p>Distances to other players won't be accurate or shown until you turn on location. <a href="#" id="find-hits-enable-location" style="color:var(--court-green);font-weight:700">Turn it on from Profile →</a></p>
    </div>` : ""}
    <div class="filter-bar simple-filters">
      <label style="flex:1 1 100%">Search by name <input type="text" id="f-search" placeholder="Type a name…" value="${escapeHtml(f.search || "")}" /></label>
      <label>UTR from
        <select id="f-utrfrom">${utrBoundOptions(f.utrFrom, "Any")}</select>
      </label>
      <label>UTR to
        <select id="f-utrto">${utrBoundOptions(f.utrTo, "Any")}</select>
      </label>
      <label>USTA from
        <select id="f-ustafrom">${ustaBoundOptions(f.ustaFrom, "Any")}</select>
      </label>
      <label>USTA to
        <select id="f-ustato">${ustaBoundOptions(f.ustaTo, "Any")}</select>
      </label>
      <label>Ratings
        <select id="f-hasrating">
          <option value="" ${!f.hasRating ? "selected" : ""}>Everyone</option>
          <option value="utr" ${f.hasRating === "utr" ? "selected" : ""}>Only players with UTR set</option>
          <option value="usta" ${f.hasRating === "usta" ? "selected" : ""}>Only players with USTA set</option>
        </select>
      </label>
      <label>Court type
        <select id="f-surface"><option value="">Any type</option>${["Hard","Clay","Grass","Indoor"].map(v => `<option ${f.surface === v ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
      <label>Distance
        <select id="f-distance">${distanceOptions(f.distance)}</select>
      </label>
      <label>Availability
        <select id="f-availmode">
          <option value="" ${!f.availMode ? "selected" : ""}>Everyone</option>
          <option value="overlap" ${f.availMode === "overlap" ? "selected" : ""}>Only overlaps with mine</option>
          <option value="set" ${f.availMode === "set" ? "selected" : ""}>Only players with availability set</option>
        </select>
      </label>
      <label>Sort by
        <select id="f-sort">
          <option value="distance" ${f.sortBy === "distance" || !f.sortBy ? "selected" : ""}>Closest to me</option>
          <option value="utr" ${f.sortBy === "utr" ? "selected" : ""}>Highest UTR first</option>
          <option value="usta" ${f.sortBy === "usta" ? "selected" : ""}>Highest USTA first</option>
        </select>
      </label>
      <button class="btn btn-primary btn-sm" id="f-apply" style="align-self:flex-end">Apply</button>
    </div>
    <div id="results" class="grid grid-2"><div class="empty-state">Loading players…</div></div>
  `;

  document.getElementById("fp-goto-availability").addEventListener("click", () => navigate("availability"));
  const enableLocationLink = document.getElementById("find-hits-enable-location");
  if (enableLocationLink) {
    enableLocationLink.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("profile");
    });
  }
  document.getElementById("f-apply").addEventListener("click", () => loadResults());
  document.getElementById("f-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadResults();
  });
  await loadResults();
}

// Plain whole-number 1-16 dropdown for a UTR "from" or "to" value (UTR's
// real scale tops out at 16, not 10) — lets someone pick any custom range
// (e.g. 3 to 7) without typing anything.
function utrBoundOptions(selected, placeholder) {
  const opts = [`<option value="" ${!selected ? "selected" : ""}>${placeholder}</option>`];
  for (let i = 1; i <= 16; i++) {
    opts.push(`<option value="${i}" ${String(selected) === String(i) ? "selected" : ""}>${i}</option>`);
  }
  return opts.join("");
}

// Standard USTA half-point increments for a "from" or "to" value.
function ustaBoundOptions(selected, placeholder) {
  const levels = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5"];
  const opts = [`<option value="" ${!selected ? "selected" : ""}>${placeholder}</option>`];
  levels.forEach((v) => opts.push(`<option value="${v}" ${selected === v ? "selected" : ""}>${v}</option>`));
  return opts.join("");
}

function distanceOptions(selected) {
  const opts = [`<option value="" ${!selected ? "selected" : ""}>Any distance</option>`];
  [5, 10, 25, 50, 100].forEach((mi) => opts.push(`<option value="${mi}" ${String(selected) === String(mi) ? "selected" : ""}>Within ${mi} mi</option>`));
  return opts.join("");
}

async function loadResults() {
  const params = new URLSearchParams();
  const search = document.getElementById("f-search").value;
  const utrFrom = document.getElementById("f-utrfrom").value;
  const utrTo = document.getElementById("f-utrto").value;
  const ustaFrom = document.getElementById("f-ustafrom").value;
  const ustaTo = document.getElementById("f-ustato").value;
  const hasRating = document.getElementById("f-hasrating").value;
  const surface = document.getElementById("f-surface").value;
  const distance = document.getElementById("f-distance").value;
  const availMode = document.getElementById("f-availmode").value;
  const sortBy = document.getElementById("f-sort").value;

  // Remember these so switching to another tab and back keeps them.
  savedFilters.hits = { search, utrFrom, utrTo, ustaFrom, ustaTo, hasRating, surface, distance, availMode, sortBy };

  if (search) params.set("search", search);
  // Auto-correct if someone picks "From" higher than "To" — just swap them
  // rather than showing zero confusing results.
  if (utrFrom || utrTo) {
    const a = utrFrom ? Number(utrFrom) : null;
    const b = utrTo ? Number(utrTo) : null;
    if (a !== null) params.set("utrMin", String(b !== null && a > b ? b : a));
    if (b !== null) params.set("utrMax", String(a !== null && a > b ? a : b));
  }
  if (ustaFrom || ustaTo) {
    const a = ustaFrom ? Number(ustaFrom) : null;
    const b = ustaTo ? Number(ustaTo) : null;
    if (a !== null) params.set("ustaMin", String(b !== null && a > b ? b : a));
    if (b !== null) params.set("ustaMax", String(a !== null && a > b ? a : b));
  }
  if (hasRating) params.set("hasRating", hasRating);
  if (surface) params.set("surface", surface);
  if (distance) params.set("maxDistance", distance);
  if (availMode) params.set("availabilityMode", availMode);
  if (sortBy) params.set("sortBy", sortBy);

  try {
    const { results } = await Api.get(`/players/find?${params.toString()}`);
    const container = document.getElementById("results");
    if (results.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="display">No matches yet</div>Try widening your filters.</div>`;
      return;
    }
    container.innerHTML = results.map((p) => playerCardHtml(p)).join("");
    const resultsById = {};
    results.forEach((p) => (resultsById[p.id] = p));
    wirePlayerCardActions(resultsById);
  } catch (e) {
    toast(e.message, true);
  }
}

function playerCardHtml(p) {
  const rating = p.utr ? `UTR ${p.utr}` : p.usta ? `USTA ${p.usta}` : "Unrated";
  return `
    <div class="player-card">
      <div class="player-card-head">
        <div class="player-card-name-row">
          ${avatarHtml(p.name, 40, p.avatarUrl)}
          <div>
            <p class="player-name">${escapeHtml(p.name)} ${starsHtml(p.avgRating, p.ratingCount)}</p>
            <p class="player-meta">${p.distance !== null ? Math.round(p.distance) + " mi away" : ""}${p.surface ? " · " + escapeHtml(p.surface) : ""}</p>
          </div>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        ${p.age ? `<span class="tag">${p.age} yrs</span>` : ""}
        ${p.gender ? `<span class="tag">${escapeHtml(p.gender)}</span>` : ""}
        ${p.usta ? `<span class="tag">USTA ${p.usta}</span>` : ""}
        ${p.style ? `<span class="tag">${escapeHtml(p.style)}</span>` : ""}
      </div>
      ${p.bio ? `<p class="bio-text">${escapeHtml(p.bio.slice(0, 130))}${p.bio.length > 130 ? "…" : ""}</p>` : ""}
      ${p.hasOverlap ? `<div class="avail-summary">${overlapSummaryHtml(p.overlappingTimes)}</div>` : ""}
      <div id="avail-${p.id}" class="avail-summary hidden"></div>
      <div class="player-card-actions">
        <button class="btn btn-primary btn-sm" data-request-hit="${p.id}" data-name="${escapeHtml(p.name)}">Request hit</button>
        <button class="btn btn-ghost btn-sm" data-toggle-avail="${p.id}">View availability</button>
        ${p.friendStatus === "friends"
          ? `<button class="btn btn-ghost btn-sm" disabled>Already friends</button>`
          : p.friendStatus === "pending"
          ? `<button class="btn btn-ghost btn-sm" disabled>Request sent</button>`
          : `<button class="btn btn-ghost btn-sm" data-add-friend="${p.id}">Add friend</button>`}
        <button class="btn btn-ghost btn-sm" data-message-player="${p.id}" data-name="${escapeHtml(p.name)}">Message</button>
        <button class="btn btn-ghost btn-sm full-span" data-view-bio="${p.id}">View bio/ratings</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
// Find Paid Hits — separate tab, only players offering paid hits
// ---------------------------------------------------------------
savedFilters.paid = {};

async function renderFindPaidHits() {
  const f = savedFilters.paid;
  pageContent().innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:14px">
      <div>
        <span class="eyebrow">Paid hitting sessions</span>
        <h1>Find paid hits</h1>
        <p>Only players who offer paid hits show up here.</p>
      </div>
      <button class="btn btn-ghost" id="fp-goto-availability">Set availability</button>
    </div>
    ${state.user.lat == null ? `
    <div class="callout" style="border-left-color:var(--danger)">
      <h4 style="color:var(--danger)">Your location is off</h4>
      <p>Distances to other players won't be accurate or shown until you turn on location. <a href="#" id="find-paid-enable-location" style="color:var(--court-green);font-weight:700">Turn it on from Profile →</a></p>
    </div>` : ""}
    <div class="filter-bar simple-filters">
      <label style="flex:1 1 100%">Search by name <input type="text" id="f-search" placeholder="Type a name…" value="${escapeHtml(f.search || "")}" /></label>
      <label>UTR from
        <select id="f-utrfrom">${utrBoundOptions(f.utrFrom, "Any")}</select>
      </label>
      <label>UTR to
        <select id="f-utrto">${utrBoundOptions(f.utrTo, "Any")}</select>
      </label>
      <label>Court type
        <select id="f-surface"><option value="">Any type</option>${["Hard","Clay","Grass","Indoor"].map(v => `<option ${f.surface === v ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
      <label>Distance
        <select id="f-distance">${distanceOptions(f.distance)}</select>
      </label>
      <button class="btn btn-primary btn-sm" id="f-apply" style="align-self:flex-end">Apply</button>
    </div>
    <div id="results" class="grid grid-2"><div class="empty-state">Loading players…</div></div>
  `;
  document.getElementById("fp-goto-availability").addEventListener("click", () => navigate("availability"));
  const enableLocationLinkPaid = document.getElementById("find-paid-enable-location");
  if (enableLocationLinkPaid) {
    enableLocationLinkPaid.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("profile");
    });
  }
  document.getElementById("f-apply").addEventListener("click", () => loadPaidResults());
  document.getElementById("f-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadPaidResults();
  });
  await loadPaidResults();
}

async function loadPaidResults() {
  const params = new URLSearchParams({ paidOnly: "true" });
  const search = document.getElementById("f-search").value;
  const utrFrom = document.getElementById("f-utrfrom").value;
  const utrTo = document.getElementById("f-utrto").value;
  const surface = document.getElementById("f-surface").value;
  const distance = document.getElementById("f-distance").value;

  savedFilters.paid = { search, utrFrom, utrTo, surface, distance };

  if (search) params.set("search", search);
  if (utrFrom || utrTo) {
    const a = utrFrom ? Number(utrFrom) : null;
    const b = utrTo ? Number(utrTo) : null;
    if (a !== null) params.set("utrMin", String(b !== null && a > b ? b : a));
    if (b !== null) params.set("utrMax", String(a !== null && a > b ? a : b));
  }
  if (surface) params.set("surface", surface);
  if (distance) params.set("maxDistance", distance);

  try {
    const { results } = await Api.get(`/players/find?${params.toString()}`);
    const container = document.getElementById("results");
    if (results.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="display">No paid hits nearby</div>Try widening your filters.</div>`;
      return;
    }
    container.innerHTML = results.map((p) => paidPlayerCardHtml(p)).join("");
    const resultsById = {};
    results.forEach((p) => (resultsById[p.id] = p));
    wirePlayerCardActions(resultsById);
  } catch (e) {
    toast(e.message, true);
  }
}

function paidPlayerCardHtml(p) {
  const rating = p.utr ? `UTR ${p.utr}` : p.usta ? `USTA ${p.usta}` : "Unrated";
  return `
    <div class="player-card">
      <div class="player-card-head">
        <div class="player-card-name-row">
          ${avatarHtml(p.name, 40, p.avatarUrl)}
          <div>
            <p class="player-name">${escapeHtml(p.name)} ${starsHtml(p.avgRating, p.ratingCount)}</p>
            <p class="player-meta">${p.distance !== null ? Math.round(p.distance) + " mi away" : ""}${p.surface ? " · " + escapeHtml(p.surface) : ""}</p>
          </div>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        <span class="tag paid">$${p.paidHits.rate}/hr${p.paidHits.method ? ` · ${escapeHtml(p.paidHits.method)}` : ""}</span>
        ${p.age ? `<span class="tag">${p.age} yrs</span>` : ""}
        ${p.gender ? `<span class="tag">${escapeHtml(p.gender)}</span>` : ""}
        ${p.usta ? `<span class="tag">USTA ${p.usta}</span>` : ""}
        ${p.style ? `<span class="tag">${escapeHtml(p.style)}</span>` : ""}
      </div>
      ${p.bio ? `<p class="bio-text">${escapeHtml(p.bio.slice(0, 130))}${p.bio.length > 130 ? "…" : ""}</p>` : ""}
      ${p.hasOverlap ? `<div class="avail-summary">${overlapSummaryHtml(p.overlappingTimes)}</div>` : ""}
      <div id="avail-${p.id}" class="avail-summary hidden"></div>
      <div class="player-card-actions">
        <button class="btn btn-primary btn-sm" data-request-paid-hit="${p.id}" data-name="${escapeHtml(p.name)}">Request paid hit</button>
        <button class="btn btn-ghost btn-sm" data-toggle-avail="${p.id}">View availability</button>
        ${p.friendStatus === "friends"
          ? `<button class="btn btn-ghost btn-sm" disabled>Already friends</button>`
          : p.friendStatus === "pending"
          ? `<button class="btn btn-ghost btn-sm" disabled>Request sent</button>`
          : `<button class="btn btn-ghost btn-sm" data-add-friend="${p.id}">Add friend</button>`}
        <button class="btn btn-ghost btn-sm" data-message-player="${p.id}" data-name="${escapeHtml(p.name)}">Message</button>
        <button class="btn btn-ghost btn-sm full-span" data-view-bio="${p.id}">View bio/ratings</button>
      </div>
    </div>`;
}

function overlapSummaryHtml(overlappingTimes) {
  const today = toISODate(new Date());
  const active = (overlappingTimes || []).filter((a) => !a.date || a.date >= today);
  if (!active.length) {
    return `<p style="color:var(--ink-soft);font-size:12.5px;margin:0">No overlapping times found.</p>`;
  }
  const thisWeek = getCurrentWeekDates(0);
  const groups = {};
  active.forEach((a) => {
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
  document.querySelectorAll("[data-toggle-avail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleAvail;
      const box = document.getElementById(`avail-${id}`);
      if (box.classList.contains("hidden") && !box.dataset.filled) {
        const player = resultsById && resultsById[id];
        box.innerHTML = availabilitySummaryHtml(player && player.availability);
        box.dataset.filled = "1";
      }
      box.classList.toggle("hidden");
      btn.textContent = box.classList.contains("hidden") ? "View availability" : "Hide availability";
    });
  });
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
        const res = await Api.post("/friends/request", { toId: Number(b.dataset.addFriend) });
        if (res.autoAccepted) {
          // They'd already sent me a request — this just accepted it, so
          // we're friends immediately, not just pending.
          try {
            const { user } = await Api.get("/profile/me");
            state.user = user;
          } catch (e) { /* non-critical */ }
          toast("You're now friends!");
          b.textContent = "Already friends";
        } else {
          toast("Friend request sent.");
          b.textContent = "Request sent";
        }
        b.disabled = true;
        b.removeAttribute("data-add-friend");
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  document.querySelectorAll("[data-message-player]").forEach((b) =>
    b.addEventListener("click", () => {
      const player = resultsById && resultsById[b.dataset.messagePlayer];
      navigate("messages");
      setTimeout(() => openChat(b.dataset.messagePlayer, b.dataset.name), 300);
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
        <div class="player-card-name-row">
          ${avatarHtml(p.name, 52, p.avatarUrl)}
          <div>
            <p class="player-name" style="font-size:19px">${escapeHtml(p.name)} ${starsHtml(p.avgRating, p.ratingCount)}</p>
            <p class="player-meta">${p.distance !== null && p.distance !== undefined ? Math.round(p.distance) + " mi away" : ""}</p>
          </div>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        ${p.age ? `<span class="tag">${p.age} yrs</span>` : ""}
        ${p.gender ? `<span class="tag">${escapeHtml(p.gender)}</span>` : ""}
        ${p.usta ? `<span class="tag">USTA ${p.usta}</span>` : ""}
        ${p.surface ? `<span class="tag">${escapeHtml(p.surface)}</span>` : ""}
        ${p.style ? `<span class="tag">${escapeHtml(p.style)}</span>` : ""}
        ${p.paidHits && p.paidHits.enabled ? `<span class="tag paid">$${p.paidHits.rate}/hr</span>` : ""}
      </div>
      <p class="bio-text">${p.bio ? escapeHtml(p.bio) : "This player hasn't written a bio yet."}</p>
      <div class="net-divider"></div>
      <div id="bio-ratings-preview" style="font-size:13px;color:var(--ink-soft)">Loading ratings…</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn btn-ghost" id="bio-view-ratings">See all ratings</button>
        <button class="btn btn-ghost" id="bio-close">Close</button>
      </div>
    </div>`);
  document.getElementById("bio-close").addEventListener("click", closeModal);
  document.getElementById("bio-view-ratings").addEventListener("click", () => showRatingsModal(p));
  loadBioRatingSummary(p.id, "bio-ratings-preview", false);
}

function showRatingsModal(p) {
  showModal(`
    <div class="card" style="max-width:420px;margin:0 auto">
      <h3 style="margin-top:0">${escapeHtml(p.name)}'s ratings</h3>
      <div id="ratings-modal-body" style="font-size:13.5px;color:var(--ink-soft)">Loading…</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" id="ratings-modal-close">Close</button>
      </div>
    </div>`);
  document.getElementById("ratings-modal-close").addEventListener("click", closeModal);
  loadBioRatingSummary(p.id);
}

async function loadBioRatingSummary(userId, targetId = "ratings-modal-body", showAll = false) {
  try {
    const { average, count, reviews } = await Api.get(`/ratings/user/${userId}`);
    const box = document.getElementById(targetId);
    if (!box) return; // modal/page was closed or navigated away before this resolved
    if (!count) {
      box.innerHTML = `<p style="margin:0">No ratings yet — they'll show up here after your hits are finished and rated.</p>`;
      return;
    }
    const stars = "★".repeat(Math.round(average)) + "☆".repeat(5 - Math.round(average));
    const shownReviews = showAll ? reviews : reviews.slice(0, 3);
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;background:var(--ball);border-radius:12px;padding:12px 14px;margin-bottom:12px">
        <span style="font-size:26px;font-weight:800;font-family:var(--font-display);color:var(--court-green-dark)">${average.toFixed(1)}</span>
        <div>
          <div style="color:#FFC72C;font-size:15px;letter-spacing:1px">${stars}</div>
          <div style="font-size:12px;color:var(--ink-soft);font-weight:600">${count} rating${count === 1 ? "" : "s"}</div>
        </div>
      </div>
      ${shownReviews.length ? shownReviews.map((r) => `
        <div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--chalk-panel)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              ${avatarHtml(r.fromName, 28)}
              <span style="font-weight:700;font-size:13.5px">${escapeHtml(r.fromName)}</span>
            </div>
            <span style="color:#FFC72C;font-size:13px;white-space:nowrap">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span>
          </div>
          <p style="margin:8px 0 2px;font-size:13.5px;line-height:1.5;color:var(--ink)">${escapeHtml(r.review)}</p>
          <p style="margin:0;font-size:11px;color:var(--ink-soft)">${timeAgo(r.createdAt)}</p>
        </div>`).join("") : `<p style="font-size:12.5px;color:var(--ink-soft);margin:0">No written reviews yet.</p>`}
    `;
  } catch (e) {
    const box = document.getElementById(targetId);
    if (box) box.innerHTML = "";
  }
}

// Shows a 1-5 star rating modal for `people`, one at a time — submitting or
// skipping one advances to the next until the queue is empty.
// Checks for any finished hits the person never got around to rating
// (e.g. they hit "Skip" in the moment, or closed the tab) and offers a
// gentle one-time-per-session nudge, grouped by hit so a group hit only
// prompts once for everyone still unrated on it.
async function maybeOfferPendingRatings() {
  if (sessionStorage.getItem("hitsync_pending_ratings_checked")) return;
  sessionStorage.setItem("hitsync_pending_ratings_checked", "1");
  try {
    const { pending: allPending } = await Api.get("/ratings/pending");
    const pending = allPending.filter((p) => p.reason !== "cancelled");
    if (!pending.length) return;
    const byHit = {};
    pending.forEach((p) => (byHit[p.hitId] = byHit[p.hitId] || []).push(p));
    const [firstHitId, firstGroup] = Object.entries(byHit)[0];
    setTimeout(() => {
      openRatingQueue(Number(firstHitId), firstGroup.map((p) => ({ id: p.toUserId, name: p.toName })));
    }, 800);
  } catch (e) { /* non-critical, ignore */ }
}

// One-time popup (per hit, ever — not just per session) telling someone
// their hit got cancelled on them, with a direct choice to review the
// canceller or skip. Marked as seen immediately so it never reappears
// regardless of which button they pick, or if they just close the tab.
function maybeShowCancelledHitPrompt(hits) {
  const candidate = hits.find(
    (h) => h.status === "cancelled" && h.everAccepted && h.cancelledBy !== state.user.id &&
      !localStorage.getItem(`hitsync_cancel_seen_${h.id}`)
  );
  if (!candidate) return;
  localStorage.setItem(`hitsync_cancel_seen_${candidate.id}`, "1");

  const canceller = candidate.cancelledBy === candidate.fromId
    ? candidate.fromUser
    : candidate.toUsers.find((u) => u.id === candidate.cancelledBy);
  const cancellerName = canceller ? canceller.name : "They";

  setTimeout(() => {
    showModal(`
      <div class="card" style="max-width:380px;margin:0 auto">
        <h3 style="margin-top:0">Hit cancelled</h3>
        <p style="color:var(--ink-soft);font-size:14px">
          ${escapeHtml(cancellerName)} cancelled your hit on ${fmtDate(candidate.date)}${candidate.cancelReason ? `: "${escapeHtml(candidate.cancelReason)}"` : "."}
        </p>
        <p style="color:var(--ink-soft);font-size:13px">Want to leave a quick review for ${escapeHtml(cancellerName)}?</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn btn-ghost" id="cancel-prompt-skip">Skip</button>
          <button class="btn btn-primary" id="cancel-prompt-review">Leave a review</button>
        </div>
      </div>`);
    document.getElementById("cancel-prompt-skip").addEventListener("click", closeModal);
    document.getElementById("cancel-prompt-review").addEventListener("click", () => {
      closeModal();
      const others = [candidate.fromUser, ...candidate.toUsers].filter((u) => u && u.id !== state.user.id);
      openRatingQueue(candidate.id, others);
    });
  }, 600);
}

function openRatingQueue(hitId, people) {
  if (!people || !people.length) return;
  const [person, ...rest] = people;
  let selectedStars = 0;

  const starRow = () => `
    <div id="rating-stars" style="display:flex;gap:6px;justify-content:center;margin:14px 0;font-size:32px;cursor:pointer">
      ${[1, 2, 3, 4, 5].map((n) => `<span data-star="${n}" style="color:${n <= selectedStars ? "#FFC72C" : "var(--line)"}">★</span>`).join("")}
    </div>`;

  const render = () => {
    const existingReview = document.getElementById("rating-review");
    const preservedReview = existingReview ? existingReview.value : "";
    showModal(`
      <div class="card" style="max-width:380px;margin:0 auto;text-align:center">
        ${avatarHtml(person.name, 56, person.avatarUrl)}
        <h3 style="margin:12px 0 2px">Rate your hit with ${escapeHtml(person.name)}</h3>
        <p style="color:var(--ink-soft);font-size:13px;margin:0">Optional, but it helps other players know who they're hitting with.</p>
        ${starRow()}
        <textarea id="rating-review" placeholder="Quick review (optional)" maxlength="300" style="width:100%;min-height:70px;border:1.5px solid var(--line);border-radius:8px;padding:10px;font-family:inherit">${escapeHtml(preservedReview)}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn btn-ghost" id="rating-skip">Skip</button>
          <button class="btn btn-primary" id="rating-submit">Submit</button>
        </div>
      </div>`);

    document.querySelectorAll("#rating-stars [data-star]").forEach((star) => {
      star.addEventListener("click", () => {
        selectedStars = Number(star.dataset.star);
        render();
      });
    });
    document.getElementById("rating-skip").addEventListener("click", () => {
      closeModal();
      openRatingQueue(hitId, rest);
    });
    document.getElementById("rating-submit").addEventListener("click", async () => {
      if (!selectedStars) {
        toast("Pick at least one star, or tap Skip.", true);
        return;
      }
      try {
        await Api.post("/ratings", {
          hitId,
          toUserId: person.id,
          stars: selectedStars,
          review: document.getElementById("rating-review").value.trim(),
        });
        toast(`Rating saved for ${person.name}.`);
      } catch (e) {
        toast(e.message, true);
      }
      closeModal();
      openRatingQueue(hitId, rest);
    });
  };
  render();
}

function openHitRequestModal(toId, name, paidHits, groupId) {
  const formats = ["Singles", "Doubles", "Drills only", "Practice sets"];
  const isPaid = !!paidHits;
  const html = `
    <div class="card" style="max-width:420px;margin:0 auto">
      <h3 style="margin-top:0">${isPaid ? "Request a paid hit" : "Request a hit"} ${groupId ? `with the ${escapeHtml(name)} group` : `with ${escapeHtml(name)}`}</h3>
      ${isPaid ? `<div class="tag paid" style="display:inline-block;margin-bottom:14px">$${paidHits.rate}/hr${paidHits.method ? ` via ${escapeHtml(paidHits.method)}` : ""}</div>` : ""}
      <form id="hit-request-form" class="form-stack">
        <label>Date <input type="date" name="date" min="${toISODate(new Date())}" required /></label>
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
        ...(groupId ? { groupId: Number(groupId) } : { toId: Number(toId) }),
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
  const [{ friends }, { incoming, outgoing }] = await Promise.all([
    Api.get("/friends"),
    Api.get("/friends/requests"),
  ]);
  pageContent().innerHTML = `
    <div class="page-header">
      <h1>Friends</h1>
      <p>Your tennis network. Check their availability or message them directly.</p>
    </div>

    ${(incoming.length || outgoing.length) ? `
    <div class="card">
      <h3 style="margin-top:0">Friend requests</h3>
      ${incoming.length ? `
        <p style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px">Received</p>
        ${incoming.map((r) => {
          friendReqUserCache[r.fromUser.id] = r.fromUser;
          return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
            <span>${escapeHtml(r.fromUser.name)}</span>
            <span>
              <button class="btn btn-ghost btn-sm" data-view-profile-friendreq="${r.fromUser.id}">View profile</button>
              <button class="btn btn-secondary btn-sm" data-accept-friend="${r.id}">Accept</button>
              <button class="btn btn-ghost btn-sm" data-decline-friend="${r.id}">Decline</button>
            </span>
          </div>`;
        }).join("")}
      ` : ""}
      ${outgoing.length ? `
        <p style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin:${incoming.length ? "14px" : "0"} 0 6px">Sent by you</p>
        ${outgoing.map((r) => {
          friendReqUserCache[r.toUser.id] = r.toUser;
          return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
            <span>${escapeHtml(r.toUser.name)}</span>
            <span style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-ghost btn-sm" data-view-profile-friendreq="${r.toUser.id}">View profile</button>
              <span class="chip chip-pending">Pending</span>
            </span>
          </div>`;
        }).join("")}
      ` : ""}
    </div>` : ""}

    <div class="grid grid-2">
      ${friends.length ? friends.map(friendCardHtml).join("") : `
        <div class="empty-state">
          <div class="display">No friends yet</div>
          Add friends from Find Hits and they'll show up here.
        </div>`}
    </div>
  `;
  wireFriendCardActions(friends);
  document.querySelectorAll("[data-view-profile-friendreq]").forEach((b) =>
    b.addEventListener("click", () => {
      const user = friendReqUserCache[Number(b.dataset.viewProfileFriendreq)];
      if (user) showBioModal(user);
    })
  );
  document.querySelectorAll("[data-accept-friend]").forEach((b) =>
    b.addEventListener("click", () => respondFriend(b.dataset.acceptFriend, true))
  );
  document.querySelectorAll("[data-decline-friend]").forEach((b) =>
    b.addEventListener("click", () => respondFriend(b.dataset.declineFriend, false))
  );
}

function friendCardHtml(f) {
  const rating = f.utr ? `UTR ${f.utr}` : f.usta ? `USTA ${f.usta}` : "Unrated";
  return `
    <div class="player-card">
      <div class="player-card-head">
        <div class="player-card-name-row">
          ${avatarHtml(f.name, 40, f.avatarUrl)}
          <div>
            <p class="player-name">${escapeHtml(f.name)} ${starsHtml(f.avgRating, f.ratingCount)}</p>
            <p class="player-meta">${f.distance !== null && f.distance !== undefined ? Math.round(f.distance) + " mi away" : ""}</p>
          </div>
        </div>
        <span class="rating-badge">${rating}</span>
      </div>
      <div class="player-tags">
        ${f.age ? `<span class="tag">${f.age} yrs</span>` : ""}
        ${f.gender ? `<span class="tag">${escapeHtml(f.gender)}</span>` : ""}
        ${f.surface ? `<span class="tag">${escapeHtml(f.surface)}</span>` : ""}
        ${f.style ? `<span class="tag">${escapeHtml(f.style)}</span>` : ""}
      </div>
      ${f.bio ? `<p class="bio-text">${escapeHtml(f.bio.slice(0, 110))}${f.bio.length > 110 ? "…" : ""}</p>` : ""}
      ${f.hasOverlap ? `<div class="avail-summary">${overlapSummaryHtml(f.overlappingTimes)}</div>` : ""}
      <div id="avail-${f.id}" class="avail-summary hidden"></div>
      <div class="player-card-actions">
        <button class="btn btn-primary btn-sm" data-request-hit="${f.id}" data-name="${escapeHtml(f.name)}">Request hit</button>
        <button class="btn btn-ghost btn-sm" data-toggle-avail="${f.id}">View availability</button>
        <button class="btn btn-ghost btn-sm" disabled>Already friends</button>
        <button class="btn btn-ghost btn-sm" data-message-friend="${f.id}" data-name="${escapeHtml(f.name)}">Message</button>
        <button class="btn btn-ghost btn-sm full-span" data-view-bio="${f.id}">View bio/ratings</button>
      </div>
    </div>`;
}

function availabilitySummaryHtml(availability) {
  const today = toISODate(new Date());
  const active = (availability || []).filter((a) => a.recurring !== false || !a.date || a.date >= today);
  if (!active.length) {
    return `<p style="color:var(--ink-soft);font-size:12.5px;margin:0">No availability set yet.</p>`;
  }
  const thisWeek = getCurrentWeekDates(0);
  const groups = {};
  active.forEach((a) => {
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
      const friend = friends.find((f) => String(f.id) === String(id));
      navigate("messages");
      setTimeout(() => openChat(id, name), 300);
    });
  });
}

// ---------------------------------------------------------------
// Simple modal helper
// ---------------------------------------------------------------
function showModal(innerHtml, mandatory) {
  closeModal();
  const wrap = document.createElement("div");
  wrap.id = "modal-backdrop";
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(15,30,27,0.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  wrap.innerHTML = innerHtml;
  if (!mandatory) {
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeModal(); });
  }
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
        ${dayHits.map((h) => `<div class="calendar-event calendar-event-${h.status}" title="${h.status === "pending" ? "Requested — waiting on a response" : "Confirmed"}: ${escapeHtml(fmtTime12(h.startTime))}–${escapeHtml(fmtTime12(h.endTime))} · ${escapeHtml(h.format)}">${fmtTime12(h.startTime)}–${fmtTime12(h.endTime)} ${escapeHtml(h.court || h.format)}</div>`).join("")}
      </div>`;
  }

  pageContent().innerHTML = `
    <div class="page-header">
      <span class="eyebrow">Your schedule</span>
      <h1>${firstDay.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h1>
      <p>Requested and confirmed hits both show here, color-coded so you always know what's locked in.</p>
    </div>
    <div class="calendar-legend">
      <span class="calendar-legend-item"><span class="calendar-legend-dot calendar-legend-dot-pending"></span> Requested — waiting on a response</span>
      <span class="calendar-legend-item"><span class="calendar-legend-dot calendar-legend-dot-accepted"></span> Confirmed — it's on!</span>
    </div>
    <div class="calendar-grid" style="margin-bottom:6px">
      ${DAYS.map((d) => `<div style="text-align:center;font-weight:700;font-size:12.5px;color:var(--clay-dark);background:var(--ball);padding:10px 0;border-radius:8px">${d}</div>`).join("")}
    </div>
    <div class="calendar-grid">${cells}</div>

    <h3 style="margin-top:28px">All upcoming hits</h3>
    <div class="grid grid-2">
      ${hits.length ? hits.map(hitRowHtml).join("") : `<p style="color:var(--ink-soft)">Nothing requested or confirmed yet.</p>`}
    </div>
  `;
  wireHitActions();
}

// ---------------------------------------------------------------
// Groups
// ---------------------------------------------------------------
function openNewGroupModal() {
  showModal(`
    <div class="card" style="max-width:380px;margin:0 auto">
      <h3 style="margin-top:0">New group</h3>
      <form id="new-group-form" style="display:flex;gap:10px">
        <input type="text" id="new-group-name" placeholder="Group name" required style="flex:1;border:1.5px solid var(--line);border-radius:6px;padding:9px 12px" />
        <button class="btn btn-primary" type="submit">Create</button>
      </form>
    </div>`);
  document.getElementById("new-group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-group-name").value.trim();
    if (!name) return;
    try {
      const { group } = await Api.post("/groups", { name });
      toast("Group created — add friends to it from the group icon in the chat.");
      closeModal();
      renderMessages().then(() => openGroupChat(group.id, group.name));
    } catch (err) {
      toast(err.message, true);
    }
  });
}


function groupMessagesHtml(messages) {
  if (!messages.length) return `<p style="color:var(--ink-soft)">No messages yet — say hello</p>`;

  const groups = [];
  for (const m of messages) {
    const mine = m.fromId === state.user.id;
    const last = groups[groups.length - 1];
    if (last && last.mine === mine && last.fromName === m.fromName) {
      last.items.push(m);
    } else {
      groups.push({ mine, fromName: m.fromName, items: [m] });
    }
  }

  return groups.map((g) => `
    <div class="msg-group ${g.mine ? "mine" : "theirs"}">
      ${!g.mine ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">${avatarHtml(g.fromName, 20)}<span style="font-size:11.5px;font-weight:700;color:var(--ink-soft)">${escapeHtml(g.fromName)}</span></div>` : ""}
      ${g.items.map((m) => `<div class="msg-bubble ${g.mine ? "mine" : "theirs"}">${escapeHtml(m.text)}</div>`).join("")}
      <span class="msg-timestamp">${fmtMsgTime(g.items[g.items.length - 1].createdAt)}</span>
    </div>
  `).join("");
}


// ---------------------------------------------------------------
// Messages
// ---------------------------------------------------------------
async function renderMessages() {
  const [{ threads }, { groups }] = await Promise.all([Api.get("/messages"), Api.get("/groups")]);

  const groupThreads = groups.map((g) => ({
    id: g.id,
    name: g.name,
    isGroup: true,
    memberCount: g.memberIds.length,
    lastMessageAt: g.messages.length ? g.messages[g.messages.length - 1].createdAt : g.createdAt,
  }));
  const allThreads = [...threads.map((t) => ({ ...t, isGroup: false })), ...groupThreads].sort(
    (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
  );

  pageContent().innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:14px">
      <div>
        <h1>Messages</h1>
        <p>Chat with anyone — friends, players you've messaged, or a group.</p>
      </div>
      <button class="btn btn-ghost" id="new-group-btn">+ New group</button>
    </div>
    <div class="grid" style="grid-template-columns: 240px 1fr; align-items:start">
      <div class="card thread-list">
        ${allThreads.length ? allThreads.map((t) => `
          <button class="thread-item" data-thread="${t.id}" data-is-group="${t.isGroup}" data-is-friend="${t.isFriend || false}" data-name="${escapeHtml(t.name)}" style="border:none;background:none;width:100%">
            ${t.isGroup ? `<span class="avatar" style="width:32px;height:32px;font-size:15px;background:var(--clay)">Grp</span>` : avatarHtml(t.name, 32, t.avatarUrl)}
            <span>${escapeHtml(t.name)}${t.isGroup ? `<span style="display:block;font-size:11px;font-weight:500;color:var(--ink-soft)">${t.memberCount} members</span>` : !t.isFriend ? `<span style="display:block;font-size:10.5px;font-weight:700;color:var(--court-green)">Not a friend</span>` : ""}</span>
          </button>`).join("") : `<p style="color:var(--ink-soft);font-size:13px">No conversations yet — message someone from Find Hits, Friends, or create a group.</p>`}
      </div>
      <div id="chat-area" class="empty-state">Select a conversation to start chatting.</div>
    </div>
  `;
  document.getElementById("new-group-btn").addEventListener("click", () => openNewGroupModal());
  document.querySelectorAll("[data-thread]").forEach((b) =>
    b.addEventListener("click", () => {
      const thread = allThreads.find((t) => String(t.id) === String(b.dataset.thread));
      if (b.dataset.isGroup === "true") {
        openGroupChat(b.dataset.thread, b.dataset.name);
      } else {
        openChat(b.dataset.thread, b.dataset.name);
      }
    })
  );
}

async function openGroupChat(groupId, name) {
  const area = document.getElementById("chat-area");
  area.className = "chat-window";
  area.innerHTML = `
    <div class="chat-header" style="justify-content:space-between">
      <button id="group-chat-icon" style="display:flex;align-items:center;gap:10px;border:none;background:none;cursor:pointer;text-align:left">
        <span class="avatar" style="width:34px;height:34px;font-size:16px;background:var(--clay)">Grp</span>
        <strong>${escapeHtml(name)}</strong>
      </button>
      <button class="btn btn-primary btn-sm" id="group-request-hit">Request hit</button>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <form id="chat-form" class="chat-input-row">
      <input type="text" id="chat-input" placeholder="Message ${escapeHtml(name)}…" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Send</button>
    </form>
  `;
  await loadGroupChatMessages(groupId);
  document.getElementById("group-chat-icon").addEventListener("click", () => openGroupManageModal(groupId));
  document.getElementById("group-request-hit").addEventListener("click", () => openHitRequestModal(null, name, null, groupId));
  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await Api.post(`/groups/${groupId}/message`, { text });
      await loadGroupChatMessages(groupId);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function loadGroupChatMessages(groupId) {
  const { group } = await Api.get(`/groups/${groupId}`);
  const box = document.getElementById("chat-messages");
  box.innerHTML = groupMessagesHtml(group.messages);
  box.scrollTop = box.scrollHeight;
}

// Shared group management UI (rename, add, remove members) — reachable
// both from the group icon in Messages and from the Groups tab directly.
async function openGroupManageModal(groupId) {
  const [{ group, members }, { friends }] = await Promise.all([
    Api.get(`/groups/${groupId}`),
    Api.get("/friends"),
  ]);
  const isOwner = group.ownerId === state.user.id;
  const memberIds = new Set(members.map((m) => m.id));
  const invitableFriends = friends.filter((f) => !memberIds.has(f.id));

  showModal(`
    <div class="card" style="max-width:420px;margin:0 auto">
      <h3 style="margin-top:0" id="manage-group-name">${escapeHtml(group.name)}</h3>
      ${isOwner ? `
        <form id="manage-rename-form" style="display:flex;gap:8px;margin-bottom:14px">
          <input type="text" id="manage-rename-input" value="${escapeHtml(group.name)}" style="flex:1;border:1.5px solid var(--line);border-radius:6px;padding:8px 10px" />
          <button class="btn btn-primary btn-sm" type="submit">Rename</button>
        </form>` : ""}
      <p style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px">Members</p>
      <div id="manage-members-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
        ${members.map((m) => `
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>${escapeHtml(m.name)}${m.id === group.ownerId ? " (owner)" : ""}</span>
            ${(isOwner && m.id !== group.ownerId) || m.id === state.user.id
              ? `<button class="btn btn-ghost btn-sm" data-remove-member="${m.id}" style="color:var(--danger)">${m.id === state.user.id ? "Leave" : "Remove"}</button>`
              : ""}
          </div>`).join("")}
      </div>
      <p style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px">Add a friend</p>
      <form id="manage-invite-form" style="display:flex;gap:8px;margin-bottom:14px">
        <select id="manage-invite-select" style="flex:1;border:1.5px solid var(--line);border-radius:6px;padding:8px 10px">
          ${invitableFriends.length
            ? `<option value="">Select a friend…</option>${invitableFriends.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("")}`
            : `<option value="">No friends left to add</option>`}
        </select>
        <button class="btn btn-secondary btn-sm" type="submit" ${invitableFriends.length ? "" : "disabled"}>Add</button>
      </form>
      ${isOwner ? `<button class="btn btn-ghost btn-sm" id="manage-delete-group" style="color:var(--danger)">Delete group</button>` : ""}
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" id="manage-close">Close</button>
      </div>
    </div>`);

  document.getElementById("manage-close").addEventListener("click", closeModal);

  const renameForm = document.getElementById("manage-rename-form");
  if (renameForm) {
    renameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = document.getElementById("manage-rename-input").value.trim();
      if (!newName) return;
      try {
        await Api.put(`/groups/${groupId}`, { name: newName });
        toast("Group renamed.");
        closeModal();
        openGroupChat(groupId, newName);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  document.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const removeId = btn.dataset.removeMember;
      const leaving = Number(removeId) === state.user.id;
      if (!confirm(leaving ? "Leave this group?" : "Remove this member?")) return;
      try {
        await Api.delete(`/groups/${groupId}/members/${removeId}`);
        toast(leaving ? "You left the group." : "Member removed.");
        closeModal();
        if (leaving) {
          renderMessages();
        } else {
          openGroupManageModal(groupId);
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  const inviteForm = document.getElementById("manage-invite-form");
  if (inviteForm) {
    inviteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userId = document.getElementById("manage-invite-select").value;
      if (!userId) return;
      try {
        await Api.post(`/groups/${groupId}/invite`, { userId: Number(userId) });
        toast("Friend added to the group.");
        openGroupManageModal(groupId);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  const deleteBtn = document.getElementById("manage-delete-group");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete "${group.name}"? This can't be undone.`)) return;
      try {
        await Api.delete(`/groups/${groupId}`);
        toast("Group deleted.");
        closeModal();
        renderMessages();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
}

async function openChat(userId, name) {
  const area = document.getElementById("chat-area");
  area.className = "chat-window";
  // Fetch the real, current profile directly instead of trusting whatever
  // the calling button happened to have cached locally — that was the
  // actual bug behind the avatar/friend-status inconsistency: four
  // different places (hit requests, search results, friends list, thread
  // list) were each independently guessing this from their own local data,
  // and any one of them being stale or wrong made the chat header wrong.
  let target = null;
  try {
    const res = await Api.get(`/profile/${userId}`);
    target = res.user;
  } catch (e) { /* fall back to name-only header below if this fails */ }
  const avatarUrl = target ? target.avatarUrl : null;
  const displayName = target ? target.name : name;
  const isFriend = (state.user.friends || []).includes(Number(userId));
  const starsBadge = target ? starsHtml(target.avgRating, target.ratingCount) : "";

  area.innerHTML = `
    <div class="chat-header" style="justify-content:space-between">
      <span style="display:flex;align-items:center;gap:10px">${avatarHtml(displayName, 34, avatarUrl)}<strong>${escapeHtml(displayName)}</strong> ${starsBadge}</span>
      ${isFriend
        ? `<span class="tag" style="background:var(--ball);color:var(--court-green-dark)">Friend</span>`
        : `<button class="btn btn-ghost btn-sm" id="chat-add-friend">Add friend</button>`}
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <form id="chat-form" class="chat-input-row">
      <input type="text" id="chat-input" placeholder="Message ${escapeHtml(displayName)}…" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Send</button>
    </form>
  `;
  await loadChatMessages(userId);
  const addFriendBtn = document.getElementById("chat-add-friend");
  if (addFriendBtn) {
    addFriendBtn.addEventListener("click", async () => {
      try {
        const res = await Api.post("/friends/request", { toId: Number(userId) });
        if (res.autoAccepted) {
          try {
            const { user } = await Api.get("/profile/me");
            state.user = user;
          } catch (e) { /* non-critical */ }
          toast("You're now friends!");
          openChat(userId, displayName); // re-render header to show the Friend badge
        } else {
          toast("Friend request sent.");
          addFriendBtn.textContent = "Request sent";
          addFriendBtn.disabled = true;
        }
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
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

function fmtMsgTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

async function loadChatMessages(userId) {
  const { messages } = await Api.get(`/messages/${userId}`);
  const box = document.getElementById("chat-messages");

  // Group consecutive messages from the same sender so it reads like a
  // real conversation instead of a bubble-per-message wall.
  const groups = [];
  for (const m of messages) {
    const mine = m.fromId === state.user.id;
    const last = groups[groups.length - 1];
    if (last && last.mine === mine) {
      last.items.push(m);
    } else {
      groups.push({ mine, items: [m] });
    }
  }

  box.innerHTML = groups.map((g) => `
    <div class="msg-group ${g.mine ? "mine" : "theirs"}">
      ${g.items.map((m) => `<div class="msg-bubble ${g.mine ? "mine" : "theirs"}">${escapeHtml(m.text)}</div>`).join("")}
      <span class="msg-timestamp">${fmtMsgTime(g.items[g.items.length - 1].createdAt)}</span>
    </div>
  `).join("") || `<p style="color:var(--ink-soft)">Say hello</p>`;
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------
// Profile
// ---------------------------------------------------------------
function marketingContentHtml() {
  const isLoggedIn = !!state.user;
  const ctaButtons = isLoggedIn
    ? `
      <button class="btn btn-primary" id="hero-cta-dashboard">Open Dashboard</button>
      <button class="btn btn-ghost" id="hero-cta-features">Explore Features</button>`
    : `
      <button class="btn btn-primary" id="hero-cta-signup">Create Account</button>
      <button class="btn btn-ghost" id="hero-cta-login">Log In</button>
      <button class="btn btn-ghost" id="hero-cta-features">Explore Features</button>`;
  return `
    <div class="grid" style="grid-template-columns: 1.2fr 1fr; align-items:center; gap:40px; margin-bottom:48px">
      <div>
        <span class="eyebrow">Tennis matchmaking &amp; scheduling</span>
        <h1 class="hero-heading" style="line-height:1.05;margin:0 0 20px">Hit more.<br>Text less.</h1>
        <p style="font-size:16px;color:var(--ink-soft);line-height:1.6;max-width:460px;margin-bottom:24px">
          Find compatible tennis partners based on skill level, age, preferences, and overlapping availability —
          then get it on the calendar without fifteen back-and-forth texts.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${ctaButtons}</div>
      </div>
      <div class="card tilt-card" style="max-width:340px;justify-self:end">
        <span class="tag" style="background:var(--ball);color:var(--court-green-dark);font-size:11px">96% MATCH</span>
        <p class="player-name" style="font-size:20px;margin-top:10px">Jordan M.</p>
        <p class="player-meta">UTR 9.4 · Hard court</p>
        <ul style="margin:14px 0 0;padding-left:18px;color:var(--ink-soft);font-size:14px;line-height:1.8">
          <li>0.2 UTR difference</li>
          <li>Available Tuesday at 5 PM</li>
          <li>Prefers competitive singles</li>
        </ul>
      </div>
    </div>

    <span class="eyebrow" id="features-anchor">Five main features</span>
    <h2 style="font-family:var(--font-display);font-size:28px;margin:0 0 20px">Everything needed to organize practice.</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:16px">
      ${[
        ["User Profiles", "Track UTR, USTA rating, age, gender, handedness, surfaces, and playing preferences."],
        ["Flexible Scheduling", "Add one-time availability for a specific week, exactly when you're actually free."],
        ["Smart Matchmaking", "Filter and sort players by skill, age, gender, court type, and distance."],
        ["Friends & Groups", "Build teams, practice crews, or trusted friend circles for faster invitations."],
        ["Messaging", "Coordinate times and courts with anyone — friends or not — without leaving the app."],
      ].map(([title, desc], i) => `
        <div style="background:var(--ball);border-radius:16px;padding:22px">
          <h3 style="margin:0 0 8px;font-size:17px">${title}</h3>
          <p style="margin:0;font-size:13.5px;color:var(--clay-dark);line-height:1.5">${desc}</p>
        </div>`).join("")}
    </div>

    <div style="background:var(--chalk-panel);border:1px solid var(--line);border-radius:20px;padding:28px;margin-top:32px">
      <span class="eyebrow">Why it works</span>
      <h2 style="font-family:var(--font-display);font-size:24px;margin:8px 0 10px">Set your availability, get matched faster.</h2>
      <p style="margin:0;font-size:14.5px;color:var(--ink-soft);line-height:1.65;max-width:640px">
        Hit Sync's matching is built around real, up-to-date availability — not just skill level. Players who keep
        their weekly availability current show up first for people who are actually free at the same time, get
        surfaced more often in Find Hits, and spend a lot less time going back and forth just to land on a time that
        works. Setting a few minutes now on your schedule is genuinely the single biggest thing you can do to get
        matched with a hitting partner faster.
      </p>
    </div>
  `;
}

function wireHeroCtaButtons() {
  const dashBtn = document.getElementById("hero-cta-dashboard");
  if (dashBtn) dashBtn.addEventListener("click", () => navigate("dashboard"));
  const signupBtn = document.getElementById("hero-cta-signup");
  if (signupBtn) signupBtn.addEventListener("click", () => showAuthScreen("signup"));
  const loginBtn = document.getElementById("hero-cta-login");
  if (loginBtn) loginBtn.addEventListener("click", () => showAuthScreen("login"));
  const featuresBtn = document.getElementById("hero-cta-features");
  if (featuresBtn) {
    featuresBtn.addEventListener("click", () => {
      const target = document.getElementById("features-anchor");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function aboutUsHtml() {
  return `
    <div style="max-width:720px;margin:0 auto;padding:20px 0 60px">
      <span class="eyebrow">About us</span>
      <h1 class="hero-heading" style="font-size:40px;line-height:1.1;margin:0 0 28px">Why we built Hit Sync</h1>

      <div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:center;margin-bottom:32px">
        <div style="text-align:center;flex:1 1 220px;max-width:240px">
          <img src="/founder-steven.jpg" alt="Steven Hu" style="width:100%;aspect-ratio:5/6;object-fit:cover;border-radius:16px;box-shadow:var(--shadow)" />
          <p style="margin:12px 0 0;font-weight:700;font-size:16px">Steven Hu</p>
          <p style="margin:2px 0 0;font-size:12.5px;color:var(--ink-soft)">Co-Founder</p>
        </div>
        <div style="text-align:center;flex:1 1 220px;max-width:240px">
          <img src="/founder-tristan.jpg" alt="Tristan Ascenzo" style="width:100%;aspect-ratio:5/6;object-fit:cover;border-radius:16px;box-shadow:var(--shadow)" />
          <p style="margin:12px 0 0;font-weight:700;font-size:16px">Tristan Ascenzo</p>
          <p style="margin:2px 0 0;font-size:12.5px;color:var(--ink-soft)">Co-Founder</p>
        </div>
      </div>

      <p style="font-size:16px;line-height:1.7;color:var(--ink-soft)">
        We created Hit Sync because as tennis players, we know the drill when it comes to finding a hit. Text someone for a hit,
        wait around for a response, then start all over with someone else if they couldn't make it. Hit Sync was
        built to solve a simple problem, finding a partner shouldn't take fifteen texts. We wanted one place to
        match with players at your level, see who's actually free when you are, and get a hit on the calendar
        without the back-and-forth. That's Hit Sync: hit more, text less.
      </p>

      <button class="btn btn-ghost" id="about-back-btn" style="margin-top:24px">← Back</button>
    </div>
  `;
}

function renderAboutPage() {
  document.getElementById("landing-content").innerHTML = aboutUsHtml();
  document.getElementById("about-back-btn").addEventListener("click", () => renderLandingScreen());
}

function renderAboutPageInApp() {
  pageContent().innerHTML = aboutUsHtml();
  document.getElementById("about-back-btn").addEventListener("click", () => navigate("home"));
}

function renderHome() {
  pageContent().innerHTML = marketingContentHtml();
  wireHeroCtaButtons();
}

function renderLandingScreen() {
  document.getElementById("landing-content").innerHTML = marketingContentHtml();
  wireHeroCtaButtons();
  const aboutBtn = document.getElementById("landing-about-btn");
  if (aboutBtn) aboutBtn.onclick = renderAboutPage;
}

async function renderProfile() {
  const { user } = await Api.get("/profile/me");
  state.user = user;
  state.profileLocked = isProfileIncomplete(user);

  pageContent().innerHTML = `
    <div class="page-header">
      <span class="eyebrow">Player profile</span>
      <h1>Edit your profile</h1>
      <p>Other players see this when deciding whether to request a hit.</p>
    </div>

    ${state.profileLocked ? `
    <div class="card" style="border-left:4px solid var(--danger);background:#FEF2F2">
      <h3 style="margin-top:0;color:var(--danger)">Finish setting up your profile to continue</h3>
      <p style="margin-bottom:0;color:var(--ink)">
        <strong>Date of birth</strong> and <strong>phone number</strong> are required before you can use the rest of Hit Sync —
        this helps keep the community safe and lets other players reach you about a hit. Fill them in below and save.
      </p>
    </div>` : ""}

    <div class="card" style="text-align:center">
      <h3 style="margin-top:0">Photo</h3>
      <div id="avatar-preview" style="margin-bottom:10px">${avatarHtml(user.name, 88, user.avatarUrl)}</div>
      <p style="margin:0 0 14px;font-weight:700;font-size:15px">${escapeHtml(user.name)} ${starsHtml(user.avgRating, user.ratingCount)}</p>
      <input type="file" id="avatar-file-input" accept="image/*" class="hidden" />
      <button type="button" class="btn btn-secondary btn-sm" id="avatar-upload-btn">${user.avatarUrl ? "Change photo" : "Add photo"}</button>
      ${user.avatarUrl ? `<button type="button" class="btn btn-ghost btn-sm" id="avatar-remove-btn">Remove</button>` : ""}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Your ratings &amp; feedback</h3>
      <div id="profile-ratings-summary" style="font-size:13.5px;color:var(--ink-soft)">Loading…</div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Basics</h3>
      <form id="profile-form" class="form-grid">
        <label>Name <input name="name" value="${escapeHtml(user.name)}" /></label>
        <label>Date of birth ${!user.dob ? `<span style="color:var(--danger)">*required</span>` : ""}
          <input id="dob-input" name="dob" type="date" value="${escapeHtml(user.dob || "")}" style="${!user.dob ? "border-color:var(--danger)" : ""}" required />
        </label>
        <p class="full" style="font-size:11.5px;color:var(--ink-soft);margin:-6px 0 0">
          <strong>Location:</strong> ${user.lat != null ? `On${user.location ? ` — ${escapeHtml(user.location)}` : ""} <span style="font-weight:600">(${user.locationSource === "gps" ? "Precise — tracked live" : user.locationSource === "zip" ? "Approximate — from zip code" : "Approximate — IP-based"})</span>` : "Off"} — used to calculate distance to other players. This is protected — never shown to anyone, only the distance in miles.
        </p>
        <div class="full" style="margin-top:-8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="location-toggle">${user.lat != null ? "Turn off location" : "Turn on location"}</button>
          <span style="font-size:12px;color:var(--ink-soft)">or</span>
          <input type="text" id="profile-zip-input" placeholder="Zip code" maxlength="10" style="width:100px;border:1.5px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12.5px" />
          <button type="button" class="btn btn-secondary btn-sm" id="profile-zip-submit">Use zip instead</button>
        </div>
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
        <p class="full" style="font-size:11.5px;color:var(--ink-soft);margin:-4px 0 0">
          <strong>Timezone:</strong> ${escapeHtml(user.timezone || "Detecting…")} — set automatically from your device, keeps your availability days accurate.
        </p>
        <label>Playing style <input name="style" value="${escapeHtml(user.style || "")}" placeholder="e.g. Aggressive baseliner" /></label>
        <label class="full">Bio <textarea name="bio" placeholder="Tennis background, goals, what you enjoy about the game…">${escapeHtml(user.bio || "")}</textarea></label>
        <div class="full"><button class="btn btn-primary" type="submit">Save profile</button></div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Contact</h3>
      <p style="color:var(--ink-soft);font-size:13px;margin-top:-6px">Your phone number is required — it's how other players (and text notifications about hits) reach you.</p>
      <form id="contact-form" class="form-grid">
        <label>Phone ${!user.phone ? `<span style="color:var(--danger)">*required</span>` : ""}
          <input name="phone" type="tel" value="${escapeHtml(user.phone || "")}" placeholder="(555) 555-5555" style="${!user.phone ? "border-color:var(--danger)" : ""}" required />
        </label>
        <div class="full"><button class="btn btn-secondary" type="submit">Save contact info</button></div>
      </form>
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

    <div class="card">
      <h3 style="margin-top:0">Availability</h3>
      <p style="color:var(--ink-soft);font-size:13.5px;margin-bottom:0">
        Set the days and times you're free to hit — this is what shows your overlapping availability on Find Hits.
      </p>
      <button class="btn btn-primary btn-sm" data-goto-availability style="margin-top:10px">Open Availability →</button>
    </div>

    <div class="card" style="border-color:var(--danger)">
      <h3 style="margin-top:0;color:var(--danger)">Delete account</h3>
      <p style="color:var(--ink-soft);font-size:13.5px">
        This permanently deletes your account, profile, availability, ratings, and hit history. It removes you from
        friends' lists and any groups you're in. This can't be undone.
      </p>
      <button class="btn btn-danger btn-sm" id="delete-account-btn">Delete my account</button>
    </div>
  `;

  document.getElementById("delete-account-btn").addEventListener("click", () => {
    const firstConfirm = confirm(
      "Are you sure you want to delete your account? This permanently removes your profile, availability, hit history, and ratings, and can't be undone."
    );
    if (!firstConfirm) return;
    const secondConfirm = prompt('This is permanent. Type "DELETE" to confirm.');
    if (secondConfirm !== "DELETE") {
      toast("Account deletion cancelled.");
      return;
    }
    Api.delete("/profile/me")
      .then(() => {
        toast("Your account has been deleted.");
        stopLocationWatch();
        Api.clearToken();
        state.user = null;
        showLandingScreen();
      })
      .catch((err) => toast(err.message, true));
  });

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (payload.utr === "") payload.utr = null; else payload.utr = Number(payload.utr);
    try {
      const { user: updated } = await Api.put("/profile/me", payload);
      state.user = updated;
      toast("Profile saved.");
      unlockProfileIfComplete();
    } catch (err) {
      toast(err.message, true);
    }
  });

  loadBioRatingSummary(state.user.id, "profile-ratings-summary", true);

  document.getElementById("avatar-upload-btn").addEventListener("click", () => {
    document.getElementById("avatar-file-input").click();
  });
  document.getElementById("avatar-file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file.", true);
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file, 400);
      const { user: updated } = await Api.put("/profile/me", { avatarUrl: dataUrl });
      state.user = updated;
      toast("Photo updated.");
      renderProfile();
    } catch (err) {
      toast(err.message || "Couldn't process that image.", true);
    }
  });
  const avatarRemoveBtn = document.getElementById("avatar-remove-btn");
  if (avatarRemoveBtn) {
    avatarRemoveBtn.addEventListener("click", async () => {
      try {
        const { user: updated } = await Api.put("/profile/me", { avatarUrl: "" });
        state.user = updated;
        toast("Photo removed.");
        renderProfile();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  document.getElementById("dob-input").addEventListener("change", async (e) => {
    const dob = e.target.value;
    if (!dob) return;
    try {
      const { user: updated } = await Api.put("/profile/me", { dob });
      state.user = updated;
      toast("Date of birth saved.");
      unlockProfileIfComplete();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("location-toggle").addEventListener("click", async () => {
    const isOn = state.user.lat != null;
    if (isOn) {
      try {
        const { user: updated } = await Api.put("/profile/me/location-consent", { accepted: false });
        state.user = updated;
        localStorage.removeItem(`hitsync_gps_enabled_${state.user.id}`);
        stopLocationWatch();
        toast("Location turned off.");
        renderProfile();
      } catch (err) {
        toast(err.message, true);
      }
    } else {
      localStorage.setItem(`hitsync_gps_enabled_${state.user.id}`, "1");
      updateLocationFromGps(() => renderProfile());
      startLocationWatch();
    }
  });

  document.getElementById("profile-zip-submit").addEventListener("click", async () => {
    const zip = document.getElementById("profile-zip-input").value.trim();
    if (!zip) { toast("Enter a zip code first.", true); return; }
    try {
      const { user: updated } = await Api.put("/profile/me/zip-location", { zip });
      state.user = updated;
      toast(updated.location ? `Location set to ${updated.location}.` : "Location set.");
      renderProfile();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const { user: updated } = await Api.put("/profile/me", payload);
      state.user = updated;
      toast("Contact info saved.");
      unlockProfileIfComplete();
    } catch (err) {
      toast(err.message, true);
    }
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

  document.querySelector("[data-goto-availability]").addEventListener("click", () => navigate("availability"));
}

// ---------------------------------------------------------------
// Availability — its own page for easier access
// ---------------------------------------------------------------
async function renderAvailability() {
  const { user } = await Api.get("/profile/me");
  state.user = user;
  const todayISO = toISODate(new Date());

  pageContent().innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:14px">
      <div>
        <span class="eyebrow">Set your schedule</span>
        <h1>Availability</h1>
        <p>This shows your overlapping availability on Find Hits — set the days/times you're free to hit.</p>
      </div>
      <button class="btn btn-primary" id="avail-goto-find-players">Find a partner</button>
    </div>
    <div class="card" id="availability-section">
      <p style="color:var(--ink-soft);font-size:13px;margin-top:0">
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
        <span style="font-size:13.5px;font-weight:600">Available at all times, every week (shown as a match to everyone on Find Hits)</span>
      </label>
      ${DAYS.map((day, i) => {
        const weekDate = toISODate(getCurrentWeekDates(profileWeekOffset)[i]);
        const dateLabel = fmtMonthDay(getCurrentWeekDates(profileWeekOffset)[i]);
        const isPastDay = weekDate < todayISO;
        // Show blocks for this weekday that belong to the week currently
        // being viewed (plus any legacy always-on blocks from before this
        // was one-time-by-default) — and never a one-time block whose date
        // has already passed, which just disappears entirely.
        const blocks = (user.availability || []).filter(
          (a) => a.day === day && (a.recurring !== false || a.date === weekDate) && (a.recurring !== false || a.date >= todayISO)
        );
        const hasAllDay = blocks.some((b) => b.start === "00:00" && b.end === "23:59");
        return `
        <div class="avail-day-row">
          <div class="avail-day-name">${day}<span class="avail-day-date">${dateLabel}</span></div>
          <div class="avail-chips">
            ${blocks.map((b) => {
              const isRecurring = b.recurring !== false;
              const isAllDayBlock = b.start === "00:00" && b.end === "23:59";
              return `
              <span class="avail-chip ${isRecurring ? "recurring" : ""}">
                ${isAllDayBlock ? "All day" : `${fmtTime12(b.start)} – ${fmtTime12(b.end)}`}
                <button type="button" class="chip-remove" data-remove-day="${day}" data-remove-start="${b.start}" data-remove-end="${b.end}" data-remove-recurring="${isRecurring}" data-remove-date="${b.date || ""}" aria-label="Remove time">✕</button>
              </span>`;
            }).join("")}
            ${isPastDay ? "" : `
              <button type="button" class="btn btn-ghost btn-sm avail-add-btn" data-add-day="${day}">+ Add time</button>
              ${hasAllDay ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-all-day="${day}">Available all day</button>`}
            `}
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
  `;

  document.getElementById("avail-goto-find-players").addEventListener("click", () => navigate("find-hits"));
  document.getElementById("avail-prev-week").addEventListener("click", () => {
    profileWeekOffset = Math.max(0, profileWeekOffset - 1);
    renderAvailability();
  });
  document.getElementById("avail-next-week").addEventListener("click", () => {
    profileWeekOffset += 1;
    renderAvailability();
  });
  const todayWeekBtn = document.getElementById("avail-today-week");
  if (todayWeekBtn) {
    todayWeekBtn.addEventListener("click", () => {
      profileWeekOffset = 0;
      renderAvailability();
    });
  }

  document.getElementById("avail-all-times").addEventListener("change", async (e) => {
    const availability = e.target.checked ? allTimesAvailability() : [];
    try {
      const { user: updated } = await Api.put("/profile/me/availability", { availability });
      state.user = updated;
      toast(e.target.checked ? "You're now available at all times." : "Availability cleared.");
      renderAvailability();
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
  document.querySelectorAll("[data-all-day]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const day = btn.dataset.allDay;
      const dayIndex = DAYS.indexOf(day);
      const weekDate = toISODate(getCurrentWeekDates(profileWeekOffset)[dayIndex]);
      const newBlock = { day, start: "00:00", end: "23:59", recurring: false, date: weekDate };
      const availability = [...(state.user.availability || []), newBlock];
      try {
        const { user: updated } = await Api.put("/profile/me/availability", { availability });
        state.user = updated;
        toast(`You're available all day ${day}.`);
        window.dispatchEvent(new CustomEvent("tutorial:notify", { detail: "action:availability-added" }));
        renderAvailability();
      } catch (err) {
        toast(err.message, true);
      }
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
        renderAvailability();
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
        renderAvailability();
      } catch (err) {
        toast(err.message, true);
      }
    });
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
  showLandingScreen();
});
