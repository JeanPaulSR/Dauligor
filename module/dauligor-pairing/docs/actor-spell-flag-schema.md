# Dauligor Actor Spell Flag Schema

This document defines the exact Dauligor flag schema for native `dnd5e` spell items embedded on actors.

The schema applies to:

- actor-owned `Item` documents of `type: "spell"`
- stored under:
  - `flags.dauligor-pairing`

This schema is for Dauligor-owned metadata only.

It does not replace native `dnd5e` spell fields.

## Purpose

The actor spell flag schema exists to support:

- class-by-class spell grouping
- favorites
- virtual folders
- Dauligor tags
- list-type-aware spell handling
- stable import identity

It must not become a shadow copy of the full spell item.

## Related Documents

Use this schema with:

- [spell-preparation-manager-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/spell-preparation-manager-guide.md)
- [spell-import-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/spell-import-contract.md)
- [character-class-import-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/character-class-import-guide.md)

## Core Rule

Native `dnd5e` spell fields remain authoritative for spell runtime.

Dauligor flags extend the spell item with management metadata only.

### Native fields that remain authoritative

Do not duplicate these as the primary truth in flags:

- `system.level`
- `system.school`
- `system.method`
- `system.prepared`
- `system.sourceItem`
- `system.activities`
- `effects`

### Dauligor flag responsibilities

Dauligor flags should answer questions like:

- Which Dauligor spell record is this?
- Which class section should it appear under?
- Is it favorited?
- Which virtual folder should it appear in?
- Which Dauligor list type does it belong to?
- Which Dauligor tags should be used for filtering?

## Storage Path

All fields described here live under:

```json
flags.dauligor-pairing
```

## Exact Schema

### Required fields

These should exist on every actor spell item imported or managed by Dauligor.

#### `schemaVersion`

- type: integer
- required: yes
- allowed values:
  - `1`

Purpose:

- version stamp for the Dauligor spell flag payload

#### `entityKind`

- type: string
- required: yes
- allowed values:
  - `"spell"`

Purpose:

- identifies the managed item kind inside the Dauligor namespace

#### `sourceId`

- type: string
- required: yes

Purpose:

- stable semantic spell source id from Dauligor

Examples:

- `spell-fireball`
- `spell-cure-wounds`
- `spell-shield`

#### `classIdentifier`

- type: string
- required: yes

Purpose:

- semantic class owner used for grouping and list logic

Examples:

- `sorcerer`
- `wizard`
- `cleric`

This is the primary grouping key for the spell preparation manager.

#### `listType`

- type: string
- required: yes
- allowed values:
  - `"prepared"`
  - `"known"`
  - `"always-prepared"`
  - `"expanded"`
  - `"innate"`

Purpose:

- semantic spell-list behavior for the owning class or subclass

Notes:

- `prepared`
  - ordinary prepared-caster spell
- `known`
  - known-spell progression spell
- `always-prepared`
  - always prepared and should generally map to native prepared state `2`
- `expanded`
  - available through a widened list, but not automatically prepared unless rules say so
- `innate`
  - use when the spell is class-linked for manager purposes but behaves more like an innate grant

#### `favorite`

- type: boolean
- required: yes
- default:
  - `false`

Purpose:

- whether the spell is favorited in Dauligor's management layer

#### `tags`

- type: string array
- required: yes
- default:
  - `[]`

Purpose:

- Dauligor tag slugs used for filtering and organization

Normalization rule:

- all tags should be lowercase kebab-case semantic slugs

Examples:

- `control`
- `combat`
- `healing`
- `ritual`

### Optional fields

These should be present only when needed.

#### `entityId`

- type: string or `null`
- required: no

Purpose:

- opaque app-side record id when the semantic `sourceId` is not the same as the app database id

#### `identifier`

- type: string or `null`
- required: no

Purpose:

- semantic spell identifier if the app distinguishes it from `sourceId`

This is usually redundant if `sourceId` already has the semantic spell id.

#### `sourceBookId`

- type: string or `null`
- required: no

Purpose:

- source or book provenance

Examples:

- `source-phb-2014`
- `source-xge-2014`

#### `classSourceId`

- type: string or `null`
- required: no

Purpose:

- source id of the owning class item in Dauligor's semantic model

Examples:

- `class-sorcerer`
- `class-wizard`

This is useful for reconciliation, but `classIdentifier` remains the primary UI grouping key.

#### `subclassIdentifier`

- type: string or `null`
- required: no

Purpose:

- semantic subclass owner when the spell is specifically linked to subclass spell behavior

Examples:

- `divine-soul`
- `clockwork-soul`

#### `subclassSourceId`

- type: string or `null`
- required: no

Purpose:

- semantic source id of the owning subclass when relevant

Examples:

- `subclass-divine-soul`
- `subclass-clockwork-soul`

#### `listSourceId`

- type: string or `null`
- required: no

Purpose:

- source id of the Dauligor spell list definition used to surface the spell

Use this if the app has separate spell list documents and a spell can belong to more than one list for the same class family.

#### `importSource`

- type: string
- required: no
- allowed values:
  - `"dauligor"`
  - `"compendium"`
  - `"manual"`
  - `"unknown"`

Purpose:

- origin of the current actor spell entry

Recommended default:

- `"dauligor"` for spells imported through the Dauligor manager

#### `folderId`

- type: string or `null`
- required: no

Purpose:

- stable virtual folder slug for grouping inside the Dauligor spell manager

Normalization rule:

- lowercase kebab-case

Examples:

- `control`
- `buffs`
- `combat-openers`

#### `folderLabel`

- type: string or `null`
- required: no

Purpose:

- user-facing folder label to display in the UI

Examples:

- `Control`
- `Buffs`
- `Combat Openers`

#### `tagsSource`

- type: string
- required: no
- allowed values:
  - `"app"`
  - `"user"`
  - `"mixed"`

Purpose:

- where the current tags came from

This is optional and only useful if the app and user can both contribute tags independently.

## Recommended Minimal v1 Payload

If you want the smallest safe schema for the first pass, use:

```json
{
  "schemaVersion": 1,
  "entityKind": "spell",
  "sourceId": "spell-shield",
  "classIdentifier": "sorcerer",
  "listType": "known",
  "favorite": false,
  "tags": []
}
```

## Recommended Full v1 Payload

```json
{
  "schemaVersion": 1,
  "entityKind": "spell",
  "sourceId": "spell-shield",
  "entityId": "P0vQ8n9F2dLk3z1A",
  "identifier": "shield",
  "sourceBookId": "source-phb-2014",
  "classIdentifier": "sorcerer",
  "classSourceId": "class-sorcerer",
  "subclassIdentifier": null,
  "subclassSourceId": null,
  "listSourceId": "spell-list-sorcerer-known",
  "listType": "known",
  "favorite": true,
  "folderId": "combat-openers",
  "folderLabel": "Combat Openers",
  "tags": ["combat", "defense", "reaction"],
  "tagsSource": "mixed",
  "importSource": "dauligor"
}
```

## Field Ownership Rules

### What the app should supply

The app should be the source of truth for:

- `sourceId`
- `entityId`
- `identifier`
- `sourceBookId`
- `classIdentifier`
- `classSourceId`
- `subclassIdentifier`
- `subclassSourceId`
- `listSourceId`
- `listType`
- baseline `tags`

### What the module may set or update

The module may set or update:

- `schemaVersion`
- `entityKind`
- `favorite`
- `folderId`
- `folderLabel`
- `importSource`
- user-managed `tags`
- `tagsSource`

## What Must Not Be Stored Here

Do not store these as Dauligor-owned spell flags:

- prepared state
- preparation method
- spell level
- spell school
- spell slot cost
- spell save DC
- spell attack bonus
- spell activities
- active effects
- full description HTML

Those belong to native spell item data.

## Relationship To Native `system.sourceItem`

Native `system.sourceItem` remains the authoritative link to the class or subclass item on the actor.

The Dauligor flags may mirror class or subclass identity for faster grouping and UI work, but the module should not treat those flag fields as stronger than `system.sourceItem`.

If a conflict appears:

1. native `system.sourceItem`
2. native owning actor class or subclass item
3. Dauligor spell flags

is the preferred resolution order.

## Relationship To Native Preparation State

Preparation state must continue to use native spell fields:

- `system.prepared = 0`
- `system.prepared = 1`
- `system.prepared = 2`

Do not store:

- `flags.dauligor-pairing.prepared`
- `flags.dauligor-pairing.isPrepared`

Those would drift from the native state.

## Multi-Class Rule

If the same spell is imported for more than one class on the same actor, each actor spell item should carry its own Dauligor class identity.

That means both of these are valid separate actor spell items:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "spell-cure-wounds",
      "classIdentifier": "bard",
      "listType": "known"
    }
  }
}
```

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "spell-cure-wounds",
      "classIdentifier": "cleric",
      "listType": "prepared"
    }
  }
}
```

This is allowed because the class owner differs.

## Reconciliation Key

When the module decides whether an actor spell item is the "same managed spell entry" for update purposes, the recommended key is:

1. `sourceId`
2. `classIdentifier`
3. `subclassIdentifier`
4. `listType`

This avoids collapsing distinct class-owned spell entries together.

## Virtual Folders

Virtual folders are a Dauligor-only grouping layer.

Use:

- `folderId`
  - stable key
- `folderLabel`
  - display label

Do not use Foundry world folders for embedded actor spells as the primary grouping mechanism.

## Tags

Tags should be semantic and low-noise.

Recommended rules:

- lowercase kebab-case
- no display punctuation
- no HTML
- no localized display labels stored as canonical tags

Good:

- `healing`
- `summon`
- `control`

Avoid:

- `Healing Spell`
- `Healing/Support`
- `Control!`

## Migration Rules

### From older Dauligor actor spell flags

If older spell items used:

- `favorite`
- `folder`
- `classIdentifier`

without a versioned schema, migrate to:

- `schemaVersion: 1`
- `folderId` and `folderLabel` instead of one ambiguous `folder` string

### From app favorites before import

If a spell is marked favorite in the app but does not yet exist on the actor:

- do not create a fake actor spell item only for the favorite
- carry that favorite state into the actor item when the spell is imported

## Validation Rules

At import or update time:

- `schemaVersion` must be an integer
- `entityKind` must equal `"spell"`
- `sourceId` must be a non-empty string
- `classIdentifier` must be a non-empty string
- `listType` must be one of the allowed values
- `favorite` must be boolean
- `tags` must be an array of strings

If `folderId` exists:

- it must be a non-empty slug string

If `folderLabel` exists:

- it must be a non-empty display string

If `subclassIdentifier` is absent:

- `subclassSourceId` should usually be absent or `null`

## Recommended Next Step

After this schema, the next exact document should define:

1. the app-side spell list payload contract
2. reconciliation rules for import, update, remove, and replace
3. actor-level spell manager UI state that does not belong on each spell item
