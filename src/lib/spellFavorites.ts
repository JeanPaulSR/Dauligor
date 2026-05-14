/**
 * Per-user spell favorites — local-first with D1 sync for logged-in users.
 *
 * Storage layers:
 *   1. localStorage (`dauligor.spellFavorites`) — primary read source and
 *      first writer. Survives anonymous browsing, supports offline toggles.
 *   2. `/api/spell-favorites` (D1 `user_spell_favorites`) — cloud copy
 *      for logged-in users only. On hook init: union of local + cloud
 *      is computed, written back to both. Subsequent toggles write
 *      through to both.
 *
 * Design intent: a player browsing on PC and phone should see the same
 * starred spells. Anonymous browsing still works (localStorage only).
 * Login → device-A favorites added in anon mode get promoted to D1 and
 * propagate to device-B on its next mount.
 *
 * The endpoint accepts any authenticated user (not just staff) and
 * always derives the user_id from the verified token — the client
 * cannot ask about another user's favorites.
 */
import { useCallback, useEffect, useState } from 'react';
import { auth } from './firebase';

const LS_KEY = 'dauligor.spellFavorites';
const ENDPOINT = '/api/spell-favorites';

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
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
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
    const ids = Array.isArray(data?.spellIds) ? data.spellIds : [];
    return new Set(ids.map((v: unknown) => String(v)));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[spellFavorites] fetchCloud failed:', err);
    return new Set();
  }
}

async function postFavorite(action: 'add' | 'remove' | 'bulkAdd', payload: Record<string, unknown>): Promise<void> {
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
      console.warn(`[spellFavorites] ${action} failed: HTTP ${res.status}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[spellFavorites] ${action} failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseSpellFavoritesResult = {
  /** Set of favorited spell IDs. Always returns a Set (never null). */
  favorites: Set<string>;
  /** True if the given spell ID is starred. */
  isFavorite: (spellId: string) => boolean;
  /** Toggle the favorite state for a spell. Writes through both layers. */
  toggleFavorite: (spellId: string) => void;
  /** True until the initial cloud-sync (if applicable) resolves. */
  hydrating: boolean;
};

/**
 * Hook entry point. Pass the current user id (or null/undefined for
 * anonymous). On mount: read localStorage immediately (synchronous,
 * paints favorites without waiting on the network), then fire a
 * cloud-sync that merges local ↔ cloud both ways and writes the
 * union back to both layers.
 *
 * `userId` changes (login / logout) re-trigger the sync.
 */
export function useSpellFavorites(userId: string | null | undefined): UseSpellFavoritesResult {
  const [favorites, setFavorites] = useState<Set<string>>(() => readLocal());
  const [hydrating, setHydrating] = useState<boolean>(Boolean(userId));

  // Cloud sync — runs whenever userId changes.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      // Anonymous session — local is the only source of truth.
      setHydrating(false);
      return;
    }
    setHydrating(true);
    (async () => {
      const cloud = await fetchCloudFavorites();
      const local = readLocal();
      // Union: any starred on either device counts. (Removing a
      // favorite is rare enough that this asymmetric "merge then
      // promote" wins simplicity vs. last-write timestamps.)
      const union = new Set<string>([...cloud, ...local]);
      // Promote local-only entries to cloud (login migration).
      const onlyInLocal = Array.from(local).filter((id) => !cloud.has(id));
      if (onlyInLocal.length > 0) await postFavorite('bulkAdd', { spellIds: onlyInLocal });
      if (cancelled) return;
      writeLocal(union);
      setFavorites(union);
      setHydrating(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const isFavorite = useCallback((spellId: string) => favorites.has(spellId), [favorites]);

  const toggleFavorite = useCallback((spellId: string) => {
    if (!spellId) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      const wasStarred = next.has(spellId);
      if (wasStarred) next.delete(spellId);
      else next.add(spellId);
      writeLocal(next);
      if (userId) {
        if (wasStarred) void postFavorite('remove', { spellId });
        else void postFavorite('add', { spellId });
      }
      return next;
    });
  }, [userId]);

  return { favorites, isFavorite, toggleFavorite, hydrating };
}
