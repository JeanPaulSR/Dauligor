# Dauligor Pairing Reference

This file documents the practical target shape for imports into your local setup:

- Foundry VTT core `13.351`
- `dnd5e` system `5.3.1`

The goal is not to guess every possible internal field. The goal is to define a solid minimum contract for the Dauligor app and give future agents a map of what Foundry expects.

## Text-first deep dive

The best text-first companion source for this module is:

- `docs/google-doc-synthesis.md`

That synthesis is based on the Google Doc deep dive and is especially useful for:

- remote agents without local system access
- understanding the architecture behind `system`, activities, advancements, and effects
- knowing which data families should be treated as first-class structures

Use it for architectural understanding, but continue to trust real Foundry exports for exact runtime JSON.

## Reference strategy for future agents

When building Dauligor schemas or mappers, use three sources together:

1. Real Foundry exports from this module
2. Local `dnd5e` system templates/code from the installed version
3. Plutonium output and behavior as a practical reference implementation

Use them in that order.

Why:

- real Foundry exports show the exact document shape your world is currently using
- local `dnd5e` files show which fields are meaningful to the sheet and advancement flows
- Plutonium shows how a mature importer chooses to map external content into Foundry documents

Important caution:

- Plutonium is an inspiration source, not the final authority
- if Plutonium and a real Foundry export disagree, trust the real export from your current Foundry + `dnd5e` version
- if a field exists in system templates/code but not in a real exported document, treat it as optional until proven necessary

## Core rule

When possible, treat real Foundry exports as canonical.

For schema work, the safest loop is:

1. Create or import a representative document in Foundry.
2. Export or dump it with this module.
3. Use that JSON as the reference target for the Dauligor payload mapper.

This matters because `dnd5e` has many defaults, migrations, and type-specific nested fields.

## Common document envelope

Most Foundry documents share these root fields:

- `_id`
- `name`
- `type` for typed documents like `Actor` and `Item`
- `img`
- `system`
- `flags`
- `folder`
- `ownership`
- `_stats`
- `sort`

For imports, you usually do not need to provide all of them.

Safe fields to provide from Dauligor:

- `name`
- `type`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`

Fields usually best omitted on import:

- `_id`
- `_stats`
- `folder`
- `ownership`
- `sort`

## Actor expectations

The most important actor types for your project are:

- `character`
- `npc`

For characters, Foundry usually stores build data partly on the actor and partly in embedded items.

Character build information commonly lives in:

- actor `system` for ability scores, currency, biography, traits, senses, movement, etc.
- embedded `Item` documents for class, subclass, feats, spells, inventory, species/race, background

This means a full character import is normally:

1. Update actor root/system data
2. Upsert embedded items

### Actor structural rules reinforced by the deep dive

The Google Doc strongly reinforces that actor imports should respect these branches as real structured data:

- `system.abilities`
- `system.skills`
- `system.attributes`
- `system.traits`

For Dauligor, that means:

- ability scores and save proficiency are not just presentation data
- skills need structured proficiency states and linked abilities
- HP, AC, movement, and senses should be treated as actor state, not item text
- resistances, immunities, and conditions belong in structured traits data

## Item expectations

Common item types relevant to Dauligor:

- `class`
- `subclass`
- `feat`
- `spell`
- `weapon`
- `equipment`
- `consumable`
- `tool`
- `loot`
- `container`
- `background`
- `race`

Useful root item fields:

- `name`
- `type`
- `img`
- `system`
- `flags`

### Item structural rules reinforced by the deep dive

The Google Doc strongly reinforces these practical item layers:

- physical inventory data
  - quantity, weight, price, equipped, attuned
- type-specific rule data
  - weapon, armor, consumable, spell, feat, class, subclass, and so on
- behavior data
  - activities, uses, recovery, effects

This means Dauligor should avoid a design where all item mechanics are packed into:

- a single description field
- a generic custom JSON blob with no typed meaning

### Example source tracking

Use module flags to keep stable identity across syncs.

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "character-123:spell:fireball",
      "version": 1
    }
  }
}
```

## Class items

Local `dnd5e` `5.3.1` sheet templates show these direct class detail fields:

- `system.identifier`
- `system.hd.denomination`
- `system.hd.spent`
- `system.hd.additional` when present
- `system.properties`
- `system.primaryAbility.value`
- `system.primaryAbility.all`

Practical meaning:

- `identifier`
  - stable class key, used for linking subclasses and other logic
- `hd`
  - hit die data for the class
- `properties`
  - class behavior flags exposed by the sheet
- `primaryAbility`
  - multiclass prerequisite abilities and whether all selected abilities are required

### Class consumption on actors

The actor classes template shows:

- actor class pills are embedded items of type `class`
- subclasses are linked beneath the class item
- subclass add buttons use `data-class-identifier="{{ cls.identifier }}"`
- actor class levels come from `cls.system.levels`

This gives two important import rules:

1. A class item should have a stable `system.identifier`.
2. A subclass should link back with `system.classIdentifier`.

## Subclass items

The local subclass sheet template exposes:

- `system.identifier`
- `system.classIdentifier`

Practical meaning:

- `identifier`
  - stable key for the subclass itself
- `classIdentifier`
  - foreign key pointing at the parent class `identifier`

If these do not line up, subclass workflows on actor sheets are likely to break or at least become awkward.

## Advancement expectations

Advancement is one of the most important moving parts for class and subclass imports.

The local `dnd5e` system contains advancement configuration and flow templates for:

- subclass flow
- item grant flow
- item choice flow
- spell config flow

This implies that class-like imports are not just descriptive text. They can carry level-based structured progression.

Typical advancement responsibilities include:

- subclass selection
- feature grants
- item grants
- choice-based grants
- spell progression configuration

For an MVP importer, do not start by generating every advancement object from scratch.

Recommended approach:

1. Export a real class item from Foundry.
2. Study its `system.advancement` array.
3. Build Dauligor schema around the exported shape.
4. Only then automate class/subclass generation.

### Deep-dive advancement rule

The Google Doc strongly supports treating advancement as its own schema family.

At minimum, future agents should expect advancement objects to carry concepts like:

- identity
- level
- type
- title
- class restriction
- type-specific configuration/value payloads

This matters because classes, subclasses, species/background-like progressions, and some feature grants will often depend on advancement logic rather than flat item fields alone.

The most important advancement type to remember for automation-heavy classes is `ScaleValue`, because it supports level-based scaling used by martial arts dice, sneak attack, and similar class mechanics.

## Activities and effects expectations

The Google Doc strongly reinforces the same pattern seen in live `dnd5e` data:

- the item is often the container
- the activity is often the behavior

Future agents should treat these as first-class import concerns:

- `system.activities`
- `system.uses`
- item or actor `effects`

Important activity families called out by the deep dive:

- attack
- damage
- heal
- save
- check
- cast
- use
- enchant
- summon
- transform

Important effect concepts called out by the deep dive:

- `changes`
- `key`
- `value`
- `mode`
- `priority`
- `duration`
- `statuses`

This means that "working in Foundry" should usually include:

- sensible use behavior
- sensible consumption/charges
- useful chat-card output
- effect application when the source mechanic implies it

## Abilities, proficiencies, and choice data

For classes, the difficult parts are not just labels like "Hit Die d10" or "Choose two skills."

The hard parts are structured choice payloads such as:

- ability requirements for multiclassing
- granted proficiencies
- optional selections
- level-gated feature grants

These are often represented in embedded advancement config rather than a single flat class field.

Because of that, Dauligor should probably distinguish between:

- display text for humans
- structured grant data for Foundry import

## Journals

Journals can be exported directly as `JournalEntry` documents.

For your app, journals are a good early target because they are less mechanically strict than classes or spells.

Useful fields:

- `name`
- `pages`
- `flags`
- `folder`

For class/subclass related journals, local `dnd5e` also defines journal page types like `class` and `subclass`.

## Recommended Dauligor payload shapes

### Character payload

```json
{
  "kind": "dauligor.character.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "character",
    "id": "char-001"
  },
  "actor": {
    "name": "Example Hero",
    "type": "character",
    "img": "icons/svg/mystery-man.svg",
    "system": {}
  },
  "items": []
}
```

### Single item payload

```json
{
  "kind": "dauligor.item.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "spell",
    "id": "spell-fireball"
  },
  "item": {
    "name": "Fireball",
    "type": "spell",
    "flags": {
      "dauligor-pairing": {
        "sourceId": "spell-fireball"
      }
    },
    "system": {}
  }
}
```

## Suggested implementation order

For the real app bridge, build in this order:

1. export and inspect real Foundry documents
2. import simple `feat` and `loot` items into actors
3. import spells and inventory items
4. import journal content
5. import characters with embedded items
6. import classes and subclasses with structured advancement

## Current local evidence used for this document

This reference was grounded using your local files:

- `system.json`
- `templates/items/details/details-class.hbs`
- `templates/items/details/details-subclass.hbs`
- `templates/actors/parts/actor-classes.hbs`
- `templates/advancement/subclass-flow.hbs`

It also matches the live document dumps you generated in your world.
