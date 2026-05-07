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
