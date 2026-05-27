# Table Structure: `classes`

The primary relational storage for character classes.

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `source_id` | TEXT (FK) | Links to `sources.id`. |
| `name` | TEXT | |
| `identifier` | TEXT (INDEX) | Unique system slug (e.g., `fighter`). |
| `hit_die` | INTEGER | e.g., 10. |
| `category` | TEXT | core, alternate, new. |
| `subclass_title`| TEXT | e.g., Martial Archetype. |
| `subclass_levels`| JSON | Array of level numbers. |
| `asi_levels` | JSON | Array of level numbers. |
| `primary_ability`| JSON | Array of strings. |
| `primary_choice` | JSON | Array of strings. |
| `proficiencies` | JSON | Complex nested object. |
| `multi_profs` | JSON | Complex nested object. |
| `spellcasting` | JSON | Configuration object. |
| `advancements` | JSON | Base progression list. |
| `excluded_ids` | JSON | UI filter config. |
| `image_display` | JSON | Focal points/Scale. |
| `card_display` | JSON | Focal points/Scale. |
| `preview_display`| JSON | Focal points/Scale. |
| `tag_ids` | JSON | Array of tag strings. |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

## Implementation Notes
- **JSON Columns**: We use JSON for fields like `advancements` because they are deeply nested arrays of rules that change frequently. This avoids creating dozens of junction tables for a single entity while maintaining schema flexibility.
- **Foreign Keys**: `source_id` is strictly enforced to ensure every class belongs to a valid sourcebook.
