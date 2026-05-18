/**
 * Per-user spell favorites — local-first with D1 sync for logged-in users.
 *
 * Storage layers:
 *   1. localStorage (`dauligor.spellFavorites`) — the **anonymous** snapshot.
 *      Writable only while logged out; while signed in it's read-only and
 *      represents what the user will see again on next logout.
 *   2. `/api/spell-favorites` (D1 `user_spell_favorites`) — the **account**
 *      copy for signed-in users. On sign-in, any anon-only entries are
 *      promoted into the account (one-way migration). Subsequent toggles
 *      while signed in write to the account only.
 *
 * Why the split:
 *   - Anonymous favorites added on this browser should follow the user
 *     into their account on first sign-in ("I starred a few things while
 *     browsing logged-out; keep them once I log in").
 *   - When the user signs out, they should see exactly what they had
 *     before signing in — not the account's full set. Otherwise the next
 *     account that signs in on this browser would inherit the previous
 *     user's stars (and worse, have them promoted into its cloud copy
 *     via the migration step).
 *
 * Concretely, the rules are:
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

async function fetchCloudFavorites(scope: FavoriteScope): Promise<Set<string>> {
  const headers = await authHeaders();
  if (!headers) return new Set();
  try {
    const url = scope
      ? `${ENDPOINT}?characterId=${encodeURIComponent(scope.characterId)}`
      : ENDPOINT;
    const res = await fetch(url, { method: 'GET', headers });
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

async function postFavorite(
  action: 'add' | 'remove' | 'bulkAdd',
  payload: Record<string, unknown>,
  scope: FavoriteScope,
): Promise<void> {
  const headers = await authHeaders();
  if (!headers) return;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      // characterId is part of the body so the action handler can
      // route to the right table (and verify ownership). Universal
      // scope omits it.
      body: JSON.stringify({
        action,
        ...payload,
        ...(scope ? { characterId: scope.characterId } : {}),
      }),
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
 *   localStorage key `dauligor.spellFavorites` + cloud-sync via
 *   /api/spell-favorites. On mount/userId-change: synchronous read
 *   from localStorage paints favorites immediately, then a cloud
 *   fetch merges local ↔ cloud both ways and writes the union back.
 *
 * Character scope (`scope.characterId` set):
 *   localStorage key `dauligor.spellFavorites.character.<id>` +
 *   cloud-sync via /api/spell-favorites?characterId=<id>. Same
 *   union-merge pattern as universal. The server enforces that the
 *   caller actually owns the character — if not, the GET 404s and
 *   the hook silently falls back to localStorage-only.
 *
 * Switching scopes (e.g. picking a different character in the
 * dropdown) re-runs the effect with the new key and reloads the
 * matching favorites set.
 */
export function useSpellFavorites(
  userId: string | null | undefined,
  scope: FavoriteScope = null,
): UseSpellFavoritesResult {
  const scopeKey = scope?.characterId ?? null;
  const [favorites, setFavorites] = useState<Set<string>>(() => readLocal(scope));
  const [hydrating, setHydrating] = useState<boolean>(Boolean(userId));

  // Cloud sync — runs whenever userId or scope changes. For both
  // scopes we do the same merge: read local, fetch cloud, take the
  // union, promote local-only entries to cloud, write the union back
  // to local. The endpoint URL/body change but the algorithm is
  // identical.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      // Anonymous session — local is the only source (no cloud
      // identity to associate writes with). Re-read in case the
      // scope changed since the initial state.
      setFavorites(readLocal(scope));
      setHydrating(false);
      return;
    }
    setHydrating(true);
    (async () => {
      const cloud = await fetchCloudFavorites(scope);
      const local = readLocal(scope);
      // In-memory display = union of both. Removals while signed in
      // happen against cloud only and don't affect the in-memory
      // result here because this effect re-runs on next sign-in.
      const union = new Set<string>([...cloud, ...local]);
      // One-way migration: any anon-only entries get promoted to the
      // cloud account. Idempotent (`ON CONFLICT DO NOTHING`).
      const onlyInLocal = Array.from(local).filter((id) => !cloud.has(id));
      if (onlyInLocal.length > 0) await postFavorite('bulkAdd', { spellIds: onlyInLocal }, scope);
      if (cancelled) return;
      // NOTE: deliberately NOT writing localStorage here. localStorage
      // is the pre-login anon snapshot and stays read-only for the
      // duration of this signed-in session — see the file header
      // comment for the full rule set. Sign-out restores in-memory
      // state to whatever this snapshot still holds.
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
      // Persistence destination depends on auth state:
      //   - Anonymous → localStorage. Cloud has no row to write.
      //   - Signed-in → cloud only. localStorage stays as the
      //     pre-login snapshot so it survives the next sign-out.
      if (userId) {
        if (wasStarred) void postFavorite('remove', { spellId }, scope);
        else void postFavorite('add', { spellId }, scope);
      } else {
        writeLocal(next, scope);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, scopeKey]);

  return { favorites, isFavorite, toggleFavorite, hydrating };
}
