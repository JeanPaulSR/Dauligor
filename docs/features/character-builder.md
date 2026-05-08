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

## Related docs

- [character-sheet.md](character-sheet.md) — sheet rendering
- [compendium-classes.md](compendium-classes.md) — class data the builder consumes
- [compendium-scaling.md](compendium-scaling.md) — scale value resolution
- [compendium-spells.md](compendium-spells.md) — spell side
- [foundry-export.md](foundry-export.md) — actor bundle export contract
- [../architecture/reference-syntax.md](../architecture/reference-syntax.md) — `@scale.*`, `@prof`, `@level` resolution
- [../database/structure/characters.md](../database/structure/characters.md), [../_archive/migration-details/phase-5-characters.md](../_archive/migration-details/phase-5-characters.md)
- [../_archive/class-progression-architecture.md](../_archive/class-progression-architecture.md), [../_archive/character-builder-progression-owned-state-outline.md](../_archive/character-builder-progression-owned-state-outline.md) — design notes
