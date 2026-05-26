# Table Structure: `character_proficiencies`

Polymorphic grants table — one row per (character, granted proficiency, source).
Holds every proficiency a character has acquired from a class / subclass / feat /
race / background / etc. The character sheet renders proficiency badges by
resolving items against this table; see
[proficiency-resolution.md](../../architecture/proficiency-resolution.md) for the
walker logic.

Schema baseline: migrations `0001_phase1_foundation.sql` (initial table) and
`20260526-1700_items_completeness_and_proficiency_source.sql` (added
`weapon_type_filter` + polymorphic source attribution).

## Layout Specs

| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `character_id` | TEXT (FK) | → `characters.id` |
| `entity_type` | TEXT NOT NULL | Polymorphic discriminator (see below) |
| `entity_id` | TEXT NOT NULL | FK into the table the discriminator points at |
| `proficiency_level` | REAL NOT NULL | `0.5` (half) / `1` (full) / `2` (expertise) |
| `weapon_type_filter` | TEXT | NULL / `'Melee'` / `'Ranged'`. Only meaningful when `entity_type='weapon_category'` |
| `source_entity_type` | TEXT | What kind of entity granted this — `'class'` / `'subclass'` / `'feat'` / `'race'` / `'background'` / etc. |
| `source_entity_id` | TEXT | Primary key of the source entity in its own table |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

## `entity_type` discriminator

The discriminator tells the resolver which table `entity_id` points at:

| Value | `entity_id` points at | Example use |
|---|---|---|
| `weapon` | `weapons.id` | Class grants proficiency with Greatsword specifically |
| `weapon_category` | `weapon_categories.id` | Class grants Simple Weapons; honors `weapon_type_filter` |
| `weapon_property` | `weapon_properties.id` | "Proficient with all finesse weapons" |
| `armor` | `armor.id` | Class grants Plate specifically |
| `armor_category` | `armor_categories.id` | Class grants Heavy Armor |
| `tool` | `tools.id` | Class grants Thieves' Tools |
| `tool_category` | `tool_categories.id` | Class grants Artisan's Tools |
| `skill` | `skills.id` | |
| `save` / `attribute` | `attributes.id` | Saving throw |
| `language` | `languages.id` | |
| (open string) | — | Resolver only matches the listed types; passthrough rows are ignored |

The resolver in `src/lib/proficiencyResolver.ts` only matches against the
weapon / armor / tool discriminators (its scope is item proficiency). The skill /
save / language rows are read by the character-sheet skill list, saves block, and
language list directly.

## `weapon_type_filter` (20260526-1700)

Restricts a `weapon_category` grant to one half of dnd5e's 2024 Melee/Ranged split.
Only checked when `entity_type='weapon_category'`.

| Value | Meaning |
|---|---|
| NULL | Whole category — grants both Melee + Ranged weapons in that category |
| `'Melee'` | Only Melee weapons in the category |
| `'Ranged'` | Only Ranged weapons in the category |

This is what differentiates **"Simple Weapons"** (NULL — both halves) from
**"Simple Melee Weapons"** (`'Melee'` only). The resolver compares the filter
against the weapon's `weapons.weapon_type` field; mismatches skip the row.

## Polymorphic source attribution (20260526-1700)

`source_entity_type` + `source_entity_id` answer "who granted this proficiency".
The character sheet surfaces them as tooltips on the proficiency badge:

> *"Granted by Fighter L1"* / *"Granted by Crossbow Expert (feat)"*

Common source types:

| `source_entity_type` | Points at | Notes |
|---|---|---|
| `class` | `classes.id` | Class-level proficiencies (saves, armor, weapons block) |
| `subclass` | `subclasses.id` | Subclass-only grants (e.g. Path of the Battlerager's Spiked Armor) |
| `feat` | `feats.id` | Feat-granted proficiencies |
| `race` | `feats.id` (race row) | Racial proficiencies — races live in `feats` with `feat_type='race'` |
| `background` | `feats.id` (background row) | Same for backgrounds |
| `manual` | — | Admin-applied via the character editor; no source entity |
| (open string) | — | Resolver passes through |

## Class re-import flow

When a class is re-imported on a character (e.g. the user fixes a class definition
and re-applies), the importer first wipes the prior class-granted rows:

```sql
DELETE FROM character_proficiencies
WHERE character_id = ?
  AND source_entity_type = 'class'
  AND source_entity_id = ?;
-- then re-INSERT the fresh class-granted rows
```

This guarantees that obsolete grants from a prior version of the class don't
accumulate on re-imports. Subclass / feat / race / background re-imports use the
same pattern with their respective discriminators.

## Indexes

- `idx_character_proficiencies_character` ON (`character_id`)
- `idx_character_proficiencies_entity` ON (`entity_type`, `entity_id`)
- `idx_character_proficiencies_source` ON (`source_entity_type`, `source_entity_id`)

## Related docs

- [proficiency-resolution.md](../../architecture/proficiency-resolution.md) — the
  hierarchical walk that turns these rows into a `[Proficient]` badge
- [proficiencies_weapons.md](proficiencies_weapons.md) /
  [proficiencies_armor.md](proficiencies_armor.md) /
  [proficiencies_tools.md](proficiencies_tools.md) — the proficiency definition
  tables `entity_id` points at
- [items.md](items.md) — `base_weapon_id` / `base_armor_id` / `base_tool_id` on
  items is how the resolver finds the right proficiency rows to test against
