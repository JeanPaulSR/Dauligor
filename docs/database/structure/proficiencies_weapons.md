# Table Structure: `weapons`

The mechanical templates for weapon proficiencies and base items.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | |
| `identifier` | TEXT UNIQUE NOT NULL | `identifier` | Slug (e.g., `longsword`). |
| `category_id` | TEXT (FK) | `categoryId` | Links to `weapon_categories.id`. |
| `weapon_type` | TEXT | `weaponType` | Melee or Ranged. |
| `ability_id` | TEXT (FK) | `ability` | Links to `attributes.id`. |
| `foundry_alias` | TEXT | `foundryAlias` | 3-letter code (e.g., `lng`). |
| `description` | TEXT | `description` | Markdown content. |
| `property_ids` | JSON | `propertyIds` | Array of `weapon_properties.id`. |
| `source` | TEXT | `source` | |
| `page` | INTEGER | `page` | |
| `basic_rules` | BOOLEAN | `basicRules` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Migration Refinements

### 1. Complex Property Mapping
- **Refinement**: Weapon properties are stored as a JSON array of IDs. The migration script ensures these IDs exist in the `weapon_properties` table.

### 2. Multi-Key Normalization
- **Refinement**: Simultaneously resolves `category_id`, `ability_id`, and `property_ids` during the migration pass.
