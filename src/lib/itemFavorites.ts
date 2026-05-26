/**
 * Per-user item favorites — local-first with D1 sync for logged-in users.
 *
 * Mirror of src/lib/featFavorites.ts (which mirrored spellFavorites).
 * Universal scope only — no per-character variant. See featFavorites
 * for the full anon→cloud merge-on-sign-in rule set; same rules
 * apply here.
 *
 * Item IDs span all four item tables (items/weapons/armor/tools) but
 * are universally unique. The endpoint and table don't care which
 * sub-table a favorite came from — the ItemList page filters its
 * loaded corpus by `favorites.has(row.id)` against rows from all
 * four tables, so the favorites pane naturally surfaces whichever
 * kind the user starred.
 */
import { useCallback, useEffect, useState } from 'react';
import { auth } from './firebase';

const LS_KEY = 'dauligor.itemFavorites';
const ENDPOINT = '/api/item-favorites';

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
  } catch { /* quota or disabled — silently degrade */ }
}

async function authHeaders(): Promise<HeadersInit | null> {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fetchCloudFavorites(): Promise<Set<string>> {
  const headers = await authHeaders();
  if (!headers) return new Set();
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers });
    if (!res.ok) return new Set();
    const data = await res.json();
    const ids = Array.isArray(data?.itemIds) ? data.itemIds : [];
    return new Set(ids.map((v: unknown) => String(v)));
  } catch (err) {
    console.warn('[itemFavorites] fetchCloud failed:', err);
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
      console.warn(`[itemFavorites] ${action} failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[itemFavorites] ${action} failed:`, err);
  }
}

export type UseItemFavoritesResult = {
  favorites: Set<string>;
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string) => void;
  hydrating: boolean;
};

export function useItemFavorites(userId: string | null | undefined): UseItemFavoritesResult {
  const [favorites, setFavorites] = useState<Set<string>>(() => readLocal());
  const [hydrating, setHydrating] = useState<boolean>(Boolean(userId));

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
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
      if (onlyInLocal.length > 0) await postFavorite('bulkAdd', { itemIds: onlyInLocal });
      if (cancelled) return;
      setFavorites(union);
      setHydrating(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const isFavorite = useCallback((itemId: string) => favorites.has(itemId), [favorites]);

  const toggleFavorite = useCallback((itemId: string) => {
    if (!itemId) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      const wasStarred = next.has(itemId);
      if (wasStarred) next.delete(itemId);
      else next.add(itemId);
      if (userId) {
        if (wasStarred) void postFavorite('remove', { itemId });
        else void postFavorite('add', { itemId });
      } else {
        writeLocal(next);
      }
      return next;
    });
  }, [userId]);

  return { favorites, isFavorite, toggleFavorite, hydrating };
}
