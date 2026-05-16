// /api/profiles/[username] — read another user's public profile.
//
// Closes the public-profile half of H1 (recovery_email + other private
// fields leaking through a `SELECT * FROM users WHERE username = ?` at
// Profile.tsx:26) and the per-profile half of H7 (campaign_members
// enumeration via Profile.tsx:33,40).
//
// Field visibility rules:
//   - Owner of the profile, or admin/co-dm: full row, full campaign list.
//   - Anyone else, when `is_private = false`: a curated subset
//     (display_name, username, avatar_url, bio, pronouns, role,
//     created_at, is_private). `recovery_email`, `active_campaign_id`,
//     `hide_username` (a setting about how *others* attribute them)
//     never go out.
//   - Anyone else, when `is_private = true`: only the bare minimum the
//     "sealed" placeholder card needs — username, display_name,
//     is_private = true. No campaigns. No bio. Nothing.
//
// `lore-writer` viewers are treated the same as players for this read.
// The campaign list is currently the full set of campaigns the target
// belongs to; tightening it to the viewer/target intersection is part
// of the audit's H7 follow-up but not in this commit.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAuthenticatedUser,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

// Roles that can see the full profile of any user. Reuses the
// character-DM set because the access semantics are identical: admin
// and co-dm need to be able to look up player profiles when running a
// session. `lore-writer` doesn't — that role is for wiki content only.
function isProfileStaff(role: string | null | undefined): boolean {
  return role === "admin" || isCharacterDM(role);
}

function getUsernameFromPath(req: NodeLikeRequest): string {
  const raw = req.query?.username;
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  const url = req.url || "";
  const match = url.match(/\/api\/profiles\/([^\/\?]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return "";
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    const username = getUsernameFromPath(req).toLowerCase();
    if (!username) {
      throw new HttpError(400, "Missing username in path.");
    }

    const { decoded, role } = await requireAuthenticatedUser(req.headers.authorization);
    const viewerUid: string = decoded.uid;

    // Pull the full row server-side first; the field strip happens in
    // memory before the response. Avoids a second round trip just to
    // check `is_private` or ownership.
    const result = await executeD1QueryInternal({
      sql: "SELECT * FROM users WHERE username = ? LIMIT 1",
      params: [username],
    });
    const rows = Array.isArray(result?.results) ? result.results : [];
    if (rows.length === 0) {
      // 404 with a generic message — don't distinguish "no such
      // username" from "exists but you can't see it" (covered by the
      // is_private branch below).
      throw new HttpError(404, "Profile not found.");
    }
    const row = rows[0] as any;

    const isOwner = row.id === viewerUid;
    const isStaff = isProfileStaff(role);
    const isPrivate = !!row.is_private;

    if (isPrivate && !isOwner && !isStaff) {
      // "Sealed" view: enough for the placeholder card, nothing else.
      return res.status(200).json({
        profile: {
          username: row.username,
          display_name: row.display_name,
          is_private: true,
        },
        campaigns: [],
      });
    }

    // Owner / staff see the full row. Everyone else (non-private
    // viewers) gets a curated subset — explicit allow-list, not a
    // strip-blocklist, so a future column addition stays private by
    // default.
    const profile = (isOwner || isStaff)
      ? row
      : {
          id: row.id,
          username: row.username,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          bio: row.bio,
          pronouns: row.pronouns,
          role: row.role,
          is_private: !!row.is_private,
          created_at: row.created_at,
        };

    // Campaign list: same visibility as the profile itself. We're
    // pulling full campaign rows here (rather than just ids) to save
    // Profile.tsx a second round trip — match what the old client
    // assembled out of fetchCollection('campaigns') + filter.
    const membershipsResult = await executeD1QueryInternal({
      sql: "SELECT campaign_id FROM campaign_members WHERE user_id = ?",
      params: [row.id],
    });
    const membershipRows = Array.isArray(membershipsResult?.results) ? membershipsResult.results : [];
    const campaignIds = membershipRows
      .map((m: any) => String(m?.campaign_id ?? ""))
      .filter(Boolean);

    let campaigns: any[] = [];
    if (campaignIds.length > 0) {
      const placeholders = campaignIds.map(() => "?").join(", ");
      const campaignsResult = await executeD1QueryInternal({
        sql: `SELECT id, name, description, era_id FROM campaigns WHERE id IN (${placeholders})`,
        params: campaignIds,
      });
      campaigns = Array.isArray(campaignsResult?.results) ? campaignsResult.results : [];
    }

    return res.status(200).json({ profile, campaigns });
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
    console.error("/api/profiles/[username] failed:", error);
    return res.status(500).json({ error: message || "Profile request failed." });
  }
}
