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
// `fetchLoreSecrets` migrated to the per-route `GET
// /api/lore/articles/[id]/secrets` endpoint, which applies the
// server-side visibility filter (non-staff only see secrets revealed
// to their active campaign). The legacy raw `SELECT * FROM
// lore_secrets` path it used to take is now blocked by the proxy's
// PROTECTED_READ_TABLES gate.
//
// `fetchLoreArticle` still uses `fetchDocument('lore', id)` for the
// editor load path — `lore_articles` reads aren't proxy-blocked
// because `dm_notes` is stripped at the per-route GET layer and the
// editor specifically needs the raw row. Migrating it to a per-route
// endpoint is a smaller follow-up that doesn't gate on the
// read-protection work.

import { auth } from "./firebase";
import { deleteDocument, queryD1 } from "./d1";

async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
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
export async function upsertLoreArticle(id: string, payload: any, dmNotes: string) {
  const res = await fetch(`/api/lore/articles/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ article: payload, dmNotes }),
  });
  return jsonOrThrow(res, "Failed to save article");
}

export async function upsertLoreSecret(articleId: string, secretId: string, data: any) {
  const res = await fetch(
    `/api/lore/articles/${encodeURIComponent(articleId)}/secrets/${encodeURIComponent(secretId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ secret: data }),
    },
  );
  return jsonOrThrow(res, "Failed to save secret");
}

export async function deleteLoreSecret(secretId: string) {
  // Server-side cascade does the work — `lore_secrets` rows have an
  // FK that clears `lore_secret_eras` / `lore_secret_campaigns`
  // automatically. The client no longer needs to look up the
  // article id first; previously this round-tripped through
  // `SELECT article_id FROM lore_secrets WHERE id = ?` just to build
  // the `/articles/<articleId>/secrets/<secretId>` URL, but that
  // direct SELECT path is now blocked by the proxy's
  // PROTECTED_READ_TABLES gate (lore_secrets content is sensitive
  // even for staff querying outside the per-route endpoint).
  //
  // The simpler URL `/api/lore/secrets/<secretId>` exists in
  // api/lore.ts specifically to support this client flow.
  const res = await fetch(
    `/api/lore/secrets/${encodeURIComponent(secretId)}`,
    { method: "DELETE", headers: await authHeader() },
  );
  return jsonOrThrow(res, "Failed to delete secret");
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
// `fetchLoreArticle` still goes through the generic proxy
// (`fetchDocument('lore', id)` + a handful of `lore_meta_*` /
// `lore_article_*` joins). Those tables are NOT in the proxy's
// PROTECTED_READ_TABLES gate — `lore_articles.dm_notes` is the only
// sensitive column there, and it's stripped at the per-route GET
// layer. The editor needs the raw shape (including dm_notes) so it
// still calls the generic helpers; migrating to a dedicated
// editor-side GET is a small follow-up. UI consumers
// (LoreArticle.tsx, Wiki.tsx, Home.tsx, etc.) have already migrated
// to the per-route GET that strips dm_notes.
//
// `fetchLoreSecrets` is now per-route (see below) because
// `lore_secrets` IS in PROTECTED_READ_TABLES — the visibility filter
// MUST run server-side for the H3 closure to hold.

/**
 * Fetch a complete Lore Article with all metadata, tags, and junctions.
 */
export async function fetchLoreArticle(id: string) {
  const { fetchDocument } = await import("./d1");
  const articleData = await fetchDocument<any>("lore", id);
  if (!articleData) return null;

  const normalized = {
    ...articleData,
    parentId: articleData.parent_id,
    dmNotes: articleData.dm_notes,
    imageUrl: articleData.image_url,
    imageDisplay: typeof articleData.image_display === "string" ? JSON.parse(articleData.image_display) : articleData.image_display,
    cardImageUrl: articleData.card_image_url,
    cardDisplay: typeof articleData.card_display === "string" ? JSON.parse(articleData.card_display) : articleData.card_display,
    previewImageUrl: articleData.preview_image_url,
    previewDisplay: typeof articleData.preview_display === "string" ? JSON.parse(articleData.preview_display) : articleData.preview_display,
    createdAt: articleData.created_at,
    updatedAt: articleData.updated_at,
    authorId: articleData.author_id,
  };

  let metadata: any = {};
  if (["character", "deity"].includes(normalized.category)) {
    const rows = await queryD1<any>(`SELECT * FROM lore_meta_characters WHERE article_id = ?`, [id]);
    if (rows.length > 0) {
      const m = rows[0];
      metadata = { ...metadata, ...m, lifeStatus: m.life_status, birthDate: m.birth_date, deathDate: m.death_date };
    }
    if (normalized.category === "deity") {
      const dRows = await queryD1<any>(`SELECT * FROM lore_meta_deities WHERE article_id = ?`, [id]);
      if (dRows.length > 0) metadata = { ...metadata, ...dRows[0], holySymbol: dRows[0].holy_symbol };
    }
  } else if (["building", "settlement", "geography", "country"].includes(normalized.category)) {
    const rows = await queryD1<any>(`SELECT * FROM lore_meta_locations WHERE article_id = ?`, [id]);
    if (rows.length > 0) {
      const m = rows[0];
      metadata = { ...metadata, ...m, locationType: m.location_type, parentLocation: m.parent_location, owningOrganization: m.owning_organization, foundingDate: m.founding_date };
    }
  } else if (["organization", "religion"].includes(normalized.category)) {
    const rows = await queryD1<any>(`SELECT * FROM lore_meta_organizations WHERE article_id = ?`, [id]);
    if (rows.length > 0) {
      const m = rows[0];
      metadata = { ...metadata, ...m, foundingDate: m.founding_date };
    }
    if (normalized.category === "religion") {
      const dRows = await queryD1<any>(`SELECT * FROM lore_meta_deities WHERE article_id = ?`, [id]);
      if (dRows.length > 0) metadata = { ...metadata, ...dRows[0], holySymbol: dRows[0].holy_symbol };
    }
  }

  const tagRows = await queryD1<any>(`SELECT tag_id FROM lore_article_tags WHERE article_id = ?`, [id]);
  const eraRows = await queryD1<any>(`SELECT era_id FROM lore_article_eras WHERE article_id = ?`, [id]);
  const campRows = await queryD1<any>(`SELECT campaign_id FROM lore_article_campaigns WHERE article_id = ?`, [id]);

  return {
    ...normalized,
    metadata,
    tags: tagRows.map((r) => r.tag_id),
    visibilityEraIds: eraRows.map((r) => r.era_id),
    visibilityCampaignIds: campRows.map((r) => r.campaign_id),
  };
}

/**
 * Fetch the secrets for a lore article — server-filtered to the
 * caller's visibility (staff see all; players see only secrets
 * revealed to their active campaign).
 *
 * The per-route GET `/api/lore/articles/[id]/secrets` does the
 * GROUP_CONCAT'd era/campaign join and the visibility filter
 * server-side, so the client just consumes the normalized array. The
 * legacy direct `SELECT * FROM lore_secrets` path is blocked by the
 * proxy's PROTECTED_READ_TABLES gate — secrets MUST flow through
 * this endpoint so the visibility check actually runs.
 */
export async function fetchLoreSecrets(articleId: string) {
  const res = await fetch(
    `/api/lore/articles/${encodeURIComponent(articleId)}/secrets`,
    { headers: await authHeader() },
  );
  const body = await jsonOrThrow(res, "Failed to load secrets");
  return Array.isArray(body?.secrets) ? body.secrets : [];
}

// `deleteDocument` import kept above; not currently used here but
// other consumers may import it transitively — keeping the side-effect-
// free re-export trail simple.
void deleteDocument;
