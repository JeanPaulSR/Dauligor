// Dauligor account session for the Foundry module — NATIVE auth (not Firebase).
//
// Flow (see handoffs/foundry-module/2026-06-06-to-app-team-cors-for-module-login.md):
//   POST /api/auth/login  {username,password}        → { token, profile }
//   POST /api/auth/refresh (Authorization: Bearer …) → { token }            (sliding 30-day)
// The token is a native HS256 session JWT; `requireAuthenticatedUser` accepts it
// as a Bearer token on /api/me, /api/lore, /api/campaigns, /api/d1/query, …
//
// The session ({token, profile}) is stored in a CLIENT-scoped setting, keyed by
// Foundry user id — so each user has their OWN Dauligor login (never shared with
// other users, never world-synced). We send the token as a Bearer header (no
// cookies), so the app can serve these routes with CORS `*` safely.
//
// NOTE: cross-origin calls only work once the app adds CORS to /api/auth +
// /api/lore + /api/campaigns (the handoff above). Until then `login()` fails with
// a network/CORS error and reports it plainly.

import { MODULE_ID, SETTINGS } from "./constants.js";
import { log } from "./utils.js";

export function resolveApiHost() {
  try {
    const mode = game.settings.get(MODULE_ID, SETTINGS.apiEndpointMode) || "local";
    return mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";
  } catch {
    return "https://www.dauligor.com";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() that auto-heals a transient failure. Cloudflare Pages Functions can
 * cold-start: the first hit may hang/time-out or return a 5xx, and the BROWSER
 * surfaces that as a misleading "No Access-Control-Allow-Origin" CORS error
 * (the failed response drops the CORS headers the warm path returns). Same class
 * of issue as the background-detail 503 the creator already retries around.
 *
 * Retries only TRANSIENT outcomes — a thrown network error, or a 5xx / 429 — with
 * a short linear backoff. A real answer (2xx or 4xx, e.g. a 401 for bad creds) is
 * returned immediately and never retried.
 */
async function fetchWithRetry(url, opts = {}, { retries = 2, backoffMs = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── session store (client-scoped, JSON-encoded string) ──────────────────────

// The client-scoped store is a JSON map keyed by Foundry user id, so each user on
// a client has their OWN Dauligor session — one user's login is never shared with
// another (and, being client scope, it's also unsynced + per-device).
function currentUserId() {
  return game.user?.id ?? "__nouser__";
}

function readSessionMap() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTINGS.session);
    if (!raw) return {};
    const m = JSON.parse(raw);
    if (!m || typeof m !== "object") return {};
    // Discard the pre-per-user bare {token,profile} shape if it's still around.
    if (m.token || m.profile) return {};
    return m;
  } catch {
    return {};
  }
}

function readSession() {
  const entry = readSessionMap()[currentUserId()];
  return (entry && typeof entry === "object" && entry.token) ? entry : null;
}

async function writeSession(value) {
  const map = readSessionMap();
  const uid = currentUserId();
  if (value) map[uid] = value;
  else delete map[uid];
  await game.settings.set(MODULE_ID, SETTINGS.session, JSON.stringify(map));
}

/** The stored session `{ token, profile }`, or null. */
export function getSession() {
  return readSession();
}
export function isLoggedIn() {
  return !!readSession();
}
/** The logged-in user's profile `{ id, username, role, display_name }`, or null. */
export function getProfile() {
  return readSession()?.profile ?? null;
}
/** Best display label for the current user. */
export function getDisplayName() {
  const p = getProfile();
  return p?.display_name || p?.username || "";
}

// ── login / logout / refresh ────────────────────────────────────────────────

/**
 * Log in with a Dauligor username + password. On success stores the session and
 * returns the profile. Throws an Error with a user-facing message on failure
 * (bad creds, network/CORS, unexpected status).
 */
export async function login(username, password) {
  const host = resolveApiHost();
  let res;
  try {
    res = await fetchWithRetry(`${host}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch (err) {
    // After retries this is a genuine network failure (or, rarely, a real CORS
    // misconfig). A transient Cloudflare cold-start — which the browser also
    // reports as a CORS error — is auto-healed by fetchWithRetry above.
    log("auth: login fetch failed after retries (network / cold-start / CORS)", err);
    throw new Error("Couldn't reach Dauligor (network hiccup). Give it a moment and try again.");
  }
  if (res.status === 401) throw new Error("Invalid username or password.");
  if (res.status === 503) throw new Error("Dauligor native login isn't configured on the server.");
  if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}).`);
  const data = await res.json().catch(() => null);
  if (!data?.token) throw new Error("Login response was missing a token.");
  await writeSession({ token: String(data.token), profile: data.profile ?? null });
  // Let open windows (Library viewer, launcher labels) react to the new session.
  try { Hooks.callAll(`${MODULE_ID}.authChanged`); } catch { /* no-op outside Foundry */ }
  return data.profile ?? null;
}

/** Clear the stored session. */
export async function logout() {
  await writeSession(null);
  try { Hooks.callAll(`${MODULE_ID}.authChanged`); } catch { /* no-op outside Foundry */ }
}

/** Refresh the sliding session token. Returns true on success. */
async function refreshToken() {
  const session = readSession();
  if (!session?.token) return false;
  try {
    const res = await fetchWithRetry(`${resolveApiHost()}/api/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    if (!data?.token) return false;
    await writeSession({ token: String(data.token), profile: session.profile });
    return true;
  } catch (err) {
    log("auth: token refresh failed", err);
    return false;
  }
}

/**
 * fetch() against the Dauligor API with the native session token attached.
 * `path` may be absolute (https://…) or app-relative ("/api/lore/…"). On a 401
 * it refreshes the token once and retries; if refresh fails it clears the
 * session (forcing re-login). Throws "Not logged in." if there's no session, or
 * on a network error. Returns the Response otherwise (caller checks res.ok).
 */
export async function authFetch(path, opts = {}) {
  const session = readSession();
  if (!session?.token) throw new Error("Not logged in.");
  const url = /^https?:\/\//i.test(path) ? path : `${resolveApiHost()}${path}`;
  const run = (token) => fetchWithRetry(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
    cache: opts.cache ?? "no-store",
  });
  let res = await run(session.token);
  if (res.status === 401) {
    if (await refreshToken()) {
      res = await run(readSession().token);
    } else {
      await logout(); // dead session — next call will prompt re-login
    }
  }
  return res;
}
