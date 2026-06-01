// Client auth — native session layer. Firebase has been removed (Phase 5); this
// is the SINGLE place the client decides "what is my bearer token" and "who am
// I". A session is a 30-day JWT from POST /api/auth/login, kept in localStorage
// and renewed in the background by the sliding refresh.

const TOKEN_KEY = "dauligor:authToken";

// Sliding renewal: once the 30-day token has under ~15 days left (past its
// half-life), the next request opportunistically refreshes it in the background
// so an active session never expires out from under the user. An idle session
// (no requests) still lapses at 30 days, which is the intended behaviour.
const REFRESH_WHEN_REMAINING_MS = 15 * 24 * 60 * 60 * 1000;
let refreshInFlight = false;

export type Identity = {
  uid: string;
  email: string | null;
  username?: string;
  role?: string;
};

type Decoded = { identity: Identity; expMs: number };

let nativeToken: string | null = null;
let nativeDecoded: Decoded | null = null;
const listeners = new Set<(id: Identity | null) => void>();

// Decode (NOT verify — the server verifies the signature) our JWT payload for
// client-side identity + expiry. Returns null on a malformed token.
function decodeToken(token: string): Decoded | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const json = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    return {
      identity: {
        uid: String(json.sub ?? ""),
        email: typeof json.email === "string" ? json.email : null,
        username: typeof json.username === "string" ? json.username : undefined,
        role: typeof json.role === "string" ? json.role : undefined,
      },
      expMs: typeof json.exp === "number" ? json.exp * 1000 : 0,
    };
  } catch {
    return null;
  }
}

// Load any stored token at module init, dropping it if already expired/invalid.
(function initFromStorage() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TOKEN_KEY);
  } catch {
    stored = null;
  }
  if (!stored) return;
  const decoded = decodeToken(stored);
  if (decoded && decoded.expMs > Date.now()) {
    nativeToken = stored;
    nativeDecoded = decoded;
  } else {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }
})();

// Cross-tab sync: the `storage` event fires in OTHER tabs when localStorage
// changes here, so a login/logout in one tab mirrors into the rest. Update the
// in-memory state directly — NOT via setNativeToken — to avoid writing back to
// storage and looping. Then emit so subscribers (App.tsx) react.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== TOKEN_KEY) return;
    const stored = e.newValue; // null when the key was removed (logout elsewhere)
    const decoded = stored ? decodeToken(stored) : null;
    if (decoded && decoded.expMs > Date.now()) {
      nativeToken = stored;
      nativeDecoded = decoded;
    } else {
      nativeToken = null;
      nativeDecoded = null;
    }
    emit();
  });
}

// True only when a native token is present AND currently unexpired. Pure (no
// side effects) so it's safe to call from React render via getIdentity().
function isNativeValid(): boolean {
  return nativeToken !== null && nativeDecoded !== null && nativeDecoded.expMs > Date.now();
}

function setNativeToken(token: string | null): void {
  nativeToken = token;
  nativeDecoded = token ? decodeToken(token) : null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — session stays in-memory for this tab */
  }
  emit();
}

function emit(): void {
  const id = getIdentity();
  for (const l of listeners) l(id);
}

// Background sliding renewal — fire-and-forget. Swaps in a fresh 30-day token
// (with current role/username) once the live one is past its half-life. The
// current request keeps using the still-valid token; the refresh only affects
// subsequent ones. Guarded so only one refresh is ever in flight.
async function maybeRefreshSession(): Promise<void> {
  if (refreshInFlight || !nativeToken || !nativeDecoded) return;
  if (nativeDecoded.expMs - Date.now() > REFRESH_WHEN_REMAINING_MS) return;
  refreshInFlight = true;
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { authorization: `Bearer ${nativeToken}` },
    });
    if (res.ok) {
      const body = await res.json();
      if (body?.token) setNativeToken(body.token);
    }
  } catch {
    /* best-effort; token stays valid until it expires */
  } finally {
    refreshInFlight = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The active bearer token, or null when signed out. The one function every
 * fetch() calls to populate `Authorization: Bearer …`. An expired token is
 * cleared here so a dead session never lingers; a live one triggers an
 * opportunistic background refresh.
 */
export async function getSessionToken(): Promise<string | null> {
  if (isNativeValid()) {
    void maybeRefreshSession();
    return nativeToken;
  }
  if (nativeToken) setNativeToken(null); // expired — drop it + notify subscribers
  return null;
}

/** Identity of the signed-in user, or null when signed out. */
export function getIdentity(): Identity | null {
  return isNativeValid() ? nativeDecoded!.identity : null;
}

export function isAuthenticated(): boolean {
  return getIdentity() !== null;
}

/**
 * Subscribe to auth-state changes (token set/cleared, including cross-tab).
 * Fires synchronously on subscribe with the current identity. Returns an
 * unsubscribe function.
 */
export function onAuthChange(cb: (id: Identity | null) => void): () => void {
  listeners.add(cb);
  cb(getIdentity());
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Log in with username + password. POST /api/auth/login → store the native
 * session token. Throws on bad credentials (or if native auth is unavailable).
 */
export async function login(username: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Login failed (HTTP ${res.status})`);
  }
  const body = await res.json();
  setNativeToken(body.token);
}

/**
 * Redeem a one-time admin sign-in link, which carries a short-lived native
 * session token. The sliding refresh extends an active session to full length.
 * Throws if the link has expired or is invalid.
 */
export async function redeemToken(token: string): Promise<void> {
  const decoded = decodeToken(token);
  if (!decoded || decoded.expMs <= Date.now()) {
    throw new Error("This sign-in link has expired or is invalid.");
  }
  setNativeToken(token);
}

export async function logout(): Promise<void> {
  setNativeToken(null);
}
