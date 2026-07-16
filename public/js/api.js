// Small fetch wrapper: attaches the JWT, parses JSON, throws readable errors.
const Api = (() => {
  function token() {
    return localStorage.getItem("hitsync_token");
  }

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;

    const res = await fetch(`/api${path}`, {
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
    setToken: (t) => localStorage.setItem("hitsync_token", t),
    clearToken: () => localStorage.removeItem("hitsync_token"),
    hasToken: () => !!token(),
  };
})();
