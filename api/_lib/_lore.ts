// Server-side SQL builders for the lore (wiki) write surface.
//
// Pure functions — they don't touch the network. Each returns a
// batched `{sql, params}[]` array that the dispatcher in api/lore.ts
// feeds to `executeD1QueryInternal`. Same shape every other server-
// side query builder uses (`api/_lib/_characterShared.ts` set the
// precedent).
//
// The legacy client-side equivalents in `src/lib/lore.ts` mixed the
// builder with the network call (calling `batchQueryD1` at the end).
// Once the per-route lore-write migration lands, those client helpers
// become thin fetch wrappers and the SQL building lives here only.
// That removes the last duplicate of the wiki write logic — the
// server is the single source of truth for what a lore save means.

type Query = { sql: string; params?: any[] };

/**
 * Build the batched query array that persists a lore article + every
 * related row (category-specific metadata, era/campaign visibility,
 * tags, links). One INSERT...ON CONFLICT DO UPDATE on lore_articles,
 * then a DELETE+INSERT pass over each related table — same shape the
 * client helper used to send, just keyed entirely server-side now.
 *
 * `authorId` MUST come from the verified token, not the request body.
 * The dispatcher in api/lore.ts passes `decoded.uid` here so a hostile
 * client can't backdate `payload.authorId` to attribute an article to
 * another user.
 */
export function buildLoreArticleSaveQueries(
  id: string,
  payload: any,
  dmNotes: string,
  authorId: string,
): Query[] {
  const queries: Query[] = [];

  // 1. Lore article base — single ON CONFLICT DO UPDATE row.
  const articleColumns = [
    "id", "title", "slug", "category", "folder", "content", "excerpt",
    "parent_id", "status", "author_id", "dm_notes", "image_url",
    "image_display", "card_image_url", "card_display",
    "preview_image_url", "preview_display", "updated_at",
  ];

  // Slug: client may already have computed one. Server falls back to a
  // simple slugify if missing.
  const slug = payload.slug || String(payload.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "lore-article";

  const articleValues = [
    id,
    payload.title,
    slug,
    payload.category,
    payload.folder || null,
    payload.content,
    payload.excerpt || null,
    payload.parentId || null,
    payload.status || "draft",
    authorId,
    dmNotes,
    payload.imageUrl || null,
    typeof payload.imageDisplay === "object" ? JSON.stringify(payload.imageDisplay) : payload.imageDisplay,
    payload.cardImageUrl || null,
    typeof payload.cardDisplay === "object" ? JSON.stringify(payload.cardDisplay) : payload.cardDisplay,
    payload.previewImageUrl || null,
    typeof payload.previewDisplay === "object" ? JSON.stringify(payload.previewDisplay) : payload.previewDisplay,
    payload.updatedAt || new Date().toISOString(),
  ];

  // created_at on insert; preserve on update (excluded.created_at would
  // overwrite with NOW, so we DON'T include it in the SET clause below).
  articleColumns.push("created_at");
  articleValues.push(payload.createdAt || payload.updatedAt || new Date().toISOString());

  const placeholders = articleColumns.map(() => "?").join(", ");
  // ON CONFLICT DO UPDATE — NOT INSERT OR REPLACE. The latter would
  // DELETE the row first and trigger ON DELETE CASCADE on lore_meta_*
  // and lore_article_* before the batch's explicit DELETE+INSERT pass
  // below could run — losing every related row in the process. See
  // memory/project_d1_upsert_idiom.md.
  //
  // `created_at` is also excluded from the SET clause so an update
  // doesn't overwrite the original creation timestamp.
  const updateCols = articleColumns.filter((c) => c !== "id" && c !== "created_at");
  const updateClause = updateCols.map((c) => `${c} = excluded.${c}`).join(", ");
  queries.push({
    sql: `INSERT INTO lore_articles (${articleColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateClause}`,
    params: articleValues,
  });

  // 2. Category-specific metadata. Always clear every possible meta
  // table first so a category change (e.g. character → organization)
  // doesn't leave ghost rows attached to the article id.
  const meta = payload.metadata || {};
  queries.push({ sql: "DELETE FROM lore_meta_characters WHERE article_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM lore_meta_locations WHERE article_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM lore_meta_organizations WHERE article_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM lore_meta_deities WHERE article_id = ?", params: [id] });

  if (payload.category === "character" || payload.category === "deity") {
    queries.push({
      sql: `INSERT INTO lore_meta_characters
              (article_id, race, age, alignment, occupation, life_status, gender, pronouns, birth_date, death_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, meta.race, meta.age, meta.alignment, meta.occupation, meta.lifeStatus, meta.gender, meta.pronouns, meta.birthDate, meta.deathDate],
    });
    if (payload.category === "deity") {
      queries.push({
        sql: "INSERT INTO lore_meta_deities (article_id, domains, holy_symbol) VALUES (?, ?, ?)",
        params: [id, meta.domains, meta.holySymbol],
      });
    }
  } else if (["building", "settlement", "geography", "country"].includes(payload.category)) {
    queries.push({
      sql: `INSERT INTO lore_meta_locations
              (article_id, location_type, population, climate, ruler, founding_date, parent_location, owning_organization)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, meta.locationType, meta.population, meta.climate, meta.ruler, meta.foundingDate, meta.parentLocation, meta.owningOrganization],
    });
  } else if (payload.category === "organization" || payload.category === "religion") {
    queries.push({
      sql: "INSERT INTO lore_meta_organizations (article_id, headquarters, leader, motto, founding_date) VALUES (?, ?, ?, ?, ?)",
      params: [id, meta.headquarters, meta.leader, meta.motto, meta.foundingDate],
    });
    if (payload.category === "religion") {
      queries.push({
        sql: "INSERT INTO lore_meta_deities (article_id, domains, holy_symbol) VALUES (?, ?, ?)",
        params: [id, meta.domains, meta.holySymbol],
      });
    }
  }

  // 3. Visibility junctions (eras, campaigns), tags, and links.
  // DELETE+INSERT instead of computing a diff — these are tiny tables
  // (<10 rows per article typical) and the explicit clear keeps the
  // logic simple.
  queries.push({ sql: "DELETE FROM lore_article_eras WHERE article_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM lore_article_campaigns WHERE article_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM lore_article_tags WHERE article_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM lore_links WHERE article_id = ?", params: [id] });

  (payload.visibilityEraIds || []).forEach((eraId: string) => {
    queries.push({ sql: "INSERT INTO lore_article_eras (article_id, era_id) VALUES (?, ?)", params: [id, eraId] });
  });
  (payload.visibilityCampaignIds || []).forEach((campId: string) => {
    queries.push({ sql: "INSERT INTO lore_article_campaigns (article_id, campaign_id) VALUES (?, ?)", params: [id, campId] });
  });
  (payload.tags || []).forEach((tagId: string) => {
    queries.push({ sql: "INSERT INTO lore_article_tags (article_id, tag_id) VALUES (?, ?)", params: [id, tagId] });
  });
  (payload.linkedArticleIds || []).forEach((targetId: string) => {
    queries.push({ sql: "INSERT INTO lore_links (article_id, target_id) VALUES (?, ?)", params: [id, targetId] });
  });

  return queries;
}

/**
 * Build the batched query array for a single secret upsert + its
 * visibility junction reset.
 */
export function buildLoreSecretSaveQueries(
  articleId: string,
  secretId: string,
  data: any,
): Query[] {
  const queries: Query[] = [];

  queries.push({
    sql: `INSERT INTO lore_secrets (id, article_id, content, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            article_id = excluded.article_id,
            content = excluded.content,
            updated_at = excluded.updated_at`,
    params: [secretId, articleId, data.content, data.updatedAt || new Date().toISOString()],
  });

  queries.push({ sql: "DELETE FROM lore_secret_eras WHERE secret_id = ?", params: [secretId] });
  queries.push({ sql: "DELETE FROM lore_secret_campaigns WHERE secret_id = ?", params: [secretId] });

  (data.eraIds || []).forEach((eraId: string) => {
    queries.push({ sql: "INSERT INTO lore_secret_eras (secret_id, era_id) VALUES (?, ?)", params: [secretId, eraId] });
  });
  (data.revealedCampaignIds || []).forEach((campId: string) => {
    queries.push({ sql: "INSERT INTO lore_secret_campaigns (secret_id, campaign_id) VALUES (?, ?)", params: [secretId, campId] });
  });

  return queries;
}
