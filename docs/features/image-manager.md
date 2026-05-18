# Image Manager

Admin tool for browsing, uploading, renaming, and deleting images stored in R2. The same image-handling primitives are reused throughout the app via `ImageUpload` and `IconPickerModal`.

For the underlying R2 bucket structure and Worker endpoints, see [../platform/r2-storage.md](../platform/r2-storage.md).

## Pages

| Route | File | Access |
|---|---|---|
| `/admin/images` | [ImageManager.tsx](../../src/pages/admin/ImageManager.tsx) | Image-manager-eligible roles (admin / co-dm / lore-writer) |
| `/images/view?url=` | [ImageViewer.tsx](../../src/pages/admin/ImageViewer.tsx) | Public — anyone with the URL |

## Three tabs

### Image Library
For freely organised content images — article inline images, battle maps, miscellaneous artwork. Browses `images/` and **hides the system subfolders** (`classes/`, `subclasses/`, `lore/`, `characters/`, `sources/`, `users/`) — those live in the System Images tab.

**Toolbar (two rows):**
- Row 1 — **Breadcrumb** (each segment is also a drag-drop target for folder moves) · **Up-arrow** to step out one level · **+ Folder** inline creation · **Upload** toggle · **Refresh**
- Row 2 — **Filter** input (searches recursively under the current folder + its subtree; cache invalidates on folder change) · **Display mode toggle** (Tiles / List — list shows thumb + name + size + uploaded date) · **Hide-private toggle** (eye-slash; hides folders starting with `_` like `_temp`; default **on**)

**Upload panel** (when expanded):
- Optional filename — blank uses timestamp + random suffix
- Type selector — Standard / Icon (126×126) / Token (400×400); determines client-side resize before upload
- Drop zone / file picker

**Detail panel** (right side, on selection):
- Full preview
- File info — name, path, size, upload date
- Copy URL button
- View button (opens `/images/view?url=`)
- Rename / Move — folder + filename inputs; **"Move & Update Links"** also rewrites every D1 row referencing the URL (see Reference scanning)
- Metadata editor — creator, description, license, source URL, tags
- Danger Zone (admin only) — delete; runs reference scan first

### System Images
Read-only browser for entity-linked image folders. Rename and delete are disabled to prevent accidental broken links.

| Section | R2 prefix | D1 table | Display name |
|---|---|---|---|
| Classes | `images/classes/` | `classes` | `name` |
| Subclasses | `images/subclasses/` | `subclasses` | `name` |
| Article Headers | `images/lore/` | `lore_articles` | `title` |
| Characters | `images/characters/` | `characters` | `name` |
| Sources | `images/sources/` | `sources` | `name` |
| Users | `images/users/` | `users` | `display_name` |

System folders use D1 row IDs as the key segment. The manager fetches the relevant table and builds an `id → name` map so cards show "Sorcerer" with the raw ID below.

**Toolbar (inside a section):** **Filter** input (matches resolved name + raw ID) · **Display mode toggle** (Tiles / List). The read-only notice now lives at the bottom of the tab.

### Icons
Folder browser for `icons/`. Same Foundry-style toolbar as Image Library: breadcrumb (drag-drop target) + **Up-arrow** + **+ Folder** + **Upload** + **Refresh** on row 1; **Filter** (current folder + subtree) + **Display mode toggle** (Tiles / List) + **Hide-private toggle** on row 2.

The previous global "search across all icons" catalog was removed — searches are now scoped to the current folder plus its subfolders, which matches the picker behaviour and avoids the prior 1000-object listing cap on the whole `icons/` tree. The auto-cropped-to-126×126 reminder lives at the bottom of the tab.

## Reusable components

### `ImageUpload` (`src/components/ui/ImageUpload.tsx`)

Used in editors throughout the app for inline image inputs. Props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `onUpload` | `(url: string) => void` | required | Called with R2 URL after upload (or `""` to clear) |
| `storagePath` | `string` | required | R2 key prefix (e.g., `images/classes/abc/`) |
| `currentImageUrl` | `string?` | — | Shows current image; X clears |
| `imageType` | `'standard'\|'icon'\|'token'` | — | Locks resize behaviour and shows badge |
| `allowTypeSelection` | `boolean?` | false | Renders a Standard / Icon / Token toggle (Image Manager) |
| `filename` | `string?` | — | Override auto-generated filename |
| `compact` | `boolean?` | false | Avatar-style square picker (feature icon slots) |
| `className` | `string?` | — | Extra CSS |

Resize behaviour (when `imageType` is `icon` or `token`): centre-crop to target canvas before WebP conversion. Source image is never distorted.

Compact mode (used in the 128px feature icon slot inside `ClassEditor` / `SubclassEditor`):
- **Click** → opens `IconPickerModal` to browse the icons library
- **Hover** → reveals magnifier (open picker), upload (direct), and X (clear) overlay buttons

### `IconPickerModal` (`src/components/ui/IconPickerModal.tsx`)

Foundry-FilePicker-style modal for browsing and selecting from R2. Props:

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Controls visibility |
| `onClose` | `() => void` | Dismiss |
| `onSelect` | `(url: string) => void` | Selection — modal closes automatically |
| `rootFolder` | `'icons'\|'tokens'?` | **Initial** source tab (default `'icons'`); user can switch in-modal |
| `imageType` | `'icon'\|'token'?` | Kept for back-compat; runtime resize is derived from the active source tab |

**Source tabs** — strip below the title toggles between enabled sources. The machinery supports both `icons/` and `tokens/`, but the `AVAILABLE_SOURCES` constant currently exposes only `icons` — the tab strip is hidden when only one source is active. Add `'tokens'` to that const to re-enable when the creature/NPC system needs it.

**Path navigation** — up-arrow steps out one level; the editable path input shows the path relative to the active source (the `<source>/` prefix is rendered as a non-editable hint). Press Enter or blur to navigate.

**Favorites** — star button in the toolbar pins the current path. Stored in `localStorage` at `dauligor.iconPicker.favorites.v1.<firebase-uid>`, so admins sharing a browser don't see each other's pins. Signed-out users see nothing and writes are skipped. The chip strip below the toolbar lists favorites for the active source; click a chip to jump, hover-X to remove.

**Create folder** (admin only) — folder-plus button opens an inline name row. Sanitized to `[a-zA-Z0-9_-]+`. R2 has no folder concept, so creation writes a `.keep` marker under the new prefix; `.keep` and any other dotfile is filtered out of the displayed listings.

**Hide private** (admin only) — eye-slash toggle hides folders starting with `_` (e.g. `_temp`). Default **on**. Non-admins always have private folders hidden and never see the toggle. Folders still visible when toggled get a small "private" badge. In search mode, files passing through a private folder are also filtered.

**Display mode** — Tile (5-col grid; thumbs + truncated name) or List (small thumb + name + size + date). Default Tile.

**Search mode** — non-empty filter input switches to a flat recursive listing of all objects under the **current folder** (not the entire source), fetched once and cached per folder. Filters by filename and key. Cache invalidates when the folder changes.

**Upload panel** (admin only) — toggle reveals upload form with two targets:
- **Current folder** — saves to the browsed path
- **Temp (`_temp`)** — saves to `<activeSource>/_temp/` for later organisation via Image Manager rename

Resize on upload: 126² for the Icons source, 400² for Tokens.

**Admin gate** — Upload, Create Folder, and Hide-Private are gated to `role === 'admin'` (read from the module-level cache in [src/lib/currentUser.ts](../../src/lib/currentUser.ts), fed by `App.tsx`). Non-admins (co-dm, lore-writer, user) see a read-only browser. The server proxy is the authoritative gate; the client gate is a UX hint.

## Reference scanning

`scanForReferences(url)` is now a thin fetch wrapper around `POST /api/r2/scan-references` (`requireImageManagerAccess`). The server fans out across the `SCAN_TARGETS` list:

`classes`, `subclasses`, `features`, `characters`, `sources`, `users`, `lore_articles` (plus their `image_url` / `card_image_url` / `preview_image_url` / `icon_url` / `avatar_url` variants).

If any row references the URL, the deletion or rename UI shows the list before confirmation. **"Move & Update Links"** in the detail panel calls `updateImageReferences(oldUrl, newUrl)` which POSTs to `/api/r2/rewrite-references`; the server runs an `UPDATE` per (table, column) pair and returns the affected row count. The R2 object rename happens client-side after the rewrite returns.

Both endpoints run server-side via `executeD1QueryInternal` — not through the generic `/api/d1/query` proxy. This is deliberate: the proxy's `PROTECTED_READ_TABLES` gate refuses raw SELECTs against `users` and `characters`, which would silently 403 the scan and hide real references. The server-side scan bypasses that gate intentionally (it runs with the shared worker secret) so image admin actually sees every reference.

The `SCAN_TARGETS` list lives in [api/_lib/r2-proxy.ts](../../api/_lib/r2-proxy.ts) only. Adding a new image-bearing column means updating that one list; do not reintroduce a parallel client-side `SCAN_TARGETS` (the proxy gate would silently hide some of the scan from the client).

The thin client wrappers + metadata CRUD live in [src/lib/imageMetadata.ts](../../src/lib/imageMetadata.ts) and write to the `image_metadata` D1 table.

## Image life cycle (concise)

1. **Upload** — Client resizes (if icon/token) → converts to WebP → POST `/api/r2/upload`.
2. **Reference** — URL stored in the relevant D1 row column (`image_url`, `card_image_url`, `avatar_url`, etc.).
3. **Serve** — `<img src="https://images.dauligor.com/<key>">`.
4. **Metadata** — Optionally enriched in Image Manager (creator, license, tags) → `image_metadata` row.
5. **Rename** — Worker copies to new key + deletes old. References rewritten in parallel.
6. **Delete** — Reference scan first; admin confirms; `r2Delete` + remove `image_metadata` row.

## Common tasks

### Add a new system image folder (e.g., for items)
1. Pick the convention (`images/items/<itemId>/`).
2. In the Item editor, use `ImageUpload` with `storagePath="images/items/<id>/"` and `imageType="icon"` (or whatever fits).
3. Add a new row to the System Images tab in `ImageManager.tsx` referencing the `items` table.
4. Add `items` to the `SCAN_TARGETS` list in [api/_lib/r2-proxy.ts](../../api/_lib/r2-proxy.ts) (server-side, not client-side) if you want delete-warnings and "Move & Update Links" to cover it.

### Move an image without breaking references
- Open Image Manager → select image → Rename / Move → "Move & Update Links". This is the only safe path.

### Find orphaned images
Currently no UI; SQL pattern:

```sql
-- Find image_metadata rows whose URL isn't referenced anywhere
SELECT url FROM image_metadata WHERE url NOT IN (
  SELECT image_url FROM classes WHERE image_url IS NOT NULL
  UNION SELECT card_image_url FROM classes WHERE card_image_url IS NOT NULL
  UNION SELECT image_url FROM subclasses WHERE image_url IS NOT NULL
  UNION SELECT image_url FROM characters WHERE image_url IS NOT NULL
  -- … etc.
);
```

## Related docs

- [../platform/r2-storage.md](../platform/r2-storage.md) — bucket structure, Worker endpoints, image life cycle
- [../ui/components.md](../ui/components.md) — `ImageUpload` and `IconPickerModal` patterns
- [wiki-lore.md](wiki-lore.md) — image slots on lore articles
- [compendium-classes.md](compendium-classes.md) — class artwork slots
- [../database/README.md](../database/README.md) — `imageMetadata` migration status
