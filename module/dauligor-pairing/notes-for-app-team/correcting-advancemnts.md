# Correcting Advancemnts

This note is about how class and subclass advancement data should be authored in the app so it can be exported cleanly and normalized into Foundry `dnd5e` advancements.

The short version is:

- class and subclass items should own progression
- feature items should own content
- scaling columns and modular choice data should support progression
- the export layer should synthesize final class/subclass advancement rows from those sources

## The Main Problem

Right now, advancement authoring is centered on individual features instead of the class or subclass root.

That is the biggest mismatch with how Foundry expects advancement data to work.

In Foundry:

- the class item owns the class advancement track
- the subclass item owns the subclass advancement track
- feature items are usually the things being granted by those advancements

In the app today:

- `ClassEditor.tsx` saves the class root document
- `SubclassEditor.tsx` saves the subclass root document
- `AdvancementManager.tsx` is only mounted inside feature modals
- feature documents can carry `advancements`
- the character builder then resolves advancements from:
  - class root
  - subclass root
  - feature docs

That means the current model is split across too many owners.

## What Should Own What

### Class Root Should Own

The class document should be the semantic owner of:

- hit point progression
- class proficiency choices
- class fixed proficiencies
- class scales
- class feature grants
- class option choices
- subclass selection timing

Concretely, this means the class root should be the source for:

- `HitPoints`
- `Trait`
- `ScaleValue`
- `ItemGrant`
- `ItemChoice`
- `Subclass`

### Subclass Root Should Own

The subclass document should be the semantic owner of:

- subclass feature grants
- subclass-granted proficiencies
- subclass scales

Concretely, this means the subclass root should be the source for:

- `ItemGrant`
- `Trait`
- `ScaleValue`

### Feature Docs Should Own

Feature docs should be the semantic owner of:

- name
- description
- uses
- activities
- effects
- flags and references
- optional links to a scale or modular choice group

Feature docs should usually not be the authoritative owner of the progression row that grants the feature.

That progression belongs on the class or subclass root.

## How This Differs From The Current App

### Current App Behavior

The current app behavior is roughly:

1. class and subclass roots save metadata
2. features save their own semantic content
3. features can also save `advancements`
4. scaling columns and unique option groups are saved separately
5. the character builder resolves choices by reading:
   - root advancements
   - feature advancements
   - legacy modular choice systems

This works as an app-side progression engine, but it makes Foundry export/import harder because the same concept can appear in more than one place.

### Recommended Behavior

The recommended behavior is:

1. keep the current authoring inputs
2. stop treating `feature.advancements` as the primary progression model for classes
3. build root class/subclass advancements from the semantic source data
4. use feature docs as the granted content objects

That gives one clear owner for progression and one clear owner for content.

## Recommended Semantic Ownership By Example

### Extra Proficiencies

If a class grants skill choices or fixed proficiencies:

- the class root should own a `Trait` advancement
- the feature can still exist and explain the rule
- the feature does not need to own the actual advancement row

Examples:

- class skill choices at level 1
- armor/tool/language proficiencies from the base class
- subclass-granted armor or weapon proficiencies

### Scale Values

If a class gains a tracked value over time:

- the class root should own a `ScaleValue` advancement
- the supporting scale can still be authored as a scaling column
- feature descriptions can reference the scale

Examples:

- Sorcery Points
- Cantrips Known
- Metamagic Known
- Infusions Known

### Feature Grants

If a feature appears automatically at a certain level:

- the class root or subclass root should own an `ItemGrant`
- the granted item should be the feature doc

Examples:

- `Font of Magic`
- `Metamagic`
- subclass level features like `Favored by the Gods`

For app authoring, these core class and subclass feature grants do not need to appear as visible editable base rows in the class or subclass editor.

Instead:

- the app should continue treating class/subclass features as inherently known content
- the export layer should synthesize export-only `ItemGrant` rows for those core features by level
- explicit `ItemGrant` rows in the editor should be reserved for special cases, not routine feature grants

That keeps the character builder UI cleaner while still giving the Foundry exporter a complete root advancement track.

### Item Choices

If a feature unlocks a pool of choices:

- the class root or subclass root should own an `ItemChoice`
- the pool should come from `uniqueOptionGroups` and `uniqueOptionItems`
- the feature doc should be the presenting content, not the owner of the progression row

Example:

- Sorcerer `Metamagic`

If an `ItemChoice` references a unique option group and is attached to a feature, that feature linkage should be treated as authoritative for export.

The export layer should derive `featureSourceId` for the option group and its option items from the attached advancement when the group or item docs do not store their own feature link directly.

### Subclass Selection

Subclass choice should come from the class root, derived from subclass progression timing.

Examples:

- `subclassFeatureLevels`
- subclass placeholder progression rows

This should synthesize into a class-root `Subclass` advancement.

## What We Should Keep Authoring In The App

The app already has the right kinds of semantic inputs. We should keep authoring:

- class root metadata
- subclass root metadata
- features
- scaling columns
- unique option groups
- unique option items
- activities on features

Those are all useful.

The change is not "stop authoring the semantic data."

The change is:

- stop treating feature-owned advancements as the main progression structure
- derive the final progression structure from the semantic inputs

## What Should Be Generated

The final root advancement arrays should be generated from semantic data.

### Class Root Generated Advancements

Generate from:

- `hitDie`
- `savingThrows`
- `proficiencies`
- `subclassFeatureLevels`
- class features by level
- scaling columns
- unique option groups and option items

The generator should output things like:

- one `HitPoints`
- one or more `Trait`
- one `Subclass`
- one or more `ScaleValue`
- one or more `ItemGrant`
- one or more `ItemChoice`

### Subclass Root Generated Advancements

Generate from:

- subclass features by level
- subclass-granted proficiencies
- subclass scaling columns
- subclass choice groups if they exist

The generator should output things like:

- subclass `ItemGrant`
- subclass `Trait`
- subclass `ScaleValue`

## What Should Probably Be Deprecated

For the class/subclass Foundry pipeline, `feature.advancements` should no longer be the main place where progression is authored.

That does not mean it must be deleted immediately.

It does mean:

- it should be treated as transitional
- it should not be the authoritative source for class progression
- if a feature-level advancement duplicates something already implied by class/subclass root data, the root data should win

## Best Implementation Strategy

The cleanest approach is to add one shared semantic builder in the app.

## Recent Contract Changes

These are now the intended export rules for the class/subclass Foundry pipeline:

- Root `class.advancements` and `subclasses[].advancements` are the authoritative progression model.
- The export layer no longer adds implicit class/subclass feature `ItemGrant` rows just because features exist at a level.
- If a feature should be granted automatically, the root class or subclass must author an explicit `ItemGrant`.

That means:

- feature presence alone is no longer enough to imply grant timing
- class and subclass roots must explicitly grant the features they own
- missing `ItemGrant` rows will now stay missing in export instead of being silently synthesized

### Spellcasting Progression

Class spellcasting progression should now come from the admin-managed `Foundry Formula Mapping` records in `spellcastingTypes`.

For class export:

- `spellcasting.progressionId` in the app is treated as a spellcasting-type reference, not a slot-scaling override
- export resolves that into:
  - native Foundry `spellcasting.progression`
  - `progressionTypeSourceId`
  - `progressionTypeIdentifier`
  - `progressionTypeLabel`
  - `progressionFormula`
- class-side `manualProgressionId` is deprecated and should not be authored going forward

Alternative slot systems remain separate:

- `altProgressionId` is for Pact-style or other alternative progressions
- export normalizes that to `altProgressionSourceId`
- those referenced records are exported under `alternativeSpellcastingScalings`

Known/cantrip scaling remains separate too:

- `spellsKnownId` is normalized to `spellsKnownSourceId`
- those referenced records are exported under `spellsKnownScalings`

This keeps three different concepts separate:

- Foundry multiclass/progression type mapping
- alternative slot progressions
- spells-known/cantrip progressions

Suggested file:

- `src/lib/classAdvancementBuilder.ts`

This builder should accept:

- class doc
- subclass docs
- features
- scaling columns
- unique option groups
- unique option items

And it should return:

- generated class advancements
- generated subclass advancements

Then reuse that same builder in:

- semantic export
- character builder
- class preview
- import preview

That way:

- the character creator and Foundry export read the same progression model
- you avoid drift between UI logic and exported JSON

## How To Think About Activities

Activities are different from advancements.

Advancements answer:

- when does the character gain something?
- how many choices do they get?
- what gets granted?

Activities answer:

- what can this granted feature actually do when used?

So:

- advancements should live on class/subclass roots
- activities should stay on feature docs

That separation is healthy and matches Foundry better.

## Final Recommendation

The app should continue authoring semantic class data, but the authoritative progression model should move upward.

Use this rule:

- class/subclass roots own progression
- features own content
- scaling columns and modular choice groups support progression
- export synthesizes final advancements from those sources

If we do that, the same class data becomes much easier to:

- show in the app
- use in the character builder
- export semantically
- normalize into Foundry `dnd5e`
