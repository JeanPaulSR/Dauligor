# Dauligor Schema Crosswalk

This document is the practical bridge between three worlds:

1. source-side data shaped like 5etools
2. importer logic shaped like Plutonium
3. target-side documents shaped like Foundry VTT + `dnd5e` `5.3.1`

The purpose is to help future agents answer a recurring question:

> "Given app-native or 5etools-like JSON, what exact Foundry document(s) need to be created or updated?"

## Ground truth order

When these sources disagree, use this order:

1. live Foundry exports from your own world
2. local `dnd5e` templates and code from the installed version
3. Plutonium implementation details
4. upstream 5etools source JSON

Reason:

- Foundry exports show the exact runtime shape your world accepts today.
- `dnd5e` templates/code show what the system actually reads and displays.
- Plutonium shows a mature mapping strategy.
- 5etools shows the information model, not the final Foundry storage model.

## Mental model

The most important distinction is:

- 5etools is mostly an information model
- Foundry `dnd5e` is a play-state and automation model

That means a mapper often needs to:

1. normalize names and source identifiers
2. infer or synthesize defaults
3. split one source record into multiple Foundry documents
4. turn human-readable choices into structured advancement data

## Comparison by content type

### Spells

5etools spell data is rich, declarative, and source-facing.

Typical 5etools spell fields include:

- `name`
- `source`
- `page`
- `level`
- `school`
- `time`
- `range`
- `components`
- `duration`
- `entries`
- `entriesHigherLevel`
- `damageInflict`
- `savingThrow`
- `miscTags`

Example evidence:

- [5etools spells PHB raw](https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/spells/spells-phb.json)

Foundry spell items, by contrast, need:

- root item data: `name`, `type: "spell"`, `img`, `flags`
- nested `system` fields for:
  - source/book metadata
  - activation
  - range/target
  - duration
  - components/materials
  - preparation/mode
  - activities or damage/healing/action structures
  - scaling

Plutonium appears to bridge this by:

- keeping source identity in flags
- converting spell tags and text into Foundry spell/item structures
- generating importer-specific `propDroppable` metadata in `flags.plutonium`

### Items

5etools item-side data is still source-facing.

It tends to describe:

- item category and rarity
- value/weight
- descriptive entries
- attunement or property text
- links to other entities via tags

Example evidence:

- [5etools base items raw](https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/items-base.json)

Foundry item data is more operational.

For an imported consumable like the Potion of Healing you dumped, Foundry stores:

- `system.quantity`
- `system.weight`
- `system.price`
- `system.identified`
- `system.type.value`
- `system.uses`
- `system.activities`
- `system.damage` or healing structures

That is a big shift:

- 5etools describes the item
- Foundry stores how the item is used during play

Plutonium’s imported item also stored:

- `flags.plutonium.page`
- `flags.plutonium.source`
- `flags.plutonium.hash`
- `flags.plutonium.propDroppable`

Those flags are extremely important research clues because they show how Plutonium keeps a reversible link back to source-side content.

### Item runtime behavior in Foundry

For modern `dnd5e`, item behavior is no longer only about top-level item fields.

A large part of usable item behavior lives in:

- `system.activities`
- `system.uses`
- embedded `effects`
- generated chat-card context

Local `dnd5e` evidence shows:

- item sheets have a dedicated activities tab
- activities are listed independently and can have rider activities
- activity uses are stored under paths like `system.activities.<activityId>.uses.spent`
- item card data is prepared through `getCardData`

This means an import schema should distinguish between:

- descriptive item data
- actionable runtime data

For example:

- a potion is not just "a consumable with a description"
- it may need an activity that heals, consumes uses, and generates a useful item card

### Activities

Activities are the most important behavior container for many imported items.

From the local system evidence, activities can cover:

- attacks
- healing
- saves
- enchantment riders
- usage/consumption
- scaling
- applicable effects

This is the key takeaway for Dauligor:

- for many item types, the real "what happens when I use this?" logic should map into activities

### Uses and recovery

Local templates show that uses are not just a single max/spent pair.

They also include recovery definitions such as:

- period
- recovery type
- formula
- auto-destroy behavior when supported

So a Dauligor source schema should eventually support:

- limited uses
- reset cadence
- recovery formula or amount
- destruction-on-expense behavior for expendables

### Effects

Foundry `dnd5e` surfaces effects prominently on documents.

The local effect template shows:

- effect sections by type
- source tracking
- toggling enable/disable
- rider effects

This suggests two practical rules:

1. an item importer should preserve or synthesize effects when they are mechanically meaningful
2. effects should be treated as a first-class part of item behavior research, not an afterthought

### Chat cards and item cards

The local chat item card template and code show that item usage is presented through prepared card data.

That card includes:

- item name and image
- subtitle
- chat description
- materials
- tags and properties

And code paths indicate that card data may be prepared with a specific activity in context.

This means future agents should not ask only:

- "How do we save the item?"

They should also ask:

- "Will the imported item produce a useful chat card when used?"

For many categories, a minimally stored item may technically import but still feel broken in play because:

- it has no activity
- it does not consume uses correctly
- it does not surface tags/properties correctly
- it produces a weak or misleading chat card

### Classes

Classes are the hardest major schema category.

5etools class-side data is strongly informational and progression-oriented. It can describe:

- hit dice
- proficiency choices
- starting equipment choices
- spellcasting progression
- class features by level
- subclass gain levels
- subclass references

The major conceptual difference is this:

- 5etools often expresses class progression as a rich narrative/choice graph
- Foundry `dnd5e` wants a class item with structured `system` data and structured `system.advancement`

Local `dnd5e` evidence shows that class items expose or depend on:

- `system.identifier`
- `system.hd`
- `system.primaryAbility`
- `system.properties`
- `system.levels`
- `system.advancement`

Local actor templates also show:

- actor sheets display class items and subclass items together
- subclass lookup keys off the class `identifier`
- class levels come from `cls.system.levels`

Plutonium’s class builder strongly reinforces this:

- it slugifies class names into a stable identifier
- it sets `system.identifier`
- it sets `system.levels`
- it builds `system.spellcasting`
- it builds `system.primaryAbility`
- it builds `system.advancement`

Most importantly, Plutonium explicitly creates:

- class `identifier`
- subclass `identifier`
- subclass `classIdentifier`

That means a Dauligor class schema should absolutely plan for:

- stable class key
- stable subclass key
- explicit subclass-to-class foreign key

### Subclasses

Subclasses are not standalone flavor text.

Foundry wants them to be structurally connected to classes.

Local `dnd5e` subclass templates expose:

- `system.identifier`
- `system.classIdentifier`

Plutonium also appears to synthesize both values explicitly.

This implies a minimum Dauligor subclass schema should include:

- `id`
- `name`
- `parentClassId`
- `source`
- `featuresByLevel`

And the mapper should turn those into:

- `system.identifier`
- `system.classIdentifier`
- `system.advancement` as needed

### Feats and features

This category is tricky because the word "feature" appears at multiple layers:

- 5etools class features / subclass features
- Foundry `Item` documents of type `feat`
- advancement grants that hand feat items to actors

Future agents should not assume:

- every 5etools feature becomes a single Foundry feat item

Sometimes the right output is:

- a `feat` item
- an advancement grant
- both

Plutonium’s class import path suggests it treats class/subclass features differently depending on import context and may skip some subclass "header" features if the subclass item itself represents them better.

### Monsters / NPCs

5etools bestiary data is already fairly structured, but Foundry NPC actors still impose their own runtime model.

Common differences:

- Foundry expects actor `system` blocks for AC, HP, movement, abilities, senses, traits, and spellcasting state
- attacks and special actions may become embedded `feat`, `weapon`, or `spell` items
- some source text still stays in biography/description fields

Plutonium’s creature importer class names suggest a dedicated actor import pipeline rather than simple raw-data passthrough.

That is a useful warning for Dauligor:

- monsters should have a dedicated mapper, not be treated as "just another JSON blob"

### Journals

Journals are simpler than classes and often make a good early success case.

The app-side structure can stay closer to source content:

- title
- sections/pages
- rich text
- images
- source references

Foundry-side output is usually:

- `JournalEntry`
- nested pages

For class-like or subclass-like journals, `dnd5e` also has typed journal pages, but you do not need that for the earliest importer versions unless you want very system-native journal rendering.

## Analysis of Recent Class Templates

Recent analysis of 5etools-style templates (Artificer, Wizard) reveals several complex structures used by Foundry system importers:

### 1. Class Data (`class`)
- **`classTableGroups`**: Flexible system for the main class table. Includes columns for dynamic features (Infusions Known, Cantrips) and grouped spell slots.
- **`startingProficiencies`**: Not just static lists. Uses `choose` objects for player-driven decisions.
- **`startingEquipment`**: Highly structured. Uses `defaultData` to specify items via IDs or `equipmentType` (e.g., `arcaneFocus`).
- **`optionalfeatureProgression`**: Specifically tracks counts for modular features like Infusions or Invocations.

### 2. Class Fluff (`classFluff`)
- **Recursive `entries`**: Text content is not a simple string. It's an array of objects with `type: "section"`, `type: "entries"`, or `type: "quote"`.
- **Insets**: Special `type: "inset"` containers for sidebars or "Quick Build" tips.

### 3. Feature Mapping
- **Reference Strings**: Features are identified by `Name|Class|Source|Level`. This requires a robust parser to link features across lists.

## Gap Analysis (Source Data vs. App Schema)

Based on `/schemas/classes.md` and the templates provided:

| Source Structure | Current App Schema Status | Found In Template |
|------------------|---------------------------|-------------------|
| **Proficiency Choices** | ❌ Static strings only | `startingProficiencies.skills.choose` |
| **Lore/Fluff Structure** | ❌ Markdown/BBCode only | `entries` (recursive objects) |
| **Starting Equipment** | ⚠️ Partial (Markdown) | `startingEquipment.defaultData` |
| **Class Table Groups** | ❌ Scaling columns are 1:1 | `classTableGroups` (flexible matrices) |
| **Optional Progression** | ⚠️ uniqueOptionMappings | `optionalfeatureProgression` |
| **Multi-Source Logic** | ❌ Firestore ID only | `reprintedAs`, `_copy` |

## Mapping Skills & Proficiencies

Dungeon Master's Archive uses static lists, but Foundry requires a multi-stage proficiency map.

1.  **Skills**: The standard list of 18 skills (Acrobatics, etc.) is consistent. The gap is the `ability` property. Archive uses a standalone `skills` collection for names, but `classes` must map these names to specific `Choose` grants in Foundry advancement.
2.  **Tools**: Similar to skills, tool proficiencies like "Brewer's Supplies" or "Smith's Tools" should link to their specific `baseitem` entry to inherit "Craft" and "Utilize" rules during the Foundry import.

## Mapping Unique Features (Optional Features)

User-defined "Unique Options" in the app (e.g., Infusions, Invocations, or Exploits) map to `optionalfeature` in 5etools and `feat` items in Foundry.

-   **Quantity vs. Scaling**: Unique features can be linked to two types of columns:
    -   **Quantity Column**: Determines how many items from a specific feature type are allowed (e.g., number of Exploits known).
    -   **Scaling Column**: Determines the power level of the option (e.g., Exploit dice scaling).
-   **Setting Data**: Information should be set at the **Feature** layer if it belongs to a specific mechanic (like a feat with scaling options), or at the **Class** layer if it is a general pool (like learning Exploits from a specific archetype).

## Multiclassing Priorities

Our app stores simple objects currently (`{"int": 13}`). Foundry expects `system.primaryAbility.value: ["int"]` and arrays for requirements. Upgrading this logic ensures we map correctly when classes need purely STR vs. STR **or** DEX.

## Scaling Value Advancements

Foundry `dnd5e` relies directly on `ScaleValue` advancement data to automate class abilities like Martial Arts dice and Sneak Attack. Our `scalingColumns` provide the table UI, but we must expand our schema to include Foundry's type definition (e.g., is it a string, a dice size, a numeric value, or a distance?) so the character sheet automatically applies these scale changes to damage rolls.

## What Plutonium appears to do

Based on the local Plutonium bundle in:

- `C:\Users\Jean\AppData\Local\FoundryVTT\Data\modules\plutonium\js\Bundle.js`

these patterns are especially useful:

### Stable identifiers

Plutonium defines a slug-style identifier helper and uses identifier matching heavily.

Observed signals include:

- `UtilDocumentItem.getNameAsIdentifier`
- `system.identifier`
- `system.classIdentifier`
- source identifier helpers

This supports a strong recommendation:

- Dauligor should generate stable source IDs and also stable Foundry-facing slug identifiers where `dnd5e` expects them

### Source-tracking flags

Plutonium stores source linkage in flags such as:

- `page`
- `source`
- `hash`
- `propDroppable`

This is very close to what Dauligor will need for sync and re-import.

A good Dauligor flag block would likely include:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class:fighter:phb",
      "sourcePage": "classes",
      "sourceBook": "PHB",
      "sourceHash": "fighter_phb",
      "entityKind": "class",
      "schemaVersion": 1
    }
  }
}
```

### Advancements are synthesized, not copied literally

Plutonium appears to build class and subclass `system.advancement` programmatically.

That is one of the most important schema research conclusions in this entire file:

- you should not expect a clean 1:1 map from raw 5etools class JSON to Foundry class `system.advancement`

There is a transformation layer in the middle, and it is substantial.

## Suggested Dauligor schema strategy

Do not start with a single huge "universal schema."

Use three layers:

### Layer 1: canonical app schema

This is what Dauligor itself wants to understand.

Example:

- `class.id`
- `class.name`
- `class.source`
- `class.hitDie`
- `class.spellcasting`
- `class.featuresByLevel`
- `class.subclassGainLevel`
- `class.multiclassRequirements`

### Layer 2: normalized import schema

This is a Foundry-oriented intermediate schema.

Example:

- stable source IDs
- resolved feature references
- explicit choice structures
- explicit grant structures
- flattened subclass links

### Layer 3: Foundry document payloads

This is the final output.

Example:

- actor update data
- item create/update data
- advancement arrays
- embedded item lists

This separation matters because:

- Layer 1 should be good for your app
- Layer 3 should be good for Foundry
- Layer 2 prevents those concerns from contaminating each other

## Research tasks future agents should perform

To keep building confidence, future agents should create a local corpus with paired examples.

For each category below, collect:

1. source-side 5etools-like data
2. Plutonium-imported Foundry document dump
3. manually created or official Foundry document dump

Categories:

- spell
- weapon
- consumable
- loot
- feat
- class
- subclass
- class feature
- NPC
- player character
- journal entry

## Recommended corpus naming

Use a folder like:

`docs/corpus/`

Suggested file naming:

- `5etools-spell-acid-splash.json`
- `plutonium-item-acid-splash.json`
- `foundry-item-acid-splash.json`
- `5etools-class-fighter.json`
- `plutonium-item-fighter-class.json`
- `foundry-item-fighter-class.json`

That makes side-by-side comparison much easier for both humans and agents.

## Current high-confidence conclusions

These are safe enough to act on now:

1. Stable source IDs are mandatory for sync-quality imports.
2. For classes and subclasses, `identifier` and `classIdentifier` are core structural fields.
3. Character imports should be split into actor updates plus embedded-item upserts.
4. Advancement is a synthesized target structure, not raw source text.
5. Plutonium’s flags and identifier patterns are worth emulating, while Foundry exports remain the final authority.

## Current unknowns worth researching next

These deserve focused follow-up:

1. the exact minimum viable `system.advancement` shape for a working custom class import in `dnd5e` `5.3.1`
2. how best to represent subclass feature grants versus separate feat items
3. which `system.spellcasting` fields are required versus derived
4. how item activities should be generated for imported spells, consumables, and weapons
5. whether journal page typed content is worth supporting in the first Dauligor importer version

## Item category checklist for corpus research

Do not stop at one item per broad category.

The research corpus should explicitly include:

- weapon: simple melee
- weapon: martial melee
- weapon: ranged weapon
- weapon: versatile weapon
- weapon: magical weapon
- equipment: light armor
- equipment: medium armor
- equipment: heavy armor
- equipment: shield
- consumable: potion
- consumable: scroll
- consumable: ammunition
- consumable: wand or charge-based magical consumable
- tool: artisan tool
- tool: musical instrument
- tool: gaming set
- loot: mundane trade good
- loot: wondrous item
- loot: attunement wondrous item
- container or backpack
- feat: general feat
- feat: class feature represented as feat item
- feat: feature with prerequisites
- spell: cantrip
- spell: leveled spell
- spell: concentration spell
- spell: ritual spell
- spell: healing spell
- spell: attack/save spell

For each one, the corpus should record:

- top-level item fields
- `system` fields
- `system.activities`
- `system.uses`
- `effects`
- chat-card behavior notes
