import { applicationDefault, cert, getApp, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { executeD1QueryInternal, loadUserRoleFromD1 } from "./d1-internal.js";

// Firestore is decommissioned. User profile + role data lives in Cloudflare D1
// (see api/_lib/d1-internal.ts). Firebase Admin is kept here only to verify
// the JWT issued at sign-in — anything else (role checks, profile reads) goes
// through D1.

const HARDCODED_STAFF_EMAILS = new Set([
  "luapnaej101@gmail.com",
  "admin@archive.internal",
  "gm@archive.internal",
]);
const IMAGE_MANAGER_ROLES = new Set(["admin", "co-dm", "lore-writer"]);
const ADMIN_ROLES = new Set(["admin"]);
// Roles allowed to act as a DM on someone else's character (read, edit,
// delete). Deliberately excludes `lore-writer` — that role is for wiki
// content, not character management. The owner of the character is
// always allowed regardless of role; see `requireCharacterAccess`.
const CHARACTER_DM_ROLES = new Set(["admin", "co-dm"]);

// Roles allowed to see drafts, dm_notes, and the full secret set on
// every wiki article. The wiki content authority is broader than the
// character DM authority — `lore-writer` is in here precisely because
// the role exists to author drafts before they're published.
const WIKI_STAFF_ROLES = new Set(["admin", "co-dm", "lore-writer"]);

type FirebaseAppletConfig = {
  projectId: string;
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || "gen-lang-client-0493579997",
  };
}

export function getAdminServices() {
  const firebaseConfig = loadFirebaseConfig();
  const app = getApps().length
    ? getApp()
    : initializeAdminApp(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON
          ? {
              credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
              projectId: firebaseConfig.projectId,
            }
          : {
              credential: applicationDefault(),
              projectId: firebaseConfig.projectId,
            },
      );

  return { auth: getAdminAuth(app) };
}

async function checkAccessFromToken(
  authHeader: string | string[] | undefined,
  allowedRoles: Set<string>,
  deniedMessage: string,
) {
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token.");
  }

  const idToken = headerValue.slice("Bearer ".length);
  try {
    const { auth } = getAdminServices();
    const decoded = await auth.verifyIdToken(idToken);
    const role = await loadUserRoleFromD1(decoded.uid);
    const isAllowed =
      HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || allowedRoles.has(role ?? "");

    if (!isAllowed) {
      throw new HttpError(403, deniedMessage);
    }
    return { decoded, role };
  } catch (error) {
    const credErr = getCredentialErrorMessage(error);
    if (credErr) {
      console.warn("Missing Firebase Admin credentials. Falling back to signatureless token parsing.", credErr);
      try {
        const parts = idToken.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
          const uid = payload.user_id || payload.sub || payload.uid;
          if (uid || payload.email) {
            // Without verified credentials we still consult D1 for the role.
            // If that fails too, fall back to the token's claim or "admin".
            const role = uid ? await loadUserRoleFromD1(uid) : null;
            return {
              decoded: { uid: uid || "fallback_uid", email: payload.email || "fallback@example.com" },
              role: role ?? payload.role ?? "admin",
            };
          }
        }
      } catch (e) {
        console.error("Signatureless token parse fallback failed:", e);
      }
    }
    throw error;
  }
}

export async function requireStaffAccess(authHeader?: string | string[]) {
  return checkAccessFromToken(authHeader, IMAGE_MANAGER_ROLES, "Staff access required.");
}

export async function requireImageManagerAccess(authHeader?: string | string[]) {
  return requireStaffAccess(authHeader);
}

export async function requireAdminAccess(authHeader?: string | string[]) {
  return checkAccessFromToken(authHeader, ADMIN_ROLES, "Admin access required.");
}

// Set of every role we currently issue. Used by endpoints that just
// need a verified user identity (not staff/admin) — e.g. per-user
// spell favorites, where the user is only allowed to read/write
// their OWN row.
const ALL_AUTHENTICATED_ROLES = new Set([
  'admin',
  'co-dm',
  'lore-writer',
  'trusted-player',
  'user',
]);

export async function requireAuthenticatedUser(authHeader?: string | string[]) {
  return checkAccessFromToken(authHeader, ALL_AUTHENTICATED_ROLES, "Authentication required.");
}

/**
 * Roles allowed to act as a DM on someone else's character. Used by the
 * `/api/characters/*` endpoints and by `/api/admin/characters`. Exported
 * (rather than inlined) so the list of "who counts as a DM" lives in
 * exactly one place.
 */
export function isCharacterDM(role: string | null | undefined): boolean {
  return CHARACTER_DM_ROLES.has(role ?? "");
}

/**
 * Roles allowed to see drafts, `dm_notes`, and the full secret set on
 * every wiki article. Used by the `/api/lore/*` endpoints. Broader than
 * `isCharacterDM` because `lore-writer` exists to author wiki content
 * (and therefore needs draft + dm_notes visibility) but should not be
 * able to read player character sheets.
 */
export function isWikiStaff(role: string | null | undefined): boolean {
  return WIKI_STAFF_ROLES.has(role ?? "");
}

/**
 * Gate for any operation on a specific character row. Allows the call if:
 *   - the caller owns the character (`characters.user_id === decoded.uid`), OR
 *   - the caller has a DM role (`admin` or `co-dm`).
 *
 * Returns `{ decoded, role, isOwner, character }` so the handler can route on
 * any of those without re-querying. Throws `HttpError(404)` if the character
 * doesn't exist — deliberately the same shape as a "not yours" rejection so
 * we don't leak whether arbitrary ids correspond to real rows.
 *
 * The single SELECT here picks up the `user_id` column only. Handlers that
 * also need the full row should issue their own query — keeping this gate
 * narrow means it can be reused by list endpoints and one-shot mutations
 * without paying the cost of loading the entire base row.
 */
export async function requireCharacterAccess(
  authHeader: string | string[] | undefined,
  characterId: string,
): Promise<{
  decoded: any;
  role: string | null;
  isOwner: boolean;
  characterUserId: string;
}> {
  const { decoded, role } = await requireAuthenticatedUser(authHeader);

  const result = await executeD1QueryInternal({
    sql: "SELECT user_id FROM characters WHERE id = ? LIMIT 1",
    params: [characterId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    // 404 instead of 403 so a probe can't enumerate which ids exist.
    throw new HttpError(404, "Character not found.");
  }

  const characterUserId = String((rows[0] as any).user_id ?? "");
  const isOwner = characterUserId === decoded.uid;
  const isDM = isCharacterDM(role);

  if (!isOwner && !isDM) {
    // Same 404 — non-owners who aren't DMs shouldn't even learn the row exists.
    throw new HttpError(404, "Character not found.");
  }

  return { decoded, role: role ?? null, isOwner, characterUserId };
}

export function getCredentialErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const missingCredentials =
    message.includes("Could not load the default credentials") ||
    message.includes("Failed to parse private key") ||
    message.includes("Service account object must contain");

  return missingCredentials
    ? "Firebase Admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON on Vercel or GOOGLE_APPLICATION_CREDENTIALS locally."
    : null;
}
