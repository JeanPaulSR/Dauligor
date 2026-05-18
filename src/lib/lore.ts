// Client helpers for the lore (wiki) write surface.
//
// These are thin fetch wrappers around the per-route endpoints in
// `api/lore.ts`. The SQL building they used to do client-side (via
// batchQueryD1 / deleteDocument against `lore_*` tables) lives in
// `api/_lib/_lore.ts` now — the server is the single source of truth
// for what a lore save means. The d1-proxy gate also blocks direct
// `lore_*` writes from the client, so call sites MUST go through
// here (or the per-route endpoint directly).
//
// Function signatures are deliberately preserved from the legacy
// helpers so the existing call sites in Wiki.tsx, LoreEditor.tsx, and
// LoreArticle.tsx don't need updates.
//
// Reads (fetchLoreArticle, fetchLoreSecrets) still go through the
// generic /api/d1/query proxy for now — the per-route /api/lore GET
// endpoints exist and are preferred for client UI, but the editor's
// load path (LoreEditor.tsx) still uses fetchLoreArticle to get the
// raw row with dm_notes attached. That migration is a smaller
// follow-up; both paths return equivalent shapes today.

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
  // DELETE path needs the article id too — fetch it once so the
  // server can do the cascading FK delete via lore_articles. We could
  // accept it as a param to drop the lookup, but every call site
  // currently invokes this with just the secret id, so keep the
  // signature stable and pay the one round-trip.
  const articleRow = await queryD1<{ article_id: string }>(
    "SELECT article_id FROM lore_secrets WHERE id = ? LIMIT 1",
    [secretId],
  );
  const articleId = articleRow[0]?.article_id;
  if (!articleId) {
    // Nothing to delete — secret already gone or never existed.
    return { ok: true, id: secretId };
  }
  const res = await fetch(
    `/api/lore/articles/${encodeURIComponent(articleId)}/secrets/${encodeURIComponent(secretId)}`,
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
/* Reads — still on /api/d1/query for now                                      */
/* -------------------------------------------------------------------------- */
//
// fetchLoreArticle / fetchLoreSecrets are kept here on the legacy
// path because LoreEditor's load flow expects them. The per-route
// `GET /api/lore/articles/[id]` and `/secrets` already exist — UI
// consumers (LoreArticle.tsx, Wiki.tsx, Home.tsx, etc.) have all
// migrated. The editor's migration is a smaller follow-up.

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
 * Fetch all secrets for a lore article with their visibility links.
 */
export async function fetchLoreSecrets(articleId: string) {
  const rows = await queryD1<any>(
    `
    SELECT s.*,
           (SELECT GROUP_CONCAT(era_id) FROM lore_secret_eras WHERE secret_id = s.id) as era_ids,
           (SELECT GROUP_CONCAT(campaign_id) FROM lore_secret_campaigns WHERE secret_id = s.id) as revealed_campaign_ids
    FROM lore_secrets s
    WHERE s.article_id = ?
  `,
    [articleId],
  );

  return rows.map((s) => ({
    ...s,
    eraIds: s.era_ids ? s.era_ids.split(",") : [],
    revealedCampaignIds: s.revealed_campaign_ids ? s.revealed_campaign_ids.split(",") : [],
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }));
}

// `deleteDocument` import kept above; not currently used here but
// other consumers may import it transitively — keeping the side-effect-
// free re-export trail simple.
void deleteDocument;
