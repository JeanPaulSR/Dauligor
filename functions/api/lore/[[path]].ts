// /api/lore/* — catch-all dispatcher for the lore (wiki) read + write
// surface.
//
// Closes the H2 + H3 leaks from the endpoint audit:
//   H2 — `lore_articles.dm_notes` is now stripped for non-staff readers.
//   H3 — `lore_secrets` visibility is filtered SERVER-side by the
//        viewer's active campaign.
//
// GET routes (any authenticated user, server-filtered):
//   /api/lore/articles                  — list (status + dm_notes filtered)
//   /api/lore/articles/<id>             — single article + metadata + tags
//                                         + junctions + parent (+ mentions)
//   /api/lore/articles/<id>/secrets     — visible secrets only
//
// Write routes (wiki staff only — admin / co-dm / lore-writer):
//   PUT    /api/lore/articles/<id>
//   DELETE /api/lore/articles/<id>
//   PUT    /api/lore/articles/<articleId>/secrets/<secretId>
//   DELETE /api/lore/articles/<articleId>/secrets/<secretId>
//   DELETE /api/lore/secrets/<secretId>
//   PUT    /api/lore/system-metadata/wiki-settings (admin only)

import {
  HttpError,
  getCredentialErrorMessage,
  isWikiStaff,
  requireAdminAccess,
  requireAuthenticatedUser,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";
import {
  buildLoreArticleSaveQueries,
  buildLoreSecretSaveQueries,
} from "../../../api/_lib/_lore.js";

/**
 * Parse `?fields=id,title,…` and intersect with an allow-list. Returns
 * `null` when the param is absent or every requested field gets
 * filtered out — the caller then defaults to a full row.
 */
function parseFields(searchParams: URLSearchParams, allowed: Set<string>): string[] | null {
  const str = searchParams.get("fields") ?? "";
  if (!str) return null;
  const safe = str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && allowed.has(s));
  return safe.length > 0 ? safe : null;
}

// Every column we'll ever return to a non-staff client. `dm_notes` is
// deliberately absent — non-staff callers literally cannot ask for it
// even with `?fields=dm_notes`. Staff get the full row regardless of
// this list (they have their own SELECT * branch).
const ALLOWED_LIST_FIELDS = new Set([
  "id",
  "title",
  "slug",
  "category",
  "folder",
  "content",
  "excerpt",
  "parent_id",
  "status",
  "author_id",
  "image_url",
  "image_display",
  "card_image_url",
  "card_display",
  "preview_image_url",
  "preview_display",
  "created_at",
  "updated_at",
]);

// Wire shape camelCase normalization. Mirrors the bespoke spread in
// LoreArticle.tsx + lib/lore.ts:fetchLoreArticle so existing consumers
// don't need to re-learn field names.
function normalizeArticleRow(row: any): any {
  if (!row) return row;
  return {
    ...row,
    parentId: row.parent_id ?? null,
    dmNotes: row.dm_notes ?? null,
    imageUrl: row.image_url ?? null,
    imageDisplay: typeof row.image_display === "string" ? safeJson(row.image_display) : row.image_display ?? null,
    cardImageUrl: row.card_image_url ?? null,
    cardDisplay: typeof row.card_display === "string" ? safeJson(row.card_display) : row.card_display ?? null,
    previewImageUrl: row.preview_image_url ?? null,
    previewDisplay: typeof row.preview_display === "string" ? safeJson(row.preview_display) : row.preview_display ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    authorId: row.author_id ?? null,
  };
}

function safeJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Article block set = the campaign-homepage set MINUS `recommended` (which is
// campaign-specific). Owned by the app (LayoutBlockType); enforced here on write.
const ALLOWED_ARTICLE_BLOCK_TYPES = new Set([
  "hero",
  "text",
  "image",
  "divider",
  "callout",
  "entity-row",
  "entity-feature",
  "group",
  "columns",
  "column",
]);

/**
 * Concatenate every text block's BBCode body (depth-first, container children
 * included) into one string. Kept in `lore_articles.content` as a search /
 * excerpt / recommended-card mirror now that blocks are the render source.
 * Accepts the wire shape (`{ block_type, config }` with config an object or a
 * JSON string) so it works on both the PUT payload and DB rows.
 */
function deriveContentMirror(blocks: any[]): string {
  const out: string[] = [];
  const visit = (b: any): void => {
    if (!b || typeof b !== "object") return;
    const type = b.block_type ?? b.blockType;
    const cfg = b.config && typeof b.config === "object"
      ? b.config
      : typeof b.config === "string"
        ? safeJson(b.config) ?? {}
        : b;
    if (type === "text" && typeof cfg?.body === "string" && cfg.body.trim()) {
      out.push(cfg.body.trim());
    }
    const children = Array.isArray(cfg?.children) ? cfg.children : [];
    children.forEach(visit);
  };
  blocks.forEach(visit);
  return out.join("\n\n");
}

/**
 * Drop the dm_notes/dmNotes pair from a row. Keep BOTH the snake_case
 * and the camelCase alias because consumers downstream of
 * `normalizeArticleRow` reach for `dmNotes` (LoreArticle.tsx:200) while
 * raw consumers still look for `dm_notes`.
 */
function stripDmNotes(row: any): any {
  if (!row) return row;
  const { dm_notes: _a, dmNotes: _b, ...rest } = row;
  return rest;
}

/**
 * Load all category-specific metadata for an article. Mirrors the
 * branchy logic in LoreArticle.tsx so the client doesn't have to know
 * which sub-table corresponds to which category.
 */
async function loadMetadata(articleId: string, category: string): Promise<Record<string, any>> {
  let metadata: Record<string, any> = {};

  if (category === "character" || category === "deity") {
    const charRes = await executeD1QueryInternal({
      sql: "SELECT * FROM lore_meta_characters WHERE article_id = ?",
      params: [articleId],
    });
    const rows = Array.isArray(charRes?.results) ? charRes.results : [];
    if (rows.length > 0) {
      const m: any = rows[0];
      metadata = { ...metadata, ...m, lifeStatus: m.life_status, birthDate: m.birth_date, deathDate: m.death_date };
    }
    if (category === "deity") {
      const dRes = await executeD1QueryInternal({
        sql: "SELECT * FROM lore_meta_deities WHERE article_id = ?",
        params: [articleId],
      });
      const dRows = Array.isArray(dRes?.results) ? dRes.results : [];
      if (dRows.length > 0) metadata = { ...metadata, ...dRows[0], holySymbol: (dRows[0] as any).holy_symbol };
    }
  } else if (["building", "settlement", "geography", "country"].includes(category)) {
    const locRes = await executeD1QueryInternal({
      sql: "SELECT * FROM lore_meta_locations WHERE article_id = ?",
      params: [articleId],
    });
    const rows = Array.isArray(locRes?.results) ? locRes.results : [];
    if (rows.length > 0) {
      const m: any = rows[0];
      metadata = {
        ...metadata,
        ...m,
        locationType: m.location_type,
        parentLocation: m.parent_location,
        owningOrganization: m.owning_organization,
        foundingDate: m.founding_date,
      };
    }
  } else if (category === "organization" || category === "religion") {
    const orgRes = await executeD1QueryInternal({
      sql: "SELECT * FROM lore_meta_organizations WHERE article_id = ?",
      params: [articleId],
    });
    const rows = Array.isArray(orgRes?.results) ? orgRes.results : [];
    if (rows.length > 0) {
      const m: any = rows[0];
      metadata = { ...metadata, ...m, foundingDate: m.founding_date };
    }
    if (category === "religion") {
      const dRes = await executeD1QueryInternal({
        sql: "SELECT * FROM lore_meta_deities WHERE article_id = ?",
        params: [articleId],
      });
      const dRows = Array.isArray(dRes?.results) ? dRes.results : [];
      if (dRows.length > 0) metadata = { ...metadata, ...dRows[0], holySymbol: (dRows[0] as any).holy_symbol };
    }
  }

  return metadata;
}

/* -------------------------------------------------------------------------- */
/* Route handlers                                                              */
/* -------------------------------------------------------------------------- */

async function handleList(searchParams: URLSearchParams, staff: boolean): Promise<Response> {
  const fields = parseFields(searchParams, ALLOWED_LIST_FIELDS);
  const cols = staff ? "*" : fields ? fields.join(", ") : Array.from(ALLOWED_LIST_FIELDS).join(", ");

  const where: string[] = [];
  const params: any[] = [];
  if (!staff) {
    where.push("status = 'published'");
  }

  const folder = searchParams.get("folder") ?? "";
  if (folder) {
    where.push("folder = ?");
    params.push(folder);
  }
  const category = searchParams.get("category") ?? "";
  if (category) {
    where.push("category = ?");
    params.push(category);
  }

  const orderRaw = searchParams.get("orderBy") ?? "";
  const orderBy = orderRaw && /^[A-Za-z_]+( ASC| DESC)?$/.test(orderRaw)
    ? orderRaw
    : "title ASC";

  const sql = `SELECT ${cols} FROM lore_articles${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy}`;
  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];

  const articles = rows
    .map((r: any) => normalizeArticleRow(r))
    .map((r) => (staff ? r : stripDmNotes(r)));

  return Response.json({ articles });
}

async function handleSingle(staff: boolean, articleId: string): Promise<Response> {
  const baseRes = await executeD1QueryInternal({
    sql: "SELECT * FROM lore_articles WHERE id = ? LIMIT 1",
    params: [articleId],
  });
  const baseRows = Array.isArray(baseRes?.results) ? baseRes.results : [];
  if (baseRows.length === 0) {
    throw new HttpError(404, "Article not found.");
  }
  const baseRow = baseRows[0] as any;

  if (!staff && baseRow.status !== "published") {
    throw new HttpError(404, "Article not found.");
  }

  const [metadata, tagRes, eraRes, campRes, mentionsRes, blocksRes] = await Promise.all([
    loadMetadata(articleId, baseRow.category),
    executeD1QueryInternal({
      sql: "SELECT tag_id FROM lore_article_tags WHERE article_id = ?",
      params: [articleId],
    }),
    executeD1QueryInternal({
      sql: "SELECT era_id FROM lore_article_eras WHERE article_id = ?",
      params: [articleId],
    }),
    executeD1QueryInternal({
      sql: "SELECT campaign_id FROM lore_article_campaigns WHERE article_id = ?",
      params: [articleId],
    }),
    executeD1QueryInternal({
      sql: `SELECT a.* FROM lore_articles a
            JOIN lore_links l ON a.id = l.article_id
            WHERE l.target_id = ?`,
      params: [articleId],
    }),
    executeD1QueryInternal({
      sql: `SELECT id, article_id, block_type, "order", config
              FROM lore_article_blocks
             WHERE article_id = ?
             ORDER BY "order" ASC`,
      params: [articleId],
    }),
  ]);

  const tags = (Array.isArray(tagRes?.results) ? tagRes.results : []).map((r: any) => r.tag_id);
  const blocks = Array.isArray(blocksRes?.results) ? blocksRes.results : [];
  const visibilityEraIds = (Array.isArray(eraRes?.results) ? eraRes.results : []).map((r: any) => r.era_id);
  const visibilityCampaignIds = (Array.isArray(campRes?.results) ? campRes.results : []).map((r: any) => r.campaign_id);
  const mentions = (Array.isArray(mentionsRes?.results) ? mentionsRes.results : [])
    .map((m: any) => normalizeArticleRow(m))
    .map((m) => (staff ? m : stripDmNotes(m)));

  let parent: any = null;
  if (baseRow.parent_id) {
    const pRes = await executeD1QueryInternal({
      sql: "SELECT * FROM lore_articles WHERE id = ? LIMIT 1",
      params: [baseRow.parent_id],
    });
    const pRows = Array.isArray(pRes?.results) ? pRes.results : [];
    if (pRows.length > 0) {
      const candidate = pRows[0] as any;
      if (staff || candidate.status === "published") {
        parent = staff ? normalizeArticleRow(candidate) : stripDmNotes(normalizeArticleRow(candidate));
      }
    }
  }

  const normalized = normalizeArticleRow(baseRow);
  const article = {
    ...(staff ? normalized : stripDmNotes(normalized)),
    metadata,
    tags,
    visibilityEraIds,
    visibilityCampaignIds,
    blocks,
  };

  return Response.json({ article, parent, mentions });
}

async function handleSecrets(staff: boolean, uid: string, articleId: string): Promise<Response> {
  const sql = `
    SELECT s.*,
           (SELECT GROUP_CONCAT(era_id) FROM lore_secret_eras WHERE secret_id = s.id) AS era_ids,
           (SELECT GROUP_CONCAT(campaign_id) FROM lore_secret_campaigns WHERE secret_id = s.id) AS revealed_campaign_ids
    FROM lore_secrets s
    WHERE s.article_id = ?
  `;
  const result = await executeD1QueryInternal({ sql, params: [articleId] });
  const rows = Array.isArray(result?.results) ? result.results : [];

  const all = rows.map((s: any) => ({
    ...s,
    eraIds: s.era_ids ? String(s.era_ids).split(",") : [],
    revealedCampaignIds: s.revealed_campaign_ids ? String(s.revealed_campaign_ids).split(",") : [],
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }));

  if (staff) {
    return Response.json({ secrets: all });
  }

  const userRes = await executeD1QueryInternal({
    sql: "SELECT active_campaign_id FROM users WHERE id = ? LIMIT 1",
    params: [uid],
  });
  const userRows = Array.isArray(userRes?.results) ? userRes.results : [];
  const activeCampaignId: string | null = userRows[0] ? (userRows[0] as any).active_campaign_id ?? null : null;

  const visible = activeCampaignId
    ? all.filter((s) => s.revealedCampaignIds.includes(activeCampaignId))
    : [];

  return Response.json({ secrets: visible });
}

async function handleArticleBlocks(staff: boolean, articleId: string): Promise<Response> {
  const check = await executeD1QueryInternal({
    sql: "SELECT status FROM lore_articles WHERE id = ? LIMIT 1",
    params: [articleId],
  });
  const rows = Array.isArray(check?.results) ? check.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "Article not found.");
  }
  // Same visibility rule as the article itself — non-staff see published only.
  if (!staff && (rows[0] as any).status !== "published") {
    throw new HttpError(404, "Article not found.");
  }

  const result = await executeD1QueryInternal({
    sql: `SELECT id, article_id, block_type, "order", config
            FROM lore_article_blocks
           WHERE article_id = ?
           ORDER BY "order" ASC`,
    params: [articleId],
  });
  const blocks = Array.isArray(result?.results) ? result.results : [];
  return Response.json({ blocks });
}

/* -------------------------------------------------------------------------- */
/* Write handlers — PUT / DELETE for articles and secrets                      */
/* -------------------------------------------------------------------------- */

async function handleArticleUpsert(request: Request, decoded: any, articleId: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  const payload = body?.article;
  const dmNotes: string = typeof body?.dmNotes === "string" ? body.dmNotes : "";
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Missing `article` in request body.");
  }
  if (typeof payload.title !== "string" || !payload.title.trim()) {
    throw new HttpError(400, "Article `title` is required.");
  }
  if (typeof payload.category !== "string" || !payload.category.trim()) {
    throw new HttpError(400, "Article `category` is required.");
  }
  if (typeof payload.content !== "string") {
    throw new HttpError(400, "Article `content` must be a string.");
  }

  const queries = buildLoreArticleSaveQueries(articleId, payload, dmNotes, decoded.uid);
  await executeD1QueryInternal(queries);

  return Response.json({ ok: true, id: articleId });
}

async function handleArticleBlocksPut(request: Request, articleId: string): Promise<Response> {
  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM lore_articles WHERE id = ? LIMIT 1",
    params: [articleId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Article not found.");
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];

  // Replace-all: clear the article's blocks, then re-insert in array order.
  // Plain INSERT after DELETE (NOT INSERT OR REPLACE), `order` from array index —
  // the same idiom campaign home-blocks use.
  const now = new Date().toISOString();
  const queries: Array<{ sql: string; params: any[] }> = [
    { sql: "DELETE FROM lore_article_blocks WHERE article_id = ?", params: [articleId] },
  ];

  blocks.forEach((b: any, index: number) => {
    const blockType = typeof b?.block_type === "string" ? b.block_type : "";
    if (!ALLOWED_ARTICLE_BLOCK_TYPES.has(blockType)) {
      throw new HttpError(400, `Invalid article block type \`${blockType}\`.`);
    }
    const id = typeof b?.id === "string" && b.id ? b.id : crypto.randomUUID();
    const config = b?.config && typeof b.config === "object" ? JSON.stringify(b.config) : "{}";
    queries.push({
      sql: `INSERT INTO lore_article_blocks (id, article_id, block_type, "order", config, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, articleId, blockType, index, config, now, now],
    });
  });

  // Keep lore_articles.content as a BBCode mirror of the text blocks so search,
  // excerpts, and recommended-card fallbacks keep working now that blocks are the
  // render source. (Mention/lore_links extraction stays client-driven via the
  // article save payload — the designer recomputes links from this same content.)
  const mirror = deriveContentMirror(blocks);
  queries.push({
    sql: "UPDATE lore_articles SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    params: [mirror, articleId],
  });

  await executeD1QueryInternal(queries);
  return Response.json({ ok: true, count: blocks.length });
}

async function handleArticleDelete(articleId: string): Promise<Response> {
  await executeD1QueryInternal({
    sql: "DELETE FROM lore_articles WHERE id = ?",
    params: [articleId],
  });
  return Response.json({ ok: true, id: articleId });
}

async function handleSecretUpsert(request: Request, articleId: string, secretId: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  const payload = body?.secret ?? body;
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Missing secret payload in request body.");
  }
  if (typeof payload.content !== "string") {
    throw new HttpError(400, "Secret `content` must be a string.");
  }

  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM lore_articles WHERE id = ? LIMIT 1",
    params: [articleId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Article not found.");
  }

  const queries = buildLoreSecretSaveQueries(articleId, secretId, payload);
  await executeD1QueryInternal(queries);

  return Response.json({ ok: true, articleId, secretId });
}

async function handleSecretDelete(secretId: string): Promise<Response> {
  await executeD1QueryInternal({
    sql: "DELETE FROM lore_secrets WHERE id = ?",
    params: [secretId],
  });
  return Response.json({ ok: true, id: secretId });
}

async function handleWikiSettingsPut(request: Request, authHeader: string | undefined): Promise<Response> {
  await requireAdminAccess(authHeader);

  const body = (await request.json().catch(() => null)) as any;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  let encoded: string;
  try {
    encoded = JSON.stringify(body);
  } catch {
    throw new HttpError(400, "Body must be JSON-serializable.");
  }
  if (encoded.length > 64 * 1024) {
    throw new HttpError(413, "wiki_settings payload exceeds the 64KB cap.");
  }

  await executeD1QueryInternal({
    sql: `INSERT INTO system_metadata (key, value, updated_at)
            VALUES ('wiki_settings', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at`,
    params: [encoded],
  });

  return Response.json({ ok: true, key: "wiki_settings" });
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded, role } = await requireAuthenticatedUser(authHeader);
    const staff = isWikiStaff(role);
    const uid: string = decoded.uid;

    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    // GET routes — any authenticated user, server-filtered.
    if (request.method === "GET") {
      if (path.length === 1 && path[0] === "articles") return await handleList(searchParams, staff);
      if (path.length === 2 && path[0] === "articles") return await handleSingle(staff, path[1]);
      if (path.length === 3 && path[0] === "articles" && path[2] === "secrets") {
        return await handleSecrets(staff, uid, path[1]);
      }
      if (path.length === 3 && path[0] === "articles" && path[2] === "blocks") {
        return await handleArticleBlocks(staff, path[1]);
      }
      return Response.json(
        { error: `Unknown lore route: /${path.join("/")}` },
        { status: 404 },
      );
    }

    // Write routes — wiki staff only (admin / co-dm / lore-writer).
    if (!staff) {
      throw new HttpError(403, "Wiki staff access required.");
    }

    if (path.length === 2 && path[0] === "articles") {
      if (request.method === "PUT") return await handleArticleUpsert(request, decoded, path[1]);
      if (request.method === "DELETE") return await handleArticleDelete(path[1]);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 3 && path[0] === "articles" && path[2] === "blocks") {
      if (request.method === "PUT") return await handleArticleBlocksPut(request, path[1]);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 4 && path[0] === "articles" && path[2] === "secrets") {
      if (request.method === "PUT") return await handleSecretUpsert(request, path[1], path[3]);
      if (request.method === "DELETE") return await handleSecretDelete(path[3]);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 2 && path[0] === "secrets") {
      if (request.method === "DELETE") return await handleSecretDelete(path[1]);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 2 && path[0] === "system-metadata" && path[1] === "wiki-settings") {
      if (request.method === "PUT") return await handleWikiSettingsPut(request, authHeader);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    return Response.json(
      { error: `Unknown lore route: /${path.join("/")}` },
      { status: 404 },
    );
  } catch (error: any) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return Response.json({ error: credentialMessage }, { status: 503 });
    }
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`/api/lore (${request.method} ${request.url}) failed:`, error);
    return Response.json(
      { error: message || "Lore request failed." },
      { status: 500 },
    );
  }
};
