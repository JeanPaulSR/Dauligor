# Table Structure: `tools`

The mechanical definitions for tools and instruments (e.g., Thieves' Tools, Flute).

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT | |
| `identifier` | TEXT UNIQUE NOT NULL | Slug (e.g., `thieves-tools`). |
| `category_id` | TEXT (FK) | Links to `tool_categories.id`. |
| `foundry_alias` | TEXT | 3-letter code (e.g., `thv`). |
| `ability_id` | TEXT (FK) | Links to `attributes.id`. |
| `description` | TEXT | Markdown content. |
| `source` | TEXT | |
| `page` | INTEGER | |
| `basic_rules` | BOOLEAN | |
| `updated_at` | DATETIME | |
