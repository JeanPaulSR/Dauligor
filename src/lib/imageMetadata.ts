import { fetchCollection, fetchDocument, upsertDocument, updateDocument, deleteDocument } from './d1';

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
// When checking references before a delete, every (collection, field) pair here
// is queried for the image URL. `col` uses the legacy/camelCase name that
// `D1_TABLE_MAP` translates into the actual D1 table; `fields` are D1 columns
// (snake_case); `nameField` is also a D1 column.

const SCAN_TARGETS: { col: string; fields: string[]; nameField: string }[] = [
  { col: 'classes',    fields: ['image_url', 'card_image_url', 'preview_image_url'], nameField: 'name' },
  { col: 'subclasses', fields: ['image_url'],                                        nameField: 'name' },
  { col: 'features',   fields: ['icon_url'],                                         nameField: 'name' },
  { col: 'characters', fields: ['image_url'],                                        nameField: 'name' },
  { col: 'sources',    fields: ['image_url'],                                        nameField: 'name' },
  { col: 'users',      fields: ['avatar_url'],                                       nameField: 'display_name' },
  { col: 'lore',       fields: ['image_url', 'card_image_url', 'preview_image_url'], nameField: 'title' },
];

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

export async function scanForReferences(url: string): Promise<ImageReference[]> {
  const results: ImageReference[] = [];

  await Promise.all(
    SCAN_TARGETS.flatMap(({ col, fields, nameField }) =>
      fields.map(async (field) => {
        try {
          const rows = await fetchCollection<any>(col, {
            select: `id, ${field}, ${nameField}`,
            where: `${field} = ?`,
            params: [url],
          });
          rows.forEach((r: any) => {
            results.push({
              collection: col,
              id: r.id,
              name: (r[nameField] as string) || r.id,
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
// Returns the number of rows updated.

export async function updateImageReferences(oldUrl: string, newUrl: string): Promise<number> {
  let count = 0;

  await Promise.all(
    SCAN_TARGETS.flatMap(({ col, fields }) =>
      fields.map(async (field) => {
        try {
          const matches = await fetchCollection<any>(col, {
            select: `id`,
            where: `${field} = ?`,
            params: [oldUrl],
          });
          await Promise.all(
            matches.map(async (m: any) => {
              // Real UPDATE — we're patching one column on a row we just
              // selected by id, and the target tables (classes, features,
              // users, sources, subclasses, lore) each have NOT NULL
              // columns that aren't in our payload. upsertDocument would
              // throw `NOT NULL constraint failed` on those tables.
              await updateDocument(col, m.id, { [field]: newUrl });
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
