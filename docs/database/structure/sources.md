# Table Structure: `sources`

The foundational registry for all content origins (Books, Homebrew, Documents).

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT | Full title of the source. |
| `slug` | TEXT (INDEX) | URL-safe identifier. |
| `abbreviation` | TEXT | Short code (e.g., PHB, VSS). |
| `rules_version` | TEXT | 2014, 2024, or universal. |
| `status` | TEXT | ready, draft, retired. |
| `description` | TEXT | Markdown content. |
| `image_url` | TEXT | R2 URL for the cover. |
| `external_url` | TEXT | Link to external page/store. |
| `tags` | JSON | Array of content types (Classes, Spells, etc). |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

## Implementation Notes
- **Rules Versioning**: The `rules_version` is used to filter compendium content (e.g., showing only 2024 Spells).
- **Legacy `payload` column**: An unused JSON column from an earlier importer (`scripts/_archive/migrate.js`) survives on older rows. New rows do not populate it.
