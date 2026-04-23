# Correcting Activities

This note is about how class and subclass feature activities should be authored in the app so they can be exported cleanly and normalized into Foundry `dnd5e` `system.activities`.

The short version is:

- the semantic activity model is already a good starting point
- the exporter is already carrying activities through correctly
- the current editor still does not expose all the fields the semantic type and Foundry both support
- the module can now read activities when they are present, but it is still a best-effort normalizer, not a perfect one-to-one export guarantee

## The Main Problem

Right now, activity support is split into three layers:

1. the app has a semantic activity type
2. the app has a partial editor for that type
3. the module has to turn that semantic shape into Foundry-native activity data

That means the activity contract is only as complete as the weakest layer.

At the moment:

- the type definition is richer than the editor
- the editor is richer than the module used to be
- some fields proven by Foundry test items are still not authorable in the app UI

## What Is Already Good

The app already has the right overall structure:

- `ActivityEditor.tsx` creates semantic activities on features
- features save activities under `feature.automation.activities`
- the export layer already carries those activities through the class export

That is the right place for them semantically.

Activities should stay owned by feature docs.

They should not move to class or subclass roots.

## What The Module Now Expects

The module now starts reading:

- `feature.automation.activities`
- `feature.advancements`
- `optionItem.automation.activities`
- `optionItem.advancements`

If those fields are missing, the import should continue exactly like before.

If they are present:

- activities are normalized into native `system.activities`
- supported feature-owned advancements are normalized into native `system.advancement`
- unresolved item references inside feature advancements are filled in after import, once the referenced feature or option items actually exist in Foundry

## What The App Still Needs To Expose Better

### Activity Creation Defaults

`transform` is listed as a supported kind, but the add-activity flow does not initialize its `transform` payload. That means transform activities start incomplete.

### Uses And Recovery

The semantic type supports:

- `uses.spent`
- `uses.max`
- `uses.recovery[]`

But the editor still effectively treats recovery as not implemented.

That means the export can structurally carry recovery data, but the app UI is not yet making it easy to author correctly.

### Consumption

The semantic type supports:

- `consumption.spellSlot`
- `consumption.scaling`
- `consumption.targets[]`

But there is not yet a full authoring surface for all the target types and scaling formulas we confirmed through Foundry test items.

### Check Activities

The semantic type supports:

- `check.associated`
- `check.ability`
- `check.dc.calculation`
- `check.dc.formula`

But the editor currently only exposes part of that surface.

The missing piece is especially important because Foundry expects stored associated skill/tool keys, not just a label.

### Attack Activities

The semantic type supports:

- attack ability
- bonus formula
- critical threshold
- attack type and classification

But the editor still does not expose the full proven set, especially critical threshold.

### Damage And Healing

The test items proved more than the current editor exposes.

Important examples:

- `damage.critical.allow`
- `damage.critical.bonus`
- per-part scaling modes
- healing custom formulas
- healing bonus formulas

The semantic type already has most of this, but the editing surface is still uneven.

### Enchant Activities

The Foundry test item proved that enchantment activities can carry:

- `enchant.self`
- `restrictions.allowMagical`
- `restrictions.type`
- `restrictions.categories`
- `restrictions.properties`
- `effects[]`
- rider links to activities, effects, and items

The editor currently only surfaces a small part of that.

### Summon Activities

The semantic type supports:

- profiles
- bonuses
- match rules
- creature type/size restrictions
- temp HP
- summon mode/prompt behavior

But the current editor is still mostly placeholder-level for this.

### Transform Activities

The Foundry sample proved that transform activities can carry:

- profiles
- settings
- customize/mode/preset

The semantic type allows that, but the editor still needs a fuller implementation path.

### Visibility

The semantic type supports:

- identifier
- min/max level
- attunement requirement
- identification requirement
- magic requirement

The editor currently only exposes the simpler portion of that.

## What The Module Can Safely Read Right Now

The module now does a best-effort conversion for:

- `attack`
- `cast`
- `check`
- `damage`
- `enchant`
- `forward`
- `heal`
- `save`
- `summon`
- `transform`
- `utility`

That means:

- if the app starts exporting a correct semantic activity shape, the module will try to build a Foundry-native activity from it
- if the activity is missing, the feature still imports as before
- if a field is not yet authored in the app, the module cannot invent it

## Important Difference Between Semantic And Native Shapes

Some activity families do not map one-to-one.

Examples:

- semantic `kind` becomes native activity `type`
- semantic `save.abilities` becomes native `save.ability`
- semantic `healing.parts[0]` becomes native `healing`
- semantic `enchant.restrictions` becomes native top-level `restrictions`
- semantic summon fields are partly flattened onto the root activity
- semantic transform fields are partly flattened onto the root activity

This is normal.

The app should continue authoring semantic data.

The module should continue handling the native conversion.

## Best Recommendation

Keep this split:

- app authors semantic activities
- exporter passes them through without trying to become Foundry-native
- module normalizes them into Foundry-native `system.activities`

But to make that work reliably, the app editor needs to catch up with the fields already supported by:

- the semantic type
- the Foundry test corpus
- the module normalizer

## Practical Next Steps For The App

1. Finish the missing editor controls for:
   - recovery
   - consumption targets
   - full check fields
   - critical settings
   - enchant restrictions/effects
   - summon
   - transform
   - full visibility

2. Make sure each activity kind initializes all of its required semantic sub-objects when created.

3. Prefer authoring stored keys instead of labels for:
   - skills
   - tools
   - other Foundry-indexed lists

4. Treat the semantic activity type as the app-side source of truth, and let the module keep owning the final conversion into Foundry shape.
