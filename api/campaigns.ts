// /api/campaigns/[[...path]] — dispatcher for the campaigns surface.
//
// Closes audit H7 (read enumeration) AND audit #8 (write gates):
//
//   - Reads — every page that renders a campaign list, single-
//     campaign view, or member roster used to fetch the entire
//     campaigns + campaign_members tables through /api/d1/query,
//     then filter client-side. That meant any signed-in user could
//     enumerate which campaigns exist and (via the membership join
//     on staff pages) which players are in which campaign.
//
//   - Writes — the proxy-level mutation gate admits the wiki-staff
//     set (admin / co-dm / lore-writer). lore-writer could create,
//     edit, or delete any campaign through `upsertDocument` /
//     `deleteDocument` — wider than the permissions-rbac doc says
//     (campaign management is admin / co-dm only). The proxy now
//     refuses direct campaigns / campaign_members writes and points
//     callers here, where `isCharacterDM` enforces admin + co-dm
//     (lore-writer 403'd) and DELETE additionally requires admin.
//
// Routes:
//
//   GET  /api/campaigns
//     Role-filtered list. Admin / co-dm see every campaign; everyone
//     else sees only campaigns they're a member of. Each row carries
//     `memberCount`.
//
//   GET  /api/campaigns/[id]
//     Single campaign. Members + staff see the full row; non-members
//     get 404 (collapsed with "not found" so probes can't enumerate
//     ids by guessing).
//
//   GET  /api/campaigns/[id]/members
//     Roster with each member's `username` / `display_name` /
//     `avatar_url`. Member-or-staff gate.
//
//   POST   /api/campaigns                          (isCharacterDM)
//   PATCH  /api/campaigns/[id]                     (isCharacterDM)
//   DELETE /api/campaigns/[id]                     (admin)
//   PUT    /api/campaigns/[id]/members/[uid]       (isCharacterDM)
//   DELETE /api/campaigns/[id]/members/[uid]       (isCharacterDM)
//
// `eras` writes still go through the proxy (admin-gated via
// PROTECTED_WRITE_TABLES per L1 close). Migrating those to per-route
// `/api/admin/eras/*` endpoints is audit priority #9, separate.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAdminAccess,
  requireAuthenticatedUser,
} from "./_lib/firebase-admin.js";
import { executeD1QueryInternal } from "./_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: any;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

/* -------------------------------------------------------------------------- */
/* Path parsing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Vercel pure serverless functions don't support real catch-all routes
 * (filesystem `[...slug]` is treated as a single-segment dynamic param,
 * same as `[name]`). The codebase pattern — mirrored from
 * `api/module.ts` — is to put one file at `api/<resource>.ts`, add a
 * vercel.json rewrite `/api/<resource>/(.*) → /api/<resource>`, and
 * parse the original path out of `req.url` inside the handler.
 *
 * `req.url` retains the user's original path even after the rewrite,
 * so a request to `/api/campaigns/<id>/members` shows up here as
 * `req.url === "/api/campaigns/<id>/members"`. We slice off the
 * `/api/campaigns/` prefix, split on `/`, and the result is the path
 * array the route table below dispatches on.
 */
function parsePath(req: NodeLikeRequest): string[] {
  const url = req.url || "";
  const pathname = url.split("?")[0];
  const tail = pathname.replace(/^\/api\/campaigns\/?/, "");
  if (!tail) return [];
  return tail.split("/").filter(Boolean).map(decodeURIComponent);
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Returns true if the caller is a member of the given campaign.
 * Looked up by primary key (campaign_id, user_id) so it's O(1) at the
 * DB layer. Staff don't need this check — they pass on role alone.
 */
async function isCampaignMember(uid: string, campaignId: string): Promise<boolean> {
  const result = await executeD1QueryInternal({
    sql: "SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ? LIMIT 1",
    params: [campaignId, uid],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Route handlers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/campaigns
 *
 * Staff (admin / co-dm) see every campaign; others see only the
 * campaigns they're members of. Each row carries `memberCount` — the
 * admin grid (AdminCampaigns) used to compute this client-side by
 * fetching every campaign_members row, which was the worst single
 * vector for the H7 enumeration risk. Now the count comes from a
 * subquery the server runs once.
 */
async function handleList(req: NodeLikeRequest, res: NodeLikeResponse, uid: string, staff: boolean) {
  const baseColumns = `
    c.id, c.name, c.slug, c.description, c.dm_id, c.era_id, c.image_url,
    c.recommended_lore_id, c.settings, c.created_at, c.updated_at,
    (SELECT COUNT(*) FROM campaign_members cm2 WHERE cm2.campaign_id = c.id) AS member_count
  `;

  const sql = staff
    ? `SELECT ${baseColumns} FROM campaigns c ORDER BY c.name ASC`
    : `SELECT ${baseColumns}
         FROM campaigns c
         JOIN campaign_members cm ON cm.campaign_id = c.id
        WHERE cm.user_id = ?
        ORDER BY c.name ASC`;
  const params = staff ? [] : [uid];

  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];

  // Camelcase the count for the client; everything else stays
  // snake_case to match the rest of the codebase's `users.active_campaign_id`
  // / `c.dm_id` conventions.
  const campaigns = rows.map((r: any) => ({
    ...r,
    memberCount: Number(r.member_count ?? 0),
    member_count: undefined,
  }));

  return res.status(200).json({ campaigns });
}

/**
 * GET /api/campaigns/[id]
 *
 * Members + staff only. Non-members get 404 (not 403) so probes can't
 * enumerate which ids are valid. Returns the full row including
 * `settings` so the editor and manager pages can render their full
 * configuration UIs without a second fetch.
 */
async function handleSingle(req: NodeLikeRequest, res: NodeLikeResponse, uid: string, staff: boolean, campaignId: string) {
  const result = await executeD1QueryInternal({
    sql: "SELECT * FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }
  const campaign = rows[0] as any;

  if (!staff) {
    const member = await isCampaignMember(uid, campaignId);
    if (!member) {
      throw new HttpError(404, "Campaign not found.");
    }
  }

  return res.status(200).json({ campaign });
}

/**
 * GET /api/campaigns/[id]/members
 *
 * Returns each member's role + minimal identity (username and
 * display_name only). Explicitly does NOT expose `recovery_email` or
 * any other column we said the per-route migration would protect —
 * a malicious client can't promote member listing into a PII
 * exfiltration channel.
 */
async function handleMembers(req: NodeLikeRequest, res: NodeLikeResponse, uid: string, staff: boolean, campaignId: string) {
  // Verify the campaign exists first so a non-member probing a bogus
  // id gets the same 404 as a probe of a real id they can't see.
  const campaignCheck = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  const checkRows = Array.isArray(campaignCheck?.results) ? campaignCheck.results : [];
  if (checkRows.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  if (!staff) {
    const member = await isCampaignMember(uid, campaignId);
    if (!member) {
      throw new HttpError(404, "Campaign not found.");
    }
  }

  const result = await executeD1QueryInternal({
    sql: `SELECT cm.user_id, cm.role, cm.joined_at,
                 u.username, u.display_name, u.avatar_url
            FROM campaign_members cm
            LEFT JOIN users u ON u.id = cm.user_id
           WHERE cm.campaign_id = ?
           ORDER BY cm.joined_at ASC`,
    params: [campaignId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];

  const members = rows.map((r: any) => ({
    user_id: r.user_id,
    role: r.role,
    joined_at: r.joined_at,
    username: r.username,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
  }));

  return res.status(200).json({ members });
}

/* -------------------------------------------------------------------------- */
/* Write handlers                                                              */
/* -------------------------------------------------------------------------- */
//
// Audit #8 close. Writes used to flow through the generic
// /api/d1/query proxy gated only by `requireStaffAccess`, which
// admits the wiki-staff set (admin / co-dm / lore-writer). That let
// lore-writer create, edit, and delete any campaign — wider than the
// permissions-rbac doc says (campaign management is admin / co-dm
// only).
//
// Here, every write requires `isCharacterDM` (admin + co-dm) except
// DELETE which requires admin specifically per the audit's spec.
// Member add/remove goes through dedicated routes so the
// (campaign_id, user_id) pair never originates from a free-form
// SQL payload.

const ALLOWED_CAMPAIGN_FIELDS = new Set([
  "name",
  "slug",
  "description",
  "dm_id",
  "era_id",
  "image_url",
  "image_display",
  "card_image_url",
  "card_display",
  "preview_image_url",
  "preview_display",
  "background_image_url",
  "recommended_lore_id",
  "settings",
]);

const ALLOWED_MEMBER_ROLES = new Set(["dm", "co-dm", "player"]);

async function readJsonBody(req: NodeLikeRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

/**
 * Stringify any object/array values so they hit the DB as JSON text.
 * The campaigns table has `settings`, `image_display`, etc. that are
 * stored as TEXT-of-JSON; passing a JS object straight to D1 would
 * coerce to "[object Object]".
 */
function coerceCampaignValue(value: any): any {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/**
 * POST /api/campaigns
 * Body: { id?: string, ...campaign fields }
 * Returns: { campaign: { id, name, ... } }
 *
 * `id` is accepted from the body if the client wants to pin a uuid
 * (matches the legacy `upsertDocument('campaigns', id, ...)` call
 * pattern in AdminCampaigns.handleCreateCampaign); the server picks
 * one with `crypto.randomUUID()` if absent.
 */
async function handleCreate(req: NodeLikeRequest, res: NodeLikeResponse, decoded: any) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "`name` is required.");

  const id: string = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const slug: string = typeof body.slug === "string" && body.slug
    ? body.slug
    : name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  // Default dm_id to the creator unless the body explicitly sets one
  // (admin tooling can create campaigns owned by another user).
  const dmId: string = typeof body.dm_id === "string" && body.dm_id ? body.dm_id : decoded.uid;

  const columns: string[] = ["id", "name", "slug", "dm_id", "created_at", "updated_at"];
  const values: any[] = [id, name, slug, dmId, new Date().toISOString(), new Date().toISOString()];

  for (const [key, val] of Object.entries(body)) {
    if (key === "id" || key === "name" || key === "slug" || key === "dm_id") continue;
    if (!ALLOWED_CAMPAIGN_FIELDS.has(key)) continue;
    columns.push(key);
    values.push(coerceCampaignValue(val));
  }

  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO campaigns (${columns.join(", ")}) VALUES (${placeholders})`;
  await executeD1QueryInternal({ sql, params: values });

  return res.status(200).json({ campaign: { id, name, slug, dm_id: dmId } });
}

/**
 * PATCH /api/campaigns/[id]
 * Body: subset of ALLOWED_CAMPAIGN_FIELDS
 *
 * Partial update. Unknown fields silently dropped (so a misspelled
 * column doesn't 400 the whole save). `id`, `created_at` not
 * patchable; `updated_at` set server-side.
 */
async function handleUpdate(req: NodeLikeRequest, res: NodeLikeResponse, campaignId: string) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (!ALLOWED_CAMPAIGN_FIELDS.has(key)) continue;
    setClauses.push(`${key} = ?`);
    params.push(coerceCampaignValue(val));
  }

  if (setClauses.length === 0) {
    return res.status(200).json({ ok: true, id: campaignId, noop: true });
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(campaignId);

  // Confirm the campaign exists so a typo'd id surfaces as 404 not a
  // silent 0-row UPDATE.
  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  const sql = `UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = ?`;
  await executeD1QueryInternal({ sql, params });

  return res.status(200).json({ ok: true, id: campaignId });
}

/**
 * DELETE /api/campaigns/[id] — admin-only per the audit spec.
 *
 * Cascades to campaign_members via the FK ON DELETE CASCADE in the
 * migration. Other tables that reference campaigns (lore_article_
 * campaigns, lore_secret_campaigns, characters.campaign_id) don't
 * have FK cascades; they're left as orphaned rows / nulls, same as
 * the legacy deleteDocument behavior.
 */
async function handleDelete(req: NodeLikeRequest, res: NodeLikeResponse, campaignId: string) {
  await requireAdminAccess(req.headers.authorization);

  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  await executeD1QueryInternal({
    sql: "DELETE FROM campaigns WHERE id = ?",
    params: [campaignId],
  });
  return res.status(200).json({ ok: true, id: campaignId });
}

/**
 * PUT /api/campaigns/[id]/members/[uid]
 * Body (optional): { role?: 'dm' | 'co-dm' | 'player' }
 *
 * Idempotent — call repeatedly with the same args and it's a no-op
 * (ON CONFLICT(campaign_id, user_id) DO UPDATE).
 */
async function handleMemberPut(req: NodeLikeRequest, res: NodeLikeResponse, campaignId: string, userId: string) {
  // Verify the campaign exists so a typo'd id surfaces as 404 rather
  // than failing later on the FK.
  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  const body = await readJsonBody(req);
  const requestedRole = typeof body?.role === "string" ? body.role : "player";
  if (!ALLOWED_MEMBER_ROLES.has(requestedRole)) {
    throw new HttpError(400, `Invalid member role \`${requestedRole}\`. Allowed: ${[...ALLOWED_MEMBER_ROLES].join(", ")}.`);
  }

  await executeD1QueryInternal({
    sql: `INSERT INTO campaign_members (campaign_id, user_id, role, joined_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(campaign_id, user_id) DO UPDATE SET role = excluded.role`,
    params: [campaignId, userId, requestedRole, new Date().toISOString()],
  });

  return res.status(200).json({ ok: true, campaign_id: campaignId, user_id: userId, role: requestedRole });
}

async function handleMemberDelete(res: NodeLikeResponse, campaignId: string, userId: string) {
  await executeD1QueryInternal({
    sql: "DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?",
    params: [campaignId, userId],
  });
  return res.status(200).json({ ok: true, campaign_id: campaignId, user_id: userId });
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const { decoded, role } = await requireAuthenticatedUser(req.headers.authorization);
    const uid: string = decoded.uid;
    if (!uid) throw new HttpError(401, "Missing uid in token.");

    // Campaign DM = admin or co-dm. Same set as character DM access
    // because both flows are about running a session; lore-writer is
    // deliberately excluded — that role exists for wiki content, not
    // campaign management.
    const staff = isCharacterDM(role);

    const path = parsePath(req);

    // ── Reads (any signed-in user, server-filtered) ───────────────────
    if (req.method === "GET") {
      if (path.length === 0) {
        return await handleList(req, res, uid, staff);
      }
      if (path.length === 1) {
        return await handleSingle(req, res, uid, staff, path[0]);
      }
      if (path.length === 2 && path[1] === "members") {
        return await handleMembers(req, res, uid, staff, path[0]);
      }
      return res.status(404).json({ error: `Unknown /api/campaigns route: /${path.join("/")}` });
    }

    // ── Writes (admin / co-dm only) ───────────────────────────────────
    // `staff` here is `isCharacterDM(role)` = admin + co-dm.
    // lore-writer is rejected with 403 even though they pass the
    // wiki-staff gate elsewhere; campaign management is not their
    // domain. DELETE additionally re-checks for admin specifically
    // inside the handler.
    if (!staff) {
      throw new HttpError(403, "Campaign DM access required (admin or co-dm).");
    }

    if (req.method === "POST" && path.length === 0) {
      return await handleCreate(req, res, decoded);
    }
    if (req.method === "PATCH" && path.length === 1) {
      return await handleUpdate(req, res, path[0]);
    }
    if (req.method === "DELETE" && path.length === 1) {
      return await handleDelete(req, res, path[0]);
    }
    if (req.method === "PUT" && path.length === 3 && path[1] === "members") {
      return await handleMemberPut(req, res, path[0], path[2]);
    }
    if (req.method === "DELETE" && path.length === 3 && path[1] === "members") {
      return await handleMemberDelete(res, path[0], path[2]);
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed for /${path.join("/")}` });
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
    console.error(`/api/campaigns (${req.method} ${req.url}) failed:`, error);
    return res.status(500).json({ error: message || "Campaigns request failed." });
  }
}
