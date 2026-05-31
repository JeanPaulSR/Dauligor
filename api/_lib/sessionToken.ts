// Native session tokens — the Worker-issued JWTs that replace Firebase ID
// tokens as the Archive moves auth onto its own stack.
//
// A login (POST /api/auth/login) verifies the user's scrypt hash and calls
// issueSessionToken(); every subsequent request carries the result as
// `Authorization: Bearer <token>`, and the gate helpers in firebase-admin.ts
// verify it. Signed with the symmetric `AUTH_JWT_SECRET` (HS256) — the same
// secret verifies, so no JWKS round-trip and no third-party issuer.
//
// Token model (per the migration plan, §9): a single SLIDING ~30-day token.
// There is no separate refresh token; the client re-issues by logging in again
// when the token nears expiry. Fine for a small, high-trust user base.
//
// Runtime-portable: jose + Web Crypto only, so this runs in Node (Express dev)
// and the Cloudflare Workers runtime (Pages Functions) alike. `process.env` is
// the same accessor firebase-admin.ts already relies on in both environments.

import { SignJWT, jwtVerify } from "jose";

const ISSUER = "dauligor";
const AUDIENCE = "dauligor-app";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day sliding window

export type SessionUser = {
  id: string;
  username: string;
  role?: string | null;
  email?: string | null;
};

// Shaped to match firebase-admin's VerifiedToken (uid + email) so the gate
// helpers treat a native session identically to a Firebase identity.
export type VerifiedSession = {
  uid: string;
  email?: string;
  username?: string;
  role?: string;
  [key: string]: unknown;
};

function getSecretKey(): Uint8Array {
  const raw = process.env.AUTH_JWT_SECRET;
  if (!raw) {
    const err = new Error(
      "AUTH_JWT_SECRET is not configured. Native auth login/verify is disabled.",
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  return new TextEncoder().encode(raw);
}

/** True when a signing secret is present, so callers can short-circuit to 503. */
export function isNativeAuthConfigured(): boolean {
  return !!process.env.AUTH_JWT_SECRET;
}

function syntheticEmail(username: string): string {
  return `${username.toLowerCase().trim()}@archive.internal`;
}

/** Mint a 30-day session token for a verified user. */
export async function issueSessionToken(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    username: user.username,
    // Carry an email so the hardcoded staff-email bypass in the gate helpers
    // keeps working for native logins; falls back to the synthetic handle email.
    email: user.email ?? syntheticEmail(user.username),
    role: user.role ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(getSecretKey());
}

/**
 * Verify a native session token. Throws (jose) if the signature, issuer,
 * audience, or expiry don't check out — callers treat a throw as "not our
 * token" and fall back to Firebase during the migration window.
 */
export async function verifySessionToken(token: string): Promise<VerifiedSession> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return {
    ...payload,
    uid: String(payload.sub ?? ""),
    email: typeof payload.email === "string" ? payload.email : undefined,
    username: typeof payload.username === "string" ? payload.username : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
  };
}
