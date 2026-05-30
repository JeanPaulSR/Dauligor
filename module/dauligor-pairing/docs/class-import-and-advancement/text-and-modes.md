# Description Text, Modes & Identity

> Part of the [Class Import & Advancement Guide](../class-import-and-advancement-guide.md).

## Description Text Contract

The importer now accepts three description families for class, subclass, feature, and class-option text:

- already-rendered HTML
- BBCode exported by the app editor
- simple markdown-like prose using headings and list syntax

Current module behavior:

- HTML is preserved as-is
- BBCode is converted to Foundry-friendly HTML during import
- plain markdown-like blocks are converted into headings, lists, horizontal rules, inline emphasis, and paragraphs
- plain text still falls back to paragraph-wrapped HTML

Practical rule for the app:

- BBCode is the preferred rich-text transport if the content is not already HTML

## Actor Import Modes

The actor importer now has three distinct progression modes.

### 1. Fresh class import

Use the class exactly as exported.

Expected behavior:

- class level starts at 1 unless the Foundry import flow chooses a higher level
- base class proficiencies are applied
- all granted features at or below the selected class level are imported

### 2. Same-class level-up

This applies when the actor already has the same class embedded.

Expected behavior:

- the importer keeps the current class level as the floor
- lower-level class and subclass features are not re-imported if they already belong to earlier levels
- newly gained levels still import their newly granted features
- desired feature/source sets still include all features at or below the target level so stale higher-level imports can be pruned safely

### 3. Multiclass initial import

This applies when the actor already has a different class but does not yet have this class.

Expected behavior:

- the importer uses `class.multiclassProficiencies` instead of the primary class proficiency profile
- base class saving throws are not granted
- only multiclass proficiencies are applied to the actor root
- the embedded class item stores `flags.dauligor-pairing.proficiencyMode = "multiclass"` so later reimports and level-ups keep using the same secondary-class behavior

Important:

- multiclass mode is sticky for that embedded class item
- later level-ups in the same class should not suddenly grant primary-class proficiencies

## Current Working Advancement Contract

For new Dauligor class exports, the intended contract is now:

- root `class.advancements` are authoritative
- root `subclass.advancements` are authoritative
- ordinary class/subclass feature grants are exported as inherent root `ItemGrant` rows
- feature items still hold content like description, uses, activities, and effects
- older inferred progression paths exist only as fallback compatibility behavior

In practice, a class like Sorcerer should now import with root rows for:

- `HitPoints`
- saving throw and proficiency `Trait` rows
- `Subclass`
- `ScaleValue`
- `ItemChoice`
- `AbilityScoreImprovement`
- inherent feature `ItemGrant`
- feature descriptions that can be normalized from BBCode into Foundry HTML

## Identity Model

Do not overload one field to mean everything.

Use three identities:

- `sourceId`
  - source/book provenance
  - example: `source-phb-2014`
- `id`
  - app record identity
  - example: `awWmrbo3YxCMU86t7Yb9`
- `identifier`
  - semantic entity slug
  - example: `sorcerer`

For normalized Foundry items, the module should store:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-sorcerer",
      "entityId": "awWmrbo3YxCMU86t7Yb9",
      "sourceBookId": "source-phb-2014"
    }
  }
}
```

Meanings:

- `flags.dauligor-pairing.sourceId`
  - stable semantic identity used for grants, upserts, and matching
- `flags.dauligor-pairing.entityId`
  - the original app record id
- `flags.dauligor-pairing.sourceBookId`
  - the source/book document identity

The app should not send Foundry-local `_id` values as its primary identity.

