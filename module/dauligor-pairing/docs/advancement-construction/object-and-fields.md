# Advancement Object Shape & Fields

> Part of the [Advancement Construction Guide](../advancement-construction-guide.md).

## Where Advancements Belong

### Advancements belong on the class item when:

- the advancement is part of the base class progression
- the advancement changes by class level
- the advancement should exist even before a specific feature item is embedded

Examples:

- Sorcerer hit points
- Sorcerer saving throws
- Sorcerer skill choices
- Sorcerer cantrips known
- Sorcerer spells known
- Sorcerer sorcery points
- Sorcerer feature grants like Spellcasting, Font of Magic, or Metamagic
- Sorcerer subclass selection

Important current rule:

- routine core class feature grants should not need to be hand-authored as visible editor rows
- the exporter should synthesize those `ItemGrant` rows from the class feature list
- explicit editor-authored `ItemGrant` rows are for special cases, not the ordinary base class feature track

### Advancements belong on the subclass item when:

- the progression is specific to one subclass
- the granted items are subclass features
- the scale only exists inside the subclass

Examples:

- Divine Soul feature grants at levels 1, 6, 14, and 18
- subclass-only scale tracks if one exists

The same export rule applies here:

- routine subclass feature grants should be synthesized into root subclass `ItemGrant` rows during export
- they do not need to appear as noisy always-present rows in the subclass editor UI

### Advancements usually do not belong on the feature item when:

- the feature item is simply something granted by the class or subclass

In most cases, a class feature item should be a `feat` item with:

- `system.description`
- `system.activities`
- `system.uses`
- `effects`
- semantic flags

The class or subclass item should then grant that feature using `ItemGrant` or `ItemChoice`.

### A simple rule for feature authoring

If the question is:

- "What does this feature do once the actor has it?"

that usually belongs on the feature item.

If the question is:

- "When does the actor get this feature, and how is that remembered?"

that usually belongs on the class or subclass advancement tree.

## General Advancement Object Shape

An advancement row is stored inside:

```json
{
  "system": {
    "advancement": {
      "pmtnr3nzZhwNOw3i": {
        "_id": "pmtnr3nzZhwNOw3i",
        "type": "HitPoints",
        "level": 1,
        "title": "Hit Points",
        "configuration": {},
        "value": {},
        "flags": {},
        "hint": ""
      }
    }
  }
}
```

The important persisted fields are:

- `_id`
- `type`
- `level`
- `title`
- `configuration`
- `value`
- `flags`
- `hint`

Some advancement families also use:

- `classRestriction`
- `icon`

For Dauligor class exports, the most important currently working root families are:

- `HitPoints`
- `Trait`
- `ScaleValue`
- `ItemGrant`
- `ItemChoice`
- `Subclass`
- `AbilityScoreImprovement`

## What Each Top-Level Field Means

### `_id`

- type: string
- actor-embedded requirement: must be a valid 16-character alphanumeric Foundry id
- purpose: local identity for that advancement row

This is one of the most important implementation details.

For Dauligor:

- world items may preserve semantic/source-style advancement identity if the system accepts it
- actor-embedded class and subclass items should use Foundry-safe 16-character `_id` values
- the semantic id should be preserved separately in flags

Recommended actor-side pattern:

```json
{
  "_id": "AbCdEf123456GhIj",
  "flags": {
    "dauligor-pairing": {
      "sourceAdvancementId": "classSorcererHitPoints"
    }
  }
}
```

### `type`

- type: string
- purpose: chooses the advancement family and its schema

Supported families in `dnd5e` `5.3.1`:

- `AbilityScoreImprovement`
- `HitPoints`
- `ItemChoice`
- `ItemGrant`
- `ScaleValue`
- `Size`
- `Subclass`
- `Trait`

### `level`

- type: integer
- purpose: the class/race/background/etc level where the advancement applies

For classes and subclasses, this is usually the character level within that class progression, not actor total level.

### `title`

- type: string
- purpose: the sheet-facing label shown on the Advancement tab

Examples:

- `Hit Points`
- `Saving Throws`
- `Skills`
- `Cantrips Known`
- `Features`
- `Sorcery Points`

### `configuration`

- type: object
- purpose: the static definition of what the advancement is allowed to do

This is the design-time part of the advancement.

Examples:

- the skill pool a Trait advancement can offer
- the scale table a ScaleValue advancement uses
- the granted item list an ItemGrant advancement can add
- the ASI points cap on AbilityScoreImprovement

### `value`

- type: object
- purpose: the actor- or item-specific realized state of the advancement

This is the runtime/persisted choice layer.

Examples:

- which skills were chosen
- which items were actually granted
- which HP result was taken at each level
- which item choices replaced earlier ones

If `configuration` says what can happen, `value` says what did happen.

### `flags`

- type: object
- purpose: custom module metadata

For Dauligor, use this for:

- `sourceAdvancementId`
- migration metadata
- provenance metadata

### `hint`

- type: string
- purpose: extra UI/help text

Usually optional.

## `configuration` Versus `value`

This distinction is the single most important rule to keep straight.

### `configuration` is for static rules

Examples:

- "Choose 2 from Arcana, Deception, Insight, Intimidation, Persuasion, Religion"
- "At level 2 the value is 2, at level 3 the value is 3"
- "Grant Font of Magic and Sorcery Points at level 2"

### `value` is for realized state

Examples:

- `"chosen": ["skills:itm", "skills:per"]`
- `"1": "max", "2": 4, "3": 6`
- `"added": { "abc...": "Actor.X.Item.abc..." }`

### Common mistake

Do not write actor decisions into `configuration`.

Do not treat `configuration` as "current state."

That will break reimport, level-up continuation, and actor reconstruction.

