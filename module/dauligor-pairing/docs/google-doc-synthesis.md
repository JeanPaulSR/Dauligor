# Google Doc Synthesis

This file distills the strongest schema-relevant points from:

- [FoundryVTT DND5e Data Model Deep Dive](https://docs.google.com/document/d/1yYynpsA0MnvTdKCkDs_jxATMLzFi7j1dUVby7hE8vhM/edit?usp=sharing)

It is intended to be a text-first reference for future agents, especially when they cannot access:

- the local Foundry install
- the local `dnd5e` system files
- the local Plutonium module

## How to use this source

Treat this document as:

- high-value architectural guidance
- high-value vocabulary and schema-shape guidance
- a strong source for what categories and sub-systems matter

Do not treat it as the only authority for literal field names.

Why:

- the Google Doc is excellent at explaining structure and mechanics
- live Foundry exports remain the best source for exact runtime JSON
- local `dnd5e` templates and code remain the best source for current sheet-facing field names

If the Google Doc and a real export disagree:

1. trust the real export
2. use the Google Doc to understand the underlying intent

## Core architectural conclusions

The strongest cross-cutting conclusions from the Google Doc are:

1. Modern Foundry + `dnd5e` is built around strict data models, not loose JSON blobs.
2. The `system` payload is not arbitrary. It is validated by DataModel/TypeDataModel rules.
3. Imports should be designed around:
   - actor models
   - item models
   - activity models
   - advancement models
   - active effects
4. Character state is increasingly split across:
   - actor root/system data
   - embedded items
   - advancement data
   - effects
5. "Use in play" behavior is a first-class concern, not just an afterthought after import.

## DataModel fundamentals

The Google Doc strongly reinforces the move from unvalidated template-driven data to:

- `DataModel`
- `TypeDataModel`
- typed field validation

Important implications for Dauligor:

- invalid types can cause validation failure
- nullability matters
- nested structures should exist in the shape the system expects
- migration and initialization behavior can transform raw `_source` data into richer runtime objects

The document also highlights the distinction between:

- `_source`
  - serialized database JSON
- initialized runtime state
  - richer in-memory structures

This matters for schema research because a dumped Foundry document may contain:

- values you should preserve
- values that are derived or initialized

## Important field families called out by the Google Doc

The document repeatedly emphasizes these field categories:

- `SchemaField`
- `StringField`
- `NumberField`
- `BooleanField`
- `ArrayField`
- `SetField`
- `HTMLField`
- `ObjectField`
- `EmbeddedCollectionField`

Practical Dauligor takeaway:

- if a field conceptually behaves like a set, array, object, boolean, or number, keep that distinction in the import schema
- do not flatten everything into free-form strings

## Actor-side conclusions

The Google Doc treats actors as strongly typed containers with:

- core metadata
- `system`
- embedded `items`
- embedded `effects`
- `flags`

It also highlights the major actor types:

- `character`
- `npc`
- `vehicle`
- `group`

### Character actors

The document strongly supports these as key branches:

- `system.abilities`
- `system.skills`
- `system.attributes`
- `system.traits`

High-value examples from the document:

- abilities contain raw score, proficiency state, and bonus formulas
- skills contain proficiency level, linked ability, and bonus formulas
- HP/AC/movement/senses are part of the central actor state
- resistances, immunities, and condition traits are structured data, not flavor text

Important Dauligor implication:

- a player character import should not be modeled as "just a list of items"
- actor root/system data is a required part of a serious character import

### NPC actors

The document emphasizes that NPCs share many branches with characters but add or prioritize:

- challenge rating
- HP formula
- legendary resources

Important Dauligor implication:

- NPC imports should have a dedicated mapper
- they should not be treated as reskinned character imports

## Item-side conclusions

The Google Doc treats items as typed documents where physical goods share common inventory fields while specialized item types add rule-specific structures.

Important recurring physical item concepts:

- quantity
- weight
- price
- equipped
- attuned

This strongly supports the idea that Dauligor should maintain:

- a common physical-item layer
- type-specific overlays for weapon, equipment, consumable, tool, loot, spell, feat, class, subclass, and so on

### Important caution

Some field names in the Google Doc appear more generalized than the currently dumped live data.

For example:

- the architecture is correct
- the exact nested property names may still need to be verified against live Foundry exports

So use the Google Doc as:

- "what kinds of data must exist"

not always as:

- "the final exact path spelling to write blindly"

## Activity system conclusions

This is one of the highest-value sections in the Google Doc.

It strongly supports the idea that the activity system is the true behavioral engine for many items.

The document explicitly treats activities as the container for:

- attacks
- damage
- healing
- saves
- checks
- cast
- forward
- use
- enchant
- summon
- transform

Important Dauligor implication:

- many imports will feel incomplete or broken if they only recreate descriptive item data without meaningful activities

### Why activities matter

The doc’s strongest point here is architectural:

- the item is often the container
- the activity is often the behavior

That lines up with the live `dnd5e` direction in v13/5.3.1 and should shape how future agents think about:

- spells
- weapons
- consumables
- special magic items
- class-linked actions

## Advancement conclusions

The Google Doc treats advancement as a dedicated API layer rather than a miscellaneous side field.

This is one of the most important schema conclusions for classes and subclasses.

It highlights a shared advancement structure with concepts like:

- `_id`
- `type`
- `level`
- `title`
- `icon`
- `classRestriction`

And it explicitly calls out major advancement types such as:

- `AbilityScoreImprovement`
- `HitPoints`
- `ItemChoice`
- `ItemGrant`
- `ScaleValue`
- `Size`
- `Subclass`
- `Trait`

Important Dauligor implication:

- the app schema should be able to describe advancement intent at a structured level
- the final Foundry mapper will likely need to synthesize advancement payloads rather than copy raw source text

### Scale values are especially important

The Google Doc emphasizes that `ScaleValue` advancements power dynamic class features such as:

- martial arts dice
- sneak attack
- similar scaling resources

This is extremely relevant for Dauligor because the app already thinks in terms of:

- scaling columns
- level-based progression
- variable feature quantities

So future agents should treat scaling as a first-class schema concept, not as a UI-only table artifact.

## Active effect conclusions

The Google Doc’s active effect section is also high value.

It highlights core effect fields such as:

- `name`
- `disabled`
- `duration`
- `origin`
- `tint`
- `statuses`
- `changes`

The most important practical section is the explanation of the `changes` array:

- `key`
- `value`
- `mode`
- `priority`

Important Dauligor implication:

- effects should be represented explicitly in the intermediate schema when they are mechanically meaningful
- imported enchantments, buffs, debuffs, and item-driven state changes should not all be flattened into prose

## Best schema rules supported by the Google Doc

These are the strongest actionable rules supported by the text:

1. Treat `Actor`, `Item`, `Activity`, `Advancement`, and `ActiveEffect` as separate but connected schema families.
2. Split source-side meaning from Foundry-side storage.
3. Preserve stable identifiers and references.
4. Do not treat classes as simple descriptive items.
5. Do not treat item behavior as secondary to item description.
6. Build imports so that chat cards, uses, activities, and effects can work in play.

## What this adds beyond the existing docs

Compared with the earlier Dauligor research docs, the Google Doc adds strong reinforcement for:

- DataModel strictness
- actor schema structure
- activity-first item behavior
- formal advancement types
- active effect mutation design

This means future agents should be more confident saying:

- "this must be structured"

and less likely to accept:

- "we can probably just stuff this into description text"

## Recommended use in future agent runs

When future agents work on the importer:

1. Read this file first.
2. Read `docs/foundry-dnd5e-reference.md`.
3. Read `docs/schema-crosswalk.md`.
4. Inspect corpus examples.
5. Only then propose or implement schema changes.
