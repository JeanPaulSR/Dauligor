# Table Structure: `lore_articles` (Base)

The foundation of the Dauligor Wiki. Every article exists here first; specialized metadata is stored in category-specific sub-tables.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `title` | TEXT | `title` | |
| `slug` | TEXT (INDEX) | `slug` | Unique within the category. |
| `category` | TEXT | `category` | character, location, item, etc. |
| `folder` | TEXT | `folder` | UI hierarchy path. |
| `content` | TEXT | `content` | Primary Markdown body. |
| `excerpt` | TEXT | `excerpt` | Summary for previews. |
| `parent_id` | TEXT (FK) | `parentId` | For nested wiki pages. |
| `status` | TEXT | `status` | draft / published. |
| `author_id` | TEXT | `authorId` | Links to `users.id`. |
| `dm_notes` | TEXT | `dmData/notes` | Private DM content. |
| `image_url` | TEXT | `imageUrl` | Header Image URL (R2). |
| `image_display` | JSON | `imageDisplay` | Focal points. |
| `card_image_url` | TEXT | `cardImageUrl` | Grid/Card Image URL (R2). |
| `card_display` | JSON | `cardDisplay` | Focal points. |
| `preview_image_url`| TEXT | `previewImageUrl`| Hover Image URL (R2). |
| `preview_display` | JSON | `previewDisplay` | Focal points. |
| `created_at` | DATETIME | `createdAt` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Implementation Notes
- **Normalization**: Fields like `dm_notes` are moved from sub-collections directly into the base table to reduce query complexity.
- **Hierarchical Wiki**: `parent_id` allows for a recursive folder structure in the UI.

## Access
All article reads and writes flow through [`api/lore.ts`](../../../api/lore.ts) — see [the endpoint table in `api-endpoints.md`](../../platform/api-endpoints.md) for method-by-method gates. The generic `/api/d1/query` proxy refuses any write to `lore_*` tables (`PROTECTED_WRITE_TABLES`, admin-gated for legacy callers) and any direct SELECT against `lore_secrets` (`PROTECTED_READ_TABLES`). `dm_notes` is included only when the per-route GET caller is wiki-staff (`isWikiStaff(role)` = admin + co-dm + lore-writer); the column is stripped for everyone else. Drafts (rows where `status != 'published'`) 404 for non-staff so probes can't enumerate them. See [../../platform/security-gates.md](../../platform/security-gates.md).
