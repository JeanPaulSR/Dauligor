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

import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAuthenticatedUser,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";

// Roles that can see the full profile of any user. Reuses the
// character-DM set because the access semantics are identical: admin
// and co-dm need to be able to look up player profiles when running a
// session. `lore-writer` doesn't — that role is for wiki content only.
function isProfileStaff(role: string | null | undefined): boolean {
  return role === "admin" || isCharacterDM(role);
}

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  if (request.method !== "GET") {
    return Response.json(
      { error: `Method ${request.method} not allowed.` },
      { status: 405 },
    );
  }

  try {
    const username = String(params?.username || "").toLowerCase();
    if (!username) {
      throw new HttpError(400, "Missing username in path.");
    }

    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded, role } = await requireAuthenticatedUser(authHeader);
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
      return Response.json({
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

    // Campaign list: same visibility as the profile itself.
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

    return Response.json({ profile, campaigns });
  } catch (error: any) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return Response.json({ error: credentialMessage }, { status: 503 });
    }
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("/api/profiles/[username] failed:", error);
    return Response.json(
      { error: message || "Profile request failed." },
      { status: 500 },
    );
  }
};
