# Dauligor Reference Syntax Guide

This document defines the reference syntax Dauligor should use when the site wants to reference:

- actor statistics
- ability scores and modifiers
- hit points
- proficiency bonus
- class levels
- class scales such as Sorcery Points
- semantic game documents such as classes, subclasses, features, and options

The goal is consistency between:

- the Dauligor site
- Dauligor semantic exports
- Foundry imports

This is deliberately not just a copy of raw Foundry references.

Instead:

- Dauligor should use stable semantic references
- the module should translate those references into Foundry-native paths or UUID links at import time

## Why This Exists

Foundry has multiple reference systems:

- formula paths like `@abilities.cha.mod`
- roll data paths like `@attributes.hp.max`
- text enrichment links like `@UUID[...]`

Those are useful, but they are too Foundry-specific to be the primary app contract.

Dauligor needs something that is:

- readable on the site
- stable even if Foundry internals shift
- based on semantic class and feature identifiers
- convertible into Foundry on import

## Core Rule

Dauligor should store semantic references.

The module should normalize them into:

- Foundry formula references
- literal computed values
- Foundry UUID links

Dauligor should not store raw world UUIDs as its primary reference format.

For the official native class and scale reference surface, plus the effect-side keys that correspond to it, see:

- `docs/class-reference-surface.md`

## Two Reference Families

There are two kinds of references in practice.

### 1. Scalar references

These represent numeric or formula-usable values.

Examples:

- `@prof`
- `@ability.cha.mod`
- `@attr.hp.max`
- `@class.sorcerer.level`
- `@scale.sorcerer.sorcery-points`

These are the references that matter inside:

- formulas
- activity fields
- custom roll logic
- text that wants to display a computed value

### 2. Entity references

These represent links to semantic game documents.

Examples:

- `@class[class-sorcerer]{Sorcerer}`
- `@subclass[subclass-divine-soul]{Divine Soul}`
- `@feature[class-feature-font-of-magic]{Font of Magic}`
- `@option[class-option-careful-spell]{Careful Spell}`

These are the references that matter inside:

- prose descriptions
- hover or click links on the site
- imported rich text that should become Foundry links later

## Recommended Grammar

### Scalar reference grammar

```text
@namespace.segment.segment
```

Examples:

- `@prof`
- `@level`
- `@ability.cha.score`
- `@ability.cha.mod`
- `@attr.hp.max`
- `@class.sorcerer.level`
- `@scale.sorcerer.sorcery-points`

Rules:

- use lowercase namespaces
- use semantic slugs for class identifiers and scale identifiers
- use stable property names
- avoid spaces

### Entity reference grammar

```text
@kind[semantic-id]{Display Label}
```

Examples:

- `@class[class-sorcerer]{Sorcerer}`
- `@subclass[subclass-divine-soul]{Divine Soul}`
- `@feature[class-feature-metamagic]{Metamagic}`
- `@option[class-option-careful-spell]{Careful Spell}`
- `@source[source-phb-2014]{Player's Handbook}`

Rules:

- `semantic-id` should be the stable semantic `sourceId`, not the app record id
- `{Display Label}` is optional for storage, but recommended when the text should remain legible even if the reference cannot be resolved later

## Supported Scalar Namespaces

These are the namespaces we should treat as the first supported reference surface.

## `@prof`

Meaning:

- the actor's proficiency bonus

Example:

- `@prof`

Foundry mapping:

- direct to `@prof`

Notes:

- this is one of the few cases where the semantic syntax and the Foundry syntax can match exactly

## `@level`

Meaning:

- total character level

Example:

- `@level`

Foundry mapping:

- `@details.level`

Important:

- treat this as total character level
- do not use it when you specifically mean a class level

## `@ability`

Recommended shape:

```text
@ability.<ability>.score
@ability.<ability>.mod
```

Examples:

- `@ability.str.score`
- `@ability.dex.mod`
- `@ability.cha.mod`

Supported ability keys:

- `str`
- `dex`
- `con`
- `int`
- `wis`
- `cha`

Meanings:

- `.score`
  - raw ability score
- `.mod`
  - ability modifier

Foundry mappings:

- `@ability.str.score -> @abilities.str.value`
- `@ability.str.mod -> @abilities.str.mod`
- `@ability.dex.score -> @abilities.dex.value`
- `@ability.dex.mod -> @abilities.dex.mod`
- and so on

Recommended rule:

- use `score` and `mod` as the canonical Dauligor properties
- let the module translate to Foundry's exact property names

## `@attr`

Use this for actor attributes.

### Hit points

Recommended shape:

```text
@attr.hp.value
@attr.hp.max
@attr.hp.temp
@attr.hp.tempmax
```

Examples:

- `@attr.hp.value`
- `@attr.hp.max`
- `@attr.hp.temp`

Foundry mappings:

- `@attr.hp.value -> @attributes.hp.value`
- `@attr.hp.max -> @attributes.hp.max`
- `@attr.hp.temp -> @attributes.hp.temp`
- `@attr.hp.tempmax -> @attributes.hp.tempmax`

### Other attribute-style roots

We should reserve this namespace for things that live under `system.attributes`.

Future examples could include:

- `@attr.ac.value`
- `@attr.init.mod`
- `@attr.spellcasting`

But unless the module explicitly supports those, do not assume every attribute path is valid yet.

## `@class`

Use this when referencing a specific class on the actor.

Recommended shape:

```text
@class.<class-identifier>.<property>
```

Examples:

- `@class.sorcerer.level`
- `@class.sorcerer.hit-die`
- `@class.sorcerer.hit-die-faces`
- `@class.sorcerer.hit-die-number`
- `@class.sorcerer.spellcasting-ability`

### `@class.<identifier>.level`

Meaning:

- the actor's current level in that class

Example:

- `@class.sorcerer.level`

Foundry mapping:

- `@classes.sorcerer.levels`

This mapping is based on the local `dnd5e` roll data structure where class entries are keyed by class identifier.

### `@class.<identifier>.hit-die`

Meaning:

- the class hit die string

Example:

- `@class.sorcerer.hit-die`

Foundry mapping:

- `@classes.sorcerer.hd.denomination`

Important:

- `dnd5e` 5.3.1 documents the native class hit-die path as `@classes.<identifier>.hd.denomination`
- that is the preferred normalization target for new imports

### `@class.<identifier>.hit-die-faces`

Meaning:

- numeric hit die face count

Example:

- `@class.sorcerer.hit-die-faces`

Semantic result:

- Sorcerer -> `6`

Foundry mapping:

- not a direct native roll-data path
- the module should derive it from `@classes.sorcerer.hd.denomination`
  - example: `d6 -> 6`

### `@class.<identifier>.hit-die-number`

Meaning:

- how many hit dice are rolled per class level

Example:

- `@class.sorcerer.hit-die-number`

Semantic result:

- standard classes -> `1`

Foundry mapping:

- usually a derived literal
- this is not a native `dnd5e` roll-data field

### `@class.<identifier>.spellcasting-ability`

Meaning:

- the spellcasting ability used by that class

Example:

- `@class.sorcerer.spellcasting-ability`

Foundry mapping:

- `@classes.sorcerer.spellcasting.ability`

This is mostly useful for semantic display or future logic, not usually for numeric formulas directly.

## `@scale`

Use this when referencing a class scale value that depends on class level.

Recommended shape:

```text
@scale.<class-identifier>.<scale-identifier>
```

Examples:

- `@scale.sorcerer.sorcery-points`
- `@scale.sorcerer.metamagic`
- `@scale.sorcerer.cantrips-known`
- `@scale.sorcerer.spells-known`

This is a Dauligor semantic reference which also maps cleanly to a native `dnd5e` scale reference.

### Why `@scale` is special

`dnd5e` 5.3.1 documents native scale refs in this shape:

- `@scale.<parent-item-identifier>.<scale-identifier>`

Scale values are still driven by `ScaleValue` advancements on the class or subclass item.

That means:

- the site should still use `@scale.sorcerer.sorcery-points`
- the module must ensure the parent item identifier and scale advancement identifier line up
- the module can then normalize directly to native `@scale.*.*` syntax

### `@scale.sorcerer.sorcery-points`

Meaning:

- current Sorcery Points value from the Sorcerer class progression

Foundry mapping:

- `@scale.sorcerer.sorcery-points`

Import behavior:

1. find the Sorcerer class item by `system.identifier = "sorcerer"`
2. find the `ScaleValue` advancement with identifier `sorcery-points`
3. if those identifiers line up, keep the native `@scale.sorcerer.sorcery-points` ref in formulas
4. in prose fields, normalize to `[[lookup @scale.sorcerer.sorcery-points]]`

### `@scale.sorcerer.metamagic`

Meaning:

- number of Metamagic choices known at the actor's current Sorcerer level

### `@scale.sorcerer.cantrips-known`

Meaning:

- current cantrips known count from Sorcerer class progression

### `@scale.sorcerer.spells-known`

Meaning:

- current spells known count from Sorcerer class progression

## `@skill`

Use this when referencing a skill specifically.

Recommended shape:

```text
@skill.<skill>.prof
```

or

```text
@skill.<skill>.value
```

Examples:

- `@skill.arc.prof`
- `@skill.per.value`

Current recommendation:

- only rely on this if the module explicitly supports it
- for now, the stronger character-creator contract is to treat skills as class `Trait` advancement choices rather than as standalone formula refs

This namespace is useful, but it is a second-wave priority compared to:

- `@prof`
- `@ability.*`
- `@attr.hp.*`
- `@class.*`
- `@scale.*`

## Entity Reference Kinds

These are the semantic entity kinds we should support first.

### `@class[...]`

Example:

- `@class[class-sorcerer]{Sorcerer}`

Meaning:

- link or mention the class document identified by `class-sorcerer`

### `@subclass[...]`

Example:

- `@subclass[subclass-divine-soul]{Divine Soul}`

Meaning:

- link or mention the subclass document identified by `subclass-divine-soul`

### `@feature[...]`

Example:

- `@feature[class-feature-font-of-magic]{Font of Magic}`

Meaning:

- link or mention a class or subclass feature item

### `@option[...]`

Example:

- `@option[class-option-careful-spell]{Careful Spell}`

Meaning:

- link or mention an option item, such as a Metamagic option

### `@source[...]`

Example:

- `@source[source-phb-2014]{Player's Handbook}`

Meaning:

- link or mention a source/book record

## Import Mapping Rules

The module should translate semantic references using these rules.

### Rule 1. Prefer native Foundry formula paths when they exist

Examples:

- `@prof -> @prof`
- `@ability.cha.mod -> @abilities.cha.mod`
- `@attr.hp.max -> @attributes.hp.max`
- `@class.sorcerer.level -> @classes.sorcerer.levels`

### Rule 2. Normalize semantic scale refs to native `@scale.*.*` refs when identifiers line up

Examples:

- `@scale.sorcerer.sorcery-points`
- `@scale.sorcerer.metamagic`

These should normalize to native `dnd5e` scale refs after the module verifies:

- the parent class or subclass item identifier
- the target `ScaleValue` advancement identifier

### Rule 3. Convert entity refs into Foundry UUID-style links only at import time

Examples:

- `@feature[class-feature-font-of-magic]{Font of Magic}`

If a concrete imported document exists:

- translate to a Foundry UUID-backed link

If it does not exist yet:

- keep the semantic reference or render as plain text

### Rule 4. Never require the app to know Foundry UUIDs ahead of time

The site should store:

- semantic ids

The module should look up:

- world item UUIDs
- embedded actor item UUIDs

## Recommended Site-Side Support Rules

The Dauligor site should treat these as the canonical first-wave references:

- `@prof`
- `@level`
- `@ability.<ability>.score`
- `@ability.<ability>.mod`
- `@attr.hp.value`
- `@attr.hp.max`
- `@attr.hp.temp`
- `@class.<class>.level`
- `@class.<class>.hit-die`
- `@scale.<class>.<scale>`
- `@class[...]`
- `@subclass[...]`
- `@feature[...]`
- `@option[...]`
- `@source[...]`

If a reference is not in that set yet, do not assume it is stable enough to standardize.

## Recommended Importer-Side Support Order

The module should implement these in this order:

1. direct scalar passthroughs
   - `@prof`
   - `@ability.*`
   - `@attr.hp.*`
   - `@class.*.level`
2. semantic class-derived refs
   - `@class.*.hit-die`
   - `@class.*.hit-die-faces`
   - `@class.*.hit-die-number`
   - `@class.*.tier`
   - `@subclass.*.level`
3. scale refs
   - `@scale.*.*`
   - `@scale.*.*.number`
   - `@scale.*.*.die`
   - `@scale.*.*.faces`
   - `@scale.*.*.denom`
4. entity refs
   - `@class[...]`
   - `@subclass[...]`
   - `@feature[...]`
   - `@option[...]`
   - `@source[...]`

## Examples

### Example 1. Class feature description

Site-side text:

```text
You have @scale.sorcerer.sorcery-points Sorcery Points and use @ability.cha.mod for your spellcasting modifier.
```

Import behavior:

- `@scale.sorcerer.sorcery-points`
  - normalized to `[[lookup @scale.sorcerer.sorcery-points]]` in prose fields
- `@ability.cha.mod`
  - normalized to `[[lookup @abilities.cha.mod]]` in prose fields
  - translated to `@abilities.cha.mod` in formula fields

### Example 2. HP-related custom formula helper

Site-side semantic formula:

```text
@class.sorcerer.hit-die-number d @class.sorcerer.hit-die-faces min 4
```

Practical normalized result:

```text
1d6min4
```

This is exactly why class hit-die references should be semantic and not hardcoded.

### Example 3. Linking a feature in prose

Site-side text:

```text
You gain @feature[class-feature-font-of-magic]{Font of Magic} at 2nd level.
```

Import behavior:

- if the feature item exists in Foundry, convert to a UUID-backed link
- otherwise preserve the semantic reference until it can be resolved later

## What Not To Do

Do not do these:

- raw Foundry UUIDs in app-authored source text
- raw embedded actor item ids in app-authored source text
- random database ids as the public reference syntax
- mixing app ids and semantic ids in the same reference family

Bad examples:

- `@UUID[Actor.x.Item.y]`
- `@item[awWmrbo3YxCMU86t7Yb9]`
- `@scale.joi0FqfJfNvgzrUlMmbn.gAdTi2hIzf6NRFc08Z9s`

Good examples:

- `@feature[class-feature-font-of-magic]`
- `@class.sorcerer.level`
- `@scale.sorcerer.sorcery-points`

## Current Module State

The module now has a first-wave semantic reference normalizer.

Current behavior:

1. first-wave scalar refs normalize to native Foundry formula paths
2. prose fields normalize scalar refs to `[[lookup ...]]`
3. scale refs normalize to native `@scale.*.*` refs after class advancement identifiers are checked
4. semantic entity refs normalize to `@UUID[...]` links when matching documents exist

That gives the site and Foundry one shared reference language instead of two unrelated ones.
