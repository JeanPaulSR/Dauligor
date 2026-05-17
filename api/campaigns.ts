// /api/campaigns/[[...path]] — catch-all dispatcher for campaign reads.
//
// Closes the broader half of the audit's H7 risk: every page that
// renders a campaign list, single-campaign view, or member roster used
// to fetch the entire campaigns + campaign_members tables through
// /api/d1/query, then filter client-side. That meant any signed-in
// user could enumerate which campaigns exist and (via the membership
// join on staff pages) which players are in which campaign — both
// useful to attackers, neither necessary for the UI.
//
// Routes (all GET):
//
//   /api/campaigns
//     Role-filtered list. Admin / co-dm see every campaign; everyone
//     else sees only campaigns they're a member of. Each row carries
//     `memberCount` so the admin grid doesn't need a second join
//     across campaign_members to render counts.
//
//   /api/campaigns/[id]
//     Single campaign. Members + staff see the full row including
//     `settings` (the JSON column that may hold DM-only feature
//     toggles). Non-members non-staff get 404 — collapsed with "not
//     found" so probes can't enumerate ids by guessing.
//
//   /api/campaigns/[id]/members
//     Roster, enriched with each member's `username` and
//     `display_name` so CampaignEditor can render names without
//     joining against the full users table client-side. Crucially
//     this is the ONLY identity the endpoint exposes — no
//     `recovery_email`, no per-user PII. Same member-or-staff gate
//     as the single-campaign route.
//
// Writes (create / update / delete campaigns, add / remove members)
// stay on /api/d1/query for now. They're already gated to staff at
// the proxy level (writes path of d1-proxy.ts → requireStaffAccess)
// so they don't compound the H7 read leak this commit closes. The
// audit's priority #8 covers moving them.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAuthenticatedUser,
} from "./_lib/firebase-admin.js";
import { executeD1QueryInternal } from "./_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
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
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

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
