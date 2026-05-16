// /api/lore/[[...path]] — catch-all dispatcher for the lore (wiki) read
// surface. One Vercel function covers every read path so we stay under
// the Hobby plan's 12-function deployment cap.
//
// Closes the H2 + H3 leaks from the endpoint audit:
//
//   H2 — `lore_articles.dm_notes` (private DM-only content) was
//        included in the JSON every signed-in user received from
//        `SELECT * FROM lore_articles ...`. Six pages touched the
//        legacy path: Wiki, LoreArticle, Home, Map, CampaignManager,
//        CampaignEditor, AdminCampaigns. All of them now go through
//        this endpoint with the column stripped for non-staff readers.
//   H3 — `lore_secrets` content was readable by any signed-in user via
//        a raw SQL JOIN that included every secret. The client filtered
//        by `revealedCampaignIds.includes(activeCampaignId)` but the
//        unrevealed secrets sat in the network payload anyway. The
//        secrets sub-route here applies the same filter SERVER-side.
//
// Routes (all GET):
//   /api/lore/articles                  — list (status + dm_notes filtered)
//   /api/lore/articles/<id>             — single article + metadata + tags
//                                         + junctions + parent (+ mentions)
//   /api/lore/articles/<id>/secrets     — visible secrets only
//
// Writes (upsertLoreArticle, upsertLoreSecret, delete...) stay on the
// legacy `/api/d1/query` path for now — they're already staff-gated by
// the write-side `requireStaffAccess` check at d1-proxy.ts, so they
// don't compound the read leaks H2/H3 target. The audit's priority #6
// item covers moving them.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  isWikiStaff,
  requireAuthenticatedUser,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

/**
 * Catch-all routes (`[[...path]]`) attach the path tail to
 * `req.query.path` as an array on Vercel; if the request hits the bare
 * `/api/lore` URL there's no `path` key at all. Normalize both cases
 * (plus the string-fallback the runtime sometimes uses for single
 * segments) into a flat string[].
 */
function parsePath(req: NodeLikeRequest): string[] {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw.map((seg) => decodeURIComponent(String(seg)));
  if (typeof raw === "string" && raw) return [decodeURIComponent(raw)];
  // URL fallback covers any runtime that doesn't populate req.query for
  // catch-alls. Match `/api/lore` and capture everything after it.
  const url = req.url || "";
  const match = url.match(/\/api\/lore\/?([^?]*)/);
  if (!match || !match[1]) return [];
  return match[1].split("/").filter(Boolean).map(decodeURIComponent);
}

/**
 * Parse `?fields=id,title,…` and intersect with an allow-list. Returns
 * `null` when the param is absent or every requested field gets
 * filtered out — the caller then defaults to a full row. Same shape as
 * `/api/me/characters` so callers don't have to learn a second pattern.
 */
function parseFields(req: NodeLikeRequest, allowed: Set<string>): string[] | null {
  const raw = req.query?.fields;
  const str = Array.isArray(raw) ? String(raw[0] ?? "") : typeof raw === "string" ? raw : "";
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
// don't need to re-learn field names. Always run on every returned row;
// JSON columns get parsed; snake_case columns get aliased.
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
 * which sub-table corresponds to which category — the server already
 * read the row, it already knows the category, it does the join.
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

async function handleList(req: NodeLikeRequest, res: NodeLikeResponse, staff: boolean) {
  // Non-staff readers only see published articles. Mirrors the
  // `where: isStaff ? undefined : "status = 'published'"` pattern that
  // Wiki.tsx used to do on the client; the server enforcing it makes
  // unpublished titles unreachable even via devtools.
  const fields = parseFields(req, ALLOWED_LIST_FIELDS);
  const cols = staff ? "*" : fields ? fields.join(", ") : Array.from(ALLOWED_LIST_FIELDS).join(", ");

  const where: string[] = [];
  const params: any[] = [];
  if (!staff) {
    where.push("status = 'published'");
  }

  // Optional filters — these mirror the most common `?folder=` /
  // `?category=` filtering the wiki UI does client-side today. Same
  // allow-list of categories the schema accepts; we don't validate
  // strictly because a bogus value just returns an empty set.
  const folder = req.query?.folder;
  if (typeof folder === "string" && folder) {
    where.push("folder = ?");
    params.push(folder);
  }
  const category = req.query?.category;
  if (typeof category === "string" && category) {
    where.push("category = ?");
    params.push(category);
  }

  const orderRaw = req.query?.orderBy;
  const orderBy = typeof orderRaw === "string" && /^[A-Za-z_]+( ASC| DESC)?$/.test(orderRaw)
    ? orderRaw
    : "title ASC";

  const sql = `SELECT ${cols} FROM lore_articles${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy}`;
  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];

  // Normalize wire shape for every consumer; strip dm_notes whenever
  // the caller isn't staff (defensive — `dm_notes` shouldn't be in the
  // non-staff SELECT to begin with, but the strip catches the
  // `?fields=dm_notes` future-mistake case too).
  const articles = rows
    .map((r: any) => normalizeArticleRow(r))
    .map((r) => (staff ? r : stripDmNotes(r)));

  return res.status(200).json({ articles });
}

async function handleSingle(req: NodeLikeRequest, res: NodeLikeResponse, staff: boolean, articleId: string) {
  // The base row determines whether the rest of the joins run at all
  // — saves the per-table round trips when the id is unknown / draft /
  // out of scope.
  const baseRes = await executeD1QueryInternal({
    sql: "SELECT * FROM lore_articles WHERE id = ? LIMIT 1",
    params: [articleId],
  });
  const baseRows = Array.isArray(baseRes?.results) ? baseRes.results : [];
  if (baseRows.length === 0) {
    throw new HttpError(404, "Article not found.");
  }
  const baseRow = baseRows[0] as any;

  // Drafts are staff-only — collapse the "you can't read this" branch
  // into a generic 404 so non-staff probes don't learn that a draft
  // id exists. Same pattern as the character endpoint's 404-vs-403.
  if (!staff && baseRow.status !== "published") {
    throw new HttpError(404, "Article not found.");
  }

  // Joined data — metadata depends on the article's category, tags and
  // visibility are universal. Mirrors what LoreArticle.tsx used to
  // assemble on the client; same shape, just consolidated server-side.
  const [metadata, tagRes, eraRes, campRes, mentionsRes] = await Promise.all([
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
    // Mentions = articles that link TO this article via lore_links.
    // The legacy join also returned the full row; we keep that shape
    // because LoreArticle's mentions panel renders title + category +
    // image_url at minimum.
    executeD1QueryInternal({
      sql: `SELECT a.* FROM lore_articles a
            JOIN lore_links l ON a.id = l.article_id
            WHERE l.target_id = ?`,
      params: [articleId],
    }),
  ]);

  const tags = (Array.isArray(tagRes?.results) ? tagRes.results : []).map((r: any) => r.tag_id);
  const visibilityEraIds = (Array.isArray(eraRes?.results) ? eraRes.results : []).map((r: any) => r.era_id);
  const visibilityCampaignIds = (Array.isArray(campRes?.results) ? campRes.results : []).map((r: any) => r.campaign_id);
  const mentions = (Array.isArray(mentionsRes?.results) ? mentionsRes.results : [])
    .map((m: any) => normalizeArticleRow(m))
    .map((m) => (staff ? m : stripDmNotes(m)));

  // Parent article lookup if the article hangs off another one. Only
  // returns the parent if THAT parent is also visible to the viewer —
  // a player navigating to a nested page shouldn't accidentally learn
  // the title of an unpublished parent.
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
  };

  return res.status(200).json({ article, parent, mentions });
}

async function handleSecrets(
  req: NodeLikeRequest,
  res: NodeLikeResponse,
  staff: boolean,
  uid: string,
  articleId: string,
) {
  // The full LEFT-JOIN-style query the legacy client used — secrets +
  // GROUP_CONCAT'd era/campaign id lists in one shot. Same SQL; the
  // filter happens after we know who's asking.
  const sql = `
    SELECT s.*,
           (SELECT GROUP_CONCAT(era_id) FROM lore_secret_eras WHERE secret_id = s.id) AS era_ids,
           (SELECT GROUP_CONCAT(campaign_id) FROM lore_secret_campaigns WHERE secret_id = s.id) AS revealed_campaign_ids
    FROM lore_secrets s
    WHERE s.article_id = ?
  `;
  const result = await executeD1QueryInternal({ sql, params: [articleId] });
  const rows = Array.isArray(result?.results) ? result.results : [];

  // Normalize the GROUP_CONCAT result back into arrays so the client
  // doesn't need to know about the SQL idiom.
  const all = rows.map((s: any) => ({
    ...s,
    eraIds: s.era_ids ? String(s.era_ids).split(",") : [],
    revealedCampaignIds: s.revealed_campaign_ids ? String(s.revealed_campaign_ids).split(",") : [],
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }));

  if (staff) {
    return res.status(200).json({ secrets: all });
  }

  // Non-staff filter: only secrets whose revealedCampaignIds contains
  // the viewer's active campaign. We look up the active campaign from
  // the users table because it's the canonical source — the client
  // could lie about it via `?as_campaign=…` otherwise.
  const userRes = await executeD1QueryInternal({
    sql: "SELECT active_campaign_id FROM users WHERE id = ? LIMIT 1",
    params: [uid],
  });
  const userRows = Array.isArray(userRes?.results) ? userRes.results : [];
  const activeCampaignId: string | null = userRows[0] ? (userRows[0] as any).active_campaign_id ?? null : null;

  const visible = activeCampaignId
    ? all.filter((s) => s.revealedCampaignIds.includes(activeCampaignId))
    : [];

  return res.status(200).json({ secrets: visible });
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    const { decoded, role } = await requireAuthenticatedUser(req.headers.authorization);
    const staff = isWikiStaff(role);
    const uid: string = decoded.uid;

    const path = parsePath(req);

    // path[0] is always "articles" for the routes we support today —
    // future shapes (e.g. /api/lore/categories) can branch here.
    if (path.length === 1 && path[0] === "articles") {
      return await handleList(req, res, staff);
    }
    if (path.length === 2 && path[0] === "articles") {
      return await handleSingle(req, res, staff, path[1]);
    }
    if (path.length === 3 && path[0] === "articles" && path[2] === "secrets") {
      return await handleSecrets(req, res, staff, uid, path[1]);
    }

    return res.status(404).json({ error: `Unknown lore route: /${path.join("/")}` });
  } catch (error) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return res.status(503).json({ error: credentialMessage });
    }
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`/api/lore (${req.method} ${req.url}) failed:`, error);
    return res.status(500).json({ error: message || "Lore request failed." });
  }
}
