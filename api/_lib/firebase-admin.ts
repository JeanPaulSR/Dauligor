// Firebase JWT verification + admin operations without the firebase-admin SDK.
//
// This module is the only place the codebase talks to Firebase Auth. It
// exports the same surface the firebase-admin SDK gave us — `getAdminServices()`
// returns `{ auth }` with `verifyIdToken` / `createUser` / `updateUser` /
// `deleteUser` / `createCustomToken` — so every consumer keeps working without
// changes.
//
// Two backends:
//   1. JWT verification uses `jose`'s remote JWKS verifier against Firebase's
//      public-key endpoint. No service-account credentials required.
//   2. Admin operations call Identity Toolkit REST directly, authenticated
//      with a short-lived OAuth2 access token derived from the service
//      account JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`.
//
// Runtime-portable: works in Node (Vercel, local dev) and in the Workers
// runtime (Cloudflare Pages Functions). No Node-only deps. This is the
// firebase-admin exit step from project_firebase_auth_exit_plan.md.

import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "jose";
import { executeD1QueryInternal, loadUserRoleFromD1 } from "./d1-internal.js";
import { isNativeAuthConfigured, verifySessionToken } from "./sessionToken.js";

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

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || "gen-lang-client-0493579997";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const IDENTITY_TOOLKIT_BASE = `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}`;
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const IDENTITY_TOOLKIT_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
const CUSTOM_TOKEN_AUDIENCE =
  "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// JWKS fetcher — jose handles fetching, caching, and rotating Firebase's
// public keys. Module-level so all requests share one cache.
const FIREBASE_JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), {
  cacheMaxAge: 6 * 60 * 60 * 1000,
});

/* -------------------------------------------------------------------------- */
/* Service account — only loaded when an admin operation actually needs it     */
/* -------------------------------------------------------------------------- */

type ServiceAccount = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
};

let _serviceAccount: ServiceAccount | null = null;
let _signingKey: CryptoKey | null = null;
let _accessToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount {
  if (_serviceAccount) return _serviceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new HttpError(
      503,
      "Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON in the environment.",
    );
  }
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new HttpError(
      503,
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.",
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new HttpError(
      503,
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.",
    );
  }
  _serviceAccount = parsed;
  return parsed;
}

async function getSigningKey(): Promise<CryptoKey> {
  if (_signingKey) return _signingKey;
  const sa = getServiceAccount();
  // PEM in env vars typically arrives with escaped newlines; convert them.
  const pem = sa.private_key.replace(/\\n/g, "\n");
  _signingKey = (await importPKCS8(pem, "RS256")) as CryptoKey;
  return _signingKey;
}

/**
 * Exchange a service-account JWT for an OAuth2 access token scoped to
 * the Identity Toolkit API. Cached in memory until ~5 min before expiry.
 */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_accessToken && _accessToken.expiresAt > now + 300) {
    return _accessToken.token;
  }

  const sa = getServiceAccount();
  const key = await getSigningKey();

  const assertion = await new SignJWT({ scope: IDENTITY_TOOLKIT_SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: sa.private_key_id, typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(OAUTH_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth2 token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _accessToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
  };
  return json.access_token;
}

/**
 * Translate Identity Toolkit REST errors to the firebase-admin error
 * shape consumers depend on. `api/admin/users.ts:handleDelete` checks
 * `err.code === 'auth/user-not-found'` to suppress benign delete-misses,
 * so that contract has to be preserved exactly.
 */
async function identityToolkitError(res: Response): Promise<Error> {
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* response wasn't JSON */
  }
  const message =
    body?.error?.message || `Identity Toolkit error: ${res.status}`;
  const err: any = new Error(message);
  if (message === "USER_NOT_FOUND" || message === "EMAIL_NOT_FOUND") {
    err.code = "auth/user-not-found";
  } else if (typeof message === "string" && message.startsWith("EMAIL_EXISTS")) {
    err.code = "auth/email-already-exists";
  } else if (typeof message === "string" && message.startsWith("WEAK_PASSWORD")) {
    err.code = "auth/weak-password";
  }
  err.status = res.status;
  err.body = body;
  return err;
}

async function identityToolkitFetch<T = any>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${IDENTITY_TOOLKIT_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await identityToolkitError(res);
  }
  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* auth — drop-in replacement for getAdminAuth(app)                            */
/* -------------------------------------------------------------------------- */

type VerifiedToken = {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  iss?: string;
  aud?: string;
  auth_time?: number;
  user_id?: string;
  sub?: string;
  iat?: number;
  exp?: number;
  firebase?: any;
  [key: string]: any;
};

type CreateUserInput = {
  email?: string;
  password?: string;
  displayName?: string;
  emailVerified?: boolean;
  disabled?: boolean;
};

type UpdateUserInput = {
  email?: string;
  password?: string;
  displayName?: string;
  emailVerified?: boolean;
  disabled?: boolean;
};

const authImpl = {
  async verifyIdToken(idToken: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
    });
    // firebase-admin synthesizes `uid` from `user_id`/`sub`; mirror that
    // so consumers don't see a behaviour change.
    return {
      ...payload,
      uid: (payload as any).user_id || (payload as any).sub || "",
      email: (payload as any).email,
    } as VerifiedToken;
  },

  async createUser(input: CreateUserInput): Promise<{ uid: string }> {
    const json = await identityToolkitFetch<{ localId: string }>("/accounts", {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      emailVerified: input.emailVerified ?? false,
      disabled: input.disabled ?? false,
    });
    return { uid: json.localId };
  },

  async updateUser(uid: string, input: UpdateUserInput): Promise<void> {
    const body: Record<string, unknown> = { localId: uid };
    if (input.email !== undefined) body.email = input.email;
    if (input.password !== undefined) body.password = input.password;
    if (input.displayName !== undefined) body.displayName = input.displayName;
    if (input.emailVerified !== undefined) body.emailVerified = input.emailVerified;
    if (input.disabled !== undefined) body.disableUser = input.disabled;
    await identityToolkitFetch("/accounts:update", body);
  },

  async deleteUser(uid: string): Promise<void> {
    await identityToolkitFetch("/accounts:delete", { localId: uid });
  },

  async createCustomToken(
    uid: string,
    developerClaims?: Record<string, unknown>,
  ): Promise<string> {
    const sa = getServiceAccount();
    const key = await getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { uid };
    if (developerClaims && Object.keys(developerClaims).length > 0) {
      claims.claims = developerClaims;
    }
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: sa.private_key_id, typ: "JWT" })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience(CUSTOM_TOKEN_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
  },
};

export function getAdminServices() {
  return { auth: authImpl };
}

/**
 * Verify a bearer token that may be EITHER our native session JWT (HS256,
 * issued by /api/auth/login) OR a Firebase ID token (RS256, JWKS-verified).
 *
 * This is the dual-acceptance gate for the Firebase-exit migration window: a
 * client that has logged in natively presents our token; a client still on
 * Firebase presents theirs. Native is tried first when configured — a native
 * token is HS256 and a Firebase token is RS256, so a Firebase token simply
 * fails the native verify and falls through. Once Firebase is fully retired
 * (Phase 5) the fallback can be deleted and only the native branch remains.
 */
export async function verifyEitherToken(idToken: string): Promise<VerifiedToken> {
  if (isNativeAuthConfigured()) {
    try {
      return (await verifySessionToken(idToken)) as unknown as VerifiedToken;
    } catch {
      // Not our token (or ours but invalid/expired) — try Firebase below.
    }
  }
  return await authImpl.verifyIdToken(idToken);
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
    // Accepts our native session token OR a Firebase ID token during the
    // migration window. No signatureless fallback — both paths are
    // signature-checked (HS256 secret / Firebase JWKS), so an unverifiable
    // token always rejects.
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
 * Roles allowed to see drafts, dm_notes, and the full secret set on
 * every wiki article. Used by `/api/lore/*`. Broader than `isCharacterDM`
 * because `lore-writer` exists to author wiki content but should not
 * read player character sheets.
 */
export function isWikiStaff(role: string | null | undefined): boolean {
  return WIKI_STAFF_ROLES.has(role ?? "");
}

/**
 * Gate for any operation on a specific character row. Same contract as
 * the firebase-admin-era helper: 404 instead of 403 when access is
 * denied OR the row doesn't exist, so probes can't enumerate ids.
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
 * Translates "service account missing" failures into a friendly 503
 * response. The old firebase-admin-era checks for "Could not load the
 * default credentials" etc. are dead — jose verification needs no
 * credentials. The remaining surface is admin operations
 * (createUser / updateUser / createCustomToken) which still need the
 * service account JSON; this helper surfaces that missing config.
 */
export function getCredentialErrorMessage(error: unknown): string | null {
  if (error instanceof HttpError && error.status === 503) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("FIREBASE_SERVICE_ACCOUNT_JSON") ||
    message.includes("client_email") ||
    (message.includes("private_key") && !message.includes("private_key_id"))
  ) {
    return "Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON in the environment.";
  }
  return null;
}
