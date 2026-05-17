import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  updateProfile,
  updatePassword,
  updateEmail,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Firebase Authentication is the only Firebase product Dauligor still uses.
// All data access has migrated to Cloudflare D1 (see src/lib/d1.ts) and R2.
// Do not reintroduce `firebase/firestore` imports — that database is gone.
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Username → email helper used by the auth pages (we sign users in by username
// against a synthetic *@archive.internal address so the same email isn't tied
// to a real inbox).
export const usernameToEmail = (username: string) => {
  return `${username.toLowerCase().trim()}@archive.internal`;
};

export {
  initializeApp,
  firebaseConfig,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  updateProfile,
  updatePassword,
  updateEmail,
  signOut,
  onAuthStateChanged,
  type User,
};

// Operation label for client-side error reports. Historical name (was used
// alongside the now-removed `handleFirestoreError`); kept as a small enum so
// log entries carry a machine-readable verb.
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface ClientErrorReport {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

/**
 * Logs a structured client-side error (with auth context) and rethrows.
 * Replaces the old `handleFirestoreError` after the Firestore migration.
 * The legacy alias is re-exported below for any straggling call sites until
 * they're renamed.
 */
export function reportClientError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const report: ClientErrorReport = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Client Error:', JSON.stringify(report));
  throw new Error(JSON.stringify(report));
}

