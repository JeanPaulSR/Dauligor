# Table Structure: `lore_meta_characters`

Specialized metadata for Character and Deity articles. Links to `lore_articles.id`.

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `article_id` | TEXT (PK, FK) | Links to `lore_articles.id`. |
| `race` | TEXT | |
| `age` | TEXT | |
| `alignment` | TEXT | |
| `occupation` | TEXT | |
| `life_status` | TEXT | Alive, Dead, Undead, Unknown. |
| `gender` | TEXT | |
| `pronouns` | TEXT | |
| `birth_date` | TEXT | |
| `death_date` | TEXT | |

## Implementation Notes
- **One-to-One**: Every row in this table MUST have a corresponding row in `lore_articles`.
- **Searchability**: This structure allows us to find all "Elven NPCs who are currently Dead" using a simple JOIN.
