# Dauligor Semantic Class Export Notes

This document describes the semantic "full export" class shape that `dauligor-pairing` can now normalize into the internal `dauligor.class-bundle.v1` import flow.

Use this when the app wants to send one rich class payload instead of prebuilding a Foundry-like class bundle.

## Accepted Top-Level Shape

The current generalized class normalizer accepts a payload shaped like:

```json
{
  "class": {},
  "subclasses": [],
  "features": [],
  "scalingColumns": [],
  "spellsKnownScalings": {},
  "alternativeSpellcastingScalings": {},
  "uniqueOptionGroups": [],
  "uniqueOptionItems": [],
  "source": null,
  "_meta": {}
}
```

The module does not require a `kind` field for this semantic export yet. It detects the shape by structure.

## What the Module Normalizes

When this payload is imported, the module converts it into:

1. a Foundry-like class item
2. class feature feat items
3. subclass feature feat items
4. class option feat items
5. subclass items for world-library imports

Actor-sheet imports remain intentionally narrower:

- embed the class item
- embed only the class features granted at or below the selected level
- do not embed subclass items
- embed only the selected class option items that apply to the chosen class level

More precisely, actor-sheet imports now behave like this:

- fresh class import: embed features up to the chosen level
- same-class level-up: embed only features unlocked above the actor's current level in that class
- secondary-class multiclass import: use `class.multiclassProficiencies` instead of the primary proficiency profile

For skill proficiencies, the semantic exporter may place the choice block in either of these locations:

- `class.skills`
- `class.proficiencies.skills`

Both are normalized by the importer, and both should use the same structure:

```json
{
  "choiceCount": 1,
  "options": ["acrobatics", "athletics"],
  "fixed": []
}
```

## Naming Conventions the Parser Expects

The parser now relies on semantic `sourceId` values rather than Firestore ids.

Expected prefixes:

| Entity | Prefix | Example |
| --- | --- | --- |
| Class | `class-` | `class-sorcerer` |
| Subclass | `subclass-` | `subclass-divine-soul` |
| Class Feature | `class-feature-` | `class-feature-font-of-magic` |
| Subclass Feature | `subclass-feature-` | `subclass-feature-divine-magic` |
| Option Group | `class-option-group-` | `class-option-group-metamagic` |
| Option Item | `class-option-` | `class-option-careful-spell` |
| Scale | `scale-` | `scale-sorcery-points` |

## Collision Prevention Rule

If the same placeholder appears at multiple levels, its `sourceId` must stay unique.

Example:

- `class-feature-sorcerous-origin-feature-6`
- `class-feature-sorcerous-origin-feature-14`
- `class-feature-sorcerous-origin-feature-18`

Do not reuse:

- `class-feature-sorcerous-origin-feature`

for all of them, or the importer will upsert one over another.

## Fields the Parser Uses Directly

### `class`

The parser uses:

- `id`
- `sourceId`
- `name`
- `identifier`
- `description`
- `lore`
- `hitDie`
- `spellcasting`
- `savingThrows`
- `primaryAbility`
- `wealth`
- `subclassFeatureLevels`
- `uniqueOptionMappings`

Important note:

- in the semantic full export, top-level `class.sourceId` is treated as source/book provenance
- the parser derives the class's own stable import identity from `class.id` plus `class.identifier`
- the normalized Foundry class item still receives its own stable `flags.dauligor-pairing.sourceId`, usually something like `class-sorcerer`

### `subclasses`

The parser uses:

- `id`
- `sourceId`
- `name`
- `classSourceId`
- `description`

### `features`

The parser uses:

- `id`
- `sourceId`
- `parentSourceId`
- `classSourceId`
- `featureKind`
- `name`
- `level`
- `description`
- `uniqueOptionGroupIds`
- `automation`
- `imageUrl` or `iconUrl` when present

Current supported `featureKind` values:

- `classFeature`
- `subclassChoice`
- `subclassFeature`

### `scalingColumns`

The parser uses:

- `sourceId`
- `name`
- `values`

These become `ScaleValue` advancements on the normalized Foundry class item.

### `spellcastingScalings`

Deprecated:

- `spellcastingScalings` is now an older bridge shape and should not be the target for new exports

### `spellsKnownScalings`

The parser currently reads:

- `levels[*].cantrips`
- `levels[*].spellsKnown`

Those become normalized `ScaleValue` advancements such as:

- `Cantrips Known`
- `Spells Known`

### `alternativeSpellcastingScalings`

The parser currently reads:

- `levels[*].slotCount`
- `levels[*].slotLevel`

These currently feed the importer’s spellcasting progression summary and preserve alternative slot progression metadata for module-side handling.

### `uniqueOptionGroups`

The parser uses:

- `sourceId`
- `featureSourceId`
- `scalingSourceId`
- `selectionCountsByLevel`
- `description`

Important behavior:

- if `selectionCountsByLevel` is empty but the linked advancement uses a scaling column, the module now derives the available selections from that scaling column during normalization
- the option-group name is also used to derive the imported feat subtype label for selected class-option items

The current importer preserves this metadata on the normalized class item flags for future choice automation.

### `uniqueOptionItems`

The parser uses:

- `sourceId`
- `name`
- `description`
- `groupSourceId`
- `levelPrerequisite`
- `imageUrl` or `iconUrl` when present

These currently normalize into world feat items with `sourceType: "classOption"`.

Class-option items now also receive:

- `system.type.value = "class"`
- `system.type.subtype` derived from the option-group label

Native examples:

- `artificerInfusion`

## Structured Data Wins Over Prose

If prose and structured data disagree, the importer should trust the structured data.

Examples:

- `selectionCountsByLevel`
- `scalingSourceId`
- `uniqueOptionMappings`
- `subclassFeatureLevels`

Descriptions are still valuable for display, but they are not the authoritative source for progression logic.

That said, the importer now accepts richer description text:

- HTML as-is
- BBCode converted to Foundry HTML
- simple markdown-like prose converted to headings/lists/paragraphs

## Current Generalized Import Behavior

The semantic class parser currently automates:

- hit point advancement
- saving throw advancement
- class scale values
- spellcasting-derived cantrip/spell known scales from `spellsKnownScalings`
- class feature grants
- subclass feature grants on generated subclass items
- actor-side ASI prompting through native `dnd5e` advancement flows when imported levels cross `AbilityScoreImprovement` rows

The parser also preserves semantic spellcasting metadata on imported class or subclass flags, including:

- `isRitualCaster`
- `progressionTypeSourceId`
- `progressionTypeIdentifier`
- `progressionFormula`
- `spellsKnownSourceId`
- `altProgressionSourceId`

## Multiclass Proficiency Shape

When `class.multiclassProficiencies` is present, it should use the same normalized shape as `class.proficiencies`.

Example:

```json
{
  "multiclassProficiencies": {
    "armor": { "choiceCount": 0, "categoryIds": ["med", "shl"], "fixedIds": [], "optionIds": [] },
    "weapons": { "choiceCount": 0, "categoryIds": [], "fixedIds": [], "optionIds": [] },
    "tools": { "choiceCount": 0, "categoryIds": [], "fixedIds": ["thief"], "optionIds": [] },
    "languages": { "choiceCount": 0, "categoryIds": [], "fixedIds": [], "optionIds": [] },
    "skills": { "choiceCount": 0, "fixedIds": [], "optionIds": [] },
    "savingThrows": { "choiceCount": 0, "fixedIds": [], "optionIds": [] }
  }
}
```

The importer now uses this block for the actor-root proficiency application when the class is imported as a secondary multiclass choice.

## Spellcasting Normalization Notes

When the semantic export includes:

```json
{
  "spellcasting": {
    "type": "prepared",
    "ability": "WIS",
    "progression": "full",
    "spellsKnownFormula": "WIS + Level"
  }
}
```

the importer should normalize that into native `dnd5e` class or subclass spellcasting:

```json
{
  "system": {
    "spellcasting": {
      "progression": "full",
      "ability": "wis",
      "preparation": {
        "formula": "@abilities.wis.mod + @classes.druid.levels"
      }
    }
  }
}
```

Important:

- current `dnd5e` no longer expects `system.spellcasting.preparation.mode` on class or subclass items
- prepared-caster display strings such as `WIS + Level` should be converted into native Foundry formulas during import
- if a semantic formula is not already native and cannot be normalized safely, the importer should omit the native preparation formula rather than writing invalid human-readable text into the Foundry field

It does not yet fully automate:

- subclass selection flows on actors
- option-choice advancement flows on actors
- native fighting style / tool-choice advancement generation
- native skill-choice advancement generation on the class item itself
- class activities/effects beyond preserving semantic automation metadata on feature flags

## Recommended Endpoint Strategy

Two viable approaches now exist:

1. Send a pre-normalized `dauligor.class-bundle.v1`
2. Send the semantic full export described here and let the Foundry module normalize it

Short recommendation:

- use the semantic export for app-side flexibility
- use the normalized bundle only if the app explicitly wants to own Foundry-side shaping

## Identity Summary

For the semantic export, keep these meanings distinct:

- `sourceId`
  - source/book provenance
- `id`
  - app record identity
- `identifier`
  - semantic entity slug

For the normalized Foundry item produced by the module, the module stores:

- `flags.dauligor-pairing.sourceId`
  - stable entity reference for item grants and upserts
- `flags.dauligor-pairing.entityId`
  - app record id
- `flags.dauligor-pairing.sourceBookId`
  - source/book identity
