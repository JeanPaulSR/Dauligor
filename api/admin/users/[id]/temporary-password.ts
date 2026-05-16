// Admin: generate a temporary password for another user.
//
// Mirrors the dev-server handler in server.ts so production has the same
// surface. Flow:
//   1. Verify the caller is an admin (Bearer token + role check).
//   2. Confirm the target user actually exists in D1 (guards against typos).
//   3. Generate a random password and push it to Firebase Auth.
//   4. Return the password to the admin for one-time copy/share.
//
// The temp-password lifecycle is owned entirely by Firebase Auth — D1 no
// longer tracks "mustChangePassword" flags after the Firestore→D1 migration.

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
 * Generates a 14-character password that always contains at least one of each:
 * uppercase, lowercase, number, symbol. Avoids visually ambiguous characters
 * (no `O`/`0`, `l`/`1`, etc.) so the value can be safely read off a screen.
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

/**
 * Vercel's filesystem router exposes the dynamic `[id]` segment on `req.query`
 * (Next-style). On the bare Node `IncomingMessage` we get from the runtime,
 * the query object is attached for us; fall back to parsing the URL if the
 * runtime ever stops providing it.
 */
function getTargetUserId(req: NodeLikeRequest): string {
  const raw = req.query?.id;
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];

  // URL fallback: /api/admin/users/<id>/temporary-password
  const url = req.url || "";
  const match = url.match(/\/api\/admin\/users\/([^\/]+)\/temporary-password/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return "";
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    const authHeader = req.headers.authorization;
    await requireAdminAccess(authHeader);

    const targetUserId = getTargetUserId(req);
    if (!targetUserId) {
      return res.status(400).json({ error: "Missing target user id in path." });
    }

    // Verify the target exists in our D1 directory before resetting their
    // Firebase Auth password. This guards against typos / stale UIDs that
    // would otherwise quietly succeed on the Firebase side but leave the
    // app with a Firebase account that has no profile row.
    const targetCheck = await executeD1QueryInternal({
      sql: "SELECT id FROM users WHERE id = ? LIMIT 1",
      params: [targetUserId],
    });
    if (!targetCheck.results?.length) {
      return res.status(404).json({ error: "Target user profile not found." });
    }

    const temporaryPassword = createTemporaryPassword();
    const { auth } = getAdminServices();
    await auth.updateUser(targetUserId, { password: temporaryPassword });

    return res.status(200).json({
      temporaryPassword,
      generatedAt: new Date().toISOString(),
    });
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
    console.error("temporary-password endpoint failed:", error);
    return res.status(500).json({ error: message || "Failed to generate temporary password." });
  }
}
