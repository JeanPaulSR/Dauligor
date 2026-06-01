/**
 * Per-user favorites for the Species + Background browsers — local-first
 * with D1 sync for signed-in users. One hook, keyed by `kind`, so a
 * browser can call it unconditionally (Rules of Hooks). Mirrors
 * `featFavorites.ts` / `spellFavorites.ts`:
 *
 *   • Anonymous toggle   → write localStorage; cloud untouched.
 *   • Sign-in sync       → union(cloud, local) in memory; local-only
 *                          entries pushed to cloud; localStorage NOT
 *                          overwritten (it's the pre-login anon snapshot).
 *   • Signed-in toggle   → write cloud; localStorage untouched.
 *   • Sign-out           → in-memory reverts to localStorage.
 *
 * Endpoints (functions/api/{species,background}-favorites.ts) derive the
 * user_id from the verified token — the client can't read another user's
 * favorites. Universal scope only (no per-character variant).
 */
import { useCallback, useEffect, useState } from 'react';
import { auth } from './firebase';

export type FavoriteKind = 'species' | 'background';

type KindConfig = {
  lsKey: string;
  endpoint: string;
  /** POST body key for a single id (add/remove). */
  idKey: string;
  /** GET response key + POST bulkAdd body key for the id array. */
  idsKey: string;
};

const CONFIG: Record<FavoriteKind, KindConfig> = {
  species: {
    lsKey: 'dauligor.speciesFavorites',
    endpoint: '/api/species-favorites',
    idKey: 'speciesId',
    idsKey: 'speciesIds',
  },
  background: {
    lsKey: 'dauligor.backgroundFavorites',
    endpoint: '/api/background-favorites',
    idKey: 'backgroundId',
    idsKey: 'backgroundIds',
  },
};

// ── localStorage backend ───────────────────────────────────────────

function readLocal(lsKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(lsKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v) => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writeLocal(lsKey: string, ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lsKey, JSON.stringify(Array.from(ids)));
  } catch {
    /* quota or disabled — silently degrade */
  }
}

// ── Cloud backend ──────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit | null> {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fetchCloudFavorites(cfg: KindConfig): Promise<Set<string>> {
  const headers = await authHeaders();
  if (!headers) return new Set();
  try {
    const res = await fetch(cfg.endpoint, { method: 'GET', headers });
    if (!res.ok) return new Set();
    const data = await res.json();
    const ids = Array.isArray(data?.[cfg.idsKey]) ? data[cfg.idsKey] : [];
    return new Set(ids.map((v: unknown) => String(v)));
  } catch (err) {
    console.warn(`[${cfg.endpoint}] fetchCloud failed:`, err);
    return new Set();
  }
}

async function postFavorite(
  cfg: KindConfig,
  action: 'add' | 'remove' | 'bulkAdd',
  payload: Record<string, unknown>,
): Promise<void> {
  const headers = await authHeaders();
  if (!headers) return;
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) console.warn(`[${cfg.endpoint}] ${action} failed: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[${cfg.endpoint}] ${action} failed:`, err);
  }
}

// ── Hook ───────────────────────────────────────────────────────────

export type UseFavoritesResult = {
  favorites: Set<string>;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  hydrating: boolean;
};

export function useSpeciesBackgroundFavorites(
  kind: FavoriteKind,
  userId: string | null | undefined,
): UseFavoritesResult {
  const cfg = CONFIG[kind];
  const [favorites, setFavorites] = useState<Set<string>>(() => readLocal(cfg.lsKey));
  const [hydrating, setHydrating] = useState<boolean>(Boolean(userId));

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setFavorites(readLocal(cfg.lsKey));
      setHydrating(false);
      return;
    }
    setHydrating(true);
    (async () => {
      const cloud = await fetchCloudFavorites(cfg);
      const local = readLocal(cfg.lsKey);
      const union = new Set<string>([...cloud, ...local]);
      const onlyInLocal = Array.from(local).filter((id) => !cloud.has(id));
      if (onlyInLocal.length > 0) await postFavorite(cfg, 'bulkAdd', { [cfg.idsKey]: onlyInLocal });
      if (cancelled) return;
      setFavorites(union);
      setHydrating(false);
    })();
    return () => { cancelled = true; };
  }, [userId, kind, cfg]);

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    if (!id) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      const wasStarred = next.has(id);
      if (wasStarred) next.delete(id);
      else next.add(id);
      if (userId) {
        if (wasStarred) void postFavorite(cfg, 'remove', { [cfg.idKey]: id });
        else void postFavorite(cfg, 'add', { [cfg.idKey]: id });
      } else {
        writeLocal(cfg.lsKey, next);
      }
      return next;
    });
  }, [userId, cfg]);

  return { favorites, isFavorite, toggleFavorite, hydrating };
}
