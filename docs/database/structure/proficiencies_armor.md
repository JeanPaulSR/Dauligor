# Table Structure: `armor`

The mechanical templates for armor proficiencies and base items.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | |
| `identifier` | TEXT UNIQUE NOT NULL | `identifier` | Slug (e.g., `plate-armor`). |
| `category_id` | TEXT (FK) | `categoryId` | Links to `armor_categories.id`. |
| `ability_id` | TEXT (FK) | `ability` | Links to `attributes.id`. |
| `foundry_alias` | TEXT | `foundryAlias` | 3-letter code (e.g., `plt`). |
| `description` | TEXT | `description` | Markdown content. |
| `source` | TEXT | `source` | |
| `page` | INTEGER | `page` | |
| `basic_rules` | BOOLEAN | `basicRules` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Migration Refinements

### 1. Attribute Resolution
- **Refinement**: Ensures the `ability` (usually STR or DEX for armor requirements/scaling) is correctly linked to the `attributes` table.
