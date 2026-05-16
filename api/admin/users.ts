// /api/admin/users — admin/staff user listing + password recovery actions.
//
// Catch-all dispatcher with one file at the resource root, mirroring the
// pattern from api/me.ts / api/lore.ts / api/campaigns.ts. The
// vercel.json rewrite `/api/admin/users/(.*) → /api/admin/users` routes
// every sub-path here; the handler parses the original URL out of
// req.url. Single function — preserves the 11/12 Hobby plan budget.
//
// Closes M2 from the audit: previously AdminUsers, AdminCampaigns, and
// CampaignEditor all ran `fetchCollection('users')` against the generic
// proxy, which returns the full row (including recovery_email) to any
// staff caller. The proxy was staff-gated, so the leak was
// staff-within-staff: lore-writer (allowed to read users today via the
// relaxed read gate) sees every player's recovery_email, etc. Now the
// list endpoint column-scopes by viewer role.
//
// Routes:
//
//   GET   /api/admin/users
//     Staff-gated user list. Column visibility depends on viewer role:
//       - Admin: full row including recovery_email and active_campaign_id.
//       - Other staff (co-dm / lore-writer): minimal identity only —
//         id, username, display_name, role, avatar_url, hide_username,
//         is_private. No recovery_email, no bio, no theme/accent_color.
//     Every row is enriched with `campaign_ids: string[]` via a JOIN on
//     campaign_members. Closes the second H7-leak path where AdminUsers
//     also called `fetchCollection('campaignMembers')` (full enumeration
//     of every membership row) to compute the same per-user list
//     client-side.
//
//   POST  /api/admin/users/<uid>/temporary-password
//     Destructive — overwrites the target's Firebase Auth password with
//     a random 14-char value and returns it once. Admin only.
//
//   POST  /api/admin/users/<uid>/sign-in-token
//     Non-destructive — mints a 1-hour Firebase custom token. Admin
//     shares a /auth/redeem?token=... URL; SPA exchanges via
//     signInWithCustomToken. Admin only.
//
// Out of scope (still on /api/d1/query — audit follow-up):
//   - POST /api/admin/users — create user (admin-only, but client still
//     uses the secondary-app + upsertDocument pattern).
//   - PATCH /api/admin/users/<uid> — role changes. Currently the client
//     calls upsertDocument('users', uid, {…role}), which the proxy
//     admits for any staff role. A co-dm / lore-writer can in principle
//     promote themselves to admin via direct devtools writes. Tracked
//     as the H6 staff-side follow-up.
//   - DELETE /api/admin/users/<uid> — delete user. Same shape.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getAdminServices,
  getCredentialErrorMessage,
  isWikiStaff,
  requireAdminAccess,
  requireAuthenticatedUser,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  body?: any;
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
 * Same shape as the other resource-root dispatchers (api/me.ts,
 * api/lore.ts, api/campaigns.ts). Vercel preserves the original URL
 * in `req.url` across the `/api/admin/users/(.*) → /api/admin/users`
 * rewrite so we can dispatch without losing the path tail.
 */
function parsePath(req: NodeLikeRequest): string[] {
  const url = req.url || "";
  const pathname = url.split("?")[0];
  const tail = pathname.replace(/^\/api\/admin\/users\/?/, "");
  if (!tail) return [];
  return tail.split("/").filter(Boolean).map(decodeURIComponent);
}

/* -------------------------------------------------------------------------- */
/* GET /api/admin/users — list                                                 */
/* -------------------------------------------------------------------------- */

// Columns every staff viewer is allowed to see. Anything sensitive
// (recovery_email, active_campaign_id) stays off this list and is only
// added back for admin viewers.
const BASIC_USER_COLUMNS = [
  "id",
  "username",
  "display_name",
  "role",
  "avatar_url",
  "hide_username",
  "is_private",
  "created_at",
] as const;

// Extra columns admins see — the union with BASIC_USER_COLUMNS is
// effectively "everything except updated_at" (which the wire doesn't
// need; the client doesn't render it). recovery_email is the critical
// one — the docs at users.md and auth-firebase.md both promise it
// never leaves the server to non-admin viewers.
const ADMIN_EXTRA_COLUMNS = [
  "bio",
  "pronouns",
  "theme",
  "accent_color",
  "recovery_email",
  "active_campaign_id",
] as const;

async function handleList(req: NodeLikeRequest, res: NodeLikeResponse, role: string | null) {
  // Wiki staff (admin / co-dm / lore-writer) get the list; everyone
  // else 403s. lore-writer's inclusion matches what the legacy
  // /api/d1/query write gate admits today — narrowing it would break
  // AdminCampaigns/CampaignEditor pages for that role; we keep the
  // surface and just column-scope the response.
  if (!isWikiStaff(role)) {
    throw new HttpError(403, "Staff access required.");
  }

  const isAdmin = role === "admin";
  const visibleCols = isAdmin
    ? [...BASIC_USER_COLUMNS, ...ADMIN_EXTRA_COLUMNS]
    : [...BASIC_USER_COLUMNS];

  // SELECT u.col1, u.col2, ..., GROUP_CONCAT(cm.campaign_id) AS campaign_ids
  // The GROUP_CONCAT closes the second leak path — AdminUsers used to
  // fetch every campaign_members row separately and bucket them client-
  // side, which leaked the entire membership graph regardless of which
  // users were on screen.
  const colsSql = visibleCols.map((c) => `u.${c}`).join(", ");
  const sql = `SELECT ${colsSql},
                      (SELECT GROUP_CONCAT(cm.campaign_id) FROM campaign_members cm WHERE cm.user_id = u.id) AS campaign_ids
                 FROM users u
                ORDER BY u.username ASC`;

  const result = await executeD1QueryInternal({ sql });
  const rows = Array.isArray(result?.results) ? result.results : [];

  const users = rows.map((r: any) => {
    const { campaign_ids: rawCampaignIds, ...rest } = r;
    const campaignIds = typeof rawCampaignIds === "string" && rawCampaignIds
      ? rawCampaignIds.split(",").filter(Boolean)
      : [];
    return { ...rest, campaign_ids: campaignIds };
  });

  return res.status(200).json({ users });
}

/* -------------------------------------------------------------------------- */
/* POST /api/admin/users/[id]/temporary-password                               */
/* POST /api/admin/users/[id]/sign-in-token                                    */
/* -------------------------------------------------------------------------- */

/**
 * Generates a 14-character password that always contains at least one
 * uppercase, lowercase, number, and symbol. Avoids visually ambiguous
 * characters (no O/0, l/1, etc.) so the value can be safely read off a
 * screen and shared verbally. Used only by the destructive
 * temporary-password branch.
 */
function createTemporaryPassword(length = 14) {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnpqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%*?";
  const allChars = `${uppercase}${lowercase}${numbers}${symbols}`;

  const required = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  while (required.length < length) {
    required.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }
  // Fisher-Yates shuffle so the required chars aren't always at the front.
  for (let i = required.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [required[i], required[swapIndex]] = [required[swapIndex], required[i]];
  }
  return required.join("");
}

async function ensureTargetExists(targetUserId: string): Promise<void> {
  // Don't change Firebase state for a UID that has no D1 profile.
  // Guards against typos / stale UIDs that would otherwise quietly
  // succeed on Firebase but leave the app with a Firebase account
  // that can't load a profile.
  const targetCheck = await executeD1QueryInternal({
    sql: "SELECT id FROM users WHERE id = ? LIMIT 1",
    params: [targetUserId],
  });
  if (!targetCheck.results?.length) {
    throw new HttpError(404, "Target user profile not found.");
  }
}

async function handleTemporaryPassword(targetUserId: string, res: NodeLikeResponse) {
  await ensureTargetExists(targetUserId);
  const temporaryPassword = createTemporaryPassword();
  const { auth } = getAdminServices();

  // Firebase only stores one password per account — this OVERWRITES
  // whatever the user currently has. The Settings UI's "Generate
  // temp password" button is labeled accordingly so admins don't
  // accidentally lock someone out who already knew their password.
  await auth.updateUser(targetUserId, { password: temporaryPassword });

  return res.status(200).json({
    temporaryPassword,
    generatedAt: new Date().toISOString(),
  });
}

async function handleSignInToken(targetUserId: string, res: NodeLikeResponse) {
  await ensureTargetExists(targetUserId);

  // Custom tokens carry the uid but no role claims — role still lives
  // in D1 and is the single source of truth. If we ever need a token
  // that signs the user in with elevated claims (emergency support
  // session, etc.), add a `developerClaims` arg here.
  const { auth } = getAdminServices();
  const token = await auth.createCustomToken(targetUserId);

  // 1 hour matches the Firebase Admin SDK default expiry. We compute
  // the string client-side instead of trusting the JWT exp claim so
  // the admin can show the user a friendly "expires at <time>" hint
  // in the dialog.
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000).toISOString();

  return res.status(200).json({
    token,
    issuedAt: issuedAt.toISOString(),
    expiresAt,
  });
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const path = parsePath(req);

    // List — GET /api/admin/users (path is empty after the rewrite)
    if (path.length === 0) {
      if (req.method !== "GET") {
        return res.status(405).json({ error: `Method ${req.method} not allowed.` });
      }
      const { role } = await requireAuthenticatedUser(req.headers.authorization);
      return await handleList(req, res, role ?? null);
    }

    // Recovery actions — POST /api/admin/users/<id>/<action>
    if (path.length === 2) {
      if (req.method !== "POST") {
        return res.status(405).json({ error: `Method ${req.method} not allowed.` });
      }
      // Admin-only — both recovery flows let one user act on another's
      // Firebase Auth record, which is unconditionally an admin-level
      // operation regardless of the destructiveness toggle.
      await requireAdminAccess(req.headers.authorization);
      const targetUserId = path[0];
      const action = path[1];
      switch (action) {
        case "temporary-password":
          return await handleTemporaryPassword(targetUserId, res);
        case "sign-in-token":
          return await handleSignInToken(targetUserId, res);
        default:
          return res.status(404).json({
            error: `Unknown admin user action: ${action || "(empty)"}`,
          });
      }
    }

    return res.status(404).json({ error: `Unknown /api/admin/users route: /${path.join("/")}` });
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
    console.error(`/api/admin/users (${req.method} ${req.url}) failed:`, error);
    return res.status(500).json({ error: message || "/api/admin/users request failed." });
  }
}
