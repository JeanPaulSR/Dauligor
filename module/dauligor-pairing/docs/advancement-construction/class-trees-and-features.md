# Class Advancement Trees & Features

> Part of the [Advancement Construction Guide](../advancement-construction-guide.md).

## What A Correct Class Advancement Tree Usually Looks Like

A well-formed class usually mixes several advancement families.

Example patterns:

- `HitPoints`
  - records per-level HP gains
- `Trait`
  - saving throws
  - skills
  - weapon proficiencies
- `ScaleValue`
  - cantrips known
  - spells known
  - class resources
- `ItemGrant`
  - feature items granted at specific levels
- `Subclass`
  - subclass selection from the base class
- `AbilityScoreImprovement`
  - ASI/boon choices at later levels

This is why a feature-rich class is not modeled by one advancement family alone.

## Class Features Versus Advancements

This is the piece that usually causes the most confusion.

### A class feature item is usually a `feat`

The feature item should define:

- name
- semantic identity
- description
- activities
- effects
- uses
- references

### The class advancement should define:

- what level grants the feature
- whether the feature is optional or required
- whether it is one feature or a choice among many
- what actor-side grant state was actually realized

### Example

`Font of Magic` should usually be represented as:

1. a `feat` item named `Font of Magic`
2. a `ScaleValue` advancement for `sorcery-points`
3. an `ItemGrant` advancement on the Sorcerer class that grants the `Font of Magic` feat item

The feature item explains the rule text and activities.

The class advancement tree explains when it exists and how it is persisted.

## Class Feature Patterns

### Pattern 1: fixed class feature

Use:

- `ItemGrant`

Examples:

- Spellcasting
- Font of Magic
- Magical Guidance

### Pattern 2: fixed subclass feature

Use:

- subclass item owns the `ItemGrant`

Examples:

- Divine Magic
- Empowered Healing
- Otherworldly Wings

### Pattern 3: choice among several feature-like options

Use:

- `ItemChoice` when the options are best modeled as items
- `Trait` when the options are trait/proficiency pools

Examples:

- Metamagic options
- fighting styles
- maneuver choices

### Pattern 4: deterministic level resource or progression

Use:

- `ScaleValue`

Examples:

- sorcery points
- cantrips known
- spells known
- metamagic count

### Pattern 5: actor decision at each gained level

Use:

- `HitPoints`
- future `AbilityScoreImprovement`
- `Trait`
- `ItemChoice`

These are the advancement families where `value` persistence matters most.

