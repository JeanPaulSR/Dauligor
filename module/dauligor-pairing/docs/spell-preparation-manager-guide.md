# Dauligor Spell Preparation Manager Guide

This document defines the target behavior for Dauligor's spell preparation and spell list management flow in Foundry.

The goal is to replace the stock spell-preparation experience with a Dauligor-managed window while still using native `dnd5e` spell items, native preparation states, and native casting behavior.

This is a behavior guide, not just a UI note.

## Purpose

The spell preparation manager should solve four problems:

1. Present all spells available to a character from their Dauligor classes and subclasses in one controlled window.
2. Let the user import, prepare, favorite, replace, and organize spells without relying on the stock sheet spell tab alone.
3. Preserve native Foundry spell behavior so spell items still work with:
   - stock `dnd5e`
   - Midi-QOL
   - DAE
   - spell-point modules
4. Support class-by-class spell handling, including prepared casters, known casters, and always-prepared lists.

## Implementation Status (May 2026 refactor)

The manager is redesigned to match the `/compendium/spells` browser
layout. The notes below reflect the **current shipped implementation**;
sections further down in this doc are the original spec and may
diverge.

### Window layout

```
┌─────────────┬───────────────────────────────┬──────────────────────────────┐
│  CLASSES    │  META STRIP                   │   DETAIL HEADER              │
│  · Bard 2   │    Bard · Known Caster        │   Title · CHIP(p218) · ★     │
│  · Cleric 3 │    Full Caster · CHA          │   Level · School · ...       │
│  · Wizard 1 │              On Sheet  Known  │                              │
│             │              0       1/4      │   IMAGE  │ CASTING TIME      │
│             │              Cantrips ‹empty› │          │ RANGE             │
│             │              0/2              │          │ COMPONENTS        │
│ FAVOURITES  │  ─────────────────────────    │          │ DURATION          │
│ [search]    │  [search …  ×  37/256 ] [On  │                              │
│             │   Sheet] [Filters]            │   DESCRIPTION (enriched)     │
│ ★ rows...   │  ─────────────────────────    │   - bold, italic, lists      │
│             │  POOL LIST  (level-grouped)   │   - dice icons + roll links  │
│             │  ○/●/📖 indicators            │   - Foundry refs (clickable) │
│             │  ★ favourite star             │                              │
│             │  prepared rows highlighted    │                              │
│             │                               │   Show Tags  (pinned bottom) │
│             │                               │     Tag-group sections       │
└─────────────┴───────────────────────────────┴──────────────────────────────┘
│  FOOTER  ·  [On Sheet → ] [In Spellbook → ?] [Prepare/Known →]  ·  [Close]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The **detail column** absorbs window-resize space (the description
  is the highest-value reading content).
- The **pool column** is fixed-ish (~400-480px) so spell rows + meta
  counters don't squish on resize.
- The **sidebar** (classes + favourites) stays narrow.
- Footer pins to the bottom of the panel; when the description is short
  the Show Tags disclosure floats at the bottom (matches the website's
  SpellDetailPanel `mt-auto` pattern).

### sheetMode flag

Each owned spell carries `flags.dauligor-pairing.sheetMode` ∈
`"prepared" | "spellbook" | "free"` — source of truth for the manager's
counter accounting + indicator state. Modes are **hierarchical, not
exclusive**: a spell that's `"prepared"` is BY DEFINITION on the sheet;
for a Wizard, a `"prepared"` spell is also in the spellbook.

dnd5e mapping:

| sheetMode    | `system.prepared` | `system.method` | Pool indicator     | Row highlight |
|--------------|-------------------|-----------------|---------------------|---------------|
| `prepared`   | `true`            | `"spell"`       | filled circle (or 📖 for Wizard) | yes (gold border) |
| `spellbook`  | `false`           | `"spell"`       | 📖                  | no            |
| `free`       | `true`            | `"spell"`       | filled circle       | no            |

All three modes ship `system.method = "spell"` — the cap-accounting
distinction is OUR flag, not dnd5e's method. (Earlier iterations used
`method = "always"` for `free`, which surfaced as "Always Prepared" in
dnd5e's per-spell editor; reverted in commit 920e13c.)

Cantrips never carry a "prepared" semantic — they're always known when
on the sheet. The Cantrips counter is independent of the Prepared counter.

### Per-class scope

All mutations + indicator checks are **scoped to the selected class**.
Adding Blade Ward to Bard doesn't light it up in Wizard's pool, and
clicking "Add" in Wizard's view doesn't update Bard's copy — it
creates a separate Wizard-attributed item. Two helpers:

- `_getOwnedDbIdMapForClass(identifier)` — filters by `classIdentifier`
- `_findOwnedSpellByDbIdForClass(dbId, identifier)` — single-spell variant

Used by: pool row indicator, favorite row indicator, detail pane
status + buttons, `_applySheetMode`, `_removeSpell`.

### Footer — hierarchical toggles

```
       on-sheet ⊇ in-spellbook ⊇ prepared
```

Three independent toggles (Close is always present):

| Button | Inactive label | Active label | Inactive action | Active action |
|---|---|---|---|---|
| **On Sheet** | Add to Sheet | Remove from Sheet | create with `sheetMode="free"` | delete the spell item (also un-preps + removes from book) |
| **In Spellbook** (Wizard only) | Add to Spellbook | Remove from Spellbook | promote to `sheetMode="spellbook"` | demote to `free` (also un-preps a prepared spell) |
| **Prepared / Known** | Prepare / Add as Known | Unprepare / Remove as Known | `sheetMode="prepared"` | Wizard: → `spellbook`; others: → `free` |

For known casters the label is "Add as Known" / "Remove as Known"; for
prepared / spellbook casters it's "Prepare" / "Unprepare".

Disabled when spell is advancement-granted or dnd5e-native always-prepared.

### Meta-strip counters

Two rows, paired columns, column-stable alignment:

```
Row 1 (always):   On Sheet         Prepared / Known
Row 2 (optional): Cantrips         In Spellbook
```

When only ONE of (Cantrips, In Spellbook) applies, it slots into the
RIGHT column (with a transparent placeholder on the left) so the visible
counter stays flush with the right edge.

- **Prepared caster** (Cleric, Druid): row 1 + Cantrips on the right
- **Known caster** (Bard, Sorcerer): row 1 + Cantrips on the right (if cantrips)
- **Spellbook caster** (Wizard): row 1 + Cantrips left + In Spellbook right

Caps:
- `Prepared / Known` cap: prepared casters use `preparation.max`;
  **known casters use `spellsKnownLevels[classLevel].spellsKnown`**
  (per-level scaling stamped at import time, with bundle-cache fallback
  for older imports).
- `Cantrips` cap: same priority — `cantripsKnown` from scaling.

### Filter modal (shared pool + favourites)

Centered overlay, same component for both surfaces. Sections:

- Level (0–9)
- School (8 schools)
- Source (PHB / XGE / … — resolves via `/api/module/sources/catalog.json`)
- Casting Time / Range / Duration / Shape (filter buckets)
- Properties (Concentration / Ritual / V / S / M)
- **Tag Groups** — one section per group in `/api/module/tags/catalog.json`
  filtered to spell-classified groups. Subtags ancestor-expand spell
  tagIds (parent-tag chip matches any subtag).

Each chip is 2-state (include/unselected). Sections have `All` / `Clear`
shortcuts. Modal carries `Reset` (clears the target's whole filter set)
and `Apply & Close`. Filter state is per-target — pool and favourites
each have their own.

### Toolbar (shared pool + favourites)

```
[ Search …  ×  37 / 256 ] [On Sheet?] [Filters]
└──── one bordered box ────┘
```

- **Search input** + custom **X clear button** (when input has text) +
  **count badge** (filteredCount / totalCount) — all inside one
  bordered wrap, visually one search field.
- Native browser X clear suppressed via `::-webkit-search-cancel-button`.
- **On Sheet** button — pool only (favourites doesn't get it).
- **Filters** button — opens the shared modal.

Search and filter state are scoped per-target ("pool" / "favourites") so
the two surfaces filter independently.

### Detail pane

Mirrors the website's `<SpellDetailPanel>`:

- **Header** — title, source chip with hover tooltip (full source name
  + page), favourite star
- **Subtitle** — level · school (· Ritual · Concentration)
- **Hero** — image left + 2-col info grid (Casting Time / Range /
  Components / Duration)
- **Body** — enriched description (BBCode → HTML server-side via
  `_bbcode.ts`; Foundry's `enrichHTML` then resolves `[[/r ...]]`,
  `[[/damage ...]]`, `&Reference[...]`)
- **Footer** (pinned to bottom of panel via `margin-top: auto`) — Show
  Tags disclosure with tags grouped by tag group

**Scroll preservation:** `_lastDetailDbId` tracks the last rendered
dbId. When re-rendering the SAME spell (toggling Show Tags / clicking
a footer button), the scroll position is preserved. Clicking a new
row resets to top.

**Description font:** Foundry's body chain (Signika under dnd5e v5)
via `var(--font-primary, var(--font-sans, ...))` — matches the meta
strip's info-row typography.

### Server endpoints used

| Endpoint | Purpose |
|---|---|
| `/api/module/sources/catalog.json` | Source labels (semantic id → shortName / name) |
| `/api/module/tags/catalog.json` | Tag-group filter + tag id → name resolution |
| `/api/module/<source>/classes/<class>.json` | Class bundle (for `spellsKnownScalings` cap data) |
| `/api/module/<source>/classes/<class>/spells.json` | Live class spell list (summaries) |
| `/api/module/spells/<dbId>.json` | Full per-spell payload (BBCode-rendered description) |

All ship **semantic source ids** (`source-phb-2014`) — no legacy
Firestore-style ids. See `docs/database/README.md` §schema-philosophy
on why D1 PKs are still legacy strings internally; the export layer
normalises via `getSemanticSourceId()` in `_classExport.ts`.

### Files

| Path | Role |
|---|---|
| `module/dauligor-pairing/scripts/spell-preparation-app.js` | Manager class — render pipeline, sheetMode mutations, filter logic, scroll preservation. |
| `module/dauligor-pairing/templates/spell-preparation-shell.hbs` | Shell template (3-col grid + footer + modal host). |
| `module/dauligor-pairing/scripts/dauligor-character-sheet.js` | Alt actor sheet — `casterKind` resolution, class section per-class scope. |
| `module/dauligor-pairing/templates/dauligor-spells-tab.hbs` | Alt sheet's Spells PART (uses `casterKind` / `casterLabel`). |
| `module/dauligor-pairing/scripts/class-import-service.js` | Importer — stamps `spellcasting.type`, `spellsKnownLevels`, synthetic `{Class} Spellcasting` feat. |
| `module/dauligor-pairing/styles/dauligor-importer.css` | All `.dauligor-spell-manager__*` and `.dauligor-character-sheet__*` styling. |
| `api/_lib/_bbcode.ts` | BBCode → HTML converter (drift mirror of `src/lib/bbcode.ts`). |
| `api/_lib/_classSpellList.ts` | Per-class spell list — resolves `spellSourceId` to semantic. |
| `api/_lib/_spellExport.ts` | Per-spell full payload — BBCode-renders description, semantic source id. |
| `api/_lib/_tagCatalog.ts` | Tag catalog endpoint helper. |
| `api/_lib/module-export-pipeline.ts` | Sources catalog (semantic ids only). |
| `api/module.ts` | Routes — `/sources/catalog.json`, `/tags/catalog.json`, class bundles, spell list, per-spell. |

## Related Documents

Use this guide with:

- [spell-import-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/spell-import-contract.md)
- [actor-spell-flag-schema.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/actor-spell-flag-schema.md)
- [character-class-import-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/character-class-import-guide.md)
- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)
- [dae-midi-character-support.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/dae-midi-character-support.md)

## Core Rule

Dauligor should replace the spell management UX, not the Foundry spell runtime model.

That means:

- native actor spell items remain the persisted spell documents on the actor
- native `dnd5e` preparation state remains the authoritative prepared state
- native `dnd5e` spell items remain the documents that are cast from the sheet
- Dauligor-only organization and UI state should live in flags, not custom `system` fields

Do not treat "it is JSON" as permission to add arbitrary custom fields under `spell.system`.

For Dauligor-specific metadata, use:

- `flags.dauligor-pairing.*`

## Native Foundry Spell Fields That Must Stay Authoritative

These fields are the most important ones to preserve:

- `type: "spell"`
- `system.level`
- `system.school`
- `system.method`
- `system.prepared`
- `system.sourceItem`
- `system.activities`
- `effects`

The most important runtime state is:

- `system.method`
  - spell preparation mode
- `system.prepared`
  - native prepared state
- `system.sourceItem`
  - which class or subclass granted or owns the spell

## Native Preparation States

Use Foundry's native preparation states:

- `0`
  - unprepared
- `1`
  - prepared
- `2`
  - always prepared

Do not introduce a parallel prepared boolean for actor spell items.

If the app needs to represent preparation semantically, it should still normalize into the native `dnd5e` representation on import.

## What The Manager Owns

The spell preparation manager owns:

- class-by-class spell discovery
- list filtering
- import into actor spell items
- preparation toggling
- favorite marking
- virtual folders
- long-rest reminder flow
- known-spell replacement flow when home rules permit it

The spell preparation manager does not own:

- spell casting workflow
- spell activities
- active effects
- spell save DC calculations
- spell attack calculations

Those remain native Foundry behavior.

## Window Layout

The mockup direction is valid.

The concrete layout should be:

### Left rail

- class list
- class filters
- collapse or expand per class
- optional list mode indicators

Example sections:

- `Sorcerer`
- `Wizard`
- `Cleric`

### Bottom-left action rail

Primary actions:

- `Favorite`
- `Prepare` or `Unprepare`
- `Import` or `Remove`
- `Assign Folder`
- `Replace`

Only show actions that make sense for the selected spell and selected class list mode.

### Top bar

- search input
- filter button
- active filters summary

Recommended filters:

- class
- spell level
- school
- ritual
- concentration
- damage or heal tags
- Dauligor tags
- imported only
- prepared only
- favorites only

### Center column

Spell list for the selected class.

This should be grouped by native Foundry-style spell levels:

- Cantrips
- 1st Level
- 2nd Level
- 3rd Level
- etc.

Spell rows should support:

- selection
- prepared status
- imported status
- favorite status
- tags or badges

### Center detail panel

The selected spell's full detail view.

Recommended sections:

- spell name
- level and school
- casting time
- range
- duration
- components
- preparation mode
- source class
- Dauligor tags
- full description

### Right rail

List summary for the selected class.

This should show:

- class name
- spell list type
- prepared count and max if relevant
- known count and max if relevant
- imported count
- favorite count
- long-rest replacement rule if relevant

## Class Grouping Rule

Spells should be presented by class, not as one undifferentiated actor spell pile.

Each class section should be:

1. class header
2. collapse toggle
3. separator line
4. spells grouped by spell level

This is true even if two classes on the actor can access the same spell.

## Multi-Class Ownership Rule

If the same spell belongs to more than one class on the same actor, treat it as class-owned, not globally shared.

That means the system should conceptually allow:

- `Cure Wounds` owned by `Cleric`
- `Cure Wounds` owned by `Bard`

as separate actor spell entries if the class-level preparation or spellcasting behavior differs.

This avoids ambiguity around:

- class grouping
- spellcasting ability
- prepared counts
- known spell replacement
- future class-specific modifiers

## Source Of Spell Availability

The manager should not guess available class spells from the actor's current embedded spell items.

It should read spell availability from Dauligor class spell list data.

Required upstream inputs:

- actor classes and subclasses from embedded class items
- Dauligor class spell list definitions
- Dauligor spell records
- Dauligor spell tags
- optional Dauligor favorites

If the app stores class spell lists separately from spell detail payloads, the manager should still treat those class lists as the source of truth for availability.

## Required App-Side Spell List Data

For each class or subclass spell list, Dauligor should be able to provide:

- `classIdentifier`
- `rules`
- `spellListType`
- `spellIds`
- spell level association if the list is level-gated
- optional tags or categories
- optional always-prepared or expanded-list markers
- optional known-caster replacement rule metadata

Recommended list types:

- `prepared`
- `known`
- `always-prepared`
- `expanded`

The exact values can vary, but the module needs stable semantic list types.

## Spell Row Statuses

Each spell row should be derivable from the combination of:

- class spell list availability
- actor imported spell items
- native preparation state
- Dauligor flags

Recommended visible statuses:

- `available`
- `imported`
- `prepared`
- `always prepared`
- `favorite`
- `in folder`
- `replaceable now`

## Actor Spell Flags

The exact actor spell item flag schema is defined in:

- [actor-spell-flag-schema.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/actor-spell-flag-schema.md)

This guide assumes that schema and does not redefine it here.

## Preparing Versus Importing

These are separate actions.

### Import

Import means:

- create or update the native actor spell item

Import should preserve:

- native spell item data
- native activities
- native effects
- native source item association
- Dauligor flags

### Prepare

Prepare means:

- update the native prepared state on an already imported actor spell item

Prepared casters should generally require a spell to exist on the actor before it can be prepared.

So the default user flow is:

1. import the spell
2. prepare it

For convenience, `Prepare` may internally perform `Import` first if the spell is not already present.

## List Type Behavior

Different spell list types should behave differently.

### Prepared casters

Behavior:

- import available spells
- prepare or unprepare imported spells
- enforce or display a preparation cap

Summary panel should show:

- `prepared / max prepared`

### Known casters

Behavior:

- import known spells
- do not treat the list as a free prepared toggle list if the class does not prepare spells normally
- if the home rule is active, allow one replacement after each long rest

Summary panel should show:

- `known / max known`
- replacement availability if relevant

### Always-prepared or expanded lists

Behavior:

- import or sync spells onto the actor
- mark as always prepared where appropriate
- do not expose ordinary prepare or unprepare controls unless the list type actually allows it

Summary panel should show:

- explanatory text instead of only counts

## Long Rest Behavior

The same manager window should be reusable after long rests.

Trigger:

- `dnd5e.restCompleted`

On long rest completion:

- optionally auto-open the spell preparation manager

This should be configurable:

- off
- prompt only
- always open

The window should adapt by list type:

- prepared casters
  - review prepared spells
- known casters with home-rule replacement
  - optionally replace one known spell
- always-prepared or expanded lists
  - review only

## Folders

Actor embedded spell items do not need real Foundry folders for this system.

Use virtual folders in Dauligor flags instead.

Requirements:

- folder name stored on the spell item
- filter by folder
- optional group by folder within a class
- folder editing from the manager

This keeps the feature lightweight and avoids trying to force embedded actor items into the world-folder model.

## Favorites

Favorites should exist in two places conceptually:

1. Dauligor app favorites
2. actor spell favorites in Foundry

The manager should be able to show app-side favorites before a spell is imported, then carry that favorite state into actor spell flags once it is imported.

This means:

- a spell can be favorited even if it is not currently prepared
- a spell can be favorited even if it is not currently imported, if the app data says it is a favorite

## Search And Tagging

Search should operate over:

- spell name
- tags
- school
- class association

Tags should be semantic app-side tags, not scraped from description HTML.

The filter model should be compatible with future app-side tag authoring.

## Data Flow

The intended runtime flow is:

1. read actor classes and subclasses
2. resolve class identifiers
3. fetch Dauligor spell lists for those classes
4. fetch or resolve the spell records referenced by those lists
5. merge with actor embedded spell items already present
6. compute per-class sections
7. render the manager window
8. on action:
   - import or update actor spell items
   - update native preparation state
   - update Dauligor flags

## Minimum Module Responsibilities

The module-side first implementation should support:

- open spell preparation manager from a button
- identify actor classes
- resolve available class spell lists
- show class-grouped spell sections
- import selected spells as native actor spell items
- toggle native prepared state
- store favorite and folder in Dauligor flags

It does not need to replace the stock sheet tab on the first pass.

## Recommended First Implementation Scope

First implementation:

1. button on actor sheet
2. Dauligor spell manager window
3. per-class grouping
4. search and basic filters
5. import spell
6. prepare or unprepare spell
7. favorite spell
8. virtual folders
9. optional long-rest reminder

Later implementation:

- replace or augment the stock sheet spells tab
- Tidy 5e integration
- richer known-caster replacement workflow
- per-class drag-and-drop organization

## Sheet Integration Direction

Build the manager window first.

After the window is stable, the same data and presentation model can be reused in:

- a base `dnd5e` custom sheet tab
- a Tidy 5e custom tab or content block

The manager should become the canonical spell UX before sheet replacement is attempted.

## What Not To Do

Do not:

- invent a parallel spell actor model
- invent a second prepared-state system
- store Dauligor-only state under `system.*`
- treat the stock spells tab as the source of truth for available class spells
- collapse multi-class spell ownership into one ambiguous shared row by default

## Recommended Next Documents

After this guide, the next implementation-facing document should define:

1. exact actor spell flag schema
2. exact spell list payload shape from the app
3. exact manager window state model
4. exact import or update reconciliation rules
