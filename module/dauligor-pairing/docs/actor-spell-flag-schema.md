# Dauligor Actor Spell Flag Schema

This document defines the Dauligor flag schema for native `dnd5e` spell items embedded on actors,
**as the module actually implements it today.**

> **Design note (2026-05-30):** an earlier version of this doc specified a large per-item schema
> (`schemaVersion`, `entityKind`, `sourceId`, `listType`, `favorite`, `tags`, `folderId`, …) stored
> on every actor spell item. The module **does not** work that way. The content metadata
> (school, level, tags, semantic ids, etc.) is served by the spell-list / spell-item **endpoints**
> and read live — there is no need to copy it onto the actor item. The schema below reflects the
> minimal identity-plus-state flags the module actually persists. The fuller historical schema is
> retired; see "Why so few flags" below.

The schema applies to actor-owned `Item` documents of `type: "spell"`, stored under
`flags.dauligor-pairing`. It is Dauligor-owned metadata only and does not replace native `dnd5e`
spell fields.

## Related Documents

- [spell-preparation-manager-guide.md](spell-preparation-manager-guide.md)
- [spell-import-contract.md](spell-import-contract.md)
- [foundry-spell-manager-inputs.md](foundry-spell-manager-inputs.md)
- [character-class-import-guide.md](character-class-import-guide.md)

## Core Rule

Native `dnd5e` spell fields remain authoritative for spell runtime. Dauligor flags carry only the
**identity needed to look the spell up against the endpoint** and the **management state** the
endpoint does not own.

### Native fields that remain authoritative

Do not duplicate these as the primary truth in flags:

- `system.level`, `system.school`
- `system.method`, `system.prepared` (preparation — see below)
- `system.sourceItem`
- `system.activities`, `effects`

## Exact Schema (what the module actually writes)

All fields live under `flags.dauligor-pairing` on the actor-owned spell item.

| Field | Type | Purpose |
|---|---|---|
| `dbId` | string | The app database id. **Primary lookup key** — the manager fetches the full spell (`dauligor.spell-item.v1`) and matches pool summaries (`dauligor.class-spell-list.v1` / `source-spell-list.v1`) by this. |
| `entityId` | string | Stable Dauligor record identity. **Primary reconciliation key** for "is this the same managed spell" on re-import / update. |
| `classIdentifier` | string \| null | Semantic class owner used for class-by-class grouping in the manager. Falls back to native `system.classIdentifier` when absent. |
| `sheetMode` | string | Dauligor cap-accounting mode: `"prepared"` \| `"spellbook"` \| `"free"`. The source of truth for how the manager counts this spell against caps. Distinct from native preparation. |
| `grantedByAdvancementId` | string \| null | Set when the spell was granted by a class advancement (so the manager can mark it as advancement-granted rather than freely chosen). |

That is the whole per-item schema. Everything else the UI shows (school, level, tags, ritual,
concentration, range/duration/shape buckets, prerequisite text, semantic source ids) comes from
the **endpoint bundle**, keyed by `dbId` — see [foundry-spell-manager-inputs.md](foundry-spell-manager-inputs.md)
and [spell-preparation-manager-guide.md](spell-preparation-manager-guide.md).

### Why so few flags

The endpoint already carries the metadata (`_classSpellList.ts` / `_spellExport.ts` ship
`schemaVersion`, `entityKind`, `sourceId`, `classSourceId`, `tagIds`, school, level, prerequisite,
and the grouping buckets in `flags["dauligor-pairing"]` on the served payload). Persisting all of
that on each actor item would make the item a stale shadow copy. The module instead keeps the
**lookup key on the item** and reads the rest live.

## Favorites — actor-level, not per-item

Favorites are **not** a per-spell-item flag. They live on the **actor**:

```json
flags.dauligor-pairing.spellFavorites = ["<dbId>", "<dbId>", ...]
```

A spell is favorited if its `dbId` is in that array. This lets a spell be favorited before it
exists as an actor item, and keeps favorite state in one place.

## Preparation — stays native (dnd5e 5.x boolean)

Preparation uses native fields, in the **dnd5e 5.x** shape:

- `system.method` — `"spell"` (normal) or `"always"` (always-prepared); also `"atwill"`/`"pact"`/`"ritual"` per native.
- `system.prepared` — **boolean** (`true`/`false`).

> The legacy numeric `system.prepared = 0/1/2` tri-state is **not** what dnd5e 5.x uses and is not
> what the module writes. "Always prepared" is `system.method === "always"`, not `prepared === 2`.

Do **not** store `flags.dauligor-pairing.prepared` / `isPrepared` — preparation must stay native.
The Dauligor-owned `sheetMode` flag is a separate concept: it records which *management bucket*
(prepared / spellbook / free) the spell counts against for cap accounting, not its native prepared
boolean.

### Resolution order

When the manager resolves a spell's class owner:

1. `flags.dauligor-pairing.classIdentifier`
2. native `system.classIdentifier`

For the link back to the owning class/subclass item, native `system.sourceItem` remains
authoritative.

## Multi-class rule

If the same spell is managed for more than one class on the same actor, each actor spell item
carries its own `classIdentifier`. Two items with the same `dbId` but different `classIdentifier`
are distinct managed entries.

## Reconciliation key

When deciding whether an actor spell item is the "same managed spell entry" for update purposes,
the module keys on:

1. `entityId`
2. `dbId`
3. `classIdentifier`

## Virtual folders — not in the manager yet

The fuller doc once specified `folderId` / `folderLabel` flags for virtual folders **in the prep
manager**. That is **not built** — the Prepare Spells manager groups by class + spell level only.

Folders *are* built on the **alt character sheet** (`scripts/dauligor-character-sheet.js`), using
an actor-level model rather than per-item schema:

- `flags.dauligor-pairing.customFolders` — actor-level folder definitions (`{id, name, ...}`)
- `flags.dauligor-pairing.customFolderId` — per-spell pointer to its folder (cleared when ungrouped)
- `flags.dauligor-pairing.customSections` / `customSectionId` — the section layer
- `flags.dauligor-pairing.classOrder`, `collapsedClasses`, `collapsedSections` — sheet view state

Bringing folder support into the prep manager (ideally reusing the alt-sheet `customFolders` model)
is tracked in [../TODO.md](../TODO.md).

## What must not be stored here

Do not store as Dauligor-owned spell flags: prepared state, preparation method, level, school,
slot cost, save DC, attack bonus, activities, active effects, or full description HTML. Those are
native spell data. Tags, school, level, etc. are endpoint-served, not item-stored.
