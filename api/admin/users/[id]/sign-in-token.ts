// Admin: mint a one-time Firebase custom token for another user.
//
// Non-destructive alternative to /temporary-password. Where the
// temp-password handler overwrites the target user's Firebase Auth
// password, this one leaves the password untouched and instead mints a
// short-lived custom token. The admin shares a redemption URL with the
// user; the SPA exchanges the token via signInWithCustomToken and the
// user is signed in for the session with their original password
// preserved.
//
// Custom tokens carry no claims here — uid only. They expire 1 hour
// after issuance per Firebase's default. Once exchanged for a Firebase
// session, the session itself is independent of the token's lifetime.
//
// Security note: anyone with the URL within the 1-hour window can sign
// in as that user. Treat the token like a password and deliver it
// out-of-band (Discord DM, in person, etc.). The same caveat applies
// to the temp-password flow today.

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
 * Vercel's filesystem router exposes the dynamic `[id]` segment on
 * `req.query`. Fall back to a URL regex if a runtime ever stops
 * providing it (kept identical to the temporary-password handler so
 * future maintainers see one pattern, not two).
 */
function getTargetUserId(req: NodeLikeRequest): string {
  const raw = req.query?.id;
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  const url = req.url || "";
  const match = url.match(/\/api\/admin\/users\/([^\/]+)\/sign-in-token/);
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

    // Same existence check as the temp-password handler: don't mint a
    // token for a UID that has no D1 profile row, otherwise we'd hand
    // the admin a working sign-in for a user who can't actually use the
    // app afterward (no profile → no role → 403 on every D1 read).
    const targetCheck = await executeD1QueryInternal({
      sql: "SELECT id FROM users WHERE id = ? LIMIT 1",
      params: [targetUserId],
    });
    if (!targetCheck.results?.length) {
      return res.status(404).json({ error: "Target user profile not found." });
    }

    // Custom tokens always carry the uid claim. We deliberately don't
    // attach a role override here — the role lives in D1 and is the
    // single source of truth. If we ever need to mint a token that
    // signs the user in WITH elevated claims (e.g. emergency support
    // session), add a `developerClaims` param here.
    const { auth } = getAdminServices();
    const token = await auth.createCustomToken(targetUserId);

    // 1 hour matches the Firebase Admin SDK default. We compute the
    // string client-side instead of trusting the token's exp claim so
    // the admin can show the user a friendly "expires at <time>" hint.
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000).toISOString();

    return res.status(200).json({
      token,
      issuedAt: issuedAt.toISOString(),
      expiresAt,
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
    console.error("sign-in-token endpoint failed:", error);
    return res.status(500).json({ error: message || "Failed to mint sign-in token." });
  }
}
