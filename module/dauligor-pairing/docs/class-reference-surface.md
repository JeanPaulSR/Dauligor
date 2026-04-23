# Dauligor Class Reference Surface

This document is the native class-reference companion to:

- `docs/reference-syntax-guide.md`

Use this file when the question is:

- which class and scale references does `dnd5e` already understand?
- which class-related effect keys are important for classes, subclasses, and scales?
- what should the module normalize Dauligor semantic refs into?

Do not use this file as the semantic grammar guide. That belongs in:

- `docs/reference-syntax-guide.md`

## Scope

This file is intentionally narrow.

It covers:

- native `dnd5e` class and subclass formula references
- native `dnd5e` scale references
- the most important class-related Active Effect keys
- the semantic-to-native mapping summary for class-heavy refs

It does not redefine:

- the Dauligor reference grammar
- general actor references outside class-heavy usage
- entity-link syntax

## Native Formula Surface

The native class-driven reference surface in `dnd5e` 5.3.x is:

- `@classes.<identifier>.levels`
- `@classes.<identifier>.hd.denomination`
- `@classes.<identifier>.hd.spent`
- `@classes.<identifier>.tier`
- `@subclasses.<identifier>.levels`
- `@scale.<parent-identifier>.<scale-identifier>`
- `@scale.<parent-identifier>.<scale-identifier>.number`
- `@scale.<parent-identifier>.<scale-identifier>.die`
- `@scale.<parent-identifier>.<scale-identifier>.faces`
- `@scale.<parent-identifier>.<scale-identifier>.denom`

Important:

- the class or subclass identifier in these formulas is the Foundry item `system.identifier`
- that identifier should stay aligned with the Dauligor semantic `identifier`

## Native Effect Surface

These are the most important class-adjacent effect keys.

### Scale values

- `system.scale.<identifier>.<scale>.value`
- `system.scale.<identifier>.<scale>.number`
- `system.scale.<identifier>.<scale>.faces`
- `system.scale.<identifier>.<scale>.modifiers`

Examples:

- `system.scale.sorcerer.sorcery-points.value`
- `system.scale.rogue.sneak-attack.number`
- `system.scale.rogue.sneak-attack.faces`

### HP and proficiency fields often touched by class features

- `system.attributes.hp.bonuses.level`
- `system.attributes.hp.bonuses.overall`
- `system.attributes.prof`

These are not class refs by themselves, but they are common destinations for class-feature effects.

## Dauligor Semantic Refs That Commonly Map Here

These are the class-heavy semantic refs that eventually map into the native surface above:

- `@class.<identifier>.level`
- `@class.<identifier>.tier`
- `@class.<identifier>.hit-die`
- `@class.<identifier>.hit-die-faces`
- `@class.<identifier>.hit-die-number`
- `@subclass.<identifier>.level`
- `@scale.<parent-identifier>.<scale-identifier>`
- `@scale.<parent-identifier>.<scale-identifier>.number`
- `@scale.<parent-identifier>.<scale-identifier>.die`
- `@scale.<parent-identifier>.<scale-identifier>.faces`
- `@scale.<parent-identifier>.<scale-identifier>.denom`

For the full semantic grammar and non-class namespaces, use:

- `docs/reference-syntax-guide.md`

## Semantic To Native Mapping Summary

| Dauligor semantic ref | Native Foundry ref or value | Notes |
| --- | --- | --- |
| `@class.sorcerer.level` | `@classes.sorcerer.levels` | class level |
| `@class.sorcerer.tier` | `@classes.sorcerer.tier` | class tier |
| `@class.sorcerer.hit-die` | `@classes.sorcerer.hd.denomination` | native hit-die string |
| `@class.sorcerer.hit-die-faces` | literal derived value such as `6` | module-derived |
| `@class.sorcerer.hit-die-number` | literal derived value such as `1` | module-derived |
| `@subclass.divine-soul.level` | `@subclasses.divine-soul.levels` | subclass-owning class level |
| `@scale.sorcerer.sorcery-points` | `@scale.sorcerer.sorcery-points` | native scale ref |
| `@scale.sorcerer.sorcery-points.number` | `@scale.sorcerer.sorcery-points.number` | numeric scale component |
| `@scale.sorcerer.sorcery-points.die` | `@scale.sorcerer.sorcery-points.die` | die object/value family |
| `@scale.sorcerer.sorcery-points.faces` | `@scale.sorcerer.sorcery-points.faces` | dice scales only |
| `@scale.sorcerer.sorcery-points.denom` | `@scale.sorcerer.sorcery-points.denom` | dice scales only |

## Scale Resolution Rule

The module should only treat a semantic scale ref as resolved when:

1. the parent item identifier is known
2. the scale advancement identifier is known
3. the imported item actually contains the matching scale advancement

Example:

- parent identifier: `sorcerer`
- scale identifier: `sorcery-points`
- native ref: `@scale.sorcerer.sorcery-points`

## Usage Rule

Use:

- `docs/reference-syntax-guide.md`
  - when defining what the app stores
- this document
  - when checking what Foundry already supports natively
