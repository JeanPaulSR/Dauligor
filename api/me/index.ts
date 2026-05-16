// /api/me — the calling user's own profile.
//
// Replaces the App.tsx / Settings.tsx / Navbar.tsx client-side
// fetchDocument('users', uid) + upsertDocument('users', uid, {...}) pair
// which together formed two of the audit's high-severity risks:
//
//   H1 — every signed-in user could fetch the full `users` row of any
//        other user via the generic /api/d1/query proxy, leaking
//        recovery_email and other PII the docs promise to keep private.
//        Closing it for the self-read path matters because the same
//        client cache that backed Profile/Navbar reads also backed
//        loadProfile, so this is the foundation.
//
//   H6 — Settings.tsx and App.tsx both ran
//        upsertDocument('users', uid, { ...profile, … }) directly. The
//        client controlled the column set, which meant a hostile or
//        coerced client could spread { ..., role: 'admin' } into the
//        write. Forcing all self-writes through a column allow-list
//        here means the role column is server-controlled — the client
//        can ask for any subset of `ALLOWED_FIELDS` and nothing else.
//
// GET   — auto-creates the row on first sign-in, auto-promotes the
//         bootstrap admin usernames, auto-sets active_campaign_id if
//         missing. All three were previously client logic in
//         App.tsx:loadProfile; the migration moves them server-side so
//         a fresh client can no longer steer the role write.
// PATCH — partial update of an allow-list of columns. Username changes
//         also push through Firebase Admin SDK so the auth email
//         (`<username>@archive.internal`) stays in sync. `role` is
//         deliberately not in the allow-list.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getAdminServices,
  getCredentialErrorMessage,
  requireAuthenticatedUser,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  body?: any;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

// Same bootstrap list firebase-admin.ts uses for the role check. Kept
// in sync deliberately — if you change one, change the other.
const HARDCODED_OWNER_EMAILS = new Set([
  "luapnaej101@gmail.com",
]);
const HARDCODED_INTERNAL_ADMIN_USERNAMES = new Set(["admin", "gm"]);

// Columns the client may set via PATCH /api/me. Anything not in this set
// is silently dropped — defense in depth, in case a future caller sends
// `role: 'admin'` or similar.
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

// Boolean-ish columns we coerce to 0/1 before the write. Mirrors the
// pattern in src/lib/d1.ts so the persisted shape matches what every
// existing reader expects.
const BOOLEAN_FIELDS = new Set(["hide_username", "is_private"]);

async function readJsonBody(req: NodeLikeRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function usernameToEmail(username: string): string {
  return `${username.toLowerCase().trim()}@archive.internal`;
}

/**
 * Returns the user's first campaign_members.campaign_id (insertion
 * order, no semantic "primary"). Used as the auto-pick for
 * `active_campaign_id` on first sign-in so the navbar campaign switcher
 * has something selected without forcing the user to click through.
 */
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

/**
 * Decide the effective bootstrap role for a fresh or returning user.
 * Three rules:
 *   - the owner email is always admin
 *   - the synthetic `admin` / `gm` usernames are always admin
 *   - everyone else gets whatever D1 says (or `user` on first creation)
 *
 * Mirrors the client logic at App.tsx:loadProfile so signing in as one
 * of those bootstrap identities reliably gives admin even if the D1
 * row got out of sync (e.g. someone hand-edited the table).
 */
function computeBootstrapRole(email: string | undefined, username: string, currentRole: string | null): string {
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
    // First sign-in: synthesize a row so subsequent reads find one.
    // Same shape the previous client-side fallback wrote, minus the
    // client's ability to dictate role.
    const username = deriveUsernameFromFirebaseUser(email, decoded.name);
    const role = computeBootstrapRole(email, username, null);
    const nowIso = new Date().toISOString();
    await executeD1QueryInternal({
      sql: `INSERT INTO users (id, username, display_name, role, theme, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      params: [
        uid,
        username,
        decoded.name || "Explorer",
        role,
        "parchment",
        nowIso,
        nowIso,
      ],
    });
    row = await loadProfileRow(uid);
  } else {
    // Returning user: enforce the bootstrap promote rules. If the
    // current role disagrees with what computeBootstrapRole says (e.g.
    // a hardcoded admin email currently has role='user'), bump it. The
    // username likewise gets pinned to the synthetic handle for the
    // internal admins.
    const currentRole: string = row.role || "user";
    const desiredRole = computeBootstrapRole(email, row.username || "", currentRole);
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

    // Auto-set active_campaign_id from the user's first membership
    // (preserves the App.tsx behavior players were relying on so the
    // navbar's campaign switcher comes up populated rather than empty).
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

async function handleGet(req: NodeLikeRequest, res: NodeLikeResponse) {
  const { decoded } = await requireAuthenticatedUser(req.headers.authorization);
  const profile = await getOwnProfile(decoded);
  return res.status(200).json({ profile });
}

async function handlePatch(req: NodeLikeRequest, res: NodeLikeResponse) {
  const { decoded } = await requireAuthenticatedUser(req.headers.authorization);
  const uid: string = decoded.uid;
  if (!uid) throw new HttpError(401, "Missing uid in token.");

  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  // Filter to allow-listed fields. Coerce booleans to 0/1 so the
  // persisted row matches the shape every existing reader expects.
  const updates: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) continue;
    if (BOOLEAN_FIELDS.has(key)) {
      updates[key] = value ? 1 : 0;
    } else {
      updates[key] = value === undefined ? null : value;
    }
  }

  if (Object.keys(updates).length === 0) {
    // Nothing to write — return the current profile unchanged. Beats
    // throwing a 400 because the no-op case happens legitimately (the
    // Settings page submits the whole form even when the user only
    // toggled a non-allow-listed field like a local-only preview).
    const profile = await getOwnProfile(decoded);
    return res.status(200).json({ profile, noop: true });
  }

  // Username changes touch Firebase Auth too (the email is derived from
  // the username via usernameToEmail). Do that BEFORE the D1 write so a
  // failure leaves the system consistent (D1 still has the old
  // username matching the old Firebase email).
  if (typeof updates.username === "string" && updates.username) {
    const newUsername = updates.username.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/i.test(newUsername)) {
      throw new HttpError(400, "Username must contain only letters, numbers, dashes and underscores.");
    }

    // Cheap duplicate guard. Race-safe enough for this scale (~dozens
    // of users) — a true race would surface as a UNIQUE constraint
    // violation on the UPDATE below and surface a 500 the user can
    // retry. Worth tightening if user-count grows.
    const existing = await executeD1QueryInternal({
      sql: "SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1",
      params: [newUsername, uid],
    });
    const existingRows = Array.isArray(existing?.results) ? existing.results : [];
    if (existingRows.length > 0) {
      throw new HttpError(409, "That username is already taken.");
    }

    // Push the Firebase Auth email update via the Admin SDK. Unlike
    // the client SDK's updateEmail, this doesn't require recent login
    // — the caller already passed token verification.
    const { auth: adminAuth } = getAdminServices();
    await adminAuth.updateUser(uid, { email: usernameToEmail(newUsername) });

    // Persist the lowercased form so reads/joins keep matching.
    updates.username = newUsername;
  }

  // Build the UPDATE dynamically from the surviving allow-listed fields.
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

  // Return the canonical post-write row — saves the client an extra
  // GET and avoids any client-side cache staleness around fields the
  // server might have normalized (e.g. lowercasing the username).
  const profile = await getOwnProfile(decoded);
  return res.status(200).json({ profile });
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "PATCH") return await handlePatch(req, res);
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
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
    console.error(`/api/me (${req.method}) failed:`, error);
    return res.status(500).json({ error: message || "/api/me request failed." });
  }
}
