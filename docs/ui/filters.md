# Filter System

Cross-page filter vocabulary used by every list / browse surface in the compendium. Authors learn one control set; UX patterns and data shapes are shared via reusable components and a single hook.

## Where it's used

| Page / Surface | Route / Component | Notes |
|---|---|---|
| Class list | `/compendium/classes` ([ClassList](../../src/pages/compendium/ClassList.tsx)) | Tag-only — uses FilterBar default content |
| Spell list | `/compendium/spells` ([SpellList](../../src/pages/compendium/SpellList.tsx)) | 8 base axes + tag groups |
| Spell list manager | `/compendium/spell-lists` ([SpellListManager](../../src/pages/compendium/SpellListManager.tsx)) | Same axes as SpellList; live filter is React state |
| Spell rules editor | `/compendium/spell-rules` ([SpellRulesEditor](../../src/pages/compendium/SpellRulesEditor.tsx)) | Persists filter state to `spell_rules.query` JSON |
| Feat list | `/compendium/feats` ([FeatList](../../src/pages/compendium/FeatList.tsx)) | 3 axes — Source / Feat Type / Properties |
| Character builder spell picker | [CharacterBuilder](../../src/pages/characters/CharacterBuilder.tsx) → [SpellFilterShell](../../src/components/compendium/SpellFilterShell.tsx) | Reads state from [useSpellFilters](../../src/hooks/useSpellFilters.ts) |
| Class detail spell viewer | [ClassView](../../src/pages/compendium/ClassView.tsx) → SpellFilterShell | Same hook + shell as the builder |

## Architecture

```
              ┌─────────────────────────────┐
              │       <FilterBar>           │
              │  (search bar + modal frame) │
              │  ─ chip-label search        │
              │  ─ Show All / Hide All      │
              │  ─ Reset (footer)           │
              │  ─ provides FilterBarContext│
              └──────────────┬──────────────┘
                             │
              renderFilters={…} child slot
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
  <AxisFilterSection>  <TagGroupFilter>  …more sections…
  (single-value         (per-group tag      (any custom
   axes: source,         filter with         JSX consumers
   level, school,        hierarchy +         supply)
   buckets…)             section-expand)
          │                  │
   matchesSingleAxisFilter   matchesTagFilters
   matchesMultiAxisFilter
   (lib/spellFilters.ts)
```

### Components and helpers

| Symbol | File | Role |
|---|---|---|
| `<FilterBar>` | [src/components/compendium/FilterBar.tsx](../../src/components/compendium/FilterBar.tsx) | The visible modal shell. Page passes a `renderFilters` JSX node — usually a list of `<AxisFilterSection>` + `<TagGroupFilter>`s. |
| `<AxisFilterSection>` | same file | Generic single-axis filter (level / school / source / activation / range / duration / shape / property — and feat axes). 3-state chips + per-section combinators. |
| `<TagGroupFilter>` | same file | Per-group tag filter with subtag hierarchy. Default state: only roots show; per-parent expand drawers reveal subtags. |
| `<FilterBarContext>` | same file | Cross-section coordination — provides `chipSearch`, `hideAllVersion`, `showAllVersion` so sections can react to modal-wide signals. |
| `useFilterSectionHidden()` | same file | Per-section collapsed state with subscription to the bulk Show All / Hide All counters. |
| `useSpellFilters()` | [src/hooks/useSpellFilters.ts](../../src/hooks/useSpellFilters.ts) | Owns rich filter state for the shared SpellFilterShell consumers (CharacterBuilder, ClassView). |
| `matchSpellAgainstRule()` | [src/lib/spellFilters.ts](../../src/lib/spellFilters.ts) | Pure matcher used by both live UI and saved-rule application. |
| `matchesSingleAxisFilter()` / `matchesMultiAxisFilter()` | same file | Per-axis primitives used by every list page's `useMemo` filter loop. |
| `matchesTagFilters()` | [src/components/compendium/FilterBar.tsx](../../src/components/compendium/FilterBar.tsx) | Tag-state matcher with subtag-aware ancestor expansion. |

### Data shapes

```ts
// Per-axis rich filter (level, school, source, buckets, properties).
// Each axis lives under its name in a record on the page state OR in
// SpellRule.query (persisted shape).
export type AxisFilter<V extends string = string> = {
  states?: Record<V, number>;        // value -> 1 (include) | 2 (exclude)
  combineMode?: 'AND' | 'OR' | 'XOR'; // for include chips. Default OR.
  exclusionMode?: 'AND' | 'OR' | 'XOR'; // for exclude chips. Default OR.
};

// Tags are grouped, so combinators live per-group instead of per-axis.
type RichTagState = {
  tagStates: Record<TagId, 0 | 1 | 2>;
  groupCombineModes: Record<GroupId, 'AND' | 'OR' | 'XOR'>;
  groupExclusionModes: Record<GroupId, 'AND' | 'OR' | 'XOR'>;
};
```

The persisted `RuleQuery` (in `spell_rules.query`) holds both shapes plus the legacy include-only arrays (`sourceFilterIds`, `tagFilterIds`, …) for back-compat. The matcher prefers the rich shape per axis when present; pre-rich rules continue to work and are auto-migrated to the rich shape on open in `SpellRulesEditor`. See [docs/database/structure/tags.md](../database/structure/tags.md#rich-tag-filter-3-state-includeexclude--andorxor) for the migration semantics.

## Vocabulary

### 3-state chips

Click a chip to cycle:

| State | Storage | Visual |
|---|---|---|
| Neutral | absent | Gold outline; tag plays no role in the filter |
| Include | `1` | Gold-solid; spell must satisfy this group's inclusion check |
| Exclude | `2` | Blood-red; spell must NOT satisfy this group's exclusion check |

### Per-section combinators

Two combinators per section, exposed as `OR` / `AND` / `XOR` toggles in the section header:

| Combinator | Drives | Modes |
|---|---|---|
| **Include logic** (gold button left of "Excl") | include chips (state=1) | OR (any match), AND (every match), XOR (exactly one) |
| **Exclusion logic** (blood button right of "Excl") | exclude chips (state=2) | OR, AND, XOR |

Single-valued axes (level / school / source / buckets — a spell has exactly one) treat AND across multiple include chips as never-match and XOR as effectively-OR. The matcher is still correct under those modes; the controls are exposed uniformly so authors don't have to learn which axes "support" what.

Multi-valued axes (Properties — a spell can have V+S+M simultaneously) use all three combinators meaningfully.

### Section header buttons

```
[▾] SECTION NAME    [OR] Excl [OR]      All | None | Clear | Hide
```

| Button | Effect |
|---|---|
| Chevron (`▸` / `▾`) | Collapse / expand the chip area. Section header stays visible when collapsed. |
| Section title | Same as chevron — click to collapse. |
| Gold `OR` | Cycle include-combinator (OR → AND → XOR → OR). |
| Blood `OR` after `Excl` | Cycle exclusion-combinator. |
| `All` | Set every chip in section to include. |
| `None` | Set every chip in section to exclude. |
| `Clear` | Reset every chip in section to neutral. |
| `Hide` | Same as the chevron — collapse the section. |

### Modal header

```
ADVANCED FILTERS                               [×]
[🔍 Filter chip labels…]  [ Show All ] [ Hide All ]
```

| Control | Effect |
|---|---|
| Chip-label search | Filters which chips render in every section. Case-insensitive substring match against chip labels. Sections that have no matching chip are hidden entirely. |
| Show All | Expand every section. |
| Hide All | Collapse every section to its header. |
| Reset (footer) | Reset filter values to neutral; keeps sections expanded/collapsed as they were. |

Bulk controls are implemented as monotonic version counters in `FilterBarContext` (not booleans) so a click after a manual toggle still fires. Sections subscribe via the `useFilterSectionHidden()` hook.

### Main row — `<FilterBar>` toolbar

```
[🔍 search…]  [▼ Filters (N)]  [↺ Reset]   <trailingActions slot>
```

| Control | Effect |
|---|---|
| Search input | Free-text search; consumer-owned via `setSearch`. |
| Filters button | Opens the modal. Badge shows `activeFilterCount` (number of non-neutral chips across all axes). |
| Reset (inline) | Always rendered. When `activeFilterCount > 0 \|\| search.length > 0`, one click clears both filters and search via `resetFilters()` + `setSearch('')`. When there's nothing to reset, the button dims and shows a "Nothing to reset" tooltip — the affordance stays discoverable. Blood-tinted hover signals it's destructive. |
| `trailingActions` slot | Optional `ReactNode` prop rendered after Reset. Children get `flex items-center gap-2 shrink-0`. Used by pages that want page-level actions inline with the filter controls — e.g., Settings popovers, edit-mode entry points, result counts. |

The trailing slot is how `SpellList` puts its `count + Settings + Spell Manager` chips on the same row as Filters, and how `SpellsEditor` puts `count + New Spell` there. Pages without trailing controls leave the prop omitted.

## Tag groups — section-expand pattern

Tag groups have a 2-level hierarchy (root → subtag). Rendering them as flat chip rows wastes vertical real-estate; rendering them as parent-indented blocks pushes every parent onto its own line. The current model splits the difference:

1. **Roots flow horizontally** in one wrap-row.
2. **Each root with subtags** gets a small `▸` / `▾` chevron BUTTON to its right (outside the chip itself, so the chip's own click target still cycles the include/exclude state cleanly).
3. **Default state: subtags collapsed.** Only roots show.
4. **Clicking the chevron** opens a drawer below the roots row labelled `Parent:` followed by the subtag chips.
5. **Auto-expand on active state** — a parent whose subtag has a non-neutral state, OR whose subtag matches the active chip-label search, is auto-expanded. The user never loses sight of an active subtag selection on modal reopen.
6. **Orphaned subtags** (parent missing from the visible set) keep their amber-edged row, labelled `Orphaned:`.

## Subtag-aware matching

Spell tags are ancestor-expanded before being checked against the filter, so a `Conjure` include chip matches a spell tagged `Conjure.Manifest`. The expansion is spell-side (cheaper than expanding the query per tag). See [docs/database/structure/tags.md](../database/structure/tags.md#hierarchical-query-matching) for the canonical description.

## SpellRule persistence

Rule queries on `/compendium/spell-rules` write the rich shape into `spell_rules.query` (JSON column). Loading any older rule transparently promotes its include-only arrays into `AxisFilter.states` with each entry marked include (state=1); the first edit commits the migration. Legacy and rich shapes coexist in the column for already-migrated rows; the matcher prefers rich and falls back to legacy.

For class-spell-list rebuild at bake time:
- `classExport.ts` + `api/_lib/_classExport.ts` build a `TagIndex` once per bake and thread it through `matchSpellAgainstRule(spell, query, parentByTagId, tagIndex)`.
- Rich rules without a `tagIndex` fail-safe to "match" (defensive: a forgotten plumbing change must never silently empty a class spell list).

## Roadmap — deferred filter improvements

Borrowed from the 5etools filter audit; tracked in the project TODO list.

### Tier 2 — meaningful structural changes
- **Source categorization**: group source pills into Core/Supplements / Adventures / Partnered / Homebrew sub-rows with per-category bulk-select buttons. Needs a `category` field on the `sources` table (migration).
- **Per-section kebab menu**: ⋮ button for Invert (flip every state 1↔2 in this section) / Toggle / Reset to default.

### Tier 3 — bigger features
- **Global section combinator** (top-of-modal toggle): AND / OR / Custom controlling how SECTIONS combine. Today every section AND's together; changing this is a real behavior change for power users.
- **Saved filter presets ("Manage Defaults")**: per-user named filter snapshots persisted to D1 — name + load + delete. Default-on-modal-open.
- **"Include References"** for Source: sources mentioned in italics count as the spell's source. Needs a references-by-source-id index we don't currently have.
- **Hierarchical sub-sections** for tag groups (5etools' Classes → Subclass [+] pattern at the section level): make subtags their own filter section with combinators independent of the parent root.
