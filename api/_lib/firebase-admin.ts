// Server-side auth gateway (native session tokens). Firebase has been removed
// (Phase 5): tokens are our own HS256 session JWTs, verified in sessionToken.ts.
// Role is read from D1 on every request and is the single source of truth.
//
// NOTE: the filename is a historical misnomer (no Firebase here anymore) — kept
// for now so the ~20 importers don't churn; rename to `auth.ts` is a follow-up.

import { executeD1QueryInternal, loadUserRoleFromD1 } from "./d1-internal.js";
import { verifySessionToken } from "./sessionToken.js";

const HARDCODED_STAFF_EMAILS = new Set([
  "luapnaej101@gmail.com",
  "admin@archive.internal",
  "gm@archive.internal",
]);
const IMAGE_MANAGER_ROLES = new Set(["admin", "co-dm", "lore-writer"]);
const ADMIN_ROLES = new Set(["admin"]);
const CHARACTER_DM_ROLES = new Set(["admin", "co-dm"]);
const WIKI_STAFF_ROLES = new Set(["admin", "co-dm", "lore-writer"]);
const ALL_AUTHENTICATED_ROLES = new Set([
  "admin",
  "co-dm",
  "lore-writer",
  "trusted-player",
  "user",
]);

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type VerifiedToken = {
  uid: string;
  email?: string;
  [key: string]: unknown;
};

/**
 * Verify a bearer token — a native HS256 session JWT issued by /api/auth/login.
 * Kept under this name (it used to accept Firebase tokens too) so existing
 * callers — including the dev server — don't change.
 */
export async function verifyEitherToken(idToken: string): Promise<VerifiedToken> {
  return (await verifySessionToken(idToken)) as unknown as VerifiedToken;
}

/* -------------------------------------------------------------------------- */
/* Token gate helpers                                                          */
/* -------------------------------------------------------------------------- */

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
  let decoded: VerifiedToken;
  try {
    decoded = await verifyEitherToken(idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(401, `Invalid auth token: ${reason}`);
  }

  const role = await loadUserRoleFromD1(decoded.uid);
  const isAllowed =
    HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") ||
    allowedRoles.has(role ?? "");

  if (!isAllowed) {
    throw new HttpError(403, deniedMessage);
  }
  return { decoded, role };
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

export async function requireAuthenticatedUser(authHeader?: string | string[]) {
  return checkAccessFromToken(authHeader, ALL_AUTHENTICATED_ROLES, "Authentication required.");
}

/**
 * Roles allowed to act as a DM on someone else's character. Used by
 * `/api/characters/*` and `/api/admin/characters`. Exported so the
 * "who counts as a DM" list lives in exactly one place.
 */
export function isCharacterDM(role: string | null | undefined): boolean {
  return CHARACTER_DM_ROLES.has(role ?? "");
}

/**
 * Roles allowed to see drafts, dm_notes, and the full secret set on every wiki
 * article. Used by `/api/lore/*`. Broader than `isCharacterDM` because
 * `lore-writer` exists to author wiki content but should not read character sheets.
 */
export function isWikiStaff(role: string | null | undefined): boolean {
  return WIKI_STAFF_ROLES.has(role ?? "");
}

/**
 * Gate for any operation on a specific character row. 404 instead of 403 when
 * access is denied OR the row doesn't exist, so probes can't enumerate ids.
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
    throw new HttpError(404, "Character not found.");
  }

  const characterUserId = String((rows[0] as any).user_id ?? "");
  const isOwner = characterUserId === decoded.uid;
  const isDM = isCharacterDM(role);

  if (!isOwner && !isDM) {
    throw new HttpError(404, "Character not found.");
  }

  return { decoded, role: role ?? null, isOwner, characterUserId };
}

/**
 * Back-compat stub for the ~17 route catch-blocks that still call this. There
 * are no Firebase service-account operations anymore, so there's never a
 * credential error to translate — always returns null (callers fall through to
 * normal error handling).
 */
export function getCredentialErrorMessage(_error: unknown): string | null {
  return null;
}
