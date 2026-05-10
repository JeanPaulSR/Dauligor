# Dauligor Advancement And Activity Implementation Guide

This guide is the working handoff for finishing class advancements and class-feature activities.

It is meant to answer:

- what the app should keep exporting
- what the app should change before the data is considered stable
- which currently exported fields are likely legacy or deprecated
- what the Foundry module must implement in order to consume the data correctly

This guide is intentionally focused on:

- classes
- subclasses
- class features
- class option groups and option items
- feature activities

Use this alongside:

- `docs/class-semantic-export-notes.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/advancement-construction-guide.md`
- `docs/class-feature-activity-contract.md`

## Current Situation

The current semantic class export is already good enough for:

- class import
- subclass import
- fixed feature grants
- scale generation
- skill choices
- HP persistence
- custom option-group prompting in the Foundry importer

The two areas that are still not fully native are:

1. `ItemChoice`-style advancement generation
2. feature `system.activities` generation

Right now:

- the module builds class progression from top-level semantic sections
- the module does not yet consume feature-owned semantic `advancements`
- the module preserves `feature.automation` in flags
- the module does not yet convert semantic activities into native `system.activities`

That means the current app export can already drive imports, but some of the newly added data is still advisory metadata rather than active import input.

## Core Rule

For classes, the class item or subclass item should own progression.

That means:

- the class item should own `HitPoints`
- the class item should own `Trait`
- the class item should own `ScaleValue`
- the class item should own `ItemGrant`
- the class item should eventually own `ItemChoice`
- the subclass item should own subclass-side `ItemGrant`

The feature item should usually own:

- description
- activities
- effects
- uses
- references

The feature item should usually not own:

- grant timing
- level progression
- option-count progression
- actor advancement state

## What The App Should Export For Native ItemChoice

For a class option pool like Metamagic, the app should continue treating the option group as the semantic source of truth.

The clean target is:

1. the class feature exists as a feature item
2. the option group defines the option pool and count progression
3. the option items define the selectable feat-like options
4. the module synthesizes a native `ItemChoice` advancement on the class item

### Recommended semantic source of truth

For each option group, the export should provide:

```json
{
  "sourceId": "class-option-group-metamagic",
  "identifier": "metamagic",
  "name": "Metamagic",
  "featureSourceId": "class-feature-metamagic",
  "scalingSourceId": "scale-metamagic",
  "selectionCountsByLevel": {
    "3": 2,
    "7": 3,
    "11": 4,
    "15": 5
  }
}
```

For each option item, the export should provide:

```json
{
  "sourceId": "class-option-careful-spell",
  "identifier": "careful-spell",
  "name": "Careful Spell",
  "groupSourceId": "class-option-group-metamagic",
  "levelPrerequisite": 0,
  "description": "..."
}
```

For the class feature that conceptually grants the pool, the export should provide:

```json
{
  "sourceId": "class-feature-metamagic",
  "identifier": "metamagic",
  "name": "Metamagic",
  "level": 3,
  "featureKind": "classFeature",
  "description": "..."
}
```

The important part is:

- the feature says what the thing is
- the group says what the pool is
- the scale says how many choices are available by level
- the option items say what can be chosen

## What The App Should Not Treat As Primary For ItemChoice

The current `features[].advancements` block is not the right primary contract yet.

Example of the current experimental Metamagic advancement:

```json
{
  "_id": "qydkpizkq",
  "level": 1,
  "configuration": {
    "scalingColumnId": "wfKNMWJOiam3tgRMg2U4",
    "optionGroupId": "w9gFb8ga81xgWfopiZQ8",
    "choiceType": "option-group",
    "count": 1,
    "pool": [],
    "countSource": "scaling"
  },
  "type": "ItemChoice",
  "title": ""
}
```

This is not ideal yet because:

- it is feature-owned rather than class-owned
- `_id` is random instead of semantic
- `level` does not match the class unlock level clearly
- `count` conflicts with `countSource = "scaling"`
- `pool` is empty
- `title` is blank

So for now, treat this as experimental metadata, not the production contract.

## App-Side Changes Needed For ItemChoice

### Must change

- Add `featureSourceId` directly to every `uniqueOptionGroup`.
- Keep `groupSourceId` on every `uniqueOptionItem`.
- Keep `selectionCountsByLevel` as the canonical count progression field.
- Keep `scalingSourceId` as the canonical scale link field.
- Make sure progression agrees across:
  - feature description
  - scale values
  - `selectionCountsByLevel`

### Strongly recommended

- Use semantic `sourceId` values everywhere.
- Keep `identifier` on groups and option items.
- Use semantic filenames and endpoint slugs where possible.

### Do not rely on yet

- `features[].advancements`

That block can remain in the export while the app experiments, but it should not be considered authoritative until the module actually consumes it and the contract is cleaned up.

## Module-Side Changes Needed For ItemChoice

The module should implement native `ItemChoice` in this order.

### 1. Synthesize `ItemChoice` from semantic option groups

Add a new class-advancement builder in:

- `scripts/class-import-service.js`

Recommended helper:

- `buildItemChoiceAdvancements(context)`

This helper should:

- iterate the semantic option groups
- resolve each group's feature
- resolve each group's option items
- build one native `ItemChoice` advancement per group
- attach it to the class item in `buildSemanticClassAdvancement(context)`

Do not build this from `features[].advancements`.

Build it from:

- `uniqueOptionGroups`
- `uniqueOptionItems`
- `class.uniqueOptionMappings` as fallback only

### 2. Convert semantic pool entries into Foundry-resolvable references

When synthesizing the `ItemChoice`, the advancement should initially carry semantic references such as:

```json
{
  "sourceId": "class-option-careful-spell"
}
```

Then in world import preparation, extend the existing reference resolver so `ItemChoice.configuration.pool` is rewritten to Foundry UUIDs, similar to how `ItemGrant.configuration.items` is already resolved.

### 3. Persist actor choices into `ItemChoice.value`

After actor import embeds selected option items, the embedded class item should record those choices in:

```json
{
  "value": {
    "added": {},
    "replaced": {}
  }
}
```

This should become the class-side memory of:

- which options were actually chosen
- what actor items they resolved to

This is important for:

- reimport
- later level-up
- export
- character reconstruction

### 4. Keep the custom wizard only as a UI layer

The current custom option wizard is still useful, but it should become a front-end for writing real `ItemChoice.value`, not the only place where the choice exists.

## What The App Should Export For Activities

For class-feature items, the app should treat activities as part of the feature item, not part of the class advancement tree.

The semantic home is:

```json
{
  "sourceId": "class-feature-font-of-magic",
  "name": "Font of Magic",
  "automation": {
    "activities": [
      {
        "type": "utility",
        "...": "..."
      }
    ],
    "effects": []
  }
}
```

This is the right conceptual home because the activity answers:

- what the feature does
- how it is activated
- what it consumes
- what it targets
- what roll/save/damage/healing it creates

It does not answer:

- when the actor gets the feature
- how many options the actor should choose
- what level unlocks the feature

## App-Side Changes Needed For Activities

### Must change

- Keep using `feature.automation.activities` as the canonical semantic activity container.
- Make sure each activity is fully shaped according to:
  - `docs/class-feature-activity-contract.md`
- Keep effects in `feature.automation.effects`.
- Avoid splitting activity configuration across unrelated feature fields when it belongs inside the activity block itself.

### Strongly recommended

- Keep semantic references in descriptions and formulas rather than pre-resolving Foundry UUIDs.
- Use stable semantic identifiers inside activities where cross-linking is needed.
- Use one complete activity contract consistently across all activity families.

### Do not rely on

- feature descriptions as the authoritative source for machine behavior

Descriptions are still for display and fallback understanding. Machine behavior should live in the activity data itself.

## Module-Side Changes Needed For Activities

The module should implement activity normalization in this order.

### 1. Add semantic-to-native activity normalization

In:

- `scripts/class-import-service.js`

or a dedicated helper file, add a normalizer that converts:

- `feature.automation.activities`

into:

- `featItem.system.activities`

The current module only preserves semantic automation in flags.

### 2. Keep the semantic copy during transition

Even after native `system.activities` is created, keep the semantic source in flags for debugging and migration:

```json
{
  "flags": {
    "dauligor-pairing": {
      "semanticAutomation": {
        "activities": [],
        "effects": []
      }
    }
  }
}
```

This helps with:

- regression checks
- reimport debugging
- comparing semantic payloads to normalized Foundry state

### 3. Run reference normalization on activities

Any semantic refs inside activity text or formulas should be normalized during import using the module's reference service.

Examples:

- prose refs
- formula refs
- scale refs
- semantic entity refs

### 4. Add validation logging for unsupported fields

If an activity family includes fields the module does not yet support, log them clearly instead of silently dropping them.

This is especially helpful while the app is still building out activity exports.

## Deprecated Or Likely Legacy Fields

The list below is based on the current Sorcerer export and the current class normalizer.

These fields are divided into:

- safe to remove now
- keep for now because they still bridge missing direct fields

## Safe To Remove Now

These are currently exported but not meaningfully used by the semantic class normalizer.

### On `class`

- `uniqueOptionGroupIds`
- `tagIds`
- `createdAt`
- `updatedAt`
- `excludedOptionIds`
- `subclassTitle`

### On `subclass`

- `excludedOptionIds`
- `tagIds`
- `uniqueOptionGroupIds`
- `uniqueOptionMappings`
- `createdAt`
- `updatedAt`
- `classIdentifier`
- `classId`

### On `feature`

- `advancements`
- `usage`
- `parentId`
- `type`
- `quantityColumnId`
- `configuration`
- `properties`
- `parentType`
- `createdAt`
- `updatedAt`
- `scalingColumnId`
- `isSubclassFeature`

### On `uniqueOptionGroup`

- `description`
- `createdAt`
- `updatedAt`
- `identifier`
- `sourceBookId`

### On `uniqueOptionItem`

- `isRepeatable`
- `createdAt`
- `updatedAt`
- `sourceBookId`
- `groupId` once `groupSourceId` is universal and stable

### On `scalingColumn`

- `parentId`
- `createdAt`
- `updatedAt`
- `parentType`
- `sourceBookId`
- `classSourceId`

## Keep For Now

These still serve as bridge fields and should stay until the replacement is universal.

### `class.uniqueOptionMappings`

Keep this until every option group exports:

- `featureSourceId`
- `scalingSourceId`

directly and reliably.

Right now the module still uses `uniqueOptionMappings` as fallback recovery when the group itself does not carry all relationship fields.

### `uniqueOptionGroup.id`

Keep this until all consumers rely only on semantic `sourceId`.

### `uniqueOptionItem.groupId`

Keep this until `groupSourceId` is universal and every consumer is source-id based.

### `scalingColumn.id`

Keep this until all mappings rely only on `scalingSourceId`.

## Data Quality Checks Before Wiring Native ItemChoice

Before the module consumes option groups as real `ItemChoice`, confirm:

- each option group has one stable `sourceId`
- each option item has one stable `sourceId`
- each option item has `groupSourceId`
- each option group has `featureSourceId`
- each option group has `selectionCountsByLevel`
- each option group has `scalingSourceId` when count comes from a scale
- scale values and prose do not disagree
- the option-item list matches the intended pool exactly

For Metamagic specifically, confirm whether level 19 and 20 should remain at 6 selections. If not, fix that before the module relies on it.

## Data Quality Checks Before Wiring Native Activities

Before the module consumes feature activities, confirm:

- every activity family is exported in `feature.automation.activities`
- every activity uses the documented field/value families
- no required machine behavior is only written in prose
- any semantic references are stable and parseable
- effects that belong with the feature are exported in `feature.automation.effects`

## Recommended Implementation Order

1. Clean the semantic option-group export:
   - add `featureSourceId`
   - confirm Metamagic progression
   - keep `groupSourceId` everywhere
2. Implement native `ItemChoice` synthesis in the module.
3. Persist `ItemChoice.value` on actor imports.
4. Clean the semantic activity export against the activity contract.
5. Implement semantic activity normalization into `system.activities`.
6. Preserve semantic activity data in flags during the transition.

## When Reviewing A New Class Payload

When a new class export is ready, review it in this order:

1. Does the class/subclass/feature identity model still look stable?
2. Do the top-level option-group sections still fully describe choice progression?
3. Are any stale legacy fields still present that no longer add value?
4. Are feature activities complete enough to normalize into native `system.activities`?
5. Is anything duplicated between prose, feature metadata, and top-level progression sections in a conflicting way?

That review order makes it easier to tell:

- what the app should fix
- what the module should implement
- what is safe to ignore for now

---

## Implementation Status (2026-05-09)

The bullet points below describe **the current shape**, not the
forward-looking design above. When the two disagree, the design above
is the target; the implementation below is what the bundle and module
look like today.

### Option items are full feat-shape feature documents

Migration `20260509-1356_unique_option_items_feat_shape.sql` brought
the `unique_option_items` row to feat-shape parity with `features`.
Each option item carries the same authoring surface as a class
feature: name, description, icon, source, page, `feature_type`,
`subtype`, `requirements`, `image_url`, `uses_max/spent/recovery`,
`properties`, `activities`, `effects`, `advancements`, `tags`,
`quantity_column_id`, `scaling_column_id`. Plus the option-specific
extras (`level_prerequisite`, `string_prerequisite`, `is_repeatable`,
`class_ids`, `requires_option_ids`).

The bundle ships each option item with the same shape as a feature:
top-level `automation` object wrapping `activities` + `effects`,
top-level `usage` for uses, top-level `advancements` for grants. The
module's `createSemanticOptionItem` reads them identically to how
`createSemanticFeatureItem` reads features.

The previously-half-built `feature_id` link on option items (an
option pointing at a separate feature row for content) was
**removed**. Option items now own their content end-to-end.

### Per-grant attachments on `ItemChoice` / `ItemGrant` advancements

When `choiceType: "option-group"`, the advancement carries two
runtime knobs in addition to `optionGroupId`:

```json
{
  "type": "ItemChoice",
  "configuration": {
    "choiceType": "option-group",
    "optionGroupId": "w9gFb8ga81xgWfopiZQ8",
    "scalingColumnId": "wfKNMWJOiam3tgRMg2U4",
    "countSource": "scaling",
    "usesFeatureSourceId": "class-feature-savage-superiority",
    "optionScalingSourceId": "scale-superiority-dice"
  }
}
```

- `usesFeatureSourceId` — the granted options' activity
  `consumption.targets[]` get rewritten to consume from this feature's
  `system.uses` pool (Battle Master Maneuvers consume Superiority
  Dice; Reaver Maneuvers consume the Reaver subclass's Savage
  Superiority pool).
- `optionScalingSourceId` — drives `@scale.linked` substitution in
  damage / dice formulas. The same option group resolves Barbarian's
  superiority dice when Reaver grants it and Fighter's when Battle
  Master grants it.

Per-grant data is also tagged onto each option item at export time so
the module can wire it without re-traversing advancements:
`flags.<MODULE_ID>.usesFeatureSourceId` +
`flags.<MODULE_ID>.optionScaleFormula` (resolved
`@scale.<class>.<column>` string).

### `@scale.linked` substitution

Authors write `@scale.linked` literally inside an option-item
activity's damage / dice / consumption formula. At import the bridge
walks every activity recursively and substitutes the token with the
resolved formula. Resolution priority:

1. `flags.<MODULE_ID>.optionScaleFormula` (from advancement's
   `optionScalingSourceId` — highest priority, the granter is the
   authority on which class's scaling applies)
2. The uses-feature's own `flags.<MODULE_ID>.scaleFormula` (implicit
   pairing — "consume from this feature, scale by what that feature
   scales by")
3. The option's own `flags.<MODULE_ID>.scaleFormula` (set on the
   option when its own `scaling_column_id` is attached)

This is what makes a single `Trip Attack` feature reusable across
Battle Master, Reaver, and any feat that grants from the Maneuvers
group — the damage formula stays `@scale.linked + @mods.str.mod`,
and each granter decides which class's scaling that resolves to.

### Subclass-attributed groups

Option groups referenced from a *subclass-root* advancement carry
`subclassSourceId` in the bundle. The runtime suppresses the prompt
for non-matching subclasses — picking Champion never shows Maneuvers,
picking Battle Master does. Class-root and feature-owned groups stay
unattributed and use the existing `featureSourceId` /
`grantedFeatureSourceIds` filter.

### Required Options (chained option prereqs)

`requires_option_ids` on `unique_option_items` is a JSON array of
sibling option `sourceId`s that must already be picked before this
option becomes selectable. Authoring-side picker stores PKs; the
exporter remaps PKs → per-option sourceIds before shipping. The
runtime disables (and tooltips) any option whose prereqs aren't
covered by either prior-group selections or current-prompt
selections, and cascade-unchecks dependents when a prereq is
unchecked. Used for option chains like Eldritch Invocations that
require an earlier invocation to be active.
