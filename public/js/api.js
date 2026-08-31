// Small fetch wrapper: attaches the JWT, parses JSON, throws readable errors.
//
// On the regular website, API calls stay relative ("/api/...") since the
// frontend and backend are served from the same origin. But if this gets
// wrapped into a native app (e.g. with Capacitor for an App Store build),
// the frontend runs from a local file/app scheme instead of your real
// server's origin — so relative paths would try to hit the phone itself
// instead of your actual backend. `window.Capacitor` is a global Capacitor
// injects automatically at runtime, so this switches to an absolute URL
// only when it detects that environment; the website is unaffected.
const API_BASE_URL = (() => {
  const isNativeApp = typeof window !== "undefined" && !!window.Capacitor;
  // TODO: replace with your real deployed URL (or custom domain) before
  // building the native app — this only matters for the App Store build,
  // not for the website itself.
  const PRODUCTION_URL = "https://hit-sync.onrender.com";
  return isNativeApp ? PRODUCTION_URL : "";
})();

const Api = (() => {
  function token() {
    return localStorage.getItem("hitsync_token");
  }

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;

    const res = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* no body */
    }

    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path) => request("DELETE", path),
    setToken: (t) => localStorage.setItem("hitsync_token", t),
    clearToken: () => localStorage.removeItem("hitsync_token"),
    hasToken: () => !!token(),
  };
})();
