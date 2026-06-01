// /api/me/* — catch-all dispatcher for the calling user's own data.
//
// Every route here derives the user identity from the verified Firebase
// token — `uid` is never read from the query string or the body. That
// keeps the self-data endpoints honest even when the relaxed
// `requireAuthenticatedUser` gate admits roles that aren't trusted to
// see anyone else's rows.
//
// Routes:
//
//   GET   /api/me
//     The caller's profile row. Auto-creates on first sign-in,
//     auto-promotes the bootstrap admin usernames, auto-sets
//     active_campaign_id from the first campaign_members row when
//     missing. All three were previously client logic in
//     App.tsx:loadProfile; the migration moves them server-side so
//     a fresh client can no longer steer the role write. Closes H1.
//
//   PATCH /api/me
//     Partial update of an allow-list of columns. Username changes
//     also push through Firebase Identity Toolkit REST so the auth
//     email (`<username>@archive.internal`) stays in sync. `role` is
//     deliberately not in the allow-list — that's how H6 stays
//     closed.
//
//   GET /api/me/characters
//     The caller's own characters (used by Sidebar's recent strip and
//     by the /characters list page for non-staff). Supports
//     ?fields=id,name,level (allow-listed) and ?limit=N (capped).
//
//   GET /api/me/campaign-memberships
//     The caller's campaign memberships, enriched with each campaign's
//     basic identity (name, era_id, image_url) so the Navbar can
//     render the switcher in one round trip instead of cross-joining
//     campaign_members + campaigns on the client. Closes the Navbar
//     half of H7 — we no longer fetch every other user's membership
//     row to figure out our own.
//
//   GET /api/me/foundation-update
//     Returns the `last_foundation_update` timestamp from
//     system_metadata. App.tsx polls this every 30s for cross-tab
//     cache invalidation (when an admin mutates a persistent table
//     in another tab, this timestamp changes and other tabs bust
//     their caches). Closes audit L4 — the previous client path did
//     a raw SELECT against system_metadata via /api/d1/query from
//     every signed-in tab every 30s.

import {
  HttpError,
  getCredentialErrorMessage,
  requireAuthenticatedUser,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";
import { getUserPermissions } from "../../../api/_lib/permissions.js";

const HARDCODED_OWNER_EMAILS = new Set(["luapnaej101@gmail.com"]);
const HARDCODED_INTERNAL_ADMIN_USERNAMES = new Set(["admin", "gm"]);

const ALLOWED_PATCH_FIELDS = new Set([
  "username",
  "display_name",
  "pronouns",
  "bio",
  "avatar_url",
  "theme",
  "accent_color",
  "hide_username",
  "is_private",
  "recovery_email",
  "active_campaign_id",
]);

const BOOLEAN_PATCH_FIELDS = new Set(["hide_username", "is_private"]);

async function pickInitialActiveCampaign(uid: string): Promise<string | null> {
  const result = await executeD1QueryInternal({
    sql: "SELECT campaign_id FROM campaign_members WHERE user_id = ? LIMIT 1",
    params: [uid],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) return null;
  const id = (rows[0] as any)?.campaign_id;
  return typeof id === "string" && id ? id : null;
}

function computeBootstrapRole(email: string | undefined, currentRole: string | null): string {
  const lowerEmail = (email || "").toLowerCase();
  const internalUsername = lowerEmail.endsWith("@archive.internal") ? lowerEmail.split("@")[0] : "";
  if (HARDCODED_OWNER_EMAILS.has(lowerEmail)) return "admin";
  if (HARDCODED_INTERNAL_ADMIN_USERNAMES.has(internalUsername)) return "admin";
  return currentRole || "user";
}

function deriveUsernameFromFirebaseUser(email: string | undefined, displayName: string | undefined): string {
  const lowerEmail = (email || "").toLowerCase();
  if (lowerEmail.endsWith("@archive.internal")) return lowerEmail.split("@")[0];
  if (displayName) return displayName.toLowerCase().replace(/\s+/g, "");
  return "explorer";
}

async function loadProfileRow(uid: string): Promise<any | null> {
  const result = await executeD1QueryInternal({
    sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
    params: [uid],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows[0] || null;
}

/**
 * Body of GET /api/me. Pulled out so PATCH can call it after writes
 * (returning the canonical post-write shape, not the in-memory diff).
 */
async function getOwnProfile(decoded: any): Promise<any> {
  const uid: string = decoded.uid;
  const email: string | undefined = decoded.email;
  if (!uid) throw new HttpError(401, "Missing uid in token.");

  let row = await loadProfileRow(uid);

  if (!row) {
    const username = deriveUsernameFromFirebaseUser(email, decoded.name);
    const role = computeBootstrapRole(email, null);
    const nowIso = new Date().toISOString();
    await executeD1QueryInternal({
      sql: `INSERT INTO users (id, username, display_name, role, theme, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      params: [uid, username, decoded.name || "Explorer", role, "parchment", nowIso, nowIso],
    });
    row = await loadProfileRow(uid);
  } else {
    const currentRole: string = row.role || "user";
    const desiredRole = computeBootstrapRole(email, currentRole);
    const lowerEmail = (email || "").toLowerCase();
    const internalUsername = lowerEmail.endsWith("@archive.internal") ? lowerEmail.split("@")[0] : "";
    const usernameNeedsFix = HARDCODED_INTERNAL_ADMIN_USERNAMES.has(internalUsername)
      && row.username !== internalUsername;

    if (desiredRole !== currentRole || usernameNeedsFix) {
      await executeD1QueryInternal({
        sql: `UPDATE users SET role = ?, username = COALESCE(?, username), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [desiredRole, usernameNeedsFix ? internalUsername : null, uid],
      });
      row = await loadProfileRow(uid);
    }

    if (row && !row.active_campaign_id) {
      const initial = await pickInitialActiveCampaign(uid);
      if (initial) {
        await executeD1QueryInternal({
          sql: `UPDATE users SET active_campaign_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          params: [initial, uid],
        });
        row = await loadProfileRow(uid);
      }
    }
  }

  return row;
}

/**
 * Folds additive `user_permissions` rows into the profile object so the
 * client gets the full identity shape in one request. `permissions` is
 * a `{ [key]: scope | null }` map; an absent key means the user does
 * not hold that permission. `effectiveProfile.permissions[key]` is the
 * client-side gate surface introduced with the content-creator role.
 */
async function attachPermissions(row: any): Promise<any> {
  if (!row || !row.id) return row;
  const permissions = await getUserPermissions(String(row.id));
  return { ...row, permissions };
}

async function handleGetMe(decoded: any): Promise<Response> {
  const profile = await getOwnProfile(decoded);
  return Response.json({ profile: await attachPermissions(profile) });
}

async function handlePatchMe(request: Request, decoded: any): Promise<Response> {
  const uid: string = decoded.uid;
  if (!uid) throw new HttpError(401, "Missing uid in token.");

  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const updates: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) continue;
    if (BOOLEAN_PATCH_FIELDS.has(key)) {
      updates[key] = value ? 1 : 0;
    } else {
      updates[key] = value === undefined ? null : value;
    }
  }

  if (Object.keys(updates).length === 0) {
    const profile = await getOwnProfile(decoded);
    return Response.json({ profile: await attachPermissions(profile), noop: true });
  }

  if (typeof updates.username === "string" && updates.username) {
    const newUsername = updates.username.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/i.test(newUsername)) {
      throw new HttpError(400, "Username must contain only letters, numbers, dashes and underscores.");
    }
    const existing = await executeD1QueryInternal({
      sql: "SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1",
      params: [newUsername, uid],
    });
    const existingRows = Array.isArray(existing?.results) ? existing.results : [];
    if (existingRows.length > 0) {
      throw new HttpError(409, "That username is already taken.");
    }
    // Username is the native login key (no email to sync). The Firebase
    // Identity-Toolkit email update was dropped with the Firebase exit.
    updates.username = newUsername;
  }

  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = ?`);
    params.push(value);
  }
  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(uid);

  await executeD1QueryInternal({
    sql: `UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`,
    params,
  });

  const profile = await getOwnProfile(decoded);
  return Response.json({ profile: await attachPermissions(profile) });
}

/* -------------------------------------------------------------------------- */
/* /api/me/characters                                                          */
/* -------------------------------------------------------------------------- */

const ALLOWED_CHARACTER_FIELDS = new Set([
  "id",
  "name",
  "level",
  "image_url",
  "campaign_id",
  "race_id",
  "background_id",
  "current_hp",
  "temp_hp",
  "max_hp_override",
  "exhaustion",
  "has_inspiration",
  "updated_at",
  "created_at",
]);

function parseCharacterFields(searchParams: URLSearchParams): string[] | null {
  const str = searchParams.get("fields") ?? "";
  if (!str) return null;
  const requested = str.split(",").map((s) => s.trim()).filter(Boolean);
  const safe = requested.filter((f) => ALLOWED_CHARACTER_FIELDS.has(f));
  return safe.length > 0 ? safe : null;
}

function parseLimit(searchParams: URLSearchParams): number | null {
  const str = searchParams.get("limit") ?? "";
  if (!str) return null;
  const n = Number(str);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 500);
}

async function handleGetMyCharacters(searchParams: URLSearchParams, decoded: any): Promise<Response> {
  const userId = decoded.uid;
  if (!userId) throw new HttpError(401, "Missing user id in token.");

  const fields = parseCharacterFields(searchParams);
  const limit = parseLimit(searchParams);
  const cols = fields ? fields.join(", ") : "*";
  let sql = `SELECT ${cols} FROM characters WHERE user_id = ? ORDER BY updated_at DESC`;
  const params: any[] = [userId];
  if (limit !== null) {
    sql += " LIMIT ?";
    params.push(limit);
  }
  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return Response.json({ characters: rows });
}

/* -------------------------------------------------------------------------- */
/* /api/me/campaign-memberships                                                */
/* -------------------------------------------------------------------------- */

/**
 * Enriched membership shape: each row carries the campaign basics
 * (name, era_id, image_url, dm_id) so the Navbar's switcher can render
 * in a single round trip. Returning the full campaign row would
 * include the `settings` JSON blob, which is bigger than the switcher
 * needs and may eventually hold DM-only flags — we restrict to a
 * known-safe column set instead.
 */
async function handleGetMyMemberships(decoded: any): Promise<Response> {
  const userId = decoded.uid;
  if (!userId) throw new HttpError(401, "Missing user id in token.");

  const result = await executeD1QueryInternal({
    sql: `SELECT cm.campaign_id, cm.role, cm.joined_at,
                 c.id AS c_id, c.name AS c_name, c.slug AS c_slug,
                 c.description AS c_description,
                 c.era_id AS c_era_id, c.image_url AS c_image_url, c.dm_id AS c_dm_id
            FROM campaign_members cm
            LEFT JOIN campaigns c ON c.id = cm.campaign_id
           WHERE cm.user_id = ?
           ORDER BY cm.joined_at ASC`,
    params: [userId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];

  const memberships = rows.map((r: any) => ({
    campaign_id: r.campaign_id,
    role: r.role,
    joined_at: r.joined_at,
    campaign: r.c_id
      ? {
          id: r.c_id,
          name: r.c_name,
          slug: r.c_slug,
          description: r.c_description,
          era_id: r.c_era_id,
          image_url: r.c_image_url,
          dm_id: r.c_dm_id,
        }
      : null,
  }));

  return Response.json({ memberships });
}

/* -------------------------------------------------------------------------- */
/* /api/me/foundation-update                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns the current `last_foundation_update` timestamp from
 * `system_metadata`. App.tsx polls this every 30s; when the value
 * changes the client busts its persistent caches (the heartbeat for
 * cross-tab cache invalidation when an admin mutates a persistent
 * table in another tab).
 *
 * Folded into /api/me rather than a dedicated /api/system-metadata
 * endpoint because (a) every signed-in user polls it on every page
 * load + every 30s thereafter, and (b) the /api/me handler is the
 * smallest natural home — it's where "things every signed-in user
 * needs about their session" already live. Closes audit L4 without
 * burning a function slot.
 */
async function handleGetFoundationUpdate(): Promise<Response> {
  const result = await executeD1QueryInternal({
    sql: "SELECT value FROM system_metadata WHERE key = 'last_foundation_update' LIMIT 1",
    params: [],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  const timestamp: string | null = rows[0] ? ((rows[0] as any).value ?? null) : null;
  return Response.json(
    { timestamp },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded } = await requireAuthenticatedUser(authHeader);

    // Pages provides params.path as a string[] for [[path]].ts catch-alls.
    // Single-segment files would get string params; this is always an array
    // (possibly empty when the URL matches the bare /api/me).
    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    if (path.length === 0) {
      if (request.method === "GET") return await handleGetMe(decoded);
      if (request.method === "PATCH") return await handlePatchMe(request, decoded);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 1 && path[0] === "characters") {
      if (request.method === "GET") return await handleGetMyCharacters(searchParams, decoded);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 1 && path[0] === "campaign-memberships") {
      if (request.method === "GET") return await handleGetMyMemberships(decoded);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    if (path.length === 1 && path[0] === "foundation-update") {
      if (request.method === "GET") return await handleGetFoundationUpdate();
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    return Response.json(
      { error: `Unknown /api/me route: /${path.join("/")}` },
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
    console.error(`/api/me (${request.method} ${request.url}) failed:`, error);
    return Response.json(
      { error: message || "/api/me request failed." },
      { status: 500 },
    );
  }
};
