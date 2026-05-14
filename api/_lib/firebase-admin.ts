import { applicationDefault, cert, getApp, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { loadUserRoleFromD1 } from "./d1-internal.js";

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
