// Additive capability layer on top of `users.role`.
//
// The existing RBAC model (`firebase-admin.ts`) is a single-role
// ladder — admin > co-dm > lore-writer > trusted-player > user.
// Some capabilities don't fit that ladder cleanly: they're *additive*
// and orthogonal to the base role. `content-creator` is the first
// such capability — a user can hold it on top of any base role
// (typically `user` or `trusted-player`) without being promoted on
// the ladder.
//
// `user_permissions` rows hold those grants. Each row pairs a
// permission key with an optional scope JSON narrowing which worlds
// / campaigns / eras the capability applies to. NULL scope means
// unrestricted on every axis.
//
// The CHECK constraint on `user_permissions.permission_key` (set in
// the worlds_and_user_permissions migration) is the source of truth
// for valid keys; that allowlist is mirrored here as a TypeScript
// type so the API surface stays narrow. Adding a key requires a
// follow-up migration that rebuilds the table (SQLite can't ALTER a
// CHECK in place).

import { executeD1QueryInternal } from "./d1-internal.js";
import { HttpError, requireAuthenticatedUser } from "./firebase-admin.js";

export type PermissionKey = "content-creator";

export const ALL_PERMISSION_KEYS: ReadonlyArray<PermissionKey> = [
  "content-creator",
];

export type Scope = {
  worlds?: string[];
  campaigns?: string[];
  eras?: string[];
};

export type PermissionsMap = Partial<Record<PermissionKey, Scope | null>>;

export function isValidPermissionKey(key: unknown): key is PermissionKey {
  return (
    typeof key === "string" &&
    (ALL_PERMISSION_KEYS as ReadonlyArray<string>).includes(key)
  );
}

export function parseScope(raw: string | null | undefined): Scope | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out: Scope = {};
    for (const axis of ["worlds", "campaigns", "eras"] as const) {
      const v = (parsed as any)[axis];
      if (Array.isArray(v)) {
        out[axis] = v.filter(
          (x: unknown): x is string => typeof x === "string",
        );
      }
    }
    return out;
  } catch {
    return null;
  }
}

export function serializeScope(scope: Scope | null | undefined): string | null {
  if (!scope) return null;
  const out: Scope = {};
  for (const axis of ["worlds", "campaigns", "eras"] as const) {
    const v = scope[axis];
    if (Array.isArray(v)) out[axis] = [...v];
  }
  if (Object.keys(out).length === 0) return null;
  return JSON.stringify(out);
}

/**
 * Returns every active permission for a user, with parsed scope.
 * Permissions not listed in the returned map mean the user does not
 * hold them.
 */
export async function getUserPermissions(
  userId: string,
): Promise<PermissionsMap> {
  const result = await executeD1QueryInternal({
    sql: "SELECT permission_key, scope_json FROM user_permissions WHERE user_id = ?",
    params: [userId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  const out: PermissionsMap = {};
  for (const row of rows) {
    const key = String((row as any).permission_key ?? "");
    if (!isValidPermissionKey(key)) continue;
    out[key] = parseScope((row as any).scope_json);
  }
  return out;
}

/**
 * Scope intersection check: does the user's scope cover the required
 * scope?
 *
 *   - Required null/undefined  → always satisfied (no narrowing asked).
 *   - User's scope null         → satisfied (user is unrestricted).
 *   - Otherwise, for each axis specified in `requiredScope` the
 *     user's scope must either omit the axis (= unrestricted on it)
 *     or contain every required value as a subset.
 */
export function scopeContains(
  userScope: Scope | null,
  requiredScope: Scope | null | undefined,
): boolean {
  if (!requiredScope) return true;
  if (!userScope) return true;
  for (const axis of ["worlds", "campaigns", "eras"] as const) {
    const required = requiredScope[axis];
    if (!Array.isArray(required) || required.length === 0) continue;
    const owned = userScope[axis];
    if (owned === undefined) continue; // unrestricted on this axis
    if (!Array.isArray(owned)) continue;
    for (const value of required) {
      if (!owned.includes(value)) return false;
    }
  }
  return true;
}

/**
 * Does the user hold this permission (and, if a scope is required,
 * is that scope within theirs)?
 */
export async function hasPermission(
  userId: string,
  key: PermissionKey,
  requiredScope?: Scope | null,
): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  if (!(key in perms)) return false;
  return scopeContains(perms[key] ?? null, requiredScope);
}

/**
 * Gate for content-creator capability. Admits:
 *   - Anyone with role `admin` (admins always pass — they have
 *     direct write access and can act as a content-creator for
 *     testing / on-behalf submission).
 *   - Anyone with a `content-creator` row in `user_permissions`,
 *     provided their scope covers `requiredScope` (if any).
 *
 * Throws `HttpError(401|403)` otherwise. Returns the verified token
 * plus the user's effective content-creator scope (NULL if admin or
 * if their grant is unrestricted).
 */
export async function requireContentCreatorAccess(
  authHeader: string | string[] | undefined,
  requiredScope?: Scope | null,
): Promise<{ decoded: any; role: string | null; scope: Scope | null }> {
  const { decoded, role } = await requireAuthenticatedUser(authHeader);

  if (role === "admin") {
    return { decoded, role, scope: null };
  }

  const perms = await getUserPermissions(decoded.uid);
  if (!("content-creator" in perms)) {
    throw new HttpError(403, "Content creator access required.");
  }

  const ownedScope = perms["content-creator"] ?? null;
  if (requiredScope && !scopeContains(ownedScope, requiredScope)) {
    throw new HttpError(403, "Outside your content-creator scope.");
  }
  return { decoded, role, scope: ownedScope };
}
