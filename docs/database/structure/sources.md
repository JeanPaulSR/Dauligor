# Table Structure: `sources`

The foundational registry for all content origins (Books, Homebrew, Documents).

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | Full title of the source. |
| `slug` | TEXT (INDEX) | `slug` | URL-safe identifier. |
| `abbreviation` | TEXT | `abbreviation` | Short code (e.g., PHB, VSS). |
| `rules_version` | TEXT | `rules` | 2014, 2024, or universal. |
| `status` | TEXT | `status` | ready, draft, retired. |
| `description` | TEXT | `description` | Markdown content. |
| `image_url` | TEXT | `imageUrl` | R2 URL for the cover. |
| `external_url` | TEXT | `url` | Link to external page/store. |
| `tags` | JSON | `tags` | Array of content types (Classes, Spells, etc). |
| `created_at` | DATETIME | `createdAt` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Implementation Notes
- **Payload Support**: The `migrate.js` script currently stores the entire Firestore document as a `payload` JSON field for safety. This is a "Total Exit" safety net.
- **Rules Versioning**: The `rules_version` is used to filter compendium content (e.g., showing only 2024 Spells).

---

## Migration Refinements (The "Fresh Start")

### 1. Column Renaming
- **Refinement**: `rules` is renamed to `rules_version` for clarity.
- **Refinement**: `url` is renamed to `external_url` to avoid confusion with internal routes.

### 2. JSON Serialization
- **Refinement**: The `tags` array is serialized to a JSON string in D1.

### 3. Image URL Resolution
- **Refinement**: Migration should verify if the `imageUrl` is a legacy Firebase path and resolve it to a permanent Cloudflare R2 public URL where possible.
