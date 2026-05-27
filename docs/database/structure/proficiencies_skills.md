# Table Structure: `skills`

The mechanical definitions for character skills (e.g., Athletics, Arcana).

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT | |
| `identifier` | TEXT UNIQUE NOT NULL | Slug (e.g., `athletics`); always lowercase. |
| `foundry_alias` | TEXT | 3-letter code (e.g., `ath`); always lowercase. |
| `ability_id` | TEXT (FK) | Links to `attributes.id` (e.g., the row for STR). |
| `description` | TEXT | Markdown content. |
| `source` | TEXT | e.g., PHB. |
| `page` | INTEGER | |
| `basic_rules` | BOOLEAN | Toggle for basic ruleset. |
| `updated_at` | DATETIME | |
