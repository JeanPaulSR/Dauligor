// /api/campaigns/* — dispatcher for the campaigns surface.
//
// Closes audit H7 (read enumeration) AND audit #8 (write gates):
//   - Reads — server-filtered to the caller's membership unless they're
//     a campaign DM (admin / co-dm).
//   - Writes — admin/co-dm only; lore-writer 403'd. DELETE additionally
//     requires admin specifically.
//
// Routes:
//   GET    /api/campaigns                          (role-filtered list)
//   GET    /api/campaigns/[id]                     (members + staff)
//   GET    /api/campaigns/[id]/members             (members + staff)
//   GET    /api/campaigns/[id]/home-blocks         (members + staff)
//   POST   /api/campaigns                          (isCharacterDM)
//   PATCH  /api/campaigns/[id]                     (isCharacterDM)
//   DELETE /api/campaigns/[id]                     (admin)
//   PUT    /api/campaigns/[id]/members/[uid]       (isCharacterDM)
//   DELETE /api/campaigns/[id]/members/[uid]       (isCharacterDM)
//   PUT    /api/campaigns/[id]/home-blocks         (isCharacterDM)
//
// `/api/admin/eras/*` writes now live in a dedicated file at
// functions/api/admin/eras/[[path]].ts — the Vercel-era 12-function
// fold that consolidated them here is no longer needed on Pages.

import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAdminAccess,
  requireAuthenticatedUser,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

async function isCampaignMember(uid: string, campaignId: string): Promise<boolean> {
  const result = await executeD1QueryInternal({
    sql: "SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ? LIMIT 1",
    params: [campaignId, uid],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Read handlers                                                               */
/* -------------------------------------------------------------------------- */

async function handleList(uid: string, staff: boolean): Promise<Response> {
  const baseColumns = `
    c.id, c.name, c.slug, c.description, c.dm_id, c.era_id, c.image_url,
    c.background_image_url, c.recommended_lore_id, c.settings, c.created_at, c.updated_at,
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

  const campaigns = rows.map((r: any) => ({
    ...r,
    memberCount: Number(r.member_count ?? 0),
    member_count: undefined,
  }));

  return Response.json({ campaigns });
}

async function handleSingle(uid: string, staff: boolean, campaignId: string): Promise<Response> {
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

  return Response.json({ campaign });
}

async function handleMembers(uid: string, staff: boolean, campaignId: string): Promise<Response> {
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

  return Response.json({ members });
}

async function handleHomeBlocks(uid: string, staff: boolean, campaignId: string): Promise<Response> {
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
    sql: `SELECT id, campaign_id, block_type, "order", config
            FROM campaign_home_blocks
           WHERE campaign_id = ?
           ORDER BY "order" ASC`,
    params: [campaignId],
  });
  const blocks = Array.isArray(result?.results) ? result.results : [];
  return Response.json({ blocks });
}

/* -------------------------------------------------------------------------- */
/* Write handlers                                                              */
/* -------------------------------------------------------------------------- */

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

const ALLOWED_HOME_BLOCK_TYPES = new Set([
  "hero",
  "text",
  "image",
  "divider",
  "recommended",
  "callout",
  "reference",
  "entity-row",
  "entity-feature",
  "group",
  "columns",
  "column",
]);

function coerceCampaignValue(value: any): any {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function handleCreate(request: Request, decoded: any): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "`name` is required.");

  const id: string = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const slug: string = typeof body.slug === "string" && body.slug
    ? body.slug
    : name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

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

  return Response.json({ campaign: { id, name, slug, dm_id: dmId } });
}

async function handleUpdate(request: Request, campaignId: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
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
    return Response.json({ ok: true, id: campaignId, noop: true });
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(campaignId);

  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  const sql = `UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = ?`;
  await executeD1QueryInternal({ sql, params });

  return Response.json({ ok: true, id: campaignId });
}

async function handleDelete(authHeader: string | undefined, campaignId: string): Promise<Response> {
  await requireAdminAccess(authHeader);

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
  return Response.json({ ok: true, id: campaignId });
}

async function handleMemberPut(request: Request, campaignId: string, userId: string): Promise<Response> {
  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  const body = (await request.json().catch(() => ({}))) as any;
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

  return Response.json({ ok: true, campaign_id: campaignId, user_id: userId, role: requestedRole });
}

async function handleHomeBlocksPut(request: Request, campaignId: string): Promise<Response> {
  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM campaigns WHERE id = ? LIMIT 1",
    params: [campaignId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Campaign not found.");
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];

  // Replace-all: clear the campaign's blocks, then re-insert in array order.
  // Plain INSERT after DELETE (NOT INSERT OR REPLACE) — same batch idiom the
  // lore junctions use. `order` is derived from the array index so the client
  // never has to renumber.
  const now = new Date().toISOString();
  const queries: Array<{ sql: string; params: any[] }> = [
    { sql: "DELETE FROM campaign_home_blocks WHERE campaign_id = ?", params: [campaignId] },
  ];

  blocks.forEach((b: any, index: number) => {
    const blockType = typeof b?.block_type === "string" ? b.block_type : "";
    if (!ALLOWED_HOME_BLOCK_TYPES.has(blockType)) {
      throw new HttpError(400, `Invalid home block type \`${blockType}\`.`);
    }
    const id = typeof b?.id === "string" && b.id ? b.id : crypto.randomUUID();
    const config = b?.config && typeof b.config === "object" ? JSON.stringify(b.config) : "{}";
    queries.push({
      sql: `INSERT INTO campaign_home_blocks (id, campaign_id, block_type, "order", config, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, campaignId, blockType, index, config, now, now],
    });
  });

  await executeD1QueryInternal(queries);
  return Response.json({ ok: true, count: blocks.length });
}

async function handleMemberDelete(campaignId: string, userId: string): Promise<Response> {
  await executeD1QueryInternal({
    sql: "DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?",
    params: [campaignId, userId],
  });
  return Response.json({ ok: true, campaign_id: campaignId, user_id: userId });
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded, role } = await requireAuthenticatedUser(authHeader);
    const uid: string = decoded.uid;
    if (!uid) throw new HttpError(401, "Missing uid in token.");

    const staff = isCharacterDM(role);

    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    // ── Reads (any signed-in user, server-filtered) ───────────────────
    if (request.method === "GET") {
      if (path.length === 0) {
        return await handleList(uid, staff);
      }
      if (path.length === 1) {
        return await handleSingle(uid, staff, path[0]);
      }
      if (path.length === 2 && path[1] === "members") {
        return await handleMembers(uid, staff, path[0]);
      }
      if (path.length === 2 && path[1] === "home-blocks") {
        return await handleHomeBlocks(uid, staff, path[0]);
      }
      return Response.json(
        { error: `Unknown /api/campaigns route: /${path.join("/")}` },
        { status: 404 },
      );
    }

    // ── Writes (admin / co-dm only) ───────────────────────────────────
    if (!staff) {
      throw new HttpError(403, "Campaign DM access required (admin or co-dm).");
    }

    if (request.method === "POST" && path.length === 0) {
      return await handleCreate(request, decoded);
    }
    if (request.method === "PATCH" && path.length === 1) {
      return await handleUpdate(request, path[0]);
    }
    if (request.method === "PUT" && path.length === 2 && path[1] === "home-blocks") {
      return await handleHomeBlocksPut(request, path[0]);
    }
    if (request.method === "DELETE" && path.length === 1) {
      return await handleDelete(authHeader, path[0]);
    }
    if (request.method === "PUT" && path.length === 3 && path[1] === "members") {
      return await handleMemberPut(request, path[0], path[2]);
    }
    if (request.method === "DELETE" && path.length === 3 && path[1] === "members") {
      return await handleMemberDelete(path[0], path[2]);
    }

    return Response.json(
      { error: `Method ${request.method} not allowed for /${path.join("/")}` },
      { status: 405 },
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
    console.error(`/api/campaigns (${request.method} ${request.url}) failed:`, error);
    return Response.json(
      { error: message || "Campaigns request failed." },
      { status: 500 },
    );
  }
};
