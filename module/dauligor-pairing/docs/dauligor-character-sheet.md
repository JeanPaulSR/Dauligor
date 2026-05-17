# Dauligor Character Sheet (opt-in alt sheet)

Opt-in actor sheet for D&D 5e characters. Subclasses dnd5e v5.x's
`CharacterActorSheet` and replaces ONLY the Spells PART's template
+ data prep. Every other tab (Inventory, Features, Effects, Biography)
inherits from the parent unchanged.

## When it applies

The sheet is registered as a non-default alt sheet during the `init`
hook (see `registerDauligorCharacterSheet` in
`scripts/dauligor-character-sheet.js`):

```js
DocumentSheetConfig.registerSheet(Actor, "dauligor-pairing", Class, {
  types: ["character"],
  makeDefault: false,
  label: "Dauligor Sheet (D&D 5e)"
});
```

User opts in per-actor via the sheet picker in the actor sheet's
header config menu. Non-opted actors keep the stock dnd5e sheet.

The subclass is **built lazily inside the init hook** because
`dnd5e.applications.actor.CharacterActorSheet` doesn't exist at
module top-level load time. The class is cached after first build
so re-registration is idempotent.

## Layout

The Spells tab body is a vertical stack:

1. dnd5e's `<item-list-controls>` (search / sort / filter datalists)
   + a Dauligor `+ Section` button + the global Prepare-Spells
   book icon (DOM-injected via `injectSpellTabToolbarButton` in
   `main.js`).
2. One section per spellcasting class + each custom section +
   "Other Spells" orphan bucket (pinned last).
3. Each section is a collapsible card whose header uses dnd5e's
   spellcasting-card purple gradient (`--dnd5e-color-sc-1` →
   `--dnd5e-color-sc-2`). The header is a 5-column CSS grid:
   **Name · Attack · Spell DC · Prepared · 📖 Prepare**.
4. Section body iterates entries: custom folders first (in
   `customFolders[sectionId]` order), then level entries (Cantrips,
   1st Level, …). Each entry is a dnd5e-style `.items-section.card`
   so dnd5e's row + column CSS owns the visuals.

## Data model

All Dauligor state lives under `flags.dauligor-pairing`.

### Actor flags

| Flag | Type | Purpose |
|---|---|---|
| `classOrder` | `string[]` | Ordered list of section identifiers (class identifiers AND custom section ids interleaved). Drives the rendering order. `__other__` is always pinned last and not in the array. |
| `collapsedClasses` | `string[]` | Section identifiers that are currently collapsed. |
| `collapsedSections` | `string[]` | Individual level/folder cards that are collapsed. Keys are `<sectionId>-<level>` for level cards and `<sectionId>-folder-<folderId>` for folder cards. |
| `customSections` | `{ id, name }[]` | User-defined top-level sections. Section ids look like `sec_<random>`. |
| `customFolders` | `{ [sectionId]: { id, name }[] }` | Folders keyed per parent section. Folder ids look like `fold_<random>`. |
| `spellFavorites` | `string[]` | dbIds of spells marked as favourite in the Prepare Spells manager. |

### Spell item flags

| Flag | Type | Purpose |
|---|---|---|
| `customSectionId` | `string \| null` | Overrides class grouping when set + valid. Stale references fall back to class. |
| `customFolderId` | `string \| null` | Overrides level grouping. Only honored when the folder belongs to the spell's current effective section. |
| `classIdentifier` | `string` | Primary class attribution. Stamped at add-time. |
| `entityId` | `string` | Dauligor D1 row id — used for owned-lookup by dbId in the Prepare Spells manager. |

### dnd5e schema fields we write

| Field | Value | Purpose |
|---|---|---|
| `system.sourceItem` | `"class:<identifier>"` | v5.3+ replacement for the deprecated `system.sourceClass`. dnd5e's `system.classIdentifier` derived getter reads this to resolve casting ability + DC. Set at add-time by `_toggleKnown` in the Prepare Spells manager. |

## Custom sections / folders

### Sections

| Operation | Trigger |
|---|---|
| Create | `+ Section` button on the toolbar. Pre-fills next default (`"Section"`, `"Section 1"`, …). |
| Rename | Right-click custom section header → "Rename Section…". |
| Delete | Right-click custom section header → "Delete Section…". Also clears `customSectionId` on every spell that pointed in + drops the section's folder list (batched `updateEmbeddedDocuments`). |
| Reorder | Drag the header onto another section header. Drop top half = above target, bottom half = below. Persists to `classOrder`. |

Empty custom sections persist as named buckets — the user can drag
spells in later.

### Folders

| Operation | Trigger |
|---|---|
| Create | Right-click section header → "Add Folder…". Pre-fills next default (`"Folder"`, `"Folder 1"`, …). |
| Rename | Right-click folder header (`.items-header` inside a folder card) → "Rename Folder…". |
| Delete | Right-click folder header → "Delete Folder…". Also clears `customFolderId` on every spell that pointed there. |
| Reorder | Drag the folder's `.items-header` onto another folder card in the same section. Drop top half = above, bottom half = below. Persists to `customFolders[sectionId]`. |

Folders REPLACE level grouping for any spell with `customFolderId`
set. Spells without the flag fall back to their level group, so a
section can have folders AND level groups side by side.

## Drag / drop semantics

The Spells tab supports three orthogonal drag operations:

| Source | Target | Effect | Detection |
|---|---|---|---|
| Class/custom section header | Section header | Reorder in `classOrder` (gold line above/below). | `_dauligorDraggingClass` instance flag |
| Folder header (`.items-header`) | Folder card in same section | Reorder in `customFolders[sectionId]`. | `_dauligorDraggingFolder` instance flag |
| Spell row | Section header | Set `customSectionId` (custom) or clear it (class). | `dataTransfer.types` has `text/plain` + no Dauligor flag |
| Spell row | Folder card | Set `customSectionId` + `customFolderId`. | Same |
| Spell row | Level card | Clear `customFolderId`. | Same |

Each handler `stopPropagation`s on the drag events it owns so the
parent section's generic drop doesn't also fire. The class-reorder
gold lines (`is-drop-above` / `is-drop-below`) are visually
distinct from the spell-drop dashed outline (`is-spell-drop-target`).

## ContextMenus

Three menus, attached in `_attachPartListeners` after the spells PART
renders:

1. **Section header** (`.dauligor-character-sheet__class-group-header`)
   via `dnd5e.applications.ContextMenu5e` →
   - "Add Folder…" (any section type except `__other__`)
   - "Rename Section…" (custom sections only)
   - "Delete Section…" (custom sections only)

2. **Folder header** (`.items-section.card[data-section-kind="folder"] .items-header`)
   via `dnd5e.applications.ContextMenu5e` →
   - "Rename Folder…"
   - "Delete Folder…"

3. **Spell row** — NOT a separate ContextMenu. We hook
   `dnd5e.getItemContextOptions` (fired by dnd5e's own inventory
   ContextMenu5e at line 64709 of `dnd5e.mjs`) and append:
   - "Move to Section…"
   - "Move to Folder…"

   The hook only fires our entries when the actor is rendering with
   our Dauligor sheet (`actor.sheet instanceof DauligorCharacterSheet`)
   so non-opted actors see the stock dnd5e menu unchanged.

All ContextMenu instances use the dnd5e `onOpen` pattern:

```js
new dnd5e.applications.ContextMenu5e(htmlElement, selector, [], {
  jQuery: false,
  onOpen: (target) => {
    ui.context.menuItems = [ /* entries */ ];
  }
});
```

The empty `[]` for static menuItems + `onOpen` populating
`ui.context.menuItems` is what dnd5e itself does. Passing static
menu items in the third arg or relying on `dataTransfer.types`
during `dragover` don't behave reliably across Foundry minors.

## Casting-ability resolution

A spell's casting ability is resolved by dnd5e's stock chain
unchanged — our sheet doesn't intercept the cast flow:

```
Activity.spellcastingAbility
  → Spell.availableAbilities
    → actor.spellcastingClasses[classIdentifier].spellcasting.ability
```

`classIdentifier` is dnd5e's derived getter that reads
`system.sourceItem` (`"class:bard"` → `"bard"`). Our `_toggleKnown`
(in the Prepare Spells manager) sets `sourceItem` at add-time, so
casting Fire Bolt from the Wizard section uses INT, casting Bless
from the Bard section uses CHA — automatically, no override hook
needed.

## Files

| Path | Role |
|---|---|
| `scripts/dauligor-character-sheet.js` | Subclass build + lazy registration. All helpers (`readCustomSections`, `createCustomFolder`, etc.), context menu wiring, drag/drop handlers, item-context-options hook. |
| `templates/dauligor-spells-tab.hbs` | Spells tab template. Iterates `context.dauligor.classGroups` (the rebucketed sections + folders). |
| `styles/dauligor-importer.css` | All `.dauligor-character-sheet__*` styling — header gradient, grid layout, drag indicators, ContextMenu modifiers. |
| `scripts/main.js` | Calls `registerDauligorCharacterSheet()` in the `init` hook. Also DOM-injects the per-class Prepare button + the global toolbar book icon onto stock dnd5e sheets. |

## See also

- [Prepare Spells manager guide](./spell-preparation-manager-guide.md) —
  the dialog that opens from the per-class Prepare buttons and the
  global toolbar icon.
- [Spell list decoupling architecture](../../docs/features/foundry-export.md)
  — the live `/api/module/<source>/classes/<class>/spells.json` endpoint the
  manager fetches from.
