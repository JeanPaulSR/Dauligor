# Image & Icon System

## 1. Overview

The image system has three layers:

| Layer | Path | Purpose |
| :--- | :--- | :--- |
| **Image Manager** | `/admin/images` | Admin tool — browse, upload, rename, delete, metadata |
| **Image Viewer** | `/images/view?url=` | Public single-image page with metadata display |
| **ImageUpload component** | `src/components/ui/ImageUpload.tsx` | Reusable upload widget used throughout editors |
| **IconPickerModal** | `src/components/ui/IconPickerModal.tsx` | Browse-and-select modal for icon/token slots |

Access to Image Manager is restricted to `admin`, `co-dm`, and `lore-writer` roles. Image Viewer is public.

---

## 2. Image Manager (`src/pages/admin/ImageManager.tsx`)

The manager has three tabs: **Image Library**, **System Images**, and **Icons**.

### Image Library tab

For freely organised content images — article inline images, battle maps, miscellaneous artwork. Starts at `images/` and hides the system subfolders (`classes/`, `subclasses/`, `lore/`, `characters/`, `sources/`, `users/`) — those live exclusively in System Images.

**Toolbar:**
- **Breadcrumb** — click any segment to navigate up; Home navigates back to `images/`
- **Upload** toggle — expands an inline upload panel
- **Refresh** — re-fetches the current folder

**Upload panel** (when expanded):
- Optional **filename** input — if left blank, a timestamp + random suffix is used
- **Type selector** — Standard / Icon (126×126) / Token (400×400); determines client-side resize before upload
- Drop zone / file picker (drag-and-drop supported)

**Detail panel** (right column, appears on image select):
- Full preview
- **File Info** — name, path, size, upload date
- **Copy URL** button
- **View** button — opens `/images/view?url=` in a new tab
- **Rename / Move** — folder + filename inputs; "Move & Update Links" calls `r2Rename` then `updateImageReferences` to rewrite every Firestore reference automatically
- **Metadata editor** — creator, description, license, source URL, tags (comma-separated)
- **Danger Zone** (admin only) — scans Firestore for references before allowing deletion

---

### System Images tab

Read-only browser for entity-linked image paths. Rename and delete are disabled to prevent accidental broken links.

**Sections:**

| Section | R2 Prefix | Firestore collection | Name field |
| :--- | :--- | :--- | :--- |
| Classes | `images/classes/` | `classes` | `name` |
| Subclasses | `images/subclasses/` | `subclasses` | `name` |
| Article Headers | `images/lore/` | `loreArticles` | `title` |
| Characters | `images/characters/` | `characters` | `name` |
| Sources | `images/sources/` | `sources` | `name` |
| Users | `images/users/` | `users` | `displayName` |

**Name resolution:** entity subfolders use Firestore document IDs as R2 keys. When a section is opened, the manager fetches the collection and builds an `id → name` map. Folder cards show the resolved name (e.g. "Sorcerer") with the raw ID in smaller text below. The detail panel also shows the friendly location path instead of raw IDs.

**Detail panel:** preview, file info with friendly path, copy URL, metadata editor. No rename or delete controls.

---

### Icons tab

Browses `icons/` in R2 as a flat recursive listing. The **Load Icons** button fetches all objects. Search filters by filename and category (subfolder name). Click any icon to copy its URL.

---

## 3. ImageUpload Component (`src/components/ui/ImageUpload.tsx`)

### Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `onUpload` | `(url: string) => void` | required | Called with the R2 public URL after upload, or `""` to clear |
| `storagePath` | `string` | required | R2 key prefix, e.g. `images/classes/abc/` |
| `currentImageUrl` | `string?` | — | Shows current image; X button calls `onUpload("")` |
| `imageType` | `'standard' \| 'icon' \| 'token'` | — | Locks resize behaviour; shows a badge; no selector |
| `allowTypeSelection` | `boolean?` | false | Renders a Standard / Icon / Token toggle (used in Image Manager) |
| `filename` | `string?` | — | Overrides the auto-generated filename (no extension needed) |
| `compact` | `boolean?` | false | Avatar-style square picker — used in feature icon slots |
| `className` | `string?` | — | Extra CSS classes |

### Image types and resize

When `imageType` (or the type selector) is set to `icon` or `token`, the image is **center-cropped** to the target canvas before WebP conversion. The source image is never distorted.

| Type | Canvas | Typical use |
| :--- | :--- | :--- |
| `standard` | Original | Lore headers, class artwork, portraits |
| `icon` | 126 × 126 | Feature icons, spell icons, item icons |
| `token` | 400 × 400 | Creature/character tokens |

### Compact mode

Used inside the 128 px icon slot in the ClassEditor and SubclassEditor feature modals.

- **Click** the widget — opens `IconPickerModal` to browse the `icons/` library
- **Hover** — reveals three overlay buttons:
  - Magnifier — opens the picker modal
  - Upload — direct file upload (bypasses picker, still resizes)
  - X — clears the current image
- `iconUrl` is saved to Firestore as part of the feature document

---

## 4. Icon Picker Modal (`src/components/ui/IconPickerModal.tsx`)

A dialog for browsing and selecting from the `icons/` (or `tokens/`) R2 folder without leaving the editor.

### Props

| Prop | Type | Description |
| :--- | :--- | :--- |
| `open` | `boolean` | Controls visibility |
| `onClose` | `() => void` | Called on dismiss |
| `onSelect` | `(url: string) => void` | Called with chosen URL; modal closes automatically |
| `rootFolder` | `string?` | Root to browse — `'icons'` or `'tokens'` (default `'icons'`) |
| `imageType` | `'icon' \| 'token'?` | Determines resize size on upload (default `'icon'`) |

### Browse mode

Opens to `rootFolder`. Subfolders are shown as clickable cards. Breadcrumb shows the path relative to the root. Refresh button re-fetches the current folder.

### Search mode

Triggered when the search input is non-empty. On first search, a **flat recursive listing** of all objects under `rootFolder/` is fetched and cached for the session. Results are filtered client-side by filename and path.

### Upload panel (toggle)

- **Upload target** — "Current folder" saves to the browsed path; "Temp (_temp)" saves to `{rootFolder}/_temp/` as a staging area
- Images uploaded via the panel appear immediately in the grid (current folder only)
- Images in `_temp` can be moved later using **Image Manager → rename**

---

## 5. Image Viewer (`src/pages/admin/ImageViewer.tsx`)

Route: `/images/view?url={encodedUrl}`

Accessible to all users. Extracts the R2 key from the URL, fetches Firestore metadata, and renders:
- Full image
- Metadata card (creator, description, license, source link, tags) — only shown when at least one field is populated

---

## 6. Shared Utilities

### `src/lib/r2.ts`
Low-level Worker API calls. All functions are async and throw on non-OK responses.

| Export | Signature | Description |
| :--- | :--- | :--- |
| `r2Upload` | `(file, key, onProgress?) → { url, key }` | XHR upload with progress events |
| `r2List` | `(prefix, delimiter?) → { objects, delimitedPrefixes }` | List objects; omit delimiter for recursive flat list |
| `r2Delete` | `(key) → void` | Delete object |
| `r2Rename` | `(oldKey, newKey) → { url, key }` | Copy + delete (atomic from R2's perspective) |

### `src/lib/imageUtils.ts`
Client-side image processing.

| Export | Description |
| :--- | :--- |
| `convertToWebP(file, quality?, target?)` | Converts to WebP; center-crops to `target` dimensions if provided |

### `src/lib/imageMetadata.ts`
Firestore metadata CRUD.

| Export | Description |
| :--- | :--- |
| `saveImageMetadata(storagePath, data)` | Upsert metadata doc |
| `getImageMetadataByPath(storagePath)` | Fetch metadata by key |
| `updateImageMetadata(storagePath, updates)` | Partial update |
| `deleteImageMetadata(storagePath)` | Remove metadata doc |
| `scanForReferences(url)` | Parallel scan across 6 collections for URL references |
| `extractStoragePath(downloadUrl)` | Extracts R2 key from a public URL (handles both R2 and legacy Firebase URLs) |
| `storagePathToDocId(storagePath)` | Encodes key as a valid Firestore doc ID |
