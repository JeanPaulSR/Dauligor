# Table Structure: `lore_meta_characters`

Specialized metadata for Character and Deity articles. Links to `lore_articles.id`.

## Layout Specs

| SQL Column | Type | Firestore Path | Note |
| :--- | :--- | :--- | :--- |
| `article_id` | TEXT (PK, FK) | - | Links to `lore_articles.id`. |
| `race` | TEXT | `metadata.race` | |
| `age` | TEXT | `metadata.age` | |
| `alignment` | TEXT | `metadata.alignment` | |
| `occupation` | TEXT | `metadata.occupation` | |
| `life_status` | TEXT | `metadata.lifeStatus`| Alive, Dead, Undead, Unknown. |
| `gender` | TEXT | `metadata.gender` | |
| `pronouns` | TEXT | `metadata.pronouns` | |
| `birth_date` | TEXT | `metadata.birthDate` | |
| `death_date` | TEXT | `metadata.deathDate` | |

## Implementation Notes
- **One-to-One**: Every row in this table MUST have a corresponding row in `lore_articles`.
- **Searchability**: This structure allows us to find all "Elven NPCs who are currently Dead" using a simple JOIN, which was impossible in Firestore without massive read costs.
