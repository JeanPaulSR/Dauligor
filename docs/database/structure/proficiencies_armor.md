# Table Structure: `armor`

The mechanical templates for armor proficiencies and base items.

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT | |
| `identifier` | TEXT UNIQUE NOT NULL | Slug (e.g., `plate-armor`). |
| `category_id` | TEXT (FK) | Links to `armor_categories.id`. |
| `ability_id` | TEXT (FK) | Links to `attributes.id` — typically STR or DEX for armor requirements/scaling. |
| `foundry_alias` | TEXT | 3-letter code (e.g., `plt`). |
| `description` | TEXT | Markdown content. |
| `source` | TEXT | |
| `page` | INTEGER | |
| `basic_rules` | BOOLEAN | |
| `updated_at` | DATETIME | |
