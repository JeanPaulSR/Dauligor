// /api/auth/* — native (non-Firebase) authentication endpoints.
//
// Part of retiring Firebase Auth (see
// docs/_drafts/auth-cloudflare-migration-plan-2026-05-31.html). These routes
// are additive and "dark" until the client is flipped (Phase 4): nothing in the
// SPA calls them yet, so adding this file changes no existing behaviour.
//
// Routes:
//
//   POST /api/auth/login
//     { username, password } → verifies the scrypt hash on the users row and
//     returns { token, profile }. The token is a 30-day native session JWT
//     (see sessionToken.ts). 401 on any mismatch — the same response whether
//     the username is unknown or the password is wrong (no user enumeration).
//
//   POST /api/auth/adopt
//     The hash-on-next-login cutover (Phase 3). Caller is already authenticated
//     (a Firebase token during the migration window); body { password } is the
//     plaintext they just logged in with. We write its scrypt hash to their
//     users row so the NEXT login can go native. Idempotent — safe to re-send.
//     Bound to the token's uid; the body cannot target another account.

import {
  HttpError,
  requireAuthenticatedUser,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";
import { hashPassword, verifyPassword } from "../../../api/_lib/password.js";
import {
  isNativeAuthConfigured,
  issueSessionToken,
} from "../../../api/_lib/sessionToken.js";

type UserRow = {
  id: string;
  username: string;
  role: string | null;
  display_name: string | null;
  password_hash: string | null;
};

async function loadUserByUsername(username: string): Promise<UserRow | null> {
  // Case-insensitive match: handles are stored as authored but logins (and the
  // old Firebase `<handle>@archive.internal` mapping) are case-folded.
  const result = await executeD1QueryInternal({
    sql: "SELECT id, username, role, display_name, password_hash FROM users WHERE LOWER(username) = ? LIMIT 1",
    params: [username.toLowerCase().trim()],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return (rows[0] as UserRow) || null;
}

async function handleLogin(request: Request): Promise<Response> {
  if (!isNativeAuthConfigured()) {
    return Response.json(
      { error: "Native auth is not configured." },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const username = typeof (body as any).username === "string" ? (body as any).username : "";
  const password = typeof (body as any).password === "string" ? (body as any).password : "";
  if (!username.trim() || !password) {
    return Response.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  const row = await loadUserByUsername(username);
  const ok = !!row && (await verifyPassword(password, row.password_hash));
  if (!ok || !row) {
    return Response.json(
      { error: "Invalid username or password." },
      { status: 401 },
    );
  }

  const token = await issueSessionToken({
    id: row.id,
    username: row.username,
    role: row.role,
  });
  return Response.json(
    {
      token,
      profile: {
        id: row.id,
        username: row.username,
        role: row.role,
        display_name: row.display_name,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function handleAdopt(request: Request): Promise<Response> {
  if (!isNativeAuthConfigured()) {
    return Response.json(
      { error: "Native auth is not configured." },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? undefined;
  // Accepts a Firebase token (the common case mid-migration) or a native one.
  const { decoded } = await requireAuthenticatedUser(authHeader);
  const uid: string = (decoded as any).uid;
  if (!uid) throw new HttpError(401, "Missing uid in token.");

  const body = await request.json().catch(() => ({}));
  const password = typeof (body as any).password === "string" ? (body as any).password : "";
  if (!password) {
    return Response.json({ error: "Password is required." }, { status: 400 });
  }

  const hash = await hashPassword(password);
  await executeD1QueryInternal({
    sql: "UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?",
    params: [hash, new Date().toISOString(), uid],
  });
  return Response.json({ adopted: true });
}

async function handleChangePassword(request: Request): Promise<Response> {
  if (!isNativeAuthConfigured()) {
    return Response.json(
      { error: "Native auth is not configured." },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? undefined;
  const { decoded } = await requireAuthenticatedUser(authHeader);
  const uid: string = (decoded as any).uid;
  if (!uid) throw new HttpError(401, "Missing uid in token.");

  const body = await request.json().catch(() => ({}));
  const newPassword = typeof (body as any).newPassword === "string" ? (body as any).newPassword : "";
  if (newPassword.length < 6) {
    return Response.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  const hash = await hashPassword(newPassword);
  await executeD1QueryInternal({
    sql: "UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?",
    params: [hash, new Date().toISOString(), uid],
  });
  return Response.json({ changed: true });
}

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    if (path.length === 1 && path[0] === "login") {
      if (request.method === "POST") return await handleLogin(request);
      return Response.json({ error: `Method ${request.method} not allowed.` }, { status: 405 });
    }

    if (path.length === 1 && path[0] === "adopt") {
      if (request.method === "POST") return await handleAdopt(request);
      return Response.json({ error: `Method ${request.method} not allowed.` }, { status: 405 });
    }

    if (path.length === 1 && path[0] === "change-password") {
      if (request.method === "POST") return await handleChangePassword(request);
      return Response.json({ error: `Method ${request.method} not allowed.` }, { status: 405 });
    }

    return Response.json(
      { error: `Unknown /api/auth route: /${path.join("/")}` },
      { status: 404 },
    );
  } catch (error: any) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`/api/auth (${request.method} ${request.url}) failed:`, error);
    return Response.json(
      { error: message || "/api/auth request failed." },
      { status: 500 },
    );
  }
};
