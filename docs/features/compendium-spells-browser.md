# Compendium — Spell Browser

The public `/compendium/spells` page — read-only spell catalogue with filtering, sorting, and favourites. Renders for every authenticated user. Admins reach the editor counterpart from a button in the toolbar; see [compendium-spells-editor.md](compendium-spells-editor.md).

| Concern | Doc |
|---|---|
| Data layer / summary index / common tasks | [compendium-spells.md](compendium-spells.md) |
| Admin editor + Foundry importer | [compendium-spells-editor.md](compendium-spells-editor.md) |
| Favourites (Universal + per-character) | [spell-favorites.md](spell-favorites.md) |
| Shared filter components / vocabulary | [../ui/filters.md](../ui/filters.md) |

Source: [src/pages/compendium/SpellList.tsx](../../src/pages/compendium/SpellList.tsx).

## Layout

```
┌─ Toolbar ─────────────────────────────────────────────────────┐
│ [search…]  [▼ Filters (N)]  [Reset]   1384/1936  ⚙ [Settings] │
├─ favourites ─┬─ spell list ─────────────┬─ detail ────────────┤
│ ★ FAVORITES │ Name           Lv  Time   │ Spell name + level  │
│ [scope ▾]   │ Sort buttons in header   │ Image + meta        │
│ ─────────── │ ─────────────────────── │ Description         │
│ row         │ row…                    │ Prereqs (if any)    │
│ row         │ row…                    │                     │
│  ↕          │  ↕                       │  ─── pinned ──      │
│             │                          │ Source, page, etc.  │
│             │                          │ [Show tags ▾]       │
└─────────────┴──────────────────────────┴─────────────────────┘
```

Fullscreen layout — the page opts in via a `spell-list-fullscreen` body class set on mount (CSS rules in [src/index.css](../../src/index.css)). That class strips `<main>`'s container padding, hides the global footer, and locks body scroll. Each pane scrolls internally; the page itself never gets a scroll wheel.

Pane heights track `window.innerHeight` minus a small chrome offset, updated on `resize`. The list column is fixed at 520px so wider viewports give all the extra width to the detail pane. See `paneHeight` and the outer-grid template in `SpellList.tsx`.

## List column

Sortable, hideable 7-column table inspired by 5etools. Each column header is a button — click to sort by that column, click again to reverse.

| Col | Source | Notes |
|---|---|---|
| Name | `spell.name` | Always visible. Always primary sort tiebreaker. |
| Lv | `spell.level` | "C" for cantrip. |
| Time | `formatActivationLabel(facets.foundryShell.activation)` | Real label (e.g., "1 action"), not bucket. |
| School | `SCHOOL_LABELS[spell.school]` | Truncated abbreviation. |
| C. | concentration flag | ◆ glyph when set. |
| Range | `formatRangeLabel(facets.foundryShell.range)` | Real label (e.g., "60 ft", "Self"). Sort key is normalised feet; self/touch sentinel-valued. |
| Src | source abbreviation | From `sourceById[spell.sourceId]`. |

Buckets (Short / Medium / Long etc.) remain the **filter axis** for Range and Time but are not used as display labels.

### Hiding columns

Columns past Name are user-toggleable via the **Settings** popover in the toolbar. Choice persists to `localStorage` under `dauligor.spellList.hiddenColumns`. Hiding a column does **not** widen the list pane (list stays 520px); the freed cell width inside the list flows to the Name column (`minmax(0,1fr)` cell), so longer names can show without truncation. See the doc-block above `PANE_MAX_HEIGHT_PX` in `SpellList.tsx` for the rationale.

### Sort state

`sortBy` + `sortDir` state in the page component. Sort key extraction is per-column; Range converts mi/m/km to feet so the order is monotonic in real distance.

## Filter modal

Standard `<FilterBar>` with eight axis sections and a tag-group disclosure. See [../ui/filters.md](../ui/filters.md) for the chip vocabulary and combine semantics.

Filter axes:

- Sources, Spell Level, Spell School
- Casting Time, Range, Duration, Shape, Properties (V/S/M/Concentration/Ritual)
- Tags (Advanced Options disclosure at the bottom — hierarchical)

The toolbar shows a filtered/total count (`1384/1936`) and an inline **Reset** button that clears both search and filters in one click.

## Detail pane

Single source of truth: [src/components/compendium/SpellDetailPanel.tsx](../../src/components/compendium/SpellDetailPanel.tsx). Self-contained — fetches its own data when `spellId` changes, caches.

Vertical layout pins the source/tags block to the bottom of the pane so short-description spells don't have an awkward floating source line at the top. Flex column with `mt-auto` on the bottom group; CardContent has an explicit height so the flex pivot has something to push against.

```
Title + level/school + ⭐ favourite
─────────────────────────────────
Image + Casting Time / Range / Components / Duration
─────────────────────────────────
Description
Prerequisites (if any)

        ↑ empty space when description is short ↑

────── (mt-auto kicks in) ──────
Source: PHB, page 256
On the spell list for: Wizard, Sorcerer
[▾ Show tags (12)]   ← toggle; default collapsed
```

The **tags toggle** keeps the detail pane uncluttered for casual reading. State persists for the session (closing the page resets). If a spell has zero tags the button doesn't render.

## Favourites pane

Left column. Header has a **scope dropdown** with two modes:

- **Universal Favorite** (default) — account-level, cross-character, cloud-synced.
- **Per-character** — one set per saved character; switching the dropdown re-points the page's favorites set to that character's list.

Both flow through [src/lib/spellFavorites.ts](../../src/lib/spellFavorites.ts) → `/api/spell-favorites`. Full storage + sync semantics in [spell-favorites.md](spell-favorites.md).

The star indicators in the spell list rows reflect the **active scope** — toggling a star writes to whichever scope is currently selected.

## Description rendering

Spell descriptions are stored as BBCode (converted from Foundry HTML on import via `htmlToBbcode`). At display time, Foundry inline syntax tokens are flattened **for display only** — never stripped from storage. Rules:

| Stored | Displayed |
|---|---|
| `[[/r 1d8]]` | `1d8` |
| `[[/damage 2d6]]` | `2d6` |
| `[[/damage 4d8 type=acid]]` | `4d8 acid` |
| `@... [status||Frightened]` | `Frightened` |
| `@...[status]` (unlabelled) | `Status` |

**Display precedence:** the detail panel renders `spells.description` (BBCode → `bbcodeToHtml`) first; raw Foundry HTML at `foundryDocument.system.description.value` is only used as a fallback for legacy rows that predate BBCode conversion.

**Round-trip back to Foundry:** on save in the editor, the BBCode description is converted back via `bbcodeToHtml` and written into `foundryDocument.system.description.value` so the next Foundry read (pairing-module import, actor-bundle re-export) ships the user's edits as HTML. Inline Foundry syntax tokens (`[[/r ...]]`, `@...[status||...]`) survive a BBCode round-trip because the BBCode pipeline doesn't recognize them — they pass through as literal text and Foundry re-interprets them on the receiving end.

## Selection-only image loading

Spell icons aren't rendered in the table rows (too noisy). The detail pane shows the icon at native 126×126 inside an `overflow-hidden` wrapper so there's no inline gap below the art. Image loading goes through [src/components/compendium/SpellArtPreview.tsx](../../src/components/compendium/SpellArtPreview.tsx), which preloads the next spell's image and shows a gold spinner while loading.

## Range bucket gotcha

The bucket VALUES (`5ft`, `30ft`, `60ft`, `120ft`, `long`, `other`) are exact-distance strings carried over from an earlier exact-value implementation. The labels (`Close`, `Short`, `Medium`, `Long`, `Far`) are band-based. The mismatch is intentional — renaming values would break stored spell-rule queries. See `RangeBucket` type comment in [src/lib/spellFilters.ts](../../src/lib/spellFilters.ts).

## Related docs

- [compendium-spells.md](compendium-spells.md) — data layer, summary index, common tasks
- [compendium-spells-editor.md](compendium-spells-editor.md) — admin editor + Foundry importer
- [spell-favorites.md](spell-favorites.md) — favourites storage and sync
- [../ui/filters.md](../ui/filters.md) — filter chip vocabulary
- [../ui/bbcode.md](../ui/bbcode.md) — description storage format
