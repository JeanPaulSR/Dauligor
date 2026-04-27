import { applicationDefault, cert, getApp, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
const HARDCODED_STAFF_EMAILS = new Set([
  "luapnaej101@gmail.com",
  "admin@archive.internal",
  "gm@archive.internal",
]);
const IMAGE_MANAGER_ROLES = new Set(["admin", "co-dm", "lore-writer"]);

type FirebaseAppletConfig = {
  projectId: string;
  firestoreDatabaseId: string;
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
    firestoreDatabaseId:
      process.env.FIRESTORE_DATABASE_ID || "ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0",
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
            }
      );

  return {
    auth: getAdminAuth(app),
    db: getAdminFirestore(app, firebaseConfig.firestoreDatabaseId),
  };
}

export async function requireImageManagerAccess(authHeader?: string | string[]) {
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token.");
  }

  const idToken = headerValue.slice("Bearer ".length);
  const { auth, db } = getAdminServices();
  const decoded = await auth.verifyIdToken(idToken);
  const actingUserSnapshot = await db.collection("users").doc(decoded.uid).get();
  const actingRole = actingUserSnapshot.exists ? actingUserSnapshot.data()?.role : null;
  const isAllowed =
    HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || IMAGE_MANAGER_ROLES.has(actingRole);

  if (!isAllowed) {
    throw new HttpError(403, "Image manager access required.");
  }

  return {
    decoded,
    role: actingRole,
  };
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
