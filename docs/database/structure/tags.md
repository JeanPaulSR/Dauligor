# Table Structure: Tag Taxonomy

System for categorizing all entities (Classes, Spells, Items, Lore).

## Table: `tag_groups`

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | e.g., "Damage Types". |
| `category` | TEXT | `category` | (Legacy) First classification. |
| `classifications`| JSON | `classifications` | Array of system types (spell, lore, etc). |
| `description` | TEXT | `description` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Table: `tags`

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `group_id` | TEXT (FK) | `groupId` | Links to `tag_groups.id`. |
| `name` | TEXT | `name` | e.g., "Fire". |
| `slug` | TEXT NOT NULL | `slug` | URL-safe identifier. Unique within its group. |
| `updated_at` | DATETIME | `updatedAt` | |

## Implementation Notes
- **Visibility**: Tag groups use `classifications` to determine where they appear in the UI. A group classified as `spell` will only appear in the Spell Editor tag selector.
