// /api/admin/users/* — admin user CRUD + password recovery actions.
//
// Catch-all dispatcher with one file at the resource root. Pages
// filesystem routing maps every sub-path under /api/admin/users/ to
// this file via the [[path]] catch-all; the dispatcher uses
// context.params.path to route.
//
// Closes M2 + the H6 staff-side bypass: the AdminUsers / AdminCampaigns
// / CampaignEditor pages used to call `fetchCollection('users')` and
// `upsertDocument('users', …)` against the generic proxy, which let
// any staff (including lore-writer) read every recovery_email and
// promote themselves to admin via direct devtools writes. The proxy
// gate now refuses raw `users` reads and writes (`PROTECTED_READ_TABLES`
// + `PROTECTED_WRITE_TABLES`), forcing every caller through this file.
//
// Routes:
//
//   GET    /api/admin/users
//     Staff list (isWikiStaff). Column visibility depends on viewer
//     role: admin gets the full row including recovery_email, other
//     staff get the basic identity column set. Each row enriched with
//     `campaign_ids: string[]` via a JOIN on campaign_members (closes
//     the second H7-leak path).
//
//   POST   /api/admin/users
//     Create (requireAdminAccess). Provisions the Firebase Auth user
//     via Identity Toolkit REST and inserts the D1 row in one go.
//     Server picks a uuid if `id` is omitted.
//
//   PATCH  /api/admin/users/<uid>
//     Update (requireAdminAccess). Allow-listed columns. Username
//     changes push through adminAuth.updateUser so the auth email
//     (`<username>@archive.internal`) stays in sync. `campaign_ids`
//     in the body triggers a server-side reconciliation against
//     campaign_members (diff and INSERT/DELETE the delta).
//
//   DELETE /api/admin/users/<uid>
//     Delete (requireAdminAccess). Removes both the Firebase Auth
//     record and the D1 row. FK cascade clears campaign_members.
//
//   POST   /api/admin/users/<uid>/temporary-password
//     Destructive — overwrites the target's Firebase Auth password
//     with a random 14-char value and returns it once.
//
//   POST   /api/admin/users/<uid>/sign-in-token
//     Non-destructive — mints a 1-hour Firebase custom token.

import {
  HttpError,
  getCredentialErrorMessage,
  isWikiStaff,
  requireAdminAccess,
  requireAuthenticatedUser,
} from "../../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../../api/_lib/d1-internal.js";
import { hashPassword } from "../../../../api/_lib/password.js";
import { issueSessionToken } from "../../../../api/_lib/sessionToken.js";
import {
  ALL_PERMISSION_KEYS,
  getUserPermissions,
  isValidPermissionKey,
  parseScope,
  serializeScope,
  type Scope,
} from "../../../../api/_lib/permissions.js";

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

async function handleList(role: string | null): Promise<Response> {
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

  // SELECT u.col1, u.col2, ..., GROUP_CONCAT(cm.campaign_id) AS campaign_ids,
  //                              GROUP_CONCAT(up.permission_key) AS permission_keys.
  // The first GROUP_CONCAT closes the second H7-leak path — AdminUsers
  // used to fetch every campaign_members row separately and bucket them
  // client-side, which leaked the entire membership graph regardless of
  // which users were on screen.
  //
  // `permission_keys` is just the key list (not scope) so admins get a
  // glance-able badge column. The full scope per permission ships via
  // GET /api/admin/users/<uid>/permissions when the admin opens the
  // permissions panel.
  const colsSql = visibleCols.map((c) => `u.${c}`).join(", ");
  const sql = `SELECT ${colsSql},
                      (SELECT GROUP_CONCAT(cm.campaign_id) FROM campaign_members cm WHERE cm.user_id = u.id) AS campaign_ids,
                      (SELECT GROUP_CONCAT(up.permission_key) FROM user_permissions up WHERE up.user_id = u.id) AS permission_keys
                 FROM users u
                ORDER BY u.username ASC`;

  const result = await executeD1QueryInternal({ sql });
  const rows = Array.isArray(result?.results) ? result.results : [];

  const users = rows.map((r: any) => {
    const {
      campaign_ids: rawCampaignIds,
      permission_keys: rawPermissionKeys,
      ...rest
    } = r;
    const campaignIds = typeof rawCampaignIds === "string" && rawCampaignIds
      ? rawCampaignIds.split(",").filter(Boolean)
      : [];
    const permissionKeys = typeof rawPermissionKeys === "string" && rawPermissionKeys
      ? rawPermissionKeys.split(",").filter(Boolean)
      : [];
    return { ...rest, campaign_ids: campaignIds, permission_keys: permissionKeys };
  });

  return Response.json({ users });
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

async function handleTemporaryPassword(targetUserId: string): Promise<Response> {
  await ensureTargetExists(targetUserId);
  const temporaryPassword = createTemporaryPassword();

  // OVERWRITES the user's native credential with a scrypt hash of the temp
  // password. The Settings UI button is labeled accordingly so admins don't
  // accidentally lock someone out who already knew their password.
  const hash = await hashPassword(temporaryPassword);
  await executeD1QueryInternal({
    sql: "UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?",
    params: [hash, new Date().toISOString(), targetUserId],
  });

  return Response.json({
    temporaryPassword,
    generatedAt: new Date().toISOString(),
  });
}

/* -------------------------------------------------------------------------- */
/* POST /api/admin/users — create                                              */
/* PATCH /api/admin/users/[id] — update                                        */
/* DELETE /api/admin/users/[id] — delete                                       */
/*                                                                              */
/* These three close the H6 staff-side follow-up. Before this commit,           */
/* AdminUsers wrote to the `users` table via the generic /api/d1/query          */
/* with `upsertDocument` / `deleteDocument` — both of which only required       */
/* `requireStaffAccess`. A co-dm or lore-writer with devtools open could        */
/* therefore promote themselves to admin via a single client-side write.        */
/* Routing these through dedicated admin-gated endpoints (combined with         */
/* the proxy-side write block on the `users` table) closes that vector.         */
/* -------------------------------------------------------------------------- */

// Columns the admin may set via PATCH. `id`, `username`, `created_at`,
// `updated_at` are deliberately not in the allow-list: id is immutable,
// username changes need a Firebase Auth rename (which we expose through
// PATCH /api/me — the target user makes that change themselves), and
// the timestamps are server-controlled. `campaign_ids` is special and
// triggers membership reconciliation rather than a column write.
const ALLOWED_USER_PATCH_FIELDS = new Set([
  "display_name",
  "role",
  "bio",
  "pronouns",
  "avatar_url",
  "theme",
  "accent_color",
  "hide_username",
  "is_private",
  "recovery_email",
  "active_campaign_id",
]);

const BOOLEAN_USER_FIELDS = new Set(["hide_username", "is_private"]);
const VALID_ROLES = new Set(["admin", "co-dm", "lore-writer", "trusted-player", "user"]);

/**
 * Replace the calling user's membership set with the requested one.
 * Idempotent — DELETE any rows not in `desiredIds`, INSERT any rows in
 * `desiredIds` not currently present. Uses the campaign_members PK
 * (campaign_id, user_id) so concurrent toggles can't double-insert.
 */
async function reconcileMemberships(userId: string, desiredIds: string[]): Promise<void> {
  // Current memberships
  const currentRes = await executeD1QueryInternal({
    sql: "SELECT campaign_id FROM campaign_members WHERE user_id = ?",
    params: [userId],
  });
  const currentRows = Array.isArray(currentRes?.results) ? currentRes.results : [];
  const currentIds = new Set<string>(currentRows.map((r: any) => String(r.campaign_id)));
  const targetIds = new Set<string>(desiredIds.map(String));

  const toRemove: string[] = [];
  currentIds.forEach((id) => {
    if (!targetIds.has(id)) toRemove.push(id);
  });
  const toAdd: string[] = [];
  targetIds.forEach((id) => {
    if (!currentIds.has(id)) toAdd.push(id);
  });

  // Removes first so re-adding (rare) doesn't trip the PK while we
  // walk the diff. D1 doesn't support multi-row DELETE WHERE IN with
  // bound parameters as cleanly as a loop here would; per-row is fine
  // since membership sets are tiny (~dozens).
  for (const cid of toRemove) {
    await executeD1QueryInternal({
      sql: "DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?",
      params: [cid, userId],
    });
  }
  for (const cid of toAdd) {
    await executeD1QueryInternal({
      sql: `INSERT INTO campaign_members (campaign_id, user_id, role, joined_at)
            VALUES (?, ?, 'player', ?)
            ON CONFLICT(campaign_id, user_id) DO NOTHING`,
      params: [cid, userId, new Date().toISOString()],
    });
  }
}

/**
 * Re-query a single user row + its membership join, in the same shape
 * /api/admin/users (list) returns. Used as the post-write response so
 * the client can drop in the new value without an extra round trip.
 */
async function loadUserById(userId: string): Promise<any | null> {
  const result = await executeD1QueryInternal({
    sql: `SELECT u.*,
                 (SELECT GROUP_CONCAT(cm.campaign_id) FROM campaign_members cm WHERE cm.user_id = u.id) AS campaign_ids,
                 (SELECT GROUP_CONCAT(up.permission_key) FROM user_permissions up WHERE up.user_id = u.id) AS permission_keys
            FROM users u
           WHERE u.id = ?
           LIMIT 1`,
    params: [userId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) return null;
  const {
    campaign_ids: rawCampaignIds,
    permission_keys: rawPermissionKeys,
    ...rest
  } = rows[0] as any;
  const campaignIds = typeof rawCampaignIds === "string" && rawCampaignIds
    ? rawCampaignIds.split(",").filter(Boolean)
    : [];
  const permissionKeys = typeof rawPermissionKeys === "string" && rawPermissionKeys
    ? rawPermissionKeys.split(",").filter(Boolean)
    : [];
  return { ...rest, campaign_ids: campaignIds, permission_keys: permissionKeys };
}

async function handleCreate(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = typeof body?.role === "string" ? body.role : "user";
  const campaignIds: string[] = Array.isArray(body?.campaignIds)
    ? body.campaignIds.map(String).filter(Boolean)
    : [];

  if (!username) throw new HttpError(400, "Missing `username`.");
  if (!displayName) throw new HttpError(400, "Missing `displayName`.");
  if (!password || password.length < 6) {
    throw new HttpError(400, "Password must be at least 6 characters.");
  }
  if (!/^[a-z0-9_-]+$/i.test(username)) {
    throw new HttpError(400, "Username must contain only letters, numbers, dashes and underscores.");
  }
  if (!VALID_ROLES.has(role)) {
    throw new HttpError(400, `Invalid role: ${role}`);
  }

  // Duplicate-username pre-check — Firebase Auth would reject the
  // create with EMAIL_EXISTS anyway, but D1 also has a UNIQUE
  // constraint on `username` and we'd rather surface a friendly
  // 409 than a 500 from the constraint violation later.
  const existing = await executeD1QueryInternal({
    sql: "SELECT id FROM users WHERE username = ? LIMIT 1",
    params: [username],
  });
  if (Array.isArray(existing?.results) && existing.results.length > 0) {
    throw new HttpError(409, "That username is already taken.");
  }

  // Native account: a generated id (no longer a Firebase UID) + the scrypt hash
  // of the password, stored straight on the D1 row. No Firebase Auth account is
  // created — the user logs in via /api/auth/login.
  const uid = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const nowIso = new Date().toISOString();
  const initialActiveCampaign = campaignIds[0] || null;

  await executeD1QueryInternal({
    sql: `INSERT INTO users (id, username, display_name, role, theme, active_campaign_id, password_hash, password_updated_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'parchment', ?, ?, ?, ?, ?)`,
    params: [uid, username, displayName, role, initialActiveCampaign, passwordHash, nowIso, nowIso, nowIso],
  });

  if (campaignIds.length > 0) {
    await reconcileMemberships(uid, campaignIds);
  }

  const user = await loadUserById(uid);
  return Response.json({ user });
}

async function handleUpdate(request: Request, targetUserId: string): Promise<Response> {
  await ensureTargetExists(targetUserId);

  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  // Filter to allow-listed columns + coerce booleans to 0/1 (D1's
  // SQLite-flavored booleans). `campaign_ids` is special-cased: it
  // doesn't go into the UPDATE, it triggers reconcileMemberships.
  const updates: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "campaign_ids") continue;
    if (!ALLOWED_USER_PATCH_FIELDS.has(key)) continue;
    if (key === "role" && typeof value === "string" && !VALID_ROLES.has(value)) {
      throw new HttpError(400, `Invalid role: ${value}`);
    }
    if (BOOLEAN_USER_FIELDS.has(key)) {
      updates[key] = value ? 1 : 0;
    } else {
      updates[key] = value === undefined ? null : value;
    }
  }

  if (Object.keys(updates).length > 0) {
    const setClauses: string[] = [];
    const params: any[] = [];
    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
    setClauses.push("updated_at = CURRENT_TIMESTAMP");
    params.push(targetUserId);
    await executeD1QueryInternal({
      sql: `UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    });
  }

  // Memberships reconciliation if the body asks for it. Caller sends
  // the full desired set (not a diff) — server figures out which rows
  // to add and remove. Idempotent.
  if (Array.isArray(body.campaign_ids)) {
    await reconcileMemberships(targetUserId, body.campaign_ids);
  }

  const user = await loadUserById(targetUserId);
  return Response.json({ user });
}

async function handleDelete(targetUserId: string): Promise<Response> {
  await ensureTargetExists(targetUserId);

  // Deleting the D1 row removes the native credential (password_hash) with it.
  // D1 FK cascades on `users.id` clear campaign_members and any other rows that
  // referenced this user, per the schema in
  // worker/migrations/0002_phase2_identity.sql.
  await executeD1QueryInternal({
    sql: "DELETE FROM users WHERE id = ?",
    params: [targetUserId],
  });

  return Response.json({ ok: true, id: targetUserId });
}

/* -------------------------------------------------------------------------- */
/* Permission grants — additive capability layer (Phase 1)                    */
/*                                                                              */
/* The `users.role` column stays a single value on the existing ladder.       */
/* Extra capabilities like `content-creator` live in `user_permissions` and    */
/* are managed through these three endpoints. Scope JSON narrows the grant     */
/* to specific worlds / campaigns / eras; null = unrestricted on every axis.   */
/* -------------------------------------------------------------------------- */

function sanitizeScope(input: unknown): Scope | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "`scope` must be an object or null.");
  }
  const out: Scope = {};
  for (const axis of ["worlds", "campaigns", "eras"] as const) {
    const v = (input as any)[axis];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      throw new HttpError(400, `\`scope.${axis}\` must be an array of ids.`);
    }
    out[axis] = v.map(String).filter(Boolean);
  }
  return Object.keys(out).length === 0 ? null : out;
}

async function handlePermissionsList(targetUserId: string): Promise<Response> {
  await ensureTargetExists(targetUserId);
  const result = await executeD1QueryInternal({
    sql: `SELECT permission_key, scope_json, granted_at, granted_by_user_id
            FROM user_permissions
           WHERE user_id = ?
        ORDER BY granted_at ASC`,
    params: [targetUserId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  const permissions = rows.map((row: any) => ({
    permission_key: row.permission_key,
    scope: parseScope(row.scope_json),
    granted_at: row.granted_at ?? null,
    granted_by_user_id: row.granted_by_user_id ?? null,
  }));
  return Response.json({
    user_id: targetUserId,
    permissions,
    available_keys: ALL_PERMISSION_KEYS,
  });
}

async function handlePermissionUpsert(
  request: Request,
  targetUserId: string,
  permissionKey: string,
  grantedByUserId: string,
): Promise<Response> {
  if (!isValidPermissionKey(permissionKey)) {
    throw new HttpError(400, `Invalid permission key: ${permissionKey}`);
  }
  await ensureTargetExists(targetUserId);

  const body = (await request.json().catch(() => ({}))) as any;
  const hasScope = body && typeof body === "object" && "scope" in body;
  const scope: Scope | null = hasScope ? sanitizeScope(body.scope) : null;
  const scopeJson = serializeScope(scope);

  const id = crypto.randomUUID();
  await executeD1QueryInternal({
    sql: `INSERT INTO user_permissions
              (id, user_id, permission_key, scope_json, granted_at, granted_by_user_id)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
          ON CONFLICT(user_id, permission_key) DO UPDATE SET
              scope_json = excluded.scope_json,
              granted_at = excluded.granted_at,
              granted_by_user_id = excluded.granted_by_user_id`,
    params: [id, targetUserId, permissionKey, scopeJson, grantedByUserId],
  });

  return Response.json({
    ok: true,
    user_id: targetUserId,
    permission_key: permissionKey,
    scope,
  });
}

async function handlePermissionDelete(
  targetUserId: string,
  permissionKey: string,
): Promise<Response> {
  if (!isValidPermissionKey(permissionKey)) {
    throw new HttpError(400, `Invalid permission key: ${permissionKey}`);
  }
  await ensureTargetExists(targetUserId);

  await executeD1QueryInternal({
    sql: "DELETE FROM user_permissions WHERE user_id = ? AND permission_key = ?",
    params: [targetUserId, permissionKey],
  });
  return Response.json({
    ok: true,
    user_id: targetUserId,
    permission_key: permissionKey,
  });
}

const SIGN_IN_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour to redeem the link

async function handleSignInToken(targetUserId: string): Promise<Response> {
  // Load the user so the token carries the current username/role (role still
  // lives in D1 and is re-checked server-side on every request).
  const result = await executeD1QueryInternal({
    sql: "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
    params: [targetUserId],
  });
  const row = Array.isArray(result?.results) ? (result.results[0] as any) : null;
  if (!row) {
    throw new HttpError(404, "Target user profile not found.");
  }

  // A short-lived native session token: signs the user in directly when
  // redeemed, but the LINK is unusable after an hour. Once redeemed, the
  // client's sliding refresh extends an active session to full length.
  const token = await issueSessionToken(
    { id: row.id, username: row.username, role: row.role },
    SIGN_IN_TOKEN_TTL_SECONDS,
  );

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SIGN_IN_TOKEN_TTL_SECONDS * 1000).toISOString();

  return Response.json({
    token,
    issuedAt: issuedAt.toISOString(),
    expiresAt,
  });
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    // GET /api/admin/users — list (staff-gated, column-scoped)
    // POST /api/admin/users — create (admin only)
    if (path.length === 0) {
      if (request.method === "GET") {
        const { role } = await requireAuthenticatedUser(authHeader);
        return await handleList(role ?? null);
      }
      if (request.method === "POST") {
        await requireAdminAccess(authHeader);
        return await handleCreate(request);
      }
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    // PATCH /api/admin/users/<id> — update (admin only)
    // DELETE /api/admin/users/<id> — delete (admin only)
    if (path.length === 1) {
      const targetUserId = path[0];
      if (request.method === "PATCH") {
        await requireAdminAccess(authHeader);
        return await handleUpdate(request, targetUserId);
      }
      if (request.method === "DELETE") {
        await requireAdminAccess(authHeader);
        return await handleDelete(targetUserId);
      }
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    // Recovery + permissions list — /api/admin/users/<id>/<action>
    if (path.length === 2) {
      const targetUserId = path[0];
      const action = path[1];

      // GET /api/admin/users/<id>/permissions — list grants (admin only)
      if (action === "permissions" && request.method === "GET") {
        await requireAdminAccess(authHeader);
        return await handlePermissionsList(targetUserId);
      }

      if (request.method !== "POST") {
        return Response.json(
          { error: `Method ${request.method} not allowed.` },
          { status: 405 },
        );
      }
      // Admin-only — both recovery flows let one user act on another's
      // Firebase Auth record, which is unconditionally an admin-level
      // operation regardless of the destructiveness toggle.
      await requireAdminAccess(authHeader);
      switch (action) {
        case "temporary-password":
          return await handleTemporaryPassword(targetUserId);
        case "sign-in-token":
          return await handleSignInToken(targetUserId);
        default:
          return Response.json(
            { error: `Unknown admin user action: ${action || "(empty)"}` },
            { status: 404 },
          );
      }
    }

    // Permission grant write — /api/admin/users/<id>/permissions/<key>
    //   PUT    → upsert grant (admin only)
    //   DELETE → revoke grant (admin only)
    if (path.length === 3 && path[1] === "permissions") {
      const targetUserId = path[0];
      const permissionKey = path[2];
      const { decoded } = await requireAdminAccess(authHeader);

      if (request.method === "PUT") {
        return await handlePermissionUpsert(
          request,
          targetUserId,
          permissionKey,
          decoded.uid,
        );
      }
      if (request.method === "DELETE") {
        return await handlePermissionDelete(targetUserId, permissionKey);
      }
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    return Response.json(
      { error: `Unknown /api/admin/users route: /${path.join("/")}` },
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
    console.error(`/api/admin/users (${request.method} ${request.url}) failed:`, error);
    return Response.json(
      { error: message || "/api/admin/users request failed." },
      { status: 500 },
    );
  }
};
