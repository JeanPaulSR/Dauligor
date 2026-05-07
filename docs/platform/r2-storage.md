# R2 Storage

Cloudflare R2 holds all binary media — class artwork, character portraits, lore article banners, icons, tokens. The browser never talks directly to R2 in production; uploads go through the Vercel/Express proxy, which forwards to the project Worker, which writes to the bucket.

Image *metadata* (creator, license, tags, etc.) lives in the D1 `image_metadata` table — see [../database/structure/](../database/structure/) once that doc is in place.

## Infrastructure

| Component | Identifier |
|---|---|
| R2 bucket | `dauligor-storage` |
| Worker | `dauligor-storage` (same Worker handles D1 too) |
| Public CDN | `https://images.dauligor.com` |
| Worker bindings | `BUCKET` (R2), `DB` (D1) — see [worker/wrangler.toml](../../worker/wrangler.toml) |

## Worker endpoints

All require `Authorization: Bearer <R2_API_SECRET>`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/upload` | Multipart upload (`file`, `key`) |
| `GET` | `/list?prefix=&delimiter=` | List objects and "folders" |
| `DELETE` | `/delete?key=` | Delete one object |
| `POST` | `/rename` | Rename / move one object (`{ oldKey, newKey }`) |
| `POST` | `/move-folder` | Batch-move all objects under a prefix (`{ oldPrefix, newPrefix }`); returns `{ count, done }` and is called in a loop until `done` |

Source: [worker/index.js](../../worker/index.js).

## Vercel / Express proxy routes

The browser calls these. They verify the user's Firebase JWT (`requireImageManagerAccess`), then forward to the Worker with the shared `R2_API_SECRET`.

| Method | Path | Calls Worker |
|---|---|---|
| `POST` | `/api/r2/upload` | `/upload` |
| `GET` | `/api/r2/list` | `/list` |
| `DELETE` | `/api/r2/delete` | `/delete` |
| `POST` | `/api/r2/rename` | `/rename` |
| `POST` | `/api/r2/move-folder` | `/move-folder` |

Source: [api/_lib/r2-proxy.ts](../../api/_lib/r2-proxy.ts), wired in [server.ts](../../server.ts) and the matching files in [api/r2/](../../api/r2/).

## Browser API

In [src/lib/r2.ts](../../src/lib/r2.ts):

```ts
r2Upload(file, key, onProgress?): Promise<{ url; key }>
r2List(prefix, delimiter?): Promise<R2ListResult>
r2Delete(key): Promise<void>
r2Rename(oldKey, newKey): Promise<{ url; key }>
r2MoveFolder(oldPrefix, newPrefix, onProgress?): Promise<{ count }>
```

The user must be authenticated; `getAuthHeaders()` throws if `auth.currentUser` is null.

## Bucket structure

```
dauligor-storage/
├── images/
│   │
│   │   ── System images (entity-linked, managed by editors) ──
│   ├── classes/{classId}/
│   ├── subclasses/{subclassId}/
│   ├── lore/{articleId}/
│   ├── characters/{characterId}/
│   ├── sources/{sourceId}/
│   ├── users/{userId}/
│   │
│   │   ── Image library (freely organised by admin/DM) ──
│   └── {custom-folder}/                  (e.g. content/, battle-maps/)
│
├── icons/
│   ├── _temp/                            staging area for unsorted uploads
│   └── {category}/                       (e.g. magic/, combat/)
│
└── tokens/
    ├── _temp/
    └── {category}/
```

System image folders use D1 row IDs as keys. The Image Manager UI resolves IDs back to display names by querying the relevant D1 table.

## Image types and sizing

All uploads are converted to **WebP** client-side before transfer (`convertToWebP` in [src/lib/imageUtils.ts](../../src/lib/imageUtils.ts)).

| Type | Canvas size | Used for |
|---|---|---|
| Standard | Original dimensions | Class/subclass artwork, portraits, lore headers |
| Icon | 126 × 126 (center-crop) | Feature icons, spell icons |
| Token | 400 × 400 (center-crop) | Creature/character tokens (combat use) |

The `ImageUpload` component takes `imageType="standard" | "icon" | "token"` and applies the right pre-processing before calling `r2Upload`.

## Image life cycle

1. **Upload** — `ImageUpload` → WebP convert → resize if icon/token → `r2Upload(file, key)` → POST `/api/r2/upload`.
2. **Reference** — The returned URL is written into the relevant D1 row (`image_url`, `icon_url`, `avatar_url`, etc.).
3. **Serve** — `<img src="https://images.dauligor.com/<key>">`. No proxy needed for reads.
4. **Metadata** — Optionally enriched in the Image Manager (creator, license, tags). Stored in the D1 `image_metadata` table.
5. **Rename** — Worker copies object to new key, deletes old. The D1 `image_metadata` row is updated in parallel via the client.
6. **Delete** — Image Manager runs `scanForReferences(url)` against D1 first. If any row references the URL, the user gets a list of referenced documents and must confirm. Then `r2Delete(key)` and the matching `image_metadata` row are removed.

## Reference scanning

Before deleting an image, the Image Manager runs parallel D1 queries across these tables:
`classes`, `subclasses`, `characters`, `sources`, `users`, `lore_articles`.

If any row references the URL (in `image_url`, `card_image_url`, `preview_image_url`, `avatar_url`, etc.), a warning is shown listing each reference before the admin confirms.

## Why all this indirection

R2 is publicly readable through `images.dauligor.com`, but **writes are gated**. The chain is:

```
browser → /api/r2/upload (verify Firebase JWT, role check)
       → Worker /upload (verify API_SECRET)
       → R2 BUCKET binding
```

This means:
- The browser never sees the `R2_API_SECRET`.
- A leaked Firebase token can only do what its role allows (and tokens expire).
- The Worker can only be called by something that already authenticated.

## Local dev

`wrangler dev` emulates R2 locally under `worker/.wrangler/state/`. Uploads in local dev are stored on disk and served from `localhost:8787`. The `R2_PUBLIC_URL` is still set to `https://images.dauligor.com` because:
- The metadata's `url` field still resolves correctly when promoted to remote later.
- For testing image rendering, the production CDN is fine; we don't need the local copy displayed.

If you specifically want to test against locally-uploaded objects, use `r2List` to confirm they exist in the local bucket, then point your browser directly at the local Wrangler R2 URL.

## Related docs

- [runtime.md](runtime.md) — request flow including R2
- [auth-firebase.md](auth-firebase.md) — JWT layer that gates uploads
- [d1-architecture.md](d1-architecture.md) — `image_metadata` table interactions
- [../features/image-manager.md](../features/image-manager.md) — the admin UI for browsing/managing the bucket
