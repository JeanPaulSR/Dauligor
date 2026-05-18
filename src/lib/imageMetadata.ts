import { fetchDocument, upsertDocument, updateDocument, deleteDocument } from './d1';
import { auth } from './firebase';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ⚠  COORDINATION NOTE FOR THE IMAGE MANAGER BRANCH  ⚠                    ║
// ║                                                                          ║
// ║  The reference scanner and rewriter have moved SERVER-SIDE as part of    ║
// ║  the read-protection security work (commit 515eb0e). If your branch     ║
// ║  adds a new image-bearing column to any table:                           ║
// ║                                                                          ║
// ║    1. Update SCAN_TARGETS in `api/_lib/r2-proxy.ts` (server-side copy).  ║
// ║    2. Do NOT add a client-side SCAN_TARGETS — the client no longer       ║
// ║       walks the tables; it calls `/api/r2/scan-references` and           ║
// ║       `/api/r2/rewrite-references` which fan out server-side.            ║
// ║    3. If your branch reintroduces direct `fetchCollection('users')` or  ║
// ║       `fetchCollection('characters')` from the client, the proxy gate    ║
// ║       at `api/_lib/d1-proxy.ts` (PROTECTED_READ_TABLES) will 403 it      ║
// ║       and image admin will silently miss references on those tables.    ║
// ║                                                                          ║
// ║  Function signatures of `scanForReferences` and `updateImageReferences`  ║
// ║  are unchanged — they're just thin fetch wrappers now. Consumers in     ║
// ║  `ImageManager.tsx` need no edits.                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

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
  uploadedAt?: any;        // ISO string
  size?: number;           // Bytes
}

export interface ImageReference {
  collection: string;
  id: string;
  name: string;
  field: string;
}

// ── scan targets ──────────────────────────────────────────────────────────────
// The list of (table, column) pairs to walk lives SERVER-SIDE now, in
// `api/_lib/r2-proxy.ts:SCAN_TARGETS`. The client just POSTs a URL to
// `/api/r2/scan-references` and the server fans out. Keeping the list
// server-only stops a hostile client from extending the scan to
// arbitrary tables (the audit's L3 concern) and lets the scan reach
// `users` / `characters` which are now blocked from direct SELECT at
// the d1-proxy gate.

// ── doc-ID helpers ────────────────────────────────────────────────────────────
// Storage paths contain '/' which we keep escaping for legacy compatibility
// with the existing imageMetadata IDs.

export function storagePathToDocId(storagePath: string): string {
  return storagePath.replace(/\//g, '--').replace(/\./g, '-dot-');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function toRowShape(meta: Partial<ImageMetadata>, storagePath?: string) {
  // Map camelCase → snake_case for the D1 image_metadata schema.
  const row: Record<string, any> = {};
  if (storagePath !== undefined) row.storage_path = storagePath;
  if (meta.url !== undefined) row.url = meta.url;
  if (meta.filename !== undefined) row.filename = meta.filename;
  if (meta.folder !== undefined) row.folder = meta.folder;
  if (meta.creator !== undefined) row.creator = meta.creator;
  if (meta.description !== undefined) row.description = meta.description;
  if (meta.tags !== undefined) row.tags = meta.tags;
  if (meta.license !== undefined) row.license = meta.license;
  if (meta.source !== undefined) row.source = meta.source;
  if (meta.uploadedBy !== undefined) row.uploaded_by = meta.uploadedBy;
  if (meta.uploadedByName !== undefined) row.uploaded_by_name = meta.uploadedByName;
  if (meta.uploadedAt !== undefined) row.uploaded_at = meta.uploadedAt;
  if (meta.size !== undefined) row.size = meta.size;
  return row;
}

function fromRowShape(row: any): ImageMetadata {
  return {
    id: row.id,
    url: row.url,
    storagePath: row.storage_path,
    filename: row.filename,
    folder: row.folder,
    creator: row.creator,
    description: row.description,
    tags: row.tags,
    license: row.license,
    source: row.source,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at,
    size: row.size,
  };
}

export async function saveImageMetadata(
  storagePath: string,
  data: Omit<ImageMetadata, 'id' | 'storagePath'>,
): Promise<void> {
  const docId = storagePathToDocId(storagePath);
  const row = toRowShape({ ...data, uploadedAt: data.uploadedAt ?? new Date().toISOString() }, storagePath);
  await upsertDocument('imageMetadata', docId, row);
}

export async function getImageMetadataByPath(storagePath: string): Promise<ImageMetadata | null> {
  const docId = storagePathToDocId(storagePath);
  const row = await fetchDocument<any>('imageMetadata', docId);
  if (!row) return null;
  return fromRowShape(row);
}

export async function updateImageMetadata(
  storagePath: string,
  updates: Partial<ImageMetadata>,
): Promise<void> {
  const docId = storagePathToDocId(storagePath);
  // Real UPDATE — image_metadata has NOT NULL columns (`url`, `storage_path`)
  // that we don't necessarily resupply in a partial patch, so we can't use
  // upsertDocument here (its INSERT-side NOT NULL check would fail).
  await updateDocument('imageMetadata', docId, toRowShape(updates));
}

export async function deleteImageMetadata(storagePath: string): Promise<void> {
  const docId = storagePathToDocId(storagePath);
  await deleteDocument('imageMetadata', docId);
}

// ── reference scanner ─────────────────────────────────────────────────────────
//
// Thin POST wrapper around `/api/r2/scan-references`. The endpoint
// gates on `requireImageManagerAccess` (admin / co-dm / lore-writer)
// and runs the fan-out server-side via `executeD1QueryInternal`,
// which can read `users` and `characters` that the d1-proxy gate now
// blocks for direct SELECTs.
//
// Previously this function ran a Promise.all across SCAN_TARGETS
// from the client, with try/catch per (table, column) pair that
// silently swallowed failures. That made the gate change invisible —
// after PROTECTED_READ_TABLES landed, scans against `users` and
// `characters` would 403 and the UI would show "no references found"
// when references actually existed. Per-route GET surfaces the real
// row count.

async function bearerHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function scanForReferences(url: string): Promise<ImageReference[]> {
  const res = await fetch('/api/r2/scan-references', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await bearerHeaders()) },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Image reference scan failed (HTTP ${res.status})`);
  }
  const body = await res.json();
  return Array.isArray(body?.references) ? body.references : [];
}

// ── reference updater ─────────────────────────────────────────────────────────
// Replaces every occurrence of oldUrl with newUrl across all scan targets.
// Returns the number of rows updated.
//
// Server-side via `/api/r2/rewrite-references` so the (table, column)
// allow-list lives in `api/_lib/r2-proxy.ts:SCAN_TARGETS` and a
// compromised client can't ship UPDATE statements against arbitrary
// columns (audit L3). Function signature unchanged.

export async function updateImageReferences(oldUrl: string, newUrl: string): Promise<number> {
  const res = await fetch('/api/r2/rewrite-references', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await bearerHeaders()) },
    body: JSON.stringify({ oldUrl, newUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Image reference rewrite failed (HTTP ${res.status})`);
  }
  const body = await res.json();
  return typeof body?.count === 'number' ? body.count : 0;
}

// ── URL → storage path ────────────────────────────────────────────────────────
// Extracts the internal storage path from a download URL so we can look up
// metadata even if only the URL is known.

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
