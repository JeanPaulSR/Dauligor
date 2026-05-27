# Compendium — Scaling Columns & Progression Tables

Scaling tables drive any value on a class sheet that depends on level: cantrip damage, sneak attack dice, sorcery point counts, spell slot tables, prepared spells known, multiclass slot conversions.

## Tables (D1)

| Table | Role |
|---|---|
| `scaling_columns` | Per-owner scaling table (cantrip damage, channel-divinity charges, etc.) — polymorphic via `(parent_id, parent_type)`; owners include class, subclass, feat, race, background, item |
| `spellcasting_progressions` | Slot tables: `type` ∈ `standard`, `pact`, `known` |
| `multiclass_master_chart` | Standard multiclass-caster slot table |
| `spellcasting_types` | Reference list of spellcasting types and their formulas |

Schema: [../database/structure/spellcasting_progressions.md](../database/structure/spellcasting_progressions.md) and [../_archive/migration-details/phase-1-foundation.md](../_archive/migration-details/phase-1-foundation.md) (foundation), [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md) (scaling columns).

## Scaling columns

A scaling column is a 20-row table where row N is the value at level N. Originally a class-only concept; as of 2026-05-27 the same table also backs feat / race / background / item scaling so non-class owners can carry their own per-level progressions (e.g. Amulet of the Devout adding +1 to Channel Divinity charges).

### Schema
- `id` (PK)
- `name` — display name (e.g., "Cantrip Damage")
- `parent_id` — id of the owning entity
- `parent_type` — one of `class`, `subclass`, `feat`, `race`, `background`, `item`
- `type` — `number` | `dice` | `string` | `cr` | `distance`
- `identifier` — stable slug (the `<identifier>` half of `@scale.<owner>.<identifier>`)
- `distance_units` — units string for `type='distance'`; ignored otherwise
- `values` — JSON; either `{ "1": "1d8", "2": "1d8", ... }` or numeric

The table is already polymorphic via `parent_type` (originally added in `0009_scalings.sql`). Widening to support feat / race / background / item required **zero schema migration** — only editor wiring + read-path scoping. See `docs/roadmap.md#scaling-columns-for-non-class-owners--follow-ups` for what's still outstanding.

### Editor

- **Full matrix editor** — `/compendium/scaling/edit/<id>` (or `/compendium/scaling/new?parentId=<id>&parentType=<type>` for a new column). Single page; takes parent context from the URL. Source: [src/pages/compendium/scaling/ScalingEditor.tsx](../../src/pages/compendium/scaling/ScalingEditor.tsx).
- **Per-owner sidebar / sub-tab** — every editor that can own columns hosts a `<ScalingColumnsPanel>` for inline rename + breakpoint preview + a link out to the full matrix editor:
  - Class editor — right sidebar ("Class Columns") — [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx)
  - Feats editor — Advancement sub-tab, right column at xl+ ("Feat Columns" / "Race Columns" / "Background Columns" depending on `feat_type`) — [src/pages/compendium/FeatsEditor.tsx](../../src/pages/compendium/FeatsEditor.tsx). **Class features (`feat_type='class'` / `'subclass'`) are excluded** — they inherit columns from the parent class.
  - Items editor — Scaling sub-tab ("Item Columns") — [src/pages/compendium/ItemsEditor.tsx](../../src/pages/compendium/ItemsEditor.tsx)

The panel itself is shared: [src/components/compendium/ScalingColumnsPanel.tsx](../../src/components/compendium/ScalingColumnsPanel.tsx).

#### URL-backed editingId

Both FeatsEditor and ItemsEditor track the current selection via `?editingId=<uuid>` so navigating to the full matrix editor and back (or refreshing the page mid-edit) preserves the user's place. The pattern is in [src/components/compendium/useEditorFormSession.ts](../../src/components/compendium/useEditorFormSession.ts) sibling logic + the per-editor effects; the FeatList public browser uses an analogous `#identifier_abbrev` hash for user-shareable links.

### Identifier convention
The column's `identifier` field (slug) combines with the owning entity's identifier to form a Foundry resolver path: `@scale.<owner-identifier>.<column-identifier>`. The `<owner-identifier>` half comes from the owning item's `system.identifier` at runtime — dnd5e resolves the namespace itself, so the app doesn't need to inject the prefix on the export side. See [../architecture/reference-syntax.md](../architecture/reference-syntax.md).

Examples that resolve independently because their owners differ:
- `@scale.wizard.cantrip-damage` (class-owned)
- `@scale.warlock.cantrip-damage` (class-owned)
- `@scale.amulet-of-the-devout.channel-divinity-bonus` (item-owned)
- `@scale.bloodlust.rage-die` (feat-owned)

### Foundry export round-trip

Class exports have always synthesized `ScaleValue` advancements from `scaling_columns`. As of `10fa13c`, the same path runs for feats — `_featExport.ts` loads scaling_columns scoped to the feat and runs each ScaleValue advancement through the shared `normalizeScaleValueAdvancement` helper (extracted from `_classExport.ts`). The exported feat carries a fully-populated `system.advancement` map; Foundry's dnd5e system resolves `@scale.<feat-identifier>.<column>` natively at play time. No module-side changes were required.

Items, races, and backgrounds **don't have a server-built export endpoint today** — they ship as Foundry items via the module's folder-export path, which doesn't currently inject scaling. Wiring is tracked in [the roadmap](../roadmap.md#scaling-columns-for-non-class-owners--follow-ups).

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
2. Use the **Class Columns** sidebar on the right (`<ScalingColumnsPanel>`).
3. Click "+ Add" → name the column → fill in level-by-level values in the full matrix editor.

### Add a new scaling column to a feat / race / background
1. Open the feat (or race, or background) editor at `/compendium/feats/manage` (or the scoped wrappers).
2. Save the row at least once so it has a stable id (the placeholder card in the Advancement tab nudges you to do this).
3. Go to the **Advancement** sub-tab — the "Feat Columns" / "Race Columns" / "Background Columns" panel is on the right at xl+ widths, stacked below at narrower viewports.
4. Click "+ Add" → name the column → fill in level-by-level values.
5. Author a `ScaleValue` advancement on the feat that references the new column (so it ships to Foundry). Other advancement types (Trait, ItemChoice, ItemGrant) can also reference scaling columns once authored — pickers come from the owner-scoped `availableScalingColumns` list.

### Add a new scaling column to an item
Same as above but in `/items/manage` — the **Scaling** sub-tab on the item editor hosts the panel. Use case: Amulet of the Devout (+1 Channel Divinity charge), Staff of Power (charge-scaling damage), etc. Note that items don't currently round-trip scaling to Foundry — see the [roadmap entry](../roadmap.md#scaling-columns-for-non-class-owners--follow-ups).

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

## Table mapping

`spellcastingScalings`, `pactMagicScalings`, and `spellsKnownScalings` are all consolidated under the single `spellcasting_progressions` D1 table. The `D1_TABLE_MAP` in [src/lib/d1Tables.ts](../../src/lib/d1Tables.ts) routes all three legacy collection names to it; rows distinguish themselves by a `type` column (`standard`, `pact`, `known`).

## Related docs

- [compendium-classes.md](compendium-classes.md) — how scaling columns hang off classes
- [compendium-spells.md](compendium-spells.md) — spell side
- [character-builder.md](character-builder.md) — sheet-side spellcasting computation
- [../architecture/reference-syntax.md](../architecture/reference-syntax.md) — `@scale.*` syntax
- [foundry-export.md](foundry-export.md) — `ScaleValue` advancement export
- [../database/structure/spellcasting_progressions.md](../database/structure/spellcasting_progressions.md)
