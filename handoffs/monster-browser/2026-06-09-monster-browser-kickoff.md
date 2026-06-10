# Kickoff — Monster Browser (new feature, new branch)

**Status:** planned · greenfield · **NOT started**
**Branch:** create `monster-browser` **off `origin/main`** — do NOT continue on
`compendium-editors` (that line is the items work; it's shipped and done — see the
"Decoupling" note at the bottom).

## Goal
Build a **public Monster Browser** — a read-only compendium browser for D&D 5e monsters
/ stat blocks (NPCs, beasts, dragons, …), mirroring the existing
`/compendium/items`, `/compendium/spells`, `/compendium/feats` browsers. Route it at
`/compendium/monsters`. (An admin editor + Foundry importer are natural follow-ups but
are **out of scope for the browser** — see "Phasing".)

## Current state (verified 2026-06-09)
**Greenfield.** There is **no `monsters` table, no monster page, no monster import,
and no monster doc** in the repo today (grep for `monster`/`creature`/`statblock`
returns only incidental hits — summon/transform activities, etc.). You are building
this from scratch — but the *browser pattern* it rides on is mature and copyable.

## Read first (orientation)
| Doc | Why |
|---|---|
| [`AGENTS.md`](../../AGENTS.md) | Briefing + the **non-negotiable rules** (D1 idioms, no firebase, timestamped migrations, local-first migrations, `main` = prod, style-guide, drift-managed pairs). Read the "Non-negotiable rules" + "Where to look" sections. |
| [`docs/README.md`](../../docs/README.md) | The documentation index — the "I'm working on…" table routes you. |

## The browser pattern — mirror these (the core reference)
Every public browser is a thin wrapper around one shared shell. **Copy the freshest
one (`ItemList`) and adapt.**

| Path | Role |
|---|---|
| [`src/components/compendium/CompendiumBrowserShell.tsx`](../../src/components/compendium/CompendiumBrowserShell.tsx) | The shared 3-pane fullscreen browser (list · filters · detail). You pass it `rows`, `columns` (`CompendiumColumn[]`), `filterAxes`, `detailPanel`, favorites wiring. |
| [`src/pages/compendium/ItemList.tsx`](../../src/pages/compendium/ItemList.tsx) | **Best template** — freshest browser. Shows: column defs, axis filters, `useAxisFilters`, favorites, hash deep-link, and the **slim-load + lazy `fetchItem`-on-select** pattern (copy this for monsters — stat blocks are heavy). |
| [`src/pages/compendium/SpellList.tsx`](../../src/pages/compendium/SpellList.tsx) · [`FeatList.tsx`](../../src/pages/compendium/FeatList.tsx) | Two more working examples (multi-axis filters, detail panels). |
| [`src/hooks/useAxisFilters.ts`](../../src/hooks/useAxisFilters.ts) | The filter-state hook (3-state chips per axis). |
| [`src/components/compendium/SectionFilterPanel.tsx`](../../src/components/compendium/SectionFilterPanel.tsx) | `FilterSection` type + the filter-modal body. |
| [`docs/features/compendium-spells-browser.md`](../../docs/features/compendium-spells-browser.md) | **Documents** the public 3-pane browser pattern (sort / hide columns / favourites pane). |
| [`docs/ui/filters.md`](../../docs/ui/filters.md) | The filter modal: 3-state chips, AND/OR/XOR combinators per section, tag section-expand. |

### Detail panel — mirror these
| Path | Role |
|---|---|
| [`src/components/compendium/ItemDetailPanel.tsx`](../../src/components/compendium/ItemDetailPanel.tsx) | Read-only detail panel: art preview (`Image()` probe → glyph fallback), BBCode description via `bbcodeToHtml`, readable mechanic rows, favourite star. A `MonsterDetailPanel` should follow this shape. |
| [`src/components/compendium/FeatDetailPanel.tsx`](../../src/components/compendium/FeatDetailPanel.tsx) | The `FeatArtPreview` pattern (the art-preview component to copy). |

## Data layer — you need a new `monsters` table
**Create a dedicated `monsters` table** — do NOT shoehorn monsters into `feats` or
another table (per the repo's "new table for new functionality" rule; the
feats-holds-races/backgrounds placeholder is the anti-pattern to avoid).

| Doc / Path | Why |
|---|---|
| [`docs/database/README.md`](../../docs/database/README.md) | Schema philosophy, migration index, the **reset workflow**. |
| [`docs/database/structure/items.md`](../../docs/database/structure/items.md) | **Template** for the per-table schema doc you'll write (`docs/database/structure/monsters.md`). Note its column/JSON conventions + the snake↔camel alias list. |
| [`docs/platform/d1-architecture.md`](../../docs/platform/d1-architecture.md) | D1 client API, the **JSON-column auto-parse list** (you must register `monsters`' JSON columns), cache layers. |
| [`src/lib/d1.ts`](../../src/lib/d1.ts) | `fetchCollection` / `fetchDocument` / `upsertDocument` helpers + the `jsonFields` auto-parse list (add monster JSON cols here). `fetchCollection` supports a `select:` projection — use it for the slim list load. |
| `AGENTS.md` § "Migration filename convention" | **Timestamped** migrations: `worker/migrations/YYYYMMDD-HHMM_create_monsters.sql`. Apply **local-first**; remote only with explicit go-ahead (never `migrations apply --remote`). |

### Suggested `monsters` columns (5e stat-block shape)
`id`, `name`, `identifier`, `source_id`, `page`, `cr` (REAL — 0.125/0.25/0.5/1/…),
`creature_type` (beast/dragon/fiend/…), `size` (tiny…gargantuan), `alignment`,
`ac` (INT) + `ac_formula`, `hp` (INT) + `hp_formula`, `speed` (JSON
{walk,fly,swim,…}), `abilities` (JSON {str,dex,con,int,wis,cha}), `saves` (JSON),
`skills` (JSON), `senses` (JSON), `damage_resistances`/`immunities`/`vulnerabilities`,
`condition_immunities`, `languages`, `traits` (JSON[]), `actions` (JSON[]),
`bonus_actions`/`reactions`/`legendary_actions`/`lair_actions` (JSON[]),
`image_url`, `description`, `tags` (JSON), `created_at`/`updated_at`.
Lock the exact shape against a real Foundry `actor` (npc) export before committing the
migration — see Foundry note below.

### Browser filter axes (start here)
`cr` (banded: 0, ⅛–1, 2–4, 5–10, 11–16, 17+), `creature_type`, `size`, `source`,
and a `tags` axis. Mirror `ItemList`'s `useAxisFilters` + `filterAxes` wiring.

## Routing + styling
| Doc | Why |
|---|---|
| [`docs/architecture/routing.md`](../../docs/architecture/routing.md) | `App.tsx` route table + RBAC enforcement at the route boundary — where to register `/compendium/monsters` (public) and any `/compendium/monsters/manage` (admin) route. |
| [`docs/ui/style-guide.md`](../../docs/ui/style-guide.md) | **Styling source of truth** — tokens only (gold/ink/blood), documented classes, square corners, minimal icons. Read before any UI. |

## Foundry (future — informs the data model NOW)
Monsters are Foundry **`Actor`** documents (`type: "npc"`) — a **different schema than
items** (which are `Item` documents). The item importers are the right *pattern* but
not a drop-in. Before finalizing the table, capture a real npc actor export to pin the
field shape.
| Doc / Path | Why |
|---|---|
| [`docs/architecture/foundry-integration.md`](../../docs/architecture/foundry-integration.md) | The dual-state philosophy + the app↔module round-trip contract. |
| `src/lib/itemImport.ts` + `src/lib/foundryActivities.ts` | Import *patterns* to mirror when a monster importer comes (shared activity converter, source matching, per-source identifier uniqueness). Actor stat blocks differ — don't assume item shapes. |

## Phasing (suggested)
1. **Migration** — `monsters` table + register JSON cols in `d1.ts`/`d1-architecture` + write `docs/database/structure/monsters.md`. Apply local-first.
2. **Seed a handful** of monsters (manual rows or a tiny script) so the browser has data to render.
3. **`MonsterList.tsx`** — copy `ItemList.tsx`, swap columns (Name / CR / Type / Size / Source) + filter axes; slim-load + lazy `fetchMonster` on select.
4. **`MonsterDetailPanel.tsx`** — copy `ItemDetailPanel.tsx`; render the stat block (art, AC/HP/speed, ability table, traits/actions via BBCode).
5. Register the `/compendium/monsters` route + sidebar entry.
6. *(later, separate scope)* admin editor + Foundry npc importer.

## Local dev + process (non-negotiable)
- Dev stack + "drive the servers yourself" recipe: [`docs/operations/local-dev.md`](../../docs/operations/local-dev.md). Worker (`worker/`, port 8787) + `npm run dev` (Express :3000). **Never `npm install` in a worktree** (node_modules is junctioned).
- **`main` = production, auto-deploys.** Never push without explicit permission; show `git log origin/main..HEAD` first. Commit when shipping (don't ask about every commit). tsc has a known baseline of pre-existing errors — keep it there, don't add new ones.
- Editor-pattern decision tree (for the eventual admin editor): [`docs/architecture/compendium-editor-patterns.md`](../../docs/architecture/compendium-editor-patterns.md).
- Coordination: add a row to [`handoffs/BRANCH_REGISTRY.md`](../BRANCH_REGISTRY.md) + a `handoffs/monster-browser/manifest.md` when you start, declaring the files you own (new `MonsterList`/`MonsterDetailPanel`, the migration) + the shared files you'll touch append-only (`src/App.tsx` routes, `src/lib/d1.ts` jsonFields, the sidebar).

## Decoupling note — this is NOT compendium-editors work
The `compendium-editors` branch (the items rebuild + importer + reader-view +
activity/lazy-load work) is **shipped and done** — prod is at `096bacf`,
`compendium-editors == origin/main`, clean tree. The monster browser is a **separate
feature on its own branch**. Start it fresh:

```bash
git fetch origin
git checkout -b monster-browser origin/main   # off main, NOT off compendium-editors
```

Everything you need is reachable from `origin/main` via the links above — no
`compendium-editors` context required.
