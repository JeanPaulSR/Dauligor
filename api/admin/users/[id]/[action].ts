// /api/admin/users/[id]/[action] — admin password recovery dispatcher.
//
// Consolidates what were previously two separate Vercel serverless
// functions:
//   - temporary-password.ts (destructive — overwrites the user's
//     Firebase Auth password with a random 14-char value, returns the
//     plaintext for one-time admin copy/share)
//   - sign-in-token.ts (non-destructive — mints a 1-hour Firebase
//     custom token; the admin shares a /auth/redeem?token=... URL and
//     the SPA exchanges it via signInWithCustomToken, original
//     password preserved)
//
// Both endpoints had nearly identical shape: same admin gate, same D1
// existence check, same error handling — they only differed in the
// "what to do with Firebase" step. Folding them into one dispatcher
// saves one function slot against the Hobby plan's 12-function cap and
// makes the two recovery flows literally co-located so future drift
// (the temp-password handler getting a feature the sign-in-token one
// missed, or vice versa) is harder.
//
// Routes (both POST):
//   /api/admin/users/<uid>/temporary-password  → action="temporary-password"
//   /api/admin/users/<uid>/sign-in-token       → action="sign-in-token"
//
// URLs deliberately kept identical to the pre-consolidation paths so
// the AdminUsers.tsx fetch() calls and any external runbooks /
// bookmarks keep working unchanged.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getAdminServices,
  getCredentialErrorMessage,
  requireAdminAccess,
} from "../../../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../_lib/d1-internal.js";

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

  // Fisher-Yates shuffle so the required chars aren't always at the
  // front of the output.
  for (let i = required.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [required[i], required[swapIndex]] = [required[swapIndex], required[i]];
  }

  return required.join("");
}

/**
 * Extract a dynamic path segment. Vercel's filesystem router attaches
 * each `[name]` segment to `req.query`, but we keep a URL-regex
 * fallback in case the runtime ever stops doing that — same defensive
 * pattern as the character + profile endpoints.
 */
function getQuerySegment(req: NodeLikeRequest, key: string, urlPattern: RegExp): string {
  const raw = req.query?.[key];
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  const url = req.url || "";
  const match = url.match(urlPattern);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return "";
}

async function handleTemporaryPassword(targetUserId: string, res: NodeLikeResponse) {
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

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    // Common auth gate — admin only. Both flows let one user act on
    // another's Firebase Auth record, which is unconditionally an
    // admin-level operation regardless of the destructiveness toggle.
    await requireAdminAccess(req.headers.authorization);

    const targetUserId = getQuerySegment(
      req,
      "id",
      /\/api\/admin\/users\/([^\/]+)\/(temporary-password|sign-in-token)/,
    );
    if (!targetUserId) {
      throw new HttpError(400, "Missing target user id in path.");
    }

    // Don't change Firebase state for a UID that has no D1 profile.
    // For temporary-password this guards against typos / stale UIDs
    // that would otherwise quietly succeed on Firebase but leave the
    // app with a Firebase account that can't load a profile. For
    // sign-in-token the same applies — handing the admin a working
    // sign-in link for a uid the SPA can't render is a foot-gun.
    const targetCheck = await executeD1QueryInternal({
      sql: "SELECT id FROM users WHERE id = ? LIMIT 1",
      params: [targetUserId],
    });
    if (!targetCheck.results?.length) {
      throw new HttpError(404, "Target user profile not found.");
    }

    const action = getQuerySegment(
      req,
      "action",
      /\/api\/admin\/users\/[^\/]+\/([^\/\?]+)/,
    );

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
    console.error(`/api/admin/users/[id]/[action] failed:`, error);
    return res.status(500).json({ error: message || "Admin user action failed." });
  }
}
