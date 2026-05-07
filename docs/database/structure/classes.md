# Table Structure: `classes`

This table is the primary relational storage for character classes, replacing the Firestore `classes` collection.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `source_id` | TEXT (FK) | `sourceId` | Links to `sources.id`. |
| `name` | TEXT | `name` | |
| `identifier` | TEXT (INDEX) | `identifier` | Unique system slug (e.g., `fighter`). |
| `hit_die` | INTEGER | `hitDie` | e.g., 10. |
| `category` | TEXT | `category` | core, alternate, new. |
| `subclass_title`| TEXT | `subclassTitle` | e.g., Martial Archetype. |
| `subclass_levels`| JSON | `subclassFeatureLevels`| Array of level numbers. |
| `asi_levels` | JSON | `asiLevels` | Array of level numbers. |
| `primary_ability`| JSON | `primaryAbility` | Array of strings. |
| `primary_choice` | JSON | `primaryAbilityChoice` | Array of strings. |
| `proficiencies` | JSON | `proficiencies` | Complex nested object. |
| `multi_profs` | JSON | `multiclassProficiencies`| Complex nested object. |
| `spellcasting` | JSON | `spellcasting` | Configuration object. |
| `advancements` | JSON | `advancements` | Base progression list. |
| `excluded_ids` | JSON | `excludedOptionIds` | UI filter config. |
| `image_display` | JSON | `imageDisplay` | Focal points/Scale. |
| `card_display` | JSON | `cardDisplay` | Focal points/Scale. |
| `preview_display`| JSON | `previewDisplay` | Focal points/Scale. |
| `tag_ids` | JSON | `tagIds` | Array of tag strings. |
| `created_at` | DATETIME | `createdAt` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Implementation Notes
- **JSON Columns**: We use JSON for fields like `advancements` because they are deeply nested arrays of rules that change frequently. This avoids creating dozens of junction tables for a single entity while maintaining schema flexibility.
- **Foreign Keys**: `source_id` is strictly enforced to ensure every class belongs to a valid sourcebook.
