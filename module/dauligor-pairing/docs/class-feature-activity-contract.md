# Dauligor Feature Item And Activity Contract

This document describes the practical Foundry shape for a `dnd5e` feature item and the activity data that can live inside it.

It is based on:

- `E:/DnD/Professional/Foundry-JSON/items/item-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-attack-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-cast-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-check-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-damage-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-enchant-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-forward-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-heal-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-save-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-summon-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-transform-feature.json`
- local `dnd5e` `5.3.1` data model code in `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs`

Use this document for:

- class features
- subclass features
- imported option items such as Metamagic options
- feat-like features which should become `Item.type = "feat"`

Do not use this as the primary contract for:

- class items
- spell items
- weapons, armor, equipment, consumables, tools, or loot

Those families can also use `system.activities`, but they have extra item-specific rules beyond this contract.


## Contents

This contract is split into parts under [`class-feature-activity/`](class-feature-activity/). The Core Rule and the Dauligor-side guidance (semantic split, minimal payload, importer rules, corpus needs) stay in this index below.

**Feature item:**
- [What The Sample Proves](class-feature-activity/sample-evidence.md)
- [Feature Item Shell & Fields](class-feature-activity/feature-item-shell.md)

**Activity structure:**
- [Shared Activity Envelope](class-feature-activity/activity-envelope.md)
- [Damage Part Structure](class-feature-activity/damage-parts.md)

**Activity types** (one file per family) &mdash; [attack](class-feature-activity/activity-attack.md) · [cast](class-feature-activity/activity-cast.md) · [check](class-feature-activity/activity-check.md) · [damage](class-feature-activity/activity-damage.md) · [enchant](class-feature-activity/activity-enchant.md) · [forward](class-feature-activity/activity-forward.md) · [heal](class-feature-activity/activity-heal.md) · [save](class-feature-activity/activity-save.md) · [summon](class-feature-activity/activity-summon.md) · [transform](class-feature-activity/activity-transform.md) · [utility](class-feature-activity/activity-utility.md)

## Core Rule

Dauligor should send semantic feature behavior.

The Foundry module should translate that behavior into:

- `Item.type = "feat"`
- `system.activities`
- `effects`
- `system.uses`
- feature-level metadata such as prerequisites, requirements, and source tracking

Dauligor should not try to generate random Foundry `_id` values for:

- the item itself
- activities
- activity effect rows
- summon or transform profiles

The module can generate Foundry-safe ids when it builds the live item.


## Recommended Dauligor Semantic Split

Dauligor should own the meaning.

The module should own the exact Foundry shape.

Recommended semantic split:

### Dauligor should send

- feature identity
- feature description
- usage rules
- prerequisite and requirement meaning
- activity semantic type
- activity range, target, duration, save, damage, heal, summon, or transform intent
- linked spell or linked feature references using semantic ids
- effect intent

### The module should derive

- Foundry item `_id`
- Foundry activity `_id`
- sibling activity references by local Foundry id
- UUID-based links where Foundry requires them
- sort order
- default empty structures for omitted optional fields

## Recommended Minimal Semantic Activity Payload

Dauligor does not need to mirror the full Foundry schema exactly. A semantic payload like this is enough:

```json
{
  "sourceId": "class-feature-font-of-magic",
  "identifier": "font-of-magic",
  "name": "Font of Magic",
  "description": "<p>...</p>",
  "activities": [
    {
      "identifier": "convert-spell-slot",
      "type": "utility",
      "activation": {
        "type": "bonus"
      },
      "uses": {
        "pool": "sorcery-points"
      },
      "roll": {
        "formula": "1"
      }
    }
  ]
}
```

Then the module can expand that into the strict Foundry structure.

## Practical Rules For The Importer

- Always create feature-style imported abilities as `Item.type = "feat"` unless the item is genuinely another family.
- Always generate Foundry activity ids locally.
- Preserve Dauligor semantic identity for the feature item and for each activity in `flags.dauligor-pairing`.
- Prefer stable semantic activity identifiers in flags even if Foundry also has random local `_id` values.
- Treat `item-feature.json` as a structure reference, not as a complete behavioral reference.
- If the app cannot yet supply a complex activity type with enough information, leave the activity out instead of shipping a misleading half-activity.

## Missing Information And Corpus Need

Information is still missing for a production-quality activity builder.

The biggest remaining gaps are:

- one truly populated saved `check` export
- one real `utility` export
- richer enchantment restriction coverage and multi-profile enchantment graphs
- cleaner notes on the exact gameplay semantics of `material` consumption targets
- more `visibility` gating examples outside the cast sample
- additional activity-level and item-level effect interaction examples

That means we should build a corpus before finalizing the importer logic for all activity families.

Use `docs/feature-activity-corpus-plan.md` as the capture checklist.
