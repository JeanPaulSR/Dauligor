# Proficiency Resolution — `character_proficiencies` → item proficiency

How the app decides whether a character is proficient with a specific item (weapon /
armor / tool) on their sheet. The resolver walks a hierarchical match — most-specific
to broadest — against the polymorphic `character_proficiencies` table, returning the
highest-priority match it finds.

Canonical implementation: [`src/lib/proficiencyResolver.ts`](../../src/lib/proficiencyResolver.ts).
Schema baseline: migration `worker/migrations/20260526-1700_items_completeness_and_proficiency_source.sql`
(commit `cd3257a`).

---

## The polymorphic table

`character_proficiencies` is a single table that grants any proficiency
(weapon / weapon category / weapon property / armor / armor category / tool /
tool category / skill / saving throw / language / damage type / condition) to a
character. The discriminator column `entity_type` says **what shape** the row's
`entity_id` points at:

| `entity_type` value | `entity_id` points at | Notes |
|---|---|---|
| `weapon` | `weapons.id` | A specific weapon (greatsword, dagger) |
| `weapon_category` | `weapon_categories.id` | "Simple Weapons" / "Martial Weapons" / "Exotic Weapons" / etc. |
| `weapon_property` | `weapon_properties.id` | Rare: "proficient with all finesse weapons" |
| `armor` | `armor.id` | A specific armor |
| `armor_category` | `armor_categories.id` | "Light Armor" / "Medium Armor" / "Heavy Armor" / "Shields" |
| `tool` | `tools.id` | A specific tool |
| `tool_category` | `tool_categories.id` | "Artisan's Tools" / "Gaming Set" / "Musical Instrument" |
| `skill` | `skills.id` | Per-skill grants |
| `save` / `attribute` | `attributes.id` | Saving throw grants |
| `language` | `languages.id` | |
| (others) | — | Open string so callers can extend |

`proficiency_level` is a REAL on the row:

- **0** — not proficient
- **0.5** — half (Jack of All Trades style)
- **1** — full proficient
- **2** — expertise

The character sheet multiplies the character's proficiency bonus by this value when
scoring attack rolls / ability checks against the item.

---

## The resolver walk

For an item (with its joined `base_*_id` proficiency-table row), the resolver tries
each match level in order. **First match wins.** Each level is scored as the *highest*
`proficiency_level` row matching its predicate — so an expertise row beats a full row
beats a half row at the same level, but a category-level grant never overrides a
specific-item grant.

### Weapons

1. **SPECIFIC** — `entity_type = 'weapon' AND entity_id = item.base_weapon_id`
   The character is proficient with this *exact* weapon. Examples: a class that
   grants "Greatsword" specifically (Hexblade), a feat that says "you gain
   proficiency with a single weapon of your choice".

2. **CATEGORY** — `entity_type = 'weapon_category' AND entity_id = base_weapon.category_id`,
   honoring `weapon_type_filter`:
   - `weapon_type_filter = NULL` — grants both Melee + Ranged (whole-category grant).
   - `weapon_type_filter = 'Melee'` — only matches weapons whose
     `weapons.weapon_type = 'Melee'`. Same for `'Ranged'`.

   This is what differentiates **"Simple Weapons"** (whole category) from
   **"Simple Melee Weapons"** (restricted half). dnd5e 2024 splits Simple + Martial
   into Melee + Ranged halves — `weapon_type_filter` is the column that lets the
   schema express the split without doubling the row count.

3. **PROPERTY** — `entity_type = 'weapon_property' AND entity_id IN base_weapon.property_ids`
   Uncommon path. A class or feat might grant "proficient with all finesse weapons"
   via this mechanism.

### Armor

1. **SPECIFIC** — `entity_type = 'armor' AND entity_id = item.base_armor_id`
2. **CATEGORY** — `entity_type = 'armor_category' AND entity_id = base_armor.category_id`
   Armor has no Melee/Ranged dimension — single category match.

### Tools

1. **SPECIFIC** — `entity_type = 'tool' AND entity_id = item.base_tool_id`
2. **CATEGORY** — `entity_type = 'tool_category' AND entity_id = base_tool.category_id`

### Other items

Items without a base proficiency association (loot, consumable, generic
equipment-non-armor, container) don't have a proficiency concept — the resolver
returns `{ proficient: false }` and the sheet suppresses the badge entirely.

---

## Source attribution

The `character_proficiencies` row also carries:

- `source_entity_type` — string discriminator: `'class'` / `'subclass'` / `'feat'` /
  `'race'` / `'background'` / etc.
- `source_entity_id` — primary key of the source entity in its own table.

This is what powers "Granted by Fighter L1" tooltips on the character sheet: the
resolver returns the source pair as `match.source`, and the sheet looks the entity
up in its respective table for display.

When a class is re-imported (e.g. the user fixes a class definition and re-applies
to an existing character), the importer does:

```sql
DELETE FROM character_proficiencies
WHERE character_id = ?
  AND source_entity_type = 'class'
  AND source_entity_id = ?;
-- then re-insert the fresh class-granted proficiencies
```

This guarantees that obsolete grants don't accumulate on character re-imports.

---

## Resolver API

```ts
import { resolveItemProficiency, resolveItemProficiencies } from '../lib/proficiencyResolver';

// Single-item resolution
const match = resolveItemProficiency(item, profs);
// match: {
//   proficient: boolean,
//   proficiencyLevel: 0 | 0.5 | 1 | 2,
//   matchedVia: 'specific' | 'category' | 'property' | null,
//   matchedEntityId: string | null,
//   source: { type: string, id: string } | null,
// }

// Bulk resolution — same proficiency set, many items
const matches = resolveItemProficiencies(items, profs);
// matches: Record<item.id, ProficiencyMatch>
```

**Caller contract:**

- The `proficiencies` array must already be scoped to the relevant character. The
  resolver does NOT filter by `character_id` — that's the consumer's job.
- The `item` must carry its joined `baseWeapon` / `baseArmor` / `baseTool` row (just
  `id`, `category_id`, `weapon_type`, `property_ids` for weapons). The caller is
  responsible for the join — keeping resolver pure means it's testable without a DB
  + works the same in browser and worker contexts.

---

## Why pure read-side

The resolver lives in `src/lib/proficiencyResolver.ts` (not `api/_lib/...`) and is
intentionally side-effect free. The character sheet uses it directly; the future
public ItemList page uses it to surface a `[Proficient]` chip on rows; the module
could theoretically also consume it for in-Foundry resolution (though dnd5e's own
proficiency model handles that side today).

The fetch / join step lives in the consumer:
- Character sheet: joins `character_inventory` × `items` × `weapons|armor|tools` ×
  `character_proficiencies` server-side.
- ItemList page: when added, fetches the current character's proficiencies once and
  resolves every row client-side as it renders.

That separation also makes it trivial to add a CLI / admin debug tool — pass any
synthetic `proficiencies` array and the resolver gives back the match.

---

## Worked example

A Fighter character has these `character_proficiencies` rows:

```text
[1] entity_type=weapon_category  entity_id=<simple>   weapon_type_filter=NULL    proficiency_level=1  source=class:fighter
[2] entity_type=weapon_category  entity_id=<martial>  weapon_type_filter=NULL    proficiency_level=1  source=class:fighter
[3] entity_type=weapon           entity_id=<longbow>  weapon_type_filter=NULL    proficiency_level=2  source=feat:bow-master
```

Resolving a **Longbow** item (whose `base_weapon` is the Longbow proficiency row):

1. SPECIFIC — row [3] matches (`entity_id=<longbow>`) with level 2 (expertise). ✓
   Return `{ proficient: true, proficiencyLevel: 2, matchedVia: 'specific',
   source: { type: 'feat', id: 'bow-master' } }`.

Resolving a **Greatsword** item (base_weapon → Greatsword → category=martial,
weapon_type=Melee):

1. SPECIFIC — no row matches. Skip.
2. CATEGORY — row [2] matches (`entity_id=<martial>`, `weapon_type_filter=NULL`).
   Level 1. ✓
   Return `{ proficient: true, proficiencyLevel: 1, matchedVia: 'category',
   source: { type: 'class', id: 'fighter' } }`.

Resolving a **Shortbow** item (base_weapon → Shortbow → category=simple,
weapon_type=Ranged):

1. SPECIFIC — no row matches.
2. CATEGORY — row [1] matches (`entity_id=<simple>`, filter NULL — grants both
   halves). Level 1.
   Return full match with source `class:fighter`.

Now imagine a homebrew Druid that grants **only Simple Melee Weapons**:

```text
[4] entity_type=weapon_category  entity_id=<simple>   weapon_type_filter='Melee'  proficiency_level=1  source=class:druid
```

Resolving a **Quarterstaff** (simple + melee) for that Druid → matches row [4] via
CATEGORY at level 1. Source: `class:druid`. Resolving a **Sling** (simple + ranged)
for that same Druid → row [4]'s filter is `'Melee'` ≠ `'Ranged'`, so NO match. The
character is not proficient with the sling.

---

## Related docs

- [`compendium-items.md`](../features/compendium-items.md) — how items reference the
  proficiency tables via `base_weapon_id` / `base_armor_id` / `base_tool_id`
- [`proficiencies_weapons.md`](../database/structure/proficiencies_weapons.md) — the
  weapons proficiency-definition table
- [`character_proficiencies.md`](../database/structure/character_proficiencies.md)
  — full schema for the polymorphic grants table
- Module side: [`class-import-contract.md`](../../module/dauligor-pairing/docs/class-import-contract.md)
  describes how class trait advancements declare these grants on export
