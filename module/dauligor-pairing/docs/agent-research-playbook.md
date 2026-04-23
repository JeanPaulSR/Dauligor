# Agent Research Playbook

This file is meant for future agents that may not have access to:

- the local Foundry install
- the local `dnd5e` system files
- the local Plutonium module

It explains how to continue useful schema work using only:

- public web sources
- the `dauligor-pairing` example module docs
- exported corpus files collected in this module

## Minimum source stack for remote agents

If local access is unavailable, use this stack:

1. `docs/google-doc-synthesis.md`
2. `docs/foundry-dnd5e-reference.md`
3. `docs/schema-crosswalk.md`
4. files in `docs/corpus/`
5. official Foundry docs/articles
6. public 5etools source JSON

If local exports are available in the corpus, trust them over public recollection.

## What remote agents should assume

Safe assumptions:

- Foundry document exports are the strongest evidence when present
- `dnd5e` item behavior likely depends heavily on `system.activities`
- classes and subclasses require structural identifiers
- sync-safe imports require stable source IDs in module flags

Unsafe assumptions:

- that 5etools JSON can be imported directly as Foundry item data
- that descriptive text alone is enough for a usable Foundry item
- that a class can be represented without structured advancement data
- that "feature" always maps to a single `feat` item

## Public sources to prefer

Official Foundry sources:

- module development article
- Foundry v13 API docs
- `ApplicationV2` docs
- hook and document APIs
- the Google Doc deep dive distilled in `docs/google-doc-synthesis.md`

Public 5etools sources:

- raw class JSON
- raw spell JSON
- raw item JSON

## How to work without local Foundry access

If you only have these docs and no runtime system:

1. Start from a corpus example if one exists.
2. Compare the 5etools-side source file to the Foundry-side export.
3. Write down the transformation rules, not just the fields.
4. Separate:
   - descriptive source fields
   - normalized intermediate fields
   - final Foundry document fields

## Transformation questions every agent should answer

For each content type, answer these explicitly:

1. What is the stable source identifier?
2. What Foundry document type should be created?
3. Which fields are copied directly?
4. Which fields are inferred or synthesized?
5. Which behavior is stored in `system.activities`?
6. Which mechanics should be represented as effects?
7. Which data belongs on the actor vs embedded items?
8. What would a user expect to happen when clicking "use" in Foundry?

## PDF section map as a research guide

The companion PDF deep dive appears to cover these major sections:

- foundational data model architecture
- base actor schema
- character and NPC data models
- weapon, equipment, consumable, tool, loot, and backpack specifics
- spell specifics
- core activity schema
- combat resolution and defensive checks
- state mutations such as enchant, summon, transform
- shared and specific advancement schema
- active effects data model

Even if an agent cannot open the PDF directly, those section headings are a strong hint about where schema work should be organized.

## Why the Google Doc matters

The Google Doc is currently the best text-first architecture source in this module because it ties together:

- actor data models
- item data models
- activity architecture
- advancement schema
- active effects

It is especially valuable for remote agents because it explains:

- why structure matters
- which subsystems exist
- which categories are first-class in Foundry

Use it for system understanding, then use corpus exports for exact field verification.

## Special caution for classes and subclasses

If a task involves classes or subclasses, assume additional complexity until proven otherwise.

Checklist:

- class slug identifier
- subclass slug identifier
- subclass parent class identifier
- level progression
- hit dice
- multiclass requirements
- proficiencies and choices
- spellcasting progression
- advancement objects

## Special caution for items

When an agent sees an item request, they should not stop at:

- `name`
- `type`
- `description`
- `price`
- `weight`

They should also investigate:

- uses
- recovery
- activities
- damage or healing structures
- attack/save flow
- attunement
- magical bonus
- effects
- chat-card quality

## Best remote-agent workflow

1. Read the schema docs in this module.
2. Pick one corpus category.
3. Compare a 5etools source example to a Foundry export example.
4. Write a transformation table.
5. Only then propose schema changes or importer logic.

## What to do if a needed corpus example is missing

If a category is missing from the corpus, the agent should explicitly say:

- which category is missing
- what assumptions are currently weak
- what example should be exported next from Foundry

This avoids overconfident schema design based only on memory.
