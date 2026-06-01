// Client auth — the native session layer that replaces direct Firebase SDK use.
//
// Part of retiring Firebase Auth (see
// docs/_drafts/auth-cloudflare-migration-plan-2026-05-31.html). This module is
// the SINGLE place the client decides "what is my bearer token" and "who am I",
// so every API call site can stop reaching into `firebase.auth.currentUser`.
//
// Dual-mode during the migration window:
//   - NATIVE: a 30-day session JWT from POST /api/auth/login, kept in
//     localStorage. Preferred when present + unexpired.
//   - FIREBASE (fallback): an existing Firebase session, used until the account
//     is adopted. `login()` falls back to it and fires the hash-on-next-login
//     cutover (POST /api/auth/adopt) so the NEXT login is native.
//
// Once every account is adopted and the client is fully on native tokens
// (Phase 5), the Firebase branches here and the `firebase` dep can be deleted —
// this module's public surface stays the same.

import { auth as firebaseAuth, usernameToEmail } from "./firebase";
import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";

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
// changes here, so a native login/logout in one tab mirrors into the rest.
// (Firebase already syncs its own session across tabs via onAuthStateChanged;
// this covers the native token, which Firebase knows nothing about.) We update
// the in-memory state directly — NOT via setNativeToken — to avoid writing back
// to storage and looping. Then emit so subscribers (App.tsx) react.
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
    // On failure (401/network) the existing token stays valid until it expires;
    // the user re-logs in then. Nothing to do here.
  } catch {
    /* best-effort */
  } finally {
    refreshInFlight = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The active bearer token: the native session if present + unexpired, else the
 * current Firebase ID token, else null. This is the one function every fetch()
 * should call to populate `Authorization: Bearer …`. An expired native token is
 * cleared here so a dead session never lingers.
 */
export async function getSessionToken(): Promise<string | null> {
  if (isNativeValid()) {
    void maybeRefreshSession(); // opportunistic sliding renewal (non-blocking)
    return nativeToken;
  }
  if (nativeToken) setNativeToken(null); // expired — drop it + notify subscribers
  if (firebaseAuth.currentUser) return await firebaseAuth.currentUser.getIdToken();
  return null;
}

/** Normalised identity from whichever mode is active, or null when signed out. */
export function getIdentity(): Identity | null {
  if (isNativeValid()) return nativeDecoded!.identity;
  const u = firebaseAuth.currentUser;
  if (u) return { uid: u.uid, email: u.email };
  return null;
}

export function isAuthenticated(): boolean {
  return getIdentity() !== null;
}

/**
 * Subscribe to auth-state changes (native token set/cleared OR Firebase
 * sign-in/out). Returns an unsubscribe function.
 *
 * Fires synchronously on subscribe ONLY when there's a definitive native
 * session; otherwise it waits for Firebase's first onAuthStateChanged (which
 * always fires once on init). That avoids flashing "logged out" — and resolving
 * a loading gate early — while a Firebase session is still being restored.
 */
export function onAuthChange(cb: (id: Identity | null) => void): () => void {
  listeners.add(cb);
  const unsubFirebase = onAuthStateChanged(firebaseAuth, () => emit());
  if (isNativeValid()) cb(getIdentity());
  return () => {
    listeners.delete(cb);
    unsubFirebase();
  };
}

/**
 * Native-first login with Firebase fallback for the migration window.
 *
 *  1. POST /api/auth/login. If the account is already adopted → native session,
 *     done (no Firebase involved).
 *  2. On 401/503 (not adopted yet, or native auth not configured) fall back to
 *     Firebase. On success, POST /api/auth/adopt with the plaintext so the D1
 *     hash is written and the NEXT login goes native.
 *
 * Throws on invalid credentials (both paths rejected).
 */
export async function login(username: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (res.ok) {
    const body = await res.json();
    // Set native FIRST so getIdentity() is never momentarily null, THEN clear
    // any stale Firebase session.
    setNativeToken(body.token);
    if (firebaseAuth.currentUser) {
      await firebaseSignOut(firebaseAuth).catch(() => {});
    }
    return;
  }

  // Only fall through to Firebase for "no native credential" outcomes; surface
  // anything else (500, etc.) as a real error.
  if (res.status !== 401 && res.status !== 503) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Login failed (HTTP ${res.status})`);
  }

  // Firebase fallback — throws on bad credentials.
  await signInWithEmailAndPassword(firebaseAuth, usernameToEmail(username), password);

  // Hash-on-next-login cutover: write the D1 hash so the next login is native.
  // Non-fatal — a failed adopt just means we retry the migration next time.
  try {
    const idToken = await firebaseAuth.currentUser?.getIdToken();
    if (idToken) {
      await fetch("/api/auth/adopt", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ password }),
      });
    }
  } catch (err) {
    console.warn("[auth] adopt-on-login failed (non-fatal):", err);
  }
  emit();
}

/** Redeem a one-time admin sign-in link. Still a Firebase custom token until the
 *  server-side mint is swapped to a native one-time token (Phase 3b/5). */
export async function redeemToken(token: string): Promise<void> {
  await signInWithCustomToken(firebaseAuth, token);
}

export async function logout(): Promise<void> {
  // Clear the native session SILENTLY first (no emit yet), then sign out
  // Firebase, then emit once. Otherwise an intermediate emit fires while the
  // Firebase session is still live → getIdentity() returns the still-signed-in
  // user → App re-runs loadProfile() and re-populates the profile after logout
  // (the UI keeps the logged-in appearance/role).
  nativeToken = null;
  nativeDecoded = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  if (firebaseAuth.currentUser) {
    await firebaseSignOut(firebaseAuth).catch(() => {});
  }
  emit();
}
