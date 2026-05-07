# Media Storage Architecture

The application uses **Cloudflare R2** for image storage, served via a Cloudflare Worker proxy. Firestore stores only URL strings pointing into R2; no binary data lives in Firebase.

## 1. Infrastructure

| Component | Purpose |
| :--- | :--- |
| **R2 bucket** (`dauligor-storage`) | Stores all binary image data |
| **Cloudflare Worker** (`dauligor-storage`) | Authenticated proxy — handles upload, list, delete, rename |
| **Firestore** (`imageMetadata` collection) | Per-image metadata (creator, license, tags, etc.) |
| **R2 public URL** | Base URL for serving images directly, e.g. `https://pub-xxx.r2.dev` |

Worker endpoints (all require `Authorization: Bearer <API_SECRET>`):

| Method | Path | Action |
| :--- | :--- | :--- |
| `POST` | `/upload` | Upload file (multipart form: `file`, `key`) |
| `GET` | `/list?prefix=&delimiter=` | List objects / prefixes |
| `DELETE` | `/delete?key=` | Delete object |
| `POST` | `/rename` | Rename/move object (`{ oldKey, newKey }`) |

Client utilities live in `src/lib/r2.ts`: `r2Upload`, `r2List`, `r2Delete`, `r2Rename`.

Environment variables required in `.env`:

```
VITE_R2_WORKER_URL=https://dauligor-storage.ACCOUNT.workers.dev
VITE_R2_API_SECRET=your-secret
```

## 2. Bucket Directory Structure

```
dauligor-storage/
├── images/
│   │
│   │  ── System Images (entity-linked, managed by editors) ──
│   ├── classes/{classId}/          — class artwork
│   ├── subclasses/{subclassId}/    — subclass artwork
│   ├── lore/{articleId}/           — lore article headers
│   ├── characters/{characterId}/   — character portraits
│   ├── sources/{sourceId}/         — source cover images
│   ├── users/{userId}/             — user avatars
│   │
│   │  ── Image Library (freely organised by admin/DM) ──
│   └── {custom}/                   — e.g. content/, battle-maps/, etc.
│
├── icons/
│   ├── _temp/                      — staging area for unsorted uploads
│   └── {category}/                 — named subfolders (e.g. magic/, combat/)
└── tokens/
    ├── _temp/
    └── {category}/
```

System image folders use Firestore document IDs as keys. Image Manager resolves these to display names by querying the relevant collection.

## 3. Image Types & Sizing

| Type | Canvas size | Usage |
| :--- | :--- | :--- |
| **Standard** | Original dimensions | Artwork, portraits, lore headers |
| **Icon** | 126 × 126 px (center-crop) | Feature icons in class/subclass editors |
| **Token** | 400 × 400 px (center-crop) | Creature/character tokens (future) |

All uploads are converted to **WebP** client-side before transfer (`src/lib/imageUtils.ts → convertToWebP`).

## 4. Metadata (`imageMetadata` Firestore collection)

Document ID is the R2 key with `/` replaced by `--` and `.` by `-dot-` (see `storagePathToDocId` in `src/lib/imageMetadata.ts`).

| Field | Type | Description |
| :--- | :--- | :--- |
| `url` | string | R2 public download URL |
| `storagePath` | string | R2 object key |
| `filename` | string | Bare filename |
| `folder` | string | Parent folder key |
| `creator` | string? | Artist / author credit |
| `description` | string? | What is depicted |
| `license` | string? | e.g. "CC BY 3.0" |
| `source` | string? | External origin URL |
| `tags` | string[]? | Searchable tags |
| `uploadedBy` | string? | User UID |
| `uploadedByName` | string? | Display name |
| `uploadedAt` | Timestamp? | Server timestamp |
| `size` | number? | Bytes |

## 5. Image Life Cycle

1. **Upload** — `ImageUpload` component converts to WebP (+ resizes if icon/token), calls `r2Upload` which POSTs to the Worker. Worker writes to R2 and returns the public URL.
2. **Reference** — The URL string is stored in the relevant Firestore document field (`imageUrl`, `iconUrl`, `avatarUrl`, etc.).
3. **Serve** — `<img>` tags reference the R2 public URL directly; no proxy needed for reads.
4. **Metadata** — Optionally enriched via Image Manager (`saveImageMetadata` → Firestore).
5. **Rename** — Worker copies object to new key, deletes old; `imageMetadata` doc is updated in parallel.
6. **Delete** — Image Manager scans Firestore references before allowing deletion; calls `r2Delete` then `deleteImageMetadata`.

## 6. Reference Scanning

Before deleting an image, `scanForReferences(url)` runs parallel Firestore queries across:

`classes`, `subclasses`, `characters`, `sources`, `users`, `loreArticles`

If any document references the URL, a warning is shown listing each reference before the admin can confirm.
