# Table Structure: `tools`

The mechanical definitions for tools and instruments (e.g., Thieves' Tools, Flute).

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | |
| `identifier` | TEXT UNIQUE NOT NULL | `identifier` | Slug (e.g., `thieves-tools`). |
| `category_id` | TEXT (FK) | `categoryId` | Links to `tool_categories.id`. |
| `foundry_alias` | TEXT | `foundryAlias` | 3-letter code (e.g., `thv`). |
| `ability_id` | TEXT (FK) | `ability` | Links to `attributes.id`. |
| `description` | TEXT | `description` | Markdown content. |
| `source` | TEXT | `source` | |
| `page` | INTEGER | `page` | |
| `basic_rules` | BOOLEAN | `basicRules` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Migration Refinements

### 1. Category and Ability Linkage
- **Refinement**: Resolves Firestore string categories and ability keys to SQL Foreign Keys.
- **Refinement**: Handles legacy data where `categoryId` might be missing by falling back to a name-based lookup on `tool_categories`.
