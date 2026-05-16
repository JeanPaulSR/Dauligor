# Character Builder

Multi-step character creation with Foundry-VTT-compatible export. The builder is also the editor for an existing character — there is no separate "view-only" character page.

## Page

| Route | File |
|---|---|
| `/characters/:id` | [src/pages/characters/CharacterBuilder.tsx](../../src/pages/characters/CharacterBuilder.tsx) |

> **Migration status:** all read/write paths on this page are on D1. The historical migration note (this was the largest item on the now-archived Firestore-cut punchlist) is preserved for context only. The `~30` D1 calls in `CharacterBuilder.tsx` were migrated cluster-by-cluster, with the data-loading effect later split into a separate `loadTick` dependents effect to avoid full-page reloads on individual saves.

## Data layer

| Table | Role |
|---|---|
| `characters` | Identity, vitals, stats JSON, info JSON, senses JSON, current/temp/max-HP overrides |
| `character_progression` | One row per class level entry (class_id, subclass_id, level_index, hp_roll) |
| `character_selections` | Advancement choices (advancement_id, level, selected_ids JSON, source_scope) |
| `character_inventory` | Owned items |
| `character_spells` | Prepared / known spells |
| `character_proficiencies` | Skill / save / armour / weapon / tool / language proficiencies |

Schema: [../database/structure/characters.md](../database/structure/characters.md), [../_archive/migration-details/phase-5-characters.md](../_archive/migration-details/phase-5-characters.md).

The character document also holds two derived blobs:
- `progressionState` — the canonical progression-owned state (class packages, owned features, owned items, owned spells)
- `info_json`, `stats_json`, `senses_json`, `metadata_json` — nested structures kept as JSON for now

Helper modules: [src/lib/characterLogic.ts](../../src/lib/characterLogic.ts), [src/lib/characterShared.ts](../../src/lib/characterShared.ts), [src/lib/classProgression.ts](../../src/lib/classProgression.ts), [src/lib/advancementState.ts](../../src/lib/advancementState.ts), [src/lib/characterExport.ts](../../src/lib/characterExport.ts), [src/lib/spellcasting.ts](../../src/lib/spellcasting.ts).

## Builder steps

The builder uses tabs rather than a wizard:

1. **Identity** — name, image, race, background, info (traits/ideals/bonds/flaws)
2. **Class progression** — pick classes per level (multiclass), pick subclass at the trigger level, resolve advancement choices
3. **Character sheet** — view derived state (Character Info / Features / Spells sub-tabs)

Class progression is the heaviest step; the sheet is mostly a derived view.

## `progressionState` — the canonical model

Stored on the character document as one big JSON blob, refreshed on every save. The shape:

```ts
progressionState: {
  classPackages: [
    {
      classId, classIdentifier,
      subclassId?, subclassIdentifier?,
      level,
      introMode: 'primary' | 'multiclass',
      advancementSelections: { [scopedKey]: selectedIds[] },
      grantedFeatureRefs: string[],
      grantedItemRefs: string[],
      spellcasting: { ... },     // reserved
      hitPointHistory: [...],    // reserved
      scaleState: { ... },       // reserved
    },
    ...
  ],
  ownedFeatures: [               // canonical granted features by class+level+source
    { sourceClassId, sourceSubclassId?, level, featureId, name, ... },
    ...
  ],
  ownedItems: [                  // granted items + selected option items
    { sourceClassId, sourceSubclassId?, level, itemId, kind, name, ... },
    ...
  ],
  ownedSpells: [...]             // reserved — not yet canonical
}
```

The detailed target model is in [_archive/character-builder-progression-owned-state-outline.md](../_archive/character-builder-progression-owned-state-outline.md).

### Why this shape
- **Single source of truth** for granted ownership. Sheet, exporter, and class-step all read from it.
- **Per-class scope** for advancement selections. A scoped key like `cleric.divine-domain.level-1` distinguishes selections cleanly from a multiclass scenario where two classes might have similarly-named advancements.
- **Survives reload** with explicit names. Progression summaries no longer fall back to raw IDs after a refresh.

### Legacy `_id-level` keys
Older characters carry `selectedOptions` keys in the form `<advancementId>-<level>`. These are read-only — the builder warns the user to re-select advancement choices when it encounters them. New writes always use the scoped form.

## Class progression step

For each class entry the user has, the step shows:
- Class header (name, level, intro mode)
- Subclass picker (when triggered)
- Per-level rows: features granted that level (from the shared progression summary), advancement cards (HP, ItemChoice, ItemGrant, Subclass, ASI, Trait, ScaleValue, Size)

Advancement cards are rendered separately from the feature list (no fuzzy attachment by name). This avoids "starting equipment" / "skill selection" cards appearing under unrelated features.

### Resolving advancement choices
- **ItemGrant** with explicit items: auto-applied.
- **ItemChoice** with a pool: user picks from the pool.
- **AbilityScoreImprovement**: user picks ability points or a feat.
- **Trait**: user picks proficiencies (with mode: Proficient / Expertise / Half).
- **Subclass**: user picks subclass. The pick writes to all matching `progression` rows for that class (so multiclass entries within the same class share a subclass).

### Multiclassing
- The class step distinguishes **primary level 1** from **multiclass level 1** (`introMode`).
- Multiclass entries skip the base starting-equipment `ItemChoice` row.
- `class.multiclassProficiencies` is used instead of regular proficiencies for multiclass intro.
- Saving throws don't stack from secondary classes (Foundry-correct behaviour).

### Trait grants and proficiency display
The builder has a `classGrantedTraits` synthesised layer that flows trait grants and trait selections back into live character state — so class saves, skills, armour, weapons, tools, and languages appear on the sheet (not just in selection JSON).

The display sync prefers whole-category labels when a category is fully granted, rather than expanding into individual item names. For choice rows, the display reads "{N} {Category} of your choice".

### Initialize Base Advancements (class side)
Authors don't need to hand-create HP / Subclass / ASI rows. The class editor's "Initialize Base Advancements" button generates them from editor fields via [src/lib/classProgression.ts](../../src/lib/classProgression.ts).

## Sheet step

See [character-sheet.md](character-sheet.md) for the rendering side. Quick summary:
- **Character Info** sub-tab — vitals, ability scores, saves, skills, traits
- **Features** sub-tab — granted features, granted items, scale values, selected advancement options
- **Spells** sub-tab — multiclass-aware spell slot table, prepared spells, known spells

## Save flow

On save:
1. Recompute `progressionState.classPackages` from the grouped `progression` entries.
2. Recompute `progressionState.ownedFeatures` from class/subclass progression summaries.
3. Recompute `progressionState.ownedItems` from granted non-feature progression entries + selected option-item advancement choices.
4. Mirror per-package `advancementSelections` into a flat top-level `selectedOptions` map (compatibility).
5. Derive `proficiencyBonus` from total character level.
6. Derive `derivedHpMax` from class HP advancements; only persist `hp.max` if there's an explicit override.
7. Batch write: `characters` row + `character_progression` rows + `character_selections` rows + `character_inventory` rows + `character_spells` rows + `character_proficiencies` rows. One round-trip via `batchQueryD1`.

## Foundry export

The builder's "Export to Foundry" produces a `dauligor.actor-bundle.v1` payload:
- `actor` — root character data (proficiency bonus from total level, primary class flags, progression class IDs, …)
- `items[]` — embedded class items, subclass items, owned feature feat items, owned option-item feat items

Class advancement values come from package-backed advancement selections (not the legacy single-class shortcut).

Source: [src/lib/characterExport.ts](../../src/lib/characterExport.ts). Also see [foundry-export.md](foundry-export.md).

## Recent rework (May 2026)

This section documents structural changes that landed after the original
Builder Steps section above. The wizard-style step description still
applies to the *content* of each step; the layout chrome and the
character-side spell manager were rebuilt for a Hand-Off-2 design pass.

### Page-scroll layout (TAB_RAIL_IMPLEMENTATION.md)

The outer page used to be `<div className="max-w-[1800px] mx-auto h-screen flex flex-col">`
with the rail mounted as a sibling flex item. That layout broke when
content overflowed (rail and content competed for the same height) and
clipped on short screens. The current shape:

```
<root h-screen flex-col overflow-hidden>             ← body lock, no page scroll
  <div cb-page-scroll flex-1 overflow-y-auto>        ← the single scroll container
    <div cb-page-inner max-w-1800 mx-auto px-X>
      (legacy-advancement warning, if present)
      <div cb-body-cols>                             ← grid: 1fr + clamp(44px, 5vw, 64px)
        <div min-w-0>{swappable step}</div>          ← content column
        <nav cb-step-rail>...</nav>                  ← sticky-top right rail
      </div>
```

- `body.character-builder-wide` locks the document body to viewport
  height + hides the global footer (mounted via a `useEffect` on the
  builder root).
- `.cb-page-scroll` is the *only* scrolling element. The class-step
  accordion / proficiency grid / spell list all grow to natural height
  and the page scrolls past them; the rail's `position: sticky; top: 14px`
  keeps it pinned through the scroll.
- The rail is rendered as the second column of `.cb-body-cols`, not a
  fixed overlay. `align-items: start` on the grid is required — without
  it the rail column stretches to the content column's height and
  `position: sticky` stops working.

The top header band (Workroom + View JSON + Export + Commit Changes
row) was absorbed into the rail. Save is the always-gold button at the
top of the rail; View JSON / Export / Delete Character live in the
rail's Settings popover.

CSS lives in [src/index.css](../../src/index.css) under the
`/* CHARACTER BUILDER LAYOUT */` block (`.cb-body-cols`, `.cb-step-rail`,
`.cb-tab-strip-btn`, etc.).

### Sheet step — BookSpread verso/recto

The "sheet" step renders as a two-page book spread:

- **Verso** (left page, 540–580px on xl): identity strip, Vital Hub,
  Abilities & Saves grid, Skills 2-col, Tools/Languages. Inspiration +
  Exhaustion pills ride right-aligned next to the name input in the
  identity strip; the Vital Hub footer is a clean 3-col Init/Speed/Prof
  row.
- **Recto** (right page, fluid): tab strip (Features · Spells · Inventory
  · Feats · Profs · Bio) with the active tab's content beneath. Below xl
  the columns stack; above xl each column scrolls independently via
  `xl:overflow-y-auto` so a long Skills list and a long Features tab
  don't fight for the same vertical space.

The Abilities & Saves grid uses the design's `.ability-save-cell` shape:
6 columns × stack(`STR` label · `+0` mod in faint-gold box · `10` score
tag · save dot + `+0` save mod), tightly spaced. Component CSS is in
[sheet-v3.css](../../E:/DnD/Professional/Dev/Design Handoff/Dauligor-Character-Sheet-Hand-Off-2/design_handoff_character_sheet/sheet-v3.css)
on the design side; the React build is inline in `CharacterBuilder.tsx`.

### Spell Manager step (Add Spells modal)

The character side of `/compendium/spell-rules` / `spell-lists` work.
Two surfaces:

1. **Per-class "Add Spells" modal.** Opens from the class header
   button in the main spell manager tree. Renders the full class
   spell pool with search + per-modal filters; clicking a row toggles
   the spell on the character's sheet (subject to per-class
   `cantripsCap` + `spellsCap` from class scaling columns). The modal
   does NOT toggle prepared state — that's the main sheet's job.
2. **Main sheet — known spells only.** Each class section in the
   sheet's main view shows only the spells already on the character.
   The leading control per row is the prep toggle; preparing respects
   a per-class prepared cap = the number of leveled spells known by
   that class. Spells with `countsAsClassId` set are charged to that
   class's cap (so cross-class assignments work correctly for Divine
   Soul / Magic Initiate / etc.).

Attribution: when the picker calls `togglePlayerKnown(spellId, level,
requiredTags, attributedClassId)`, the new owned-spell entry gets
`countsAsClassId = attributedClassId`. The main view's per-class
section then filters via `attributedClassForSpell(spellId, owned)`,
which resolves to (in priority order):
1. `owned.countsAsClassId` (explicit attribution from the modal)
2. `owned.grantedById` when `grantedByType === 'class'` (granted by
   the class's own advancement)
3. The first spellcasting class whose pool contains the spell —
   deterministic fallback for legacy data written before
   `countsAsClassId` was set by the modal.

### Class-step freeze fix (`canonicalStringify`)

Two `useEffect`s in `CharacterBuilder.tsx` reconcile
`character.progressionState` against a freshly-built shape. Their bail
guards previously used `JSON.stringify(a) === JSON.stringify(b)`, which
is key-order-sensitive — `spell_rules.updated_at` writes ISO via
`new Date().toISOString()`, while SQLite-emitted `class_spell_lists.added_at`
strings differ. The matching characters'-side reconcile effects looked
similar: persisted `progressionState` shape vs. freshly built one
could differ purely on key order, triggering a no-op `setCharacter`
write that re-fired the effect, looped, and locked the tab when the
class step was visible (its per-level accordion render is expensive
enough to make the loop visible as a freeze).

`canonicalStringify(value)` (top of [CharacterBuilder.tsx](../../src/pages/characters/CharacterBuilder.tsx))
sorts object keys lexicographically before emitting. Drop-in for
`JSON.stringify` in the two effect guards. Allocation-light (manual
concat). `scripts/_repro_progression_loop.mjs` is the regression
harness — run via `npx tsx scripts/_repro_progression_loop.mjs`.

## Related docs
