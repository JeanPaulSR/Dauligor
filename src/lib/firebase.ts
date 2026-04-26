import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signOut, 
  onAuthStateChanged, 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  updatePassword,
  updateEmail
} from 'firebase/auth';
import { 
  initializeFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocFromServer,
  memoryLocalCache,
  memoryLruGarbageCollector,
  CACHE_SIZE_UNLIMITED
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const isLocalhost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

// Switching to memory cache to resolve persistence-related "Unexpected state" errors 
// which occur during rapid tab switching in the admin panel. 
// Memory cache is safer and avoids corrupted IndexedDB states in preview environments.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache({
    // Using a large memory cache but with LRU cleanup to keep state clean
    garbageCollector: memoryLruGarbageCollector({
      cacheSizeBytes: CACHE_SIZE_UNLIMITED
    })
  }),
  // Localhost tends to play better with Firestore's default transport selection,
  // while preview environments still benefit from long polling.
  ...(isLocalhost
    ? { experimentalAutoDetectLongPolling: true }
    : { experimentalForceLongPolling: true })
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);

// Helper to reset Firestore state (reloads the page to clear memory cache)
export const resetFirestore = async () => {
  window.location.reload();
};

// Helper to convert a username to a Firebase-compatible email
export const usernameToEmail = (username: string) => {
  return `${username.toLowerCase().trim()}@archive.internal`;
};

export { 
  initializeApp,
  firebaseConfig,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  updateProfile,
  updatePassword,
  updateEmail,
  signOut,
  onAuthStateChanged,
  type User
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
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
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
