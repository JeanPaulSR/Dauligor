/**
 * Per-user feat favorites — local-first with D1 sync for logged-in users.
 *
 * Storage layers:
 *   1. localStorage (`dauligor.featFavorites`) — the **anonymous** snapshot.
 *      Writable only while logged out; while signed in it's read-only and
 *      represents what the user will see again on next logout.
 *   2. `/api/feat-favorites` (D1 `user_feat_favorites`) — the **account**
 *      copy for signed-in users. On sign-in, any anon-only entries are
 *      promoted into the account (one-way migration). Subsequent toggles
 *      while signed in write to the account only.
 *
 * Mirrors `spellFavorites.ts` exactly except that:
 *   - Universal scope only (no per-character variant). Feat favorites
 *     are account-level "starred for later" picks; per-character feat
 *     prep isn't a concept in 5e the way per-character spell prep is.
 *     If a future feature needs it, add a parallel `character_feat_favorites`
 *     table + scope arg the same way the spell side does.
 *   - Cloud payload key is `featIds` (not `spellIds`); endpoint body
 *     uses `featId` (not `spellId`).
 *
 * Rules (mirror spellFavorites for cross-page consistency):
 *   • Anonymous toggle      → write localStorage; cloud untouched.
 *   • Sign-in cloud sync    → union (cloud + local) shown in memory;
 *                              local-only entries pushed to cloud;
 *                              **localStorage is NOT overwritten**.
 *   • Signed-in toggle      → write cloud; localStorage untouched.
 *   • Sign-out              → in-memory state reverts to localStorage
 *                              (the unchanged pre-login snapshot).
 *
 * The endpoint accepts any authenticated user (not just staff) and
 * always derives the user_id from the verified token — the client
 * cannot ask about another user's favorites.
 */
import { useCallback, useEffect, useState } from 'react';
import { getSessionToken, isAuthenticated } from "./auth";

const LS_KEY = 'dauligor.featFavorites';
const ENDPOINT = '/api/feat-favorites';

// ---------------------------------------------------------------------------
// localStorage backend
// ---------------------------------------------------------------------------

function readLocal(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v) => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writeLocal(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* quota or disabled — silently degrade */
  }
}

// ---------------------------------------------------------------------------
// Cloud backend
// ---------------------------------------------------------------------------

async function authHeaders(): Promise<HeadersInit | null> {
  if (!isAuthenticated()) return null;
  const token = await getSessionToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function fetchCloudFavorites(): Promise<Set<string>> {
  const headers = await authHeaders();
  if (!headers) return new Set();
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers });
    if (!res.ok) return new Set();
    const data = await res.json();
    const ids = Array.isArray(data?.featIds) ? data.featIds : [];
    return new Set(ids.map((v: unknown) => String(v)));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[featFavorites] fetchCloud failed:', err);
    return new Set();
  }
}

async function postFavorite(
  action: 'add' | 'remove' | 'bulkAdd',
  payload: Record<string, unknown>,
): Promise<void> {
  const headers = await authHeaders();
  if (!headers) return;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[featFavorites] ${action} failed: HTTP ${res.status}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[featFavorites] ${action} failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseFeatFavoritesResult = {
  /** Set of favorited feat IDs. Always returns a Set (never null). */
  favorites: Set<string>;
  /** True if the given feat ID is starred. */
  isFavorite: (featId: string) => boolean;
  /** Toggle the favorite state for a feat. Writes through both layers. */
  toggleFavorite: (featId: string) => void;
  /** True until the initial cloud-sync (if applicable) resolves. */
  hydrating: boolean;
};

/**
 * Hook entry point.
 *
 * Universal scope only — no per-character variant. On mount/userId
 * change: synchronous read from localStorage paints favorites
 * immediately, then a cloud fetch merges local ↔ cloud both ways and
 * writes the union back. See the file header comment for the full
 * persistence rule set (same as spellFavorites).
 */
export function useFeatFavorites(userId: string | null | undefined): UseFeatFavoritesResult {
  const [favorites, setFavorites] = useState<Set<string>>(() => readLocal());
  const [hydrating, setHydrating] = useState<boolean>(Boolean(userId));

  // Cloud sync — runs whenever userId changes. Identical merge
  // algorithm to spellFavorites: read local, fetch cloud, take the
  // union in-memory, promote local-only entries to cloud, leave
  // localStorage untouched.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      // Anonymous session — local is the only source.
      setFavorites(readLocal());
      setHydrating(false);
      return;
    }
    setHydrating(true);
    (async () => {
      const cloud = await fetchCloudFavorites();
      const local = readLocal();
      const union = new Set<string>([...cloud, ...local]);
      const onlyInLocal = Array.from(local).filter((id) => !cloud.has(id));
      if (onlyInLocal.length > 0) await postFavorite('bulkAdd', { featIds: onlyInLocal });
      if (cancelled) return;
      // localStorage is deliberately not rewritten here — it's the
      // pre-login anon snapshot that survives sign-out. See header.
      setFavorites(union);
      setHydrating(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const isFavorite = useCallback((featId: string) => favorites.has(featId), [favorites]);

  const toggleFavorite = useCallback((featId: string) => {
    if (!featId) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      const wasStarred = next.has(featId);
      if (wasStarred) next.delete(featId);
      else next.add(featId);
      if (userId) {
        if (wasStarred) void postFavorite('remove', { featId });
        else void postFavorite('add', { featId });
      } else {
        writeLocal(next);
      }
      return next;
    });
  }, [userId]);

  return { favorites, isFavorite, toggleFavorite, hydrating };
}
