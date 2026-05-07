# Compendium — Scaling Columns & Progression Tables

Scaling tables drive any value on a class sheet that depends on level: cantrip damage, sneak attack dice, sorcery point counts, spell slot tables, prepared spells known, multiclass slot conversions.

## Tables (D1)

| Table | Role |
|---|---|
| `scaling_columns` | Per-class / per-subclass scaling table (cantrip damage, etc.) |
| `spellcasting_progressions` | Slot tables: `type` ∈ `standard`, `pact`, `known` |
| `multiclass_master_chart` | Standard multiclass-caster slot table |
| `spellcasting_types` | Reference list of spellcasting types and their formulas |

Schema: [../database/structure/spellcasting_progressions.md](../database/structure/spellcasting_progressions.md) and [../database/migration-details/phase-1-foundation.md](../database/migration-details/phase-1-foundation.md) (foundation), [../database/migration-details/phase-4-compendium.md](../database/migration-details/phase-4-compendium.md) (scaling columns).

## Scaling columns

A class scaling column is a 20-row table where row N is the value at level N.

### Schema
- `id` (PK)
- `name` — display name (e.g., "Cantrip Damage")
- `parent_id` — class or subclass ID
- `parent_type` — `class` or `subclass`
- `values` — JSON; either `{ "1": "1d8", "2": "1d8", ... }` or numeric

### Editor
- `/compendium/scaling/` — main scaling editor entry
- Per-class scaling columns appear inside the class editor under their own tab
- Subclass-specific columns live under the subclass editor

Source: [src/pages/compendium/scaling/ScalingEditor.tsx](../../src/pages/compendium/scaling/ScalingEditor.tsx).

### Identifier convention
The display name maps to an identifier (slug). Reference syntax `@scale.<class>.<identifier>` resolves at character level. See [../architecture/reference-syntax.md](../architecture/reference-syntax.md).

When two classes share a column name (e.g., "Cantrip Damage"), the identifier is namespaced to the class — `@scale.wizard.cantrip-damage` and `@scale.warlock.cantrip-damage` resolve independently.

## Spellcasting progressions

Three progression "shapes":

| Type | Stored values | Used for |
|---|---|---|
| `standard` | `{ "1": [2,0,0,...], "2": [3,0,0,...], ... }` (slots-by-level) | Full and half casters |
| `pact` | `{ "1": { slots: 1, level: 1 }, "2": ..., ... }` | Warlock pact magic |
| `known` | `{ "1": 4, "2": 5, ... }` | "Known spells" formulas (Sorcerer, Bard, Ranger known) |

### Editors
- [SpellcastingScalingEditor.tsx](../../src/pages/compendium/scaling/SpellcastingScalingEditor.tsx) — full caster slot tables
- [AlternativeSpellcastingScalingEditor.tsx](../../src/pages/compendium/scaling/AlternativeSpellcastingScalingEditor.tsx) — pact magic and other variants
- [SpellsKnownScalingEditor.tsx](../../src/pages/compendium/scaling/SpellsKnownScalingEditor.tsx) — known-spells progression
- [SpellcastingTypeEditor.tsx](../../src/pages/admin/SpellcastingTypeEditor.tsx) — global spellcasting types catalog
- [SpellcastingAdvancementManager.tsx](../../src/pages/admin/SpellcastingAdvancementManager.tsx) — assigns scalings to classes

### Class side
Classes set `spellcasting` (JSON column) referencing one of these progressions:
```json
{
  "progression": "<spellcastingScalingId>",
  "ability": "wis",
  "preparation": { "formula": "@abilities.wis.mod + @classes.druid.levels" },
  "type": "standard"
}
```

When `spellcasting` is unset (or explicitly disabled), the class exports `progression: "none"` rather than carrying active-looking defaults.

## Multiclass master chart

A single row in `multiclass_master_chart` stores the standard 5e multiclass slot conversion table — how to combine "spellcasting levels" from multiple classes into a single slot row.

### Contributing classes
Each class's `spellcasting` defines its contribution formula. Examples:
- Wizard 3 → contributes 3 caster levels (full caster).
- Cleric 5 → contributes 5 (full caster).
- Fighter 3 (Eldritch Knight) → contributes `ceil(3 / 3) = 1` (third-caster).
- Ranger 2 → contributes `floor(2 / 2) = 1` (half-caster).

The character sheet sums the contributions and looks up the row in `multiclass_master_chart`.

### Editor
[StandardMulticlassEditor.tsx](../../src/pages/admin/StandardMulticlassEditor.tsx).

## How the character builder consumes scaling

The character sheet's spellcasting computation pulls all active class+subclass spellcasting contributors using their `spellcasting.formula` plus the multiclass master chart. Sources:

- [src/lib/spellcasting.ts](../../src/lib/spellcasting.ts) — slot computation
- [src/pages/characters/CharacterBuilder.tsx](../../src/pages/characters/CharacterBuilder.tsx) — multi-class caster summing

For per-class scale values (cantrip damage etc.), the builder evaluates `@scale.<class>.<column>` references on display.

## Common tasks

### Add a new scaling column to a class
1. Open the class editor.
2. Go to the Scaling tab.
3. Add a new column with name and identifier.
4. Fill in level-by-level values.

### Change a class's spellcasting type
1. Open the class editor.
2. Go to the Spellcasting tab.
3. Toggle spellcasting on (or pick a different `progression`).
4. Save. The export pipeline rewrites the formula with the new progression on the next class export.

### Add a new spellcasting type
1. `/admin/spellcasting-types` → add a new row with name, identifier, foundry_name, formula.
2. Use it in any class's spellcasting block.

### Reference the new column in a feature formula
Add `@scale.<class>.<identifier>` anywhere a formula is accepted (feature damage, activity damage, etc.). See [../architecture/reference-syntax.md](../architecture/reference-syntax.md) for the supported scalars.

## Known issues / TODOs

### Unified spellcasting variant editor
**Status:** open · **Priority:** medium

The original editor layout had three separate pages for the same underlying data:
- `SpellcastingScalingEditor` — full-caster slot tables (`type='standard'`)
- `AlternativeSpellcastingScalingEditor` — pact magic (`type='pact'`) — **deleted as obsolete**
- `SpellsKnownScalingEditor` — known-spells progression (`type='known'`)

These all back onto a single `spellcasting_progressions` D1 table, discriminated by the `type` column. The right structure post-migration is:

1. **One unified editor** parametrised by progression type (pact / standard / known / future variants like point-based casters or half-casters with custom slot shapes).
2. The class editor's spellcasting block already references progressions by id; the type filter is the only thing that changes per variant.
3. `/compendium/pact-scaling/*` routes were removed when the obsolete editor was deleted; the link surfaces in [src/pages/admin/SpellcastingAdvancementManager.tsx](../../src/pages/admin/SpellcastingAdvancementManager.tsx) and [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx) need to either repoint at the unified editor or be removed.

**What this enables**: authoring custom spellcasting types (homebrew "Power Points" alternative, druidcraft variants, etc.) via the existing `spellcasting_types` catalog without needing a new editor surface per variant. Pact-magic and other non-standard casters get the same authoring affordances as full casters.

**Implementation pointers**:
- [src/pages/compendium/scaling/SpellcastingScalingEditor.tsx](../../src/pages/compendium/scaling/SpellcastingScalingEditor.tsx) — current standard-caster editor; the unifying pass goes here. Currently uses the wrong table name (`'spellcasting_scalings'`); fix is on punchlist B5.
- [src/pages/compendium/scaling/SpellsKnownScalingEditor.tsx](../../src/pages/compendium/scaling/SpellsKnownScalingEditor.tsx) — could fold in or stay separate (the data shape is genuinely different).
- [src/pages/admin/SpellcastingAdvancementManager.tsx](../../src/pages/admin/SpellcastingAdvancementManager.tsx) — admin panel listing all progressions; needs the link cleanup and a `fetchCollection`-based reload pattern (not `onSnapshot`).

## Migration note

`spellcastingScalings`, `pactMagicScalings`, and `spellsKnownScalings` are all consolidated under the single `spellcasting_progressions` D1 table. The `D1_TABLE_MAP` in [src/lib/d1.ts](../../src/lib/d1.ts) routes all three legacy collection names to it.

`SpellcastingAdvancementManager.tsx` still uses `onSnapshot`/`deleteDoc` on the legacy Firestore collections — see [../database/README.md](../database/README.md) for the punchlist.

## Related docs

- [compendium-classes.md](compendium-classes.md) — how scaling columns hang off classes
- [compendium-spells.md](compendium-spells.md) — spell side
- [character-builder.md](character-builder.md) — sheet-side spellcasting computation
- [../architecture/reference-syntax.md](../architecture/reference-syntax.md) — `@scale.*` syntax
- [foundry-export.md](foundry-export.md) — `ScaleValue` advancement export
- [../database/structure/spellcasting_progressions.md](../database/structure/spellcasting_progressions.md)
