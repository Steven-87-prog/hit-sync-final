// First-time interactive tutorial.
// Highlights a real control on the page with a glowing ring, lets the user
// interact with the page underneath it, and for a few steps waits for the
// user to actually perform the action before moving on. Starts on the
// Profile page (so a brand-new account gets set up first) and then walks
// through every major feature.
const Tutorial = (() => {
  const steps = [
    {
      page: "profile",
      selector: "#profile-form",
      text: "You're all set up! Now let's fill in the rest of your profile — your rating, surface, and a short bio help other players know who they're hitting with.",
    },
    {
      page: "availability",
      selector: "#availability-section",
      text: 'Availability has its own tab — it powers the overlap shown on Find Hits. Tap "+ Add time" under any day to add a block.',
    },
    {
      page: "availability",
      selector: "#availability-section",
      text: "Go ahead and add one time block now — pick a day, tap \"+ Add time\", set a start/end, and hit Add.",
      waitForEvent: "action:availability-added",
    },
    {
      page: "dashboard",
      selector: '.nav-link[data-page="find-hits"]',
      text: "This is Find Hits — everyone shows up here, friend or not. When your schedules actually overlap, you'll see it right on their card. Tap it to continue.",
      waitForEvent: "page:find-hits",
    },
    {
      page: "find-hits",
      selector: ".filter-bar",
      text: "Narrow results with filters like UTR, USTA rating, distance, and surface. Try adjusting one, then hit Next.",
    },
    {
      page: "find-hits",
      selector: '.nav-link[data-page="friends"]',
      text: "Once someone accepts your friend request, they'll show up on this Friends page — you can check their availability and message them anytime. Tap it to continue.",
      waitForEvent: "page:friends",
    },
    {
      page: "friends",
      selector: '.nav-link[data-page="calendar"]',
      text: "Accepted hits automatically land on your Calendar. Tap it to take a look.",
      waitForEvent: "page:calendar",
    },
    {
      page: "calendar",
      selector: '.nav-link[data-page="messages"]',
      text: "Messages is also where groups live — chat with friends directly, or tap \"+ New group\" to set up a doubles team or practice crew and message everyone at once. Tap it to continue.",
      waitForEvent: "page:messages",
    },
    {
      page: "messages",
      selector: "#notif-bell",
      text: "Last stop: this bell shows notifications for friend requests, hit requests, and cancellations, so you never miss an update. That's the full tour!",
    },
  ];

  let current = -1;
  let active = false;
  const MOBILE_BREAKPOINT = 860;

  const overlay = () => document.getElementById("tutorial-overlay");
  const highlightEl = () => document.getElementById("tutorial-highlight");
  const boxEl = () => document.getElementById("tutorial-box");
  const textEl = () => document.getElementById("tutorial-text");
  const nextBtn = () => document.getElementById("tutorial-next");
  const hintEl = () => document.getElementById("tutorial-waiting-hint");

  function shouldAutoStart() {
    // Kept for backward compatibility; actual trigger is now the
    // server-side user.tutorialSeen flag (see app.js boot()).
    return !localStorage.getItem("hitsync_tutorial_done");
  }

  async function markDone() {
    localStorage.setItem("hitsync_tutorial_done", "1");
    try {
      await Api.put("/profile/me/tutorial-seen");
      if (typeof state !== "undefined" && state.user) state.user.tutorialSeen = true;
    } catch (e) {
      // not fatal — worst case the tutorial replays once more
    }
  }

  function isNavLinkSelector(selector) {
    return selector.includes(".nav-link");
  }

  function isInsideNav(el) {
    const nav = document.getElementById("side-nav");
    return !!(nav && el && nav.contains(el));
  }

  // Opens the sidebar and waits for its slide-in transition to actually
  // finish (via `transitionend`, with a timeout fallback) before calling
  // back — this was the root cause of the highlight landing in the wrong
  // spot before: we used to measure one animation frame after opening it,
  // long before the ~200ms CSS transition had actually completed.
  function openSideNavAndWait(callback) {
    const nav = document.getElementById("side-nav");
    const scrim = document.getElementById("nav-scrim");
    scrim.classList.remove("hidden");
    if (nav.classList.contains("open")) {
      callback();
      return;
    }
    nav.classList.add("open");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      nav.removeEventListener("transitionend", onEnd);
      callback();
    };
    const onEnd = (e) => {
      if (e.propertyName === "transform") finish();
    };
    nav.addEventListener("transitionend", onEnd);
    setTimeout(finish, 300); // fallback in case transitionend doesn't fire
  }

  function measureAndPlace(target) {
    const hl = highlightEl();
    const box = boxEl();
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    const pad = 6;
    hl.style.left = `${rect.left - pad}px`;
    hl.style.top = `${rect.top - pad}px`;
    hl.style.width = `${rect.width + pad * 2}px`;
    hl.style.height = `${rect.height + pad * 2}px`;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const boxWidth = Math.min(300, viewportW - 32);
    let boxTop = rect.bottom + 14;
    let boxLeft = Math.min(Math.max(rect.left, 12), viewportW - boxWidth - 12);

    if (boxTop + 200 > viewportH) {
      boxTop = Math.max(rect.top - 210, 12);
    }
    if (viewportW < 640) {
      boxLeft = 16;
      boxTop = rect.top > viewportH / 2 ? 76 : viewportH - 230;
    }

    box.style.left = `${boxLeft}px`;
    box.style.top = `${boxTop}px`;
    return true;
  }

  function position(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (!target) {
      // Target not mounted yet (page still rendering) — retry shortly.
      setTimeout(() => position(targetSelector), 150);
      return;
    }

    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    if (isMobile && isInsideNav(target)) {
      // Open the sidebar so the actual feature is visible, glowing, and
      // directly tappable — waits for the real animation to finish first.
      openSideNavAndWait(() => {
        if (!measureAndPlace(target)) setTimeout(() => position(targetSelector), 150);
      });
    } else {
      if (isMobile && typeof closeMobileNav === "function") closeMobileNav();
      requestAnimationFrame(() => {
        if (!measureAndPlace(target)) setTimeout(() => position(targetSelector), 150);
      });
    }
  }

  // Used by scroll/resize handlers only — just re-measures where the
  // current target is right now and moves the highlight there. Doesn't
  // touch the nav (it isn't opening/closing mid-scroll) and doesn't queue
  // its own requestAnimationFrame, since the caller already runs inside
  // one — nesting another rAF here was the actual bug: it let the "am I
  // already scheduled" flag reset itself a frame before the real
  // measurement ran, so fast/flung scrolling on iOS could leave the glow
  // stuck wherever it last measured instead of tracking the page.
  function reposition(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (target) measureAndPlace(target);
  }

  function showStep(i) {
    current = i;
    const step = steps[i];

    const goShow = () => {
      textEl().textContent = step.text;
      const isLast = i === steps.length - 1;
      nextBtn().textContent = isLast ? "Finish" : "Next";
      nextBtn().classList.toggle("hidden", !!step.waitForEvent);
      hintEl().classList.toggle("hidden", !step.waitForEvent);
      if (step.waitForEvent) {
        hintEl().textContent = "Waiting for you to try it — or tap End tutorial to exit.";
      }
      position(step.selector);
    };

    if (step.page && typeof navigate === "function" && typeof state !== "undefined" && state.page !== step.page) {
      navigate(step.page);
      setTimeout(goShow, 200);
    } else {
      goShow();
    }
  }

  function start() {
    active = true;
    overlay().classList.remove("hidden");
    showStep(0);
    window.addEventListener("resize", handleResize);
    // Capture phase so we catch scrolling on the page itself *and* on any
    // nested scrollable element (modals, chat windows, etc) — "scroll"
    // doesn't bubble, so a plain window listener alone would miss those.
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    // iOS Safari reports its visible area separately from the layout
    // viewport (address bar show/hide, keyboard, etc) — track that too so
    // the highlight doesn't drift on iPhone.
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleResize);
      window.visualViewport.addEventListener("scroll", handleScroll);
    }
  }

  let scrollTicking = false;
  function handleScroll() {
    if (!active || current < 0) return;
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      reposition(steps[current].selector);
      scrollTicking = false;
    });
  }

  function handleResize() {
    if (active && current >= 0) reposition(steps[current].selector);
  }

  function advance() {
    if (current < steps.length - 1) {
      showStep(current + 1);
    } else {
      finish();
    }
  }

  function finish() {
    active = false;
    overlay().classList.add("hidden");
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("scroll", handleScroll, { capture: true });
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", handleResize);
      window.visualViewport.removeEventListener("scroll", handleScroll);
    }
    if (typeof closeMobileNav === "function") closeMobileNav();
    markDone();
  }

  function notify(eventName) {
    if (!active || current < 0) return;
    const step = steps[current];
    if (step.waitForEvent === eventName) {
      setTimeout(advance, 250);
    }
  }

  function init() {
    document.getElementById("tutorial-next").addEventListener("click", advance);
    document.getElementById("tutorial-skip").addEventListener("click", finish);
  }

  return { init, start, notify, shouldAutoStart, isActive: () => active };
})();
