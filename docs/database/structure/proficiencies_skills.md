# Table Structure: `skills`

The mechanical definitions for character skills (e.g., Athletics, Arcana).

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | |
| `identifier` | TEXT UNIQUE NOT NULL | `identifier` | Slug (e.g., `athletics`). |
| `foundry_alias` | TEXT | `foundryAlias` | 3-letter code (e.g., `ath`). |
| `ability_id` | TEXT (FK) | `ability` | Links to `attributes.id`. |
| `description` | TEXT | `description` | Markdown content. |
| `source` | TEXT | `source` | e.g., PHB. |
| `page` | INTEGER | `page` | |
| `basic_rules` | BOOLEAN | `basicRules` | Toggle for basic ruleset. |
| `updated_at` | DATETIME | `updatedAt` | |

## Migration Refinements

### 1. Ability Linkage
- **Refinement**: The Firestore `ability` string (e.g., "STR") is resolved to the corresponding UUID in the `attributes` table during migration.

### 2. Standardization
- **Refinement**: All `identifier` slugs are normalized to lowercase.
- **Refinement**: `foundry_alias` is normalized to lowercase and trimmed to 3 characters.
