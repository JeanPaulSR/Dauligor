# Draft — `/admin/proficiencies` UX revamp

Status: **locked design, scheduled after shell migration**. Decisions captured 2026-05-21:

- **Role gate stays admin-only** (only the UX changes; the page is still GM-tier).
- **Sequencing**: this revamp lands AFTER the [`ProficiencyEntityShell` migration](proficiency-shell-design-2026-05-21.md) is stable. Editors first, nav second.
- **Cross-tab search ships with v1**.
- Grouping labels still open — Combat / Language / Game System is the default; revisit at implementation time.

---

## What it is today

[AdminProficiencies.tsx](../../src/pages/admin/AdminProficiencies.tsx) (85 lines) is a flat strip of **13 buttons** stacked horizontally:

```
[Skills] [Tools] [Tool Categories] [Weapons] [Weapon Categories] [Weapon Properties]
[Armor] [Armor Categories] [Languages] [Language Categories] [Damage Types]
[Attributes] [Spellcasting]
```

Each click swaps the body to a different editor. Admin-only role gate at the top.

---

## Why it needs help

1. **No grouping** — Weapons and "Weapon Properties" sit between "Weapon Categories" and "Armor". An admin has to scan the strip linearly to find the right tab.
2. **No counts** — "How many Skills do I have?" requires clicking in. Same for the other 12 tabs.
3. **No active-tab persistence** — refreshing the page sends you back to Skills.
4. **No search across categories** — "where is Longsword?" requires guessing it's in Weapons.
5. **Visual sameness** — every tab is the same gold-on-card pill. 13 of them is wall-of-buttons.
6. **Admin-only gate is now stale**. The user noted this is "out of the admin-only phase." Need to align with current `effectiveProfile` / RBAC convention. **What's the right role gate?** (open question below)
7. **"Conditions" comment-only references** — lines 10-12 note conditions moved to `/admin/statuses`. The comment is right but the rest of the page still feels like it's frozen in the pre-Statuses-move state.

---

## Proposed layout

Replace the flat 13-button strip with a **left-rail nav** grouped by domain, body on the right:

```
┌─────────────────────────┬──────────────────────────────────────┐
│ PROFICIENCIES MANAGER   │                                       │
│ Define core game data… │  <editor for selected tab>             │
│                         │                                       │
│ ── Combat ──            │                                       │
│   Skills           (18) │                                       │
│   Tools            (24) │                                       │
│     Categories      (6) │                                       │
│   Weapons          (52) │                                       │
│     Categories      (4) │                                       │
│     Properties     (12) │                                       │
│   Armor            (15) │                                       │
│     Categories      (4) │                                       │
│                         │                                       │
│ ── Language ──          │                                       │
│   Languages        (28) │                                       │
│     Categories      (5) │                                       │
│                         │                                       │
│ ── Game System ──       │                                       │
│   Attributes        (6) │                                       │
│   Damage Types     (13) │                                       │
│   Spellcasting          │                                       │
│                         │                                       │
│ [🔍 Find proficiency…]   │                                       │
└─────────────────────────┴──────────────────────────────────────┘
   ~240px                    flex-1
```

Notes on the sketch:
- **Headers** (`── Combat ──`, `── Language ──`, `── Game System ──`) group by domain. The grouping mirrors how a DM thinks about these: "I'm setting up combat data" vs "I'm setting up the language list" vs "I'm tuning the system itself."
- **Counts** in parens come from `fetchCollection(name, { orderBy: 'name ASC' })` row counts. Cached so we don't re-fetch on every tab switch.
- **Indented Categories / Properties** sit under their parent. Visually weights them as "supporting taxonomies" rather than first-class peers.
- **Spellcasting** is a one-off — it's not a CRUD list editor like the others; it's a progression manager. Keep it grouped in "Game System" but flag visually that it opens a different surface.
- **Find proficiency search** at the bottom of the rail. Types one of: skill / tool / weapon / armor / language / damage type names. Click result → switches tab + scrolls/highlights the matching list row.
- The rail collapses to a top tab strip below `md:` (matches the current responsive convention).

Visual style: same shadcn primitives + gold accent the rest of the app uses. The rail is `.browser-sidebar`-styled (already a named class — [docs/ui/components.md](../ui/components.md#browsers-two-panel-split-views)). Active row gets the gold-fill treatment used in `/wiki`'s lore tree.

---

## Persistence

Selected tab persists in `localStorage` under `dauligor.adminProficiencies.activeTab.v1`. Refresh restores the last tab. Same convention used by `IconPickerModal.favorites.v1.<uid>` ([docs/ui/components.md](../ui/components.md)).

---

## Role gating

Decision: **stay admin-only**. The "out of admin-only phase" language was about UX maturity, not access control. The current `userProfile?.role !== 'admin'` gate stays.

---

## What the search box does (and doesn't)

Types a substring → filters rows across **all** of the lists in the rail's domain set, server-side via `queryD1` with a `LIKE` pattern (one per table). Returns up to N results sorted by table priority. Click → switch tab + scroll the list to the row.

What it doesn't do:
- Cross-table fuzzy search. Substring only.
- Search inside descriptions. Names + identifiers only.
- Server-side global FTS. We don't have it.

Search is a quality-of-life addition, not the headline feature. If it's contentious we can ship the rail revamp without it and add later.

---

## Behavior changes vs current

| Surface | Before | After |
|---|---|---|
| Default tab | Skills | Last-used tab, falls back to Skills if no localStorage entry |
| Role gate | admin-only (hard) | (TBD — see open question) |
| Tab order | 13 in a row | Grouped + indented in a rail |
| Mobile layout | Wrapping pill row | Horizontal tab strip (collapsed; categories grouped) |
| Counts shown | No | Yes (lazy-loaded, cached) |
| Search | No | Yes |
| Header | Title + italic description block | Stays; pushed into the rail header |
| Body | Editor unchanged | Editor unchanged (the `ProficiencyEntityShell` migration is orthogonal) |

The editors themselves don't change behavior — that's a separate migration.

---

## Sequencing

This revamp can land **before**, **with**, or **after** the `ProficiencyEntityShell` migration. They're independent surfaces. My preference: ship the shell migration first (proves the consolidated form path), then the rail revamp on top of stable editors. That way if a rail-side bug shows up, it's isolated from the editor consolidation.

Open to flipping the order if the user wants the visual improvement sooner.

---

## Resolved questions

1. **Role gate** → admin-only (no change)
2. **Search box** → ships with v1
3. **Sequencing** → revamp comes after the shell migration is verified stable
4. **Grouping labels** → tentative `Combat / Language / Game System`; revisit at implementation
5. **Page rename** → defer (cosmetic; not part of v1)

## Live mockups

Three nav layouts mounted at `/admin/proficiencies/mockups` for visual comparison. The mockup page swaps between variants without touching the production AdminProficiencies.

| Variant | Shape | Notes |
|---|---|---|
| **A** — Vertical Left Rail | 260px sidebar with grouped sections; sub-taxonomies indented under their parent; counts right-aligned; search box at the bottom | Closest to the original sketch. Easiest to scan top-to-bottom. Costs ~260px of horizontal space the editor body could use. |
| **B** — Hierarchical Top Tabs | Group row on top (Combat / Language / Game System); sub-tab strip below shows the active group's tabs only | Most conservative — minimal departure from the current flat strip. Hides 8 of the 13 tabs behind the group switch (less scannable, more compact). |
| **C** — Search-First Palette | Big search input as the primary nav; chips below filter as you type and are grouped by domain | Modern command-palette feel. Best for users who know what they want. Slightly buried for first-time discovery. |

Implementation file: `src/pages/admin/AdminProficienciesMockups.tsx` (delete after a winner is picked).
Route: `/admin/proficiencies/mockups` — wired in `src/App.tsx`.

All three variants share:
- The same 13-entry tab definition (mock counts for visual realism)
- The same placeholder editor body (we're comparing nav, not editors)
- Domain grouping (Combat / Language / Game System)
- Counts shown next to each entry
- The same admin-only gate
