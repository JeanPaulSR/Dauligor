// Client helpers for the lore (wiki) read + write surface.
//
// These are thin fetch wrappers around the per-route endpoints in
// `api/lore.ts`. The SQL building they used to do client-side (via
// batchQueryD1 / deleteDocument against `lore_*` tables) lives in
// `api/_lib/_lore.ts` now — the server is the single source of truth
// for what a lore save means. The d1-proxy gate blocks direct
// `lore_*` writes AND direct `lore_secrets` reads from the client,
// so call sites MUST go through here (or the per-route endpoint
// directly).
//
// Function signatures are deliberately preserved from the legacy
// helpers so the existing call sites in Wiki.tsx, LoreEditor.tsx, and
// LoreArticle.tsx don't need updates.
//
// `fetchLoreSecrets` and `fetchLoreArticle` both migrated to the
// per-route GET endpoints in `api/lore.ts`. The server does the
// multi-table joins (article + lore_meta_* + lore_article_*) and
// applies the staff-vs-non-staff `dm_notes` strip, so the client
// just unwraps `body.article` or `body.secrets`. The visibility
// filter for secrets runs server-side (non-staff only see secrets
// revealed to their active campaign). No more raw SELECTs against
// `lore_articles` / `lore_secrets` from this module — the proxy's
// PROTECTED_READ_TABLES gate blocks the latter anyway.

import { getSessionToken } from "./auth";

async function authHeader(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonOrThrow(res: Response, fallbackMsg: string): Promise<any> {
  if (res.ok) return res.json().catch(() => ({}));
  const errBody = await res.json().catch(() => ({}));
  throw new Error(errBody?.error || `${fallbackMsg} (HTTP ${res.status})`);
}

/**
 * Idempotent upsert. The server builds the multi-table batch from
 * api/_lib/_lore.ts and runs it; we just hand it the payload and the
 * dmNotes string (kept separate from the rest of the payload because
 * the legacy helper signature did, and because dm_notes is the
 * single most-sensitive column on the row).
 *
 * `authorId` is NEVER sent — the server takes it from the verified
 * token. Any `payload.authorId` in the body is ignored.
 */
export async function upsertLoreArticle(id: string, payload: any) {
  const res = await fetch(`/api/lore/articles/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ article: payload }),
  });
  return jsonOrThrow(res, "Failed to save article");
}

export async function deleteLoreArticle(articleId: string) {
  const res = await fetch(
    `/api/lore/articles/${encodeURIComponent(articleId)}`,
    { method: "DELETE", headers: await authHeader() },
  );
  return jsonOrThrow(res, "Failed to delete article");
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */
//
// Both reads now go through the per-route endpoints in `api/lore.ts`.
// The server does the multi-table join (article + lore_meta_* +
// lore_article_eras / _campaigns / _tags) and applies the
// staff-vs-non-staff `dm_notes` strip. The client just unwraps the
// JSON. This means:
//
//   - Drafts return 404 for non-staff (the legacy client-side `if
//     (article.status !== 'published')` filter ran AFTER the row was
//     already on the wire — leaked draft titles via timing if nothing
//     else).
//   - `dm_notes` only ships when the caller is staff.
//   - The proxy `lore_articles` SELECT path that `fetchDocument` used
//     to take is unneeded; one fewer raw read of a sensitive-column
//     table.
//
// `fetchLoreSecrets` goes through its own per-route endpoint (see
// below) because `lore_secrets` is in PROTECTED_READ_TABLES — direct
// SELECTs would 403.

/**
 * Fetch a complete Lore Article with all metadata, tags, and junctions.
 *
 * Returns `null` for 404 (article doesn't exist OR caller is non-staff
 * viewing a draft — the server intentionally returns 404 instead of
 * 403 in both cases so a non-staff probe can't tell a draft id from a
 * nonexistent one).
 *
 * Throws for any other non-2xx so callers can surface a real error
 * instead of treating a 5xx as "missing article".
 */
export async function fetchLoreArticle(id: string) {
  const res = await fetch(
    `/api/lore/articles/${encodeURIComponent(id)}`,
    { headers: await authHeader() },
  );
  if (res.status === 404) return null;
  const body = await jsonOrThrow(res, "Failed to load article");
  return body?.article ?? null;
}


