import { db } from './firebase';
import {
  collection, doc, setDoc, getDoc, deleteDoc, updateDoc,
  query, where, getDocs, serverTimestamp,
} from 'firebase/firestore';

// ── types ─────────────────────────────────────────────────────────────────────

export interface ImageMetadata {
  id?: string;
  url: string;
  storagePath: string;
  filename: string;
  folder: string;
  creator?: string;        // Artist / author credit
  description?: string;    // What is depicted
  tags?: string[];
  license?: string;        // e.g. "CC BY 3.0", "All Rights Reserved"
  source?: string;         // External origin URL
  uploadedBy?: string;     // UID
  uploadedByName?: string; // Display name
  uploadedAt?: any;        // Firestore Timestamp or Date
  size?: number;           // Bytes
}

export interface ImageReference {
  collection: string;
  id: string;
  name: string;
  field: string;
}

// ── scan targets ──────────────────────────────────────────────────────────────
// When checking references before a delete, every (collection, field) pair here
// is queried for the image URL.

const SCAN_TARGETS: { col: string; fields: string[]; nameField: string }[] = [
  { col: 'classes',      fields: ['imageUrl', 'cardImageUrl', 'previewImageUrl'], nameField: 'name' },
  { col: 'subclasses',   fields: ['imageUrl'],                                   nameField: 'name' },
  { col: 'features',     fields: ['iconUrl'],                                    nameField: 'name' },
  { col: 'characters',   fields: ['imageUrl'],                                   nameField: 'name' },
  { col: 'sources',      fields: ['imageUrl'],                                   nameField: 'name' },
  { col: 'users',        fields: ['avatarUrl'],                                  nameField: 'displayName' },
  { col: 'loreArticles', fields: ['imageUrl', 'coverImage'],                     nameField: 'title' },
];

// ── doc-ID helpers ────────────────────────────────────────────────────────────
// Storage paths contain '/' which is invalid in Firestore doc IDs.

export function storagePathToDocId(storagePath: string): string {
  return storagePath.replace(/\//g, '--').replace(/\./g, '-dot-');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveImageMetadata(
  storagePath: string,
  data: Omit<ImageMetadata, 'id' | 'storagePath'>,
): Promise<void> {
  const docId = storagePathToDocId(storagePath);
  await setDoc(
    doc(db, 'imageMetadata', docId),
    { ...data, storagePath, uploadedAt: data.uploadedAt ?? serverTimestamp() },
    { merge: true },
  );
}

export async function getImageMetadataByPath(storagePath: string): Promise<ImageMetadata | null> {
  const docId = storagePathToDocId(storagePath);
  const snap = await getDoc(doc(db, 'imageMetadata', docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<ImageMetadata, 'id'>) };
}

export async function updateImageMetadata(
  storagePath: string,
  updates: Partial<ImageMetadata>,
): Promise<void> {
  const docId = storagePathToDocId(storagePath);
  await setDoc(doc(db, 'imageMetadata', docId), updates, { merge: true });
}

export async function deleteImageMetadata(storagePath: string): Promise<void> {
  const docId = storagePathToDocId(storagePath);
  await deleteDoc(doc(db, 'imageMetadata', docId));
}

// ── reference scanner ─────────────────────────────────────────────────────────

export async function scanForReferences(url: string): Promise<ImageReference[]> {
  const results: ImageReference[] = [];

  await Promise.all(
    SCAN_TARGETS.flatMap(({ col, fields, nameField }) =>
      fields.map(async (field) => {
        try {
          const q = query(collection(db, col), where(field, '==', url));
          const snap = await getDocs(q);
          snap.docs.forEach((d) => {
            results.push({
              collection: col,
              id: d.id,
              name: (d.data()[nameField] as string) || d.id,
              field,
            });
          });
        } catch {
          // Skip collections that don't exist or have restricted access
        }
      }),
    ),
  );

  return results;
}

// ── reference updater ─────────────────────────────────────────────────────────
// Replaces every occurrence of oldUrl with newUrl across all scan targets.
// Returns the number of document fields updated.

export async function updateImageReferences(oldUrl: string, newUrl: string): Promise<number> {
  let count = 0;

  await Promise.all(
    SCAN_TARGETS.flatMap(({ col, fields }) =>
      fields.map(async (field) => {
        try {
          const q = query(collection(db, col), where(field, '==', oldUrl));
          const snap = await getDocs(q);
          await Promise.all(
            snap.docs.map(async (d) => {
              await updateDoc(doc(db, col, d.id), { [field]: newUrl });
              count++;
            }),
          );
        } catch {
          // Skip collections with restricted access
        }
      }),
    ),
  );

  return count;
}

// ── URL → storage path ────────────────────────────────────────────────────────
// Extracts the internal storage path from a Firebase download URL so we can
// look up metadata even if only the URL is known.

export function extractStoragePath(downloadUrl: string): string | null {
  try {
    const u = new URL(downloadUrl);
    // Firebase Storage URLs encode the path after /o/
    if (u.hostname.includes('firebasestorage.googleapis.com')) {
      const match = u.pathname.match(/\/o\/(.+)$/);
      if (!match) return null;
      return decodeURIComponent(match[1]);
    }
    // R2 public URLs — the key is the pathname without the leading slash
    const key = u.pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}
