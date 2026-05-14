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

// Universal-favorites key (default scope: scope === null).
const UNIVERSAL_LS_KEY = 'dauligor.spellFavorites';
// Per-character favorites key prefix. Final key is `${prefix}.${characterId}`.
// Keeping the namespace under `dauligor.spellFavorites` keeps any future
// "wipe favorites" admin tooling able to find all related keys with a
// single `startsWith` check on localStorage.
const CHARACTER_LS_KEY_PREFIX = 'dauligor.spellFavorites.character';
const ENDPOINT = '/api/spell-favorites';

/**
 * The scope a favorites toggle writes to. `null` = the user-level
 * "Universal Favorite" set (cross-character, cloud-synced via D1).
 * A character id = a per-character favorite set stored locally only
 * for now — cloud sync for per-character favorites is a follow-up
 * (would need a new D1 table and endpoint).
 */
export type FavoriteScope = { characterId: string } | null;

function lsKeyForScope(scope: FavoriteScope): string {
  if (!scope) return UNIVERSAL_LS_KEY;
  return `${CHARACTER_LS_KEY_PREFIX}.${scope.characterId}`;
}

// ---------------------------------------------------------------------------
// localStorage backend
// ---------------------------------------------------------------------------

function readLocal(scope: FavoriteScope): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(lsKeyForScope(scope));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v) => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writeLocal(ids: Set<string>, scope: FavoriteScope) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lsKeyForScope(scope), JSON.stringify(Array.from(ids)));
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
 * Hook entry point.
 *
 * Universal scope (default, `scope === null`):
 *   Pass the current user id (or null/undefined for anonymous). On
 *   mount: read localStorage immediately (synchronous, paints
 *   favorites without waiting on the network), then fire a
 *   cloud-sync that merges local ↔ cloud both ways and writes the
 *   union back to both layers. `userId` changes (login / logout)
 *   re-trigger the sync.
 *
 * Character scope (`scope.characterId` set):
 *   Per-character favorites — stored in localStorage under a key
 *   that includes the character id, no cloud sync. Switching the
 *   scope (e.g. selecting a different character in the dropdown)
 *   reloads from the new key so the favorites set always reflects
 *   the active scope. Cloud sync for per-character favorites is a
 *   follow-up — it needs a new D1 table and endpoint.
 */
export function useSpellFavorites(
  userId: string | null | undefined,
  scope: FavoriteScope = null,
): UseSpellFavoritesResult {
  const scopeKey = scope?.characterId ?? null;
  const [favorites, setFavorites] = useState<Set<string>>(() => readLocal(scope));
  const [hydrating, setHydrating] = useState<boolean>(Boolean(userId) && !scope);

  // Re-read localStorage whenever the scope changes (e.g. user
  // switches from "Universal Favorite" to a character). For the
  // universal scope this is followed by a cloud-sync merge; for
  // character scope it's the final read.
  useEffect(() => {
    let cancelled = false;
    if (scope) {
      // Character scope — local-only. No cloud sync (yet).
      setFavorites(readLocal(scope));
      setHydrating(false);
      return;
    }
    if (!userId) {
      // Anonymous universal session — local is the only source.
      setFavorites(readLocal(null));
      setHydrating(false);
      return;
    }
    setHydrating(true);
    (async () => {
      const cloud = await fetchCloudFavorites();
      const local = readLocal(null);
      // Union: any starred on either device counts. (Removing a
      // favorite is rare enough that this asymmetric "merge then
      // promote" wins simplicity vs. last-write timestamps.)
      const union = new Set<string>([...cloud, ...local]);
      // Promote local-only entries to cloud (login migration).
      const onlyInLocal = Array.from(local).filter((id) => !cloud.has(id));
      if (onlyInLocal.length > 0) await postFavorite('bulkAdd', { spellIds: onlyInLocal });
      if (cancelled) return;
      writeLocal(union, null);
      setFavorites(union);
      setHydrating(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, scopeKey]);

  const isFavorite = useCallback((spellId: string) => favorites.has(spellId), [favorites]);

  const toggleFavorite = useCallback((spellId: string) => {
    if (!spellId) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      const wasStarred = next.has(spellId);
      if (wasStarred) next.delete(spellId);
      else next.add(spellId);
      writeLocal(next, scope);
      // Cloud sync only fires for the universal scope. Character-
      // scoped favorites are localStorage-only for now.
      if (!scope && userId) {
        if (wasStarred) void postFavorite('remove', { spellId });
        else void postFavorite('add', { spellId });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, scopeKey]);

  return { favorites, isFavorite, toggleFavorite, hydrating };
}
