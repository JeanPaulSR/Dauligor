// Client-side calls into the module-export queue/rebake endpoints.
//
// Editors call `queueRebake(kind, id)` after a successful upsert. The server
// debounces (default 1h after last edit) before regenerating the R2-cached
// bundles, so consecutive edits on the same entity in a session don't
// rebuild on each save. Manual "Bake Now" buttons call `rebakeNow(kind, id)`
// for an immediate sync rebake.
//
// All calls are best-effort — a failure here doesn't roll back the save
// that just succeeded. Worst case is the export caches stay stale until
// another save fires a rebake or someone hits "Bake Now".

import { auth } from './firebase';

export type ExportEntityKind =
  | 'class'
  | 'subclass'
  | 'feature'
  | 'scalingColumn'
  | 'optionGroup'
  | 'optionItem'
  | 'source';

async function authHeaders(): Promise<HeadersInit | null> {
  if (!auth.currentUser) return null;
  try {
    const idToken = await auth.currentUser.getIdToken();
    return {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    };
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget — schedules a rebake at least 1h from now. Consecutive
 * saves on the same entity reset that 1h clock (server-side UPSERT).
 */
export async function queueRebake(kind: ExportEntityKind, id: string): Promise<void> {
  if (!id) return;
  try {
    const headers = await authHeaders();
    if (!headers) return;
    await fetch('/api/module/queue-rebake', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, id }),
    });
  } catch (error) {
    console.warn('[moduleExport] queueRebake failed', { kind, id, error });
  }
}

/**
 * Synchronous rebake — runs the export pipeline now and writes R2. Returns
 * `{ ok, written, error? }` so the caller can show a toast.
 */
export async function rebakeNow(
  kind: ExportEntityKind,
  id: string,
): Promise<{ ok: boolean; written: string[]; error?: string }> {
  if (!id) return { ok: false, written: [], error: 'No id provided.' };

  const headers = await authHeaders();
  if (!headers) return { ok: false, written: [], error: 'You must be signed in.' };

  try {
    const res = await fetch('/api/module/rebake-now', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, id }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, written: [], error: text || `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    return { ok: true, written: Array.isArray(json?.written) ? json.written : [] };
  } catch (error: any) {
    return { ok: false, written: [], error: error?.message ?? String(error) };
  }
}
