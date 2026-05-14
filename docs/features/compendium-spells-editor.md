# Compendium — Spell Editor

The admin-only `/compendium/spells/manage` page. Two workflows under one route:

- **Foundry Import** workbench — batch-import spells from FoundryVTT pairing-module exports.
- **Manual Editor** — author-from-scratch or edit-existing form.

| Concern | Doc |
|---|---|
| Public browser | [compendium-spells-browser.md](compendium-spells-browser.md) |
| Data layer / summary index / common tasks | [compendium-spells.md](compendium-spells.md) |
| Round-trip back to Foundry | [foundry-export.md](foundry-export.md) |
| Tags + subtag hierarchy | [../database/structure/tags.md](../database/structure/tags.md) |

Source: [src/pages/compendium/SpellsEditor.tsx](../../src/pages/compendium/SpellsEditor.tsx). Admin-gated; non-admins get an Access Denied placeholder.

## Page layout

Fullscreen via the shared `spell-list-fullscreen` body class (same one used by the public browser). Two stacked toolbar rows + 3-column working area:

```
┌─ Toolbar ─────────────────────────────────────────────────────────────┐
│ [← Back]  [Foundry] [Manual]   ───   [Backfill] [Purge All]            │
├─ FilterBar ───────────────────────────────────────────────────────────┤
│ [search]  [Filters (N)]  [Reset]   539/539   [+ New Spell]            │
├─ list ──────┬─ editor (middle, widest) ────────────┬─ tags + prereqs ─┤
│ Name Lv Src │ Spell name + level                    │ Tabs:            │
│ ─────────── │ Tabs: Basics, Mechanics, Activities,  │   Tags (N)       │
│ Fireball    │   Effects                             │   Prereqs (N)    │
│ Frostbite   │ (Save / Delete / Reset Form pinned to │                  │
│  ↕ 36px rows│  the editor card header)              │ Chip picker with │
│             │  ↕                                    │ subtag drawers   │
└─────────────┴───────────────────────────────────────┴──────────────────┘
```

Pane heights derive from `window.innerHeight - 200` (the extra 60px vs the browser accounts for the consolidated outer toolbar). Resize listener keeps the panes live.

### Toolbar row 1 — page chrome

Single row consolidates what used to be three rows of page chrome (Back, Foundry/Manual tabs, admin maintenance buttons):

| Control | Effect |
|---|---|
| ← Back To Spells | Link to `/compendium/spells` |
| Foundry Import / Manual Editor | Tab switcher (controls which content panel renders below) |
| Backfill Descriptions | Regenerate BBCode descriptions for every spell from its preserved Foundry HTML payload. Admin-only. |
| Purge All Spells | Two-stage confirm; clears every row in the spells table. Admin-only. |

### Toolbar row 2 — FilterBar

Shared `<FilterBar>` component:

- Search input (matches name / identifier / source label)
- **Filters** button → modal with Sources / Spell Level / Spell School axis sections
- Inline **Reset** button (clears search + filters in one click)
- Filtered/total count (`539/539`)
- **New Spell** button — resets the form to a blank state

The filter axes are scoped to the three most useful for editing (source, level, school); more can be added by appending `<AxisFilterSection>` entries to the `renderFilters` prop. See [../ui/filters.md](../ui/filters.md) for the full chip vocabulary.

## Left column — compact spell list

```
NAME              Lv  Src
─────────────────────────
Abi-Dalzim's H… │ 8 │ XGE
Absorb Elements │ 1 │ XGE
Acid Splash     │ C │ PHB
```

Three columns: Name (truncating, 1fr), Level (28px), Source abbreviation (52px). Row height 36px, `<VirtualizedList>` for the scroll surface. Selecting a row sets `editingId` which triggers a lazy `fetchSpell(id)` to populate `formData`.

The compact rhythm intentionally drops the rich 94px tall cards the old layout used — the filter button covers detailed searching, so the list rows only need to identify the spell at a glance.

## Middle column — editor

Tabs: **Basics**, **Mechanics**, **Activities**, **Effects**. (Prereqs moved out to the right column.)

The editor card has the title + per-spell action buttons (Delete / Reset Form / Save) pinned to its header so a save is one click away regardless of which tab is showing. Inactive tab content unmounts (Radix default); form state lives in `formData` so unmounted fields still contribute on save. No `forceMount` needed.

| Tab | Holds |
|---|---|
| **Basics** | Icon upload, Name, Identifier, Source, Level, School, Preparation Mode, Description (MarkdownEditor) |
| **Mechanics** | Casting (activation, ritual, concentration, V/S/M), Targeting (range + duration + template + affects), Uses (max + recovery) — see [Mechanics field map](#mechanics-field-map) below |
| **Activities** | `<ActivityEditor>` — same child component used by FeatsEditor / ClassEditor / OptionGroup. `availableEffects={formData.effects}` |
| **Effects** | `<ActiveEffectEditor>` — item-level Active Effects |

### Mechanics field map

| Field | Lands on (Foundry `system.*`) |
|---|---|
| Activation type/value/condition | `activation.{type,value,condition}` |
| Ritual / Concentration | `properties[ritual, concentration]` |
| V / S / M components | `properties[vocal, somatic, material]` + `materials.{value,consumed,cost,supply}` |
| Range value/long/units/special | `range.{value,long,units,special}` |
| Duration value/units | `duration.*` |
| Target Template (type, size, width, height, units) | `target.template.*` |
| Target Affects (type, count, chooses, special) | `target.affects.*` |
| Uses max + recovery rows | `uses.max`, `uses.recovery[]` |

`range.long` is the second range value used by ranged-attack-style spells (Firebolt, Eldritch Blast); most spells leave it blank.

### Spell name title sizing

Name `<h3>` is `text-2xl xl:text-3xl` with `leading-tight break-words`. Long names like "Abi-Dalzim's Horrid Wilting" or "Raulothim's Psychic Lance" stay on one line at xl widths, break cleanly below.

## Right column — Tags + Prereqs

A `<Tabs>` card with two sub-tabs:

- **Tags (N)** — descriptive tags (`spells.tags`). What the spell IS.
- **Prereqs (N)** — required tags (`spells.required_tags`) + a free-text Prerequisite Notes field. What the caster must HAVE.

Both tabs route through the same `<SpellTagPicker>` (inline in `SpellsEditor.tsx`; extraction is a follow-up). Count badges in each TabsTrigger reflect the live selection length.

Right column is 420px wide so a typical tag-group row with 6–8 chips + the ▸/▾ expand button doesn't wrap mid-chip. Middle column is `minmax(0,1fr)` and absorbs the remaining viewport width.

### SpellTagPicker — hierarchical layout

Mirrors the filter system's `<TagGroupFilter>` shape so the picker affordances stay consistent across the app:

1. **Per-group collapsible sections** with selection-count + total badges in the header. Closed by default; auto-open on mount if any tag in the group is currently selected.
2. **Inside an open group**, root tags flow horizontally in a single wrap-row.
3. **Each root with subtags** gets a small `▸/▾` button next to it (separate click target so the chip's click still cycles the include/exclude state).
4. **Subtag drawers** expand BELOW the roots row, labelled with the parent's name. Multiple expanded parents don't blur together.
5. **Auto-expand** a parent whose subtag is currently selected OR matches the picker's filter input.
6. **Orphans** — subtags whose parent isn't in the visible set surface in an amber-edged row so stale hierarchy isn't silently dropped.

### "Subtag implies its parent" invariant

The picker enforces a semantic invariant at toggle time:

- **Selecting a subtag** whose parent isn't selected auto-adds the parent in the same `onChange` call.
- **Deselecting a parent** auto-drops any of its currently-selected subtags.

So a subtag is never present on a spell without its parent. Matches the user-visible model "a subtag is meaningless without its super tag" — selecting "Burst" on a spell implies "Necromancy" is also relevant.

## Save flow

`handleSave`:

1. Validate name + source.
2. Build the payload (merging form Mechanics fields back into `foundry_data.system` so non-form Foundry fields aren't clobbered, and mirroring the BBCode description back to `foundry_data.description.value` as HTML for round-trip).
3. Capture `editingIdAtStart` + `savedId` BEFORE the await so refresh logic has a stable target.
4. `upsertSpell(savedId, payload)`.
5. Refresh the entries list (`fetchCollection('spells')`) → left column reflects the new name without a page reload.
6. **Refresh the just-saved spell's cache** via `fetchSpell(savedId)` → `spellDetailsById[savedId]` updated, so clicking the spell again shows current data.
7. **If the user is still on the spell they were saving** (compared via `editingIdRef.current === editingIdAtStart`), adopt `editingId = savedId`. On UPDATE this is a no-op; on CREATE it transitions from "New Spell" mode to "editing the just-created spell" so subsequent edits route to the same row. If the user navigated away during the save, leave their selection alone.

Key invariants this preserves:

- After save, the LIST shows the new data immediately (no full page reload needed).
- After save, the EDITOR stays on the saved spell (no jump to a blank New Spell form).
- A fast click on another spell mid-save doesn't get its form wiped out by the post-save logic.

## Foundry Import workbench

The other tab. Source: [src/components/compendium/SpellImportWorkbench.tsx](../../src/components/compendium/SpellImportWorkbench.tsx), [src/lib/spellImport.ts](../../src/lib/spellImport.ts).

**Input**: `dauligor.foundry-spell-folder-export.v1` JSON files exported from the FoundryVTT pairing module's "Export Spell Folder" sidebar button. Each payload is one folder of native Foundry spell items.

**Workbench**:
- Multi-file JSON upload (drag-and-drop)
- Batch summary: total / new / matching-existing / errors
- Left-column searchable spell list (matches `spell_summaries` against incoming candidates)
- Right-column 5etools-style spell detail preview
- Per-spell tag assignment (from spell-classified tag groups in Tag Manager)
- Single-spell import or visible-batch import buttons

**On import**:
- Source is matched by slug to the user's `sources` table.
- Image paths starting with `icons/...` or `/icons/...` are normalised to `https://images.dauligor.com/...`.
- The full Foundry payload is preserved as `foundry_data` (JSON column).
- The shell fields (level, school, components, etc.) are extracted from the Foundry payload for normal D1 querying.
- The importer matches by `identifier`. Re-importing **updates** `foundry_data` and any shell fields — manual edits to description / tags are **not** preserved across re-imports.

## Admin maintenance actions

| Action | Effect |
|---|---|
| **Backfill Descriptions** | Regenerate the BBCode description of every spell from its preserved Foundry HTML payload (`foundry_data.description.value`). Existing descriptions are overwritten. Spells without a Foundry payload are skipped. |
| **Purge All Spells** | Two-stage confirm; the second prompt requires typing `DELETE ALL SPELLS` exactly. Wipes every row in the spells table. Meant for clean-slate before a fresh import. |

Both are admin-gated and have explicit `requireAdminAccess` server-side verification.

## Related docs

- [compendium-spells.md](compendium-spells.md) — data layer + summary index
- [compendium-spells-browser.md](compendium-spells-browser.md) — public browser
- [spell-favorites.md](spell-favorites.md) — favourites system (the editor doesn't show favourites but shares the underlying spells table)
- [../architecture/compendium-editor-patterns.md](../architecture/compendium-editor-patterns.md) — the 4 editor patterns + decision tree (this editor is a bespoke variant of Pattern B with a SpellList-inspired list+detail layout)
- [foundry-export.md](foundry-export.md) — Foundry round-trip
- [../ui/filters.md](../ui/filters.md) — filter chip vocabulary
