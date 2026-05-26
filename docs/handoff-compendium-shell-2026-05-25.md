# Handoff — Compendium browser shell + items architecture (2026-05-25)

> **Supersedes** `docs/handoff-foundry-alignment-2026-05-25.md` (intentionally never committed — its content is folded into this doc).
>
> **Read first:**
> - `docs/architecture/proposal-editor-pattern.md` (still the live contract for proposal-mode editors)
> - `module/dauligor-pairing/docs/{spell,feat,item,actor}-folder-export-contract.md` (the four Foundry → Dauligor transport contracts)
> - `docs/features/compendium-races-backgrounds.md` (implementation guide for the only remaining placeholder surfaces)
>
> **Status:** **All 73 changed files committed across 8 staged commits on `main`** as of 2026-05-25. **Five new D1 migrations applied to LOCAL only**, none on remote yet — see "Migrations pending remote application" below.
>
> ## Commit chain on `main`
>
> | Commit | Scope |
> |---|---|
> | C1 — `chore(sidebar)` | Drop Manager rows from the Compendium nav. |
> | C2 — `feat(foundry)` | Shared HTML cleanup + feat-browser endpoints + prereqs rendering. |
> | C3 — `feat(compendium)` | Public browser shell + 5 list pages + favorites system (spells, feats, items, races + backgrounds placeholders). |
> | C4 — `feat(compendium)` | Editor shell + restructure of SpellsEditor / FeatsEditor / ItemsEditor + Race/BackgroundEditor wrappers + import workbenches. |
> | C5 — `feat(items)` | Unified items table + Foundry-aligned shapes + activity enum alignment. |
> | C6 — `feat(advancements)` | Feat-level advancements + character-build runtime + ASI feat-or-stats flow. |
> | C7 — `feat(module)` | Item + Actor folder exports + importer wiring + local-dev server mounts. |
> | C8 — `docs` | This documentation pass + races/backgrounds implementation guide. |

---

## Production topology (stable since 2026-05-21)

| Layer | Where it runs |
|---|---|
| Frontend SPA | Cloudflare Pages (`www.dauligor.com`) |
| `/api/*` surface | Cloudflare Pages Functions (`functions/api/*`) |
| D1 + R2 binding | Cloudflare Worker `dauligor-storage` (separate `wrangler deploy` from `worker/`) |
| Local dev | Express + Vite on `:3000`, `wrangler dev` worker on `:8787` |

## 🚨 Critical D1 migration rules

**Production D1's `d1_migrations` tracking table is empty.** Until task #39 (backfill `d1_migrations`) ships:

- ✅ **Apply new migrations** via `npx wrangler d1 execute dauligor-db --remote --file=<file>`
- ❌ **Do NOT** run `npx wrangler d1 migrations apply dauligor-db --remote` — would replay every migration from scratch

**Per-migration permission rule (AGENTS.md #7):** Never apply a migration to remote D1 without explicit per-migration permission from the user. Treat `--remote` as a one-way door.

**Migrations pending remote application (all applied locally):**
1. `20260524-1800_foundry_aligned_item_shapes.sql` — weapons/armor/tools Foundry-aligned columns
2. `20260525-1600_user_feat_favorites.sql` — `user_feat_favorites` table
3. `20260525-1700_user_item_favorites.sql` — `user_item_favorites` table
4. `20260525-1800_items_unified_shapes.sql` — unified items-table shape columns + polymorphic base_*_id FKs
5. `20260525-1900_feats_advancements.sql` — adds `feats.advancements` JSON column for feat-level advancements (Adept of the Red Robes-style)

---

## Architectural decisions locked this session

### 1. Items live in the `items` table; weapons/armor/tools are PROFICIENCY DEFINITIONS

`weapons` / `armor` / `tools` D1 tables are catalogued by `/admin/proficiencies` and hold base-type definitions ("Greatsword", "Padded", "Lyre"). They are **not** an inventory of game items.

Actual game items (Acid (vial), Flame Tongue Greatsword, etc.) live in the unified `items` table. Each item references its proficiency category via **polymorphic FK columns** (`base_weapon_id`/`base_armor_id`/`base_tool_id` — one set per item, others NULL).

The `items` table absorbed shape-specific columns via migration `20260525-1800`:
- **Weapons:** `damage` JSON, `range` JSON, `mastery`, `magical_bonus`, `ammunition`, `proficient`
- **Armor:** `armor_value`, `armor_dex`, `armor_magical_bonus`, `strength`, `stealth`, `armor_type`
- **Tools:** `tool_type`, `bonus`
- All: existing `base_item` TEXT slug column preserved as the Foundry source-of-truth

`itemImport.ts` is now single-target — every Foundry item routes to `items` regardless of shape. The Foundry `system.type.baseItem` slug is resolved against the matching proficiency table's `identifier` and written into the right `base_*_id` FK. Unresolved slugs surface a warning telling admins to add the missing proficiency row.

### 2. Public compendium browsers share one shell

`<CompendiumBrowserShell>` (553 LoC at `src/components/compendium/CompendiumBrowserShell.tsx`) owns viewport-lock, paneHeight, 3-col grid, FilterBar wiring, Settings popover, favorites pane shell, sortable column-header chevrons, virtualized list, detail pane Card. Pages supply only entity-specific bits (data load, filter pipeline, column descriptors, detail panel, favorites hook).

`useAxisFilters` hook (201 LoC at `src/hooks/useAxisFilters.ts`) bundles the 8 axis cyclers + active count + reset that used to be ~120 LoC of boilerplate per page.

| Page | Before | After |
|---|---|---|
| SpellList | 1429 | **933** |
| FeatList | (post-rebuild) 700 | **350** |
| ItemList | (post-rebuild) 900 | **569** |

A convention change in `CompendiumBrowserShell` now propagates to all three.

**Sortable columns:** added to the shell via `sortable: true` on `CompendiumColumn<TRow>` + `sortBy`/`sortDir`/`onSortChange` props. SpellList consumes this; FeatList/ItemList don't need it.

### 3. Favorites stay per-entity (deferred consolidation)

Three parallel implementations exist (`user_spell_favorites`, `user_feat_favorites`, `user_item_favorites` tables + endpoints + libs). Consolidation into one `user_entity_favorites` table with kind discriminator was explicitly **deferred** at user request.

---

## This session's uncommitted work — file manifest

### Migrations (LOCAL D1 only)
| File | Adds |
|---|---|
| `worker/migrations/20260525-1600_user_feat_favorites.sql` | `user_feat_favorites` table |
| `worker/migrations/20260525-1700_user_item_favorites.sql` | `user_item_favorites` table |
| `worker/migrations/20260525-1800_items_unified_shapes.sql` | shape columns + 3 polymorphic base_*_id FKs on items |

### Pages Functions
| File | Purpose |
|---|---|
| `functions/api/feat-favorites.ts` | universal-scope feat favorites endpoint |
| `functions/api/item-favorites.ts` | universal-scope item favorites endpoint |

### Libraries
| File | Purpose |
|---|---|
| `src/lib/featFavorites.ts` | client hook + localStorage/cloud merge |
| `src/lib/itemFavorites.ts` | mirror for items |
| `src/lib/itemImport.ts` | **REFACTORED** — single-target architecture, base-item FK resolver |
| `src/lib/featImport.ts` | from prior session, unchanged |
| `src/lib/compendium.ts` | from prior session |
| `src/lib/d1.ts` | from prior session |

### Hooks + shell
| File | Purpose |
|---|---|
| `src/hooks/useAxisFilters.ts` | shared axis-filter state + cyclers |
| `src/components/compendium/CompendiumBrowserShell.tsx` | shared chrome for public compendium pages |

### Compendium pages
| File | Status |
|---|---|
| `src/pages/compendium/SpellList.tsx` | rewritten on the shell (1429 → 933) |
| `src/pages/compendium/FeatList.tsx` | rewritten on the shell |
| `src/pages/compendium/ItemList.tsx` | **NEW** public unified items browser |
| `src/pages/compendium/RacesList.tsx` | **NEW** placeholder (schema TBD) |
| `src/pages/compendium/BackgroundsList.tsx` | **NEW** placeholder (schema TBD) |
| `src/pages/compendium/Compendium.tsx` | hub: added items/races/backgrounds tiles |
| `src/pages/compendium/ItemsEditor.tsx` | unchanged content; moved to `/items/manage` |

### Import workbenches (per-entity)
| File | Status |
|---|---|
| `src/components/compendium/ItemImportWorkbench.tsx` | refactored to single-target |
| `src/components/compendium/FeatImportWorkbench.tsx` | from prior session |
| `src/components/compendium/SpellImportWorkbench.tsx` | from prior session |

### Editor mechanics-fields (from prior session)
| File | Status |
|---|---|
| `src/components/compendium/WeaponMechanicsFields.tsx` | NEW |
| `src/components/compendium/ArmorMechanicsFields.tsx` | NEW |
| `src/components/compendium/ToolMechanicsFields.tsx` | NEW |
| `src/pages/admin/WeaponsEditor.tsx` | wired |
| `src/pages/admin/ArmorEditor.tsx` | wired |
| `src/pages/compendium/ToolsEditor.tsx` | wired |

### Activity enum alignment (from prior session)
- `src/components/compendium/activity/{constants.ts, ActivationDurationEditor.tsx, RangeTargetingEditor.tsx}` + `ActivityEditor.tsx`

### Foundry module exports (from prior session)
- `module/dauligor-pairing/scripts/{export-service.js, main.js}` + `module/dauligor-pairing/docs/{item,actor}-folder-export-contract.md`

### Routes / Sidebar
- `src/App.tsx` — added ItemList/RacesList/BackgroundsList routes; moved ItemsEditor → `/items/manage`
- `src/components/Sidebar.tsx` — added public Items/Races/Backgrounds entries
- `server.ts` — mounted `/api/spell-favorites`, `/api/feat-favorites`, `/api/item-favorites` for local dev

---

## Recommended commit strategy

Five logical commits, ordered safe-first:

1. **Foundry export expansion** (lowest risk, deploy independently)
   - `module/dauligor-pairing/**` + the 2 new contract docs

2. **Foundry-aligned editor shapes** (from prior session)
   - Migration `20260524-1800_foundry_aligned_item_shapes.sql`
   - Activity enum changes (4 files)
   - WeaponMechanicsFields / ArmorMechanicsFields / ToolMechanicsFields + their editors
   - `compendium.ts` + `d1.ts` updates

3. **Foundry import workbenches** (from prior session)
   - `featImport.ts`, `FeatImportWorkbench.tsx`, FeatsEditor tabs
   - `SpellImportWorkbench.tsx` updates

4. **Items unified architecture** (this session — the big one)
   - Migration `20260525-1800_items_unified_shapes.sql`
   - `itemImport.ts` refactor
   - `ItemImportWorkbench.tsx` refactor

5. **Compendium browser shell + new public pages** (this session)
   - Migrations `20260525-1600` + `20260525-1700` (favorites tables)
   - `useAxisFilters.ts`, `CompendiumBrowserShell.tsx`
   - `featFavorites.ts`, `itemFavorites.ts`
   - `functions/api/feat-favorites.ts` + `item-favorites.ts`
   - SpellList / FeatList / ItemList / RacesList / BackgroundsList
   - `Compendium.tsx`, `Sidebar.tsx`, `App.tsx`, `server.ts`

Each commit is independently safe to ship; later commits depend on earlier ones (migrations apply in order).

---

## Verification status

- `npx tsc --noEmit` → 7 errors (all pre-existing: `asChild` Popover typing in CompendiumBrowserShell + SpellList + 4 unrelated files). **0 new errors** from this session's work.
- `npm run build` → green (~10–30s depending on cache state)
- Local D1 migrations applied successfully
- Local dev server: Express + Vite on `:3000`, ports were cleared mid-session

---

## Pending non-blocking work

| # | Task | Sketch |
|---|---|---|
| 1 | Apply 4 migrations to remote D1 | All applied locally; each needs explicit per-migration permission |
| 2 | Unified favorites backend | 3 parallel tables/endpoints could collapse to one with kind discriminator; user deferred |
| 3 | Races + Backgrounds schemas | Placeholder pages exist; full table+importer+editor work TBD |
| 4 | Items folder export cosmetic | `itemSummary.magical` ships as `""` instead of `false` |
| 5 | Items contract doc drift | `itemSummary.container.capacity` shape doesn't match doc |
| #24/25/26 | Self-serve worlds, per-world content gating, system page type | Carry-over from prior backlog |
| #39 | Backfill `d1_migrations` on prod D1 | Until done, no `migrations apply --remote` |
| #194 | Audit unchunked IN clauses in `_classExport.ts` | D1 ~100-param limit |
| #204 | Foundry visual + functional verify | Manual test of all sidebar buttons + new exports |

---

## Project conventions to honor

- **No backwards compatibility during migrations** — when shape changes, update sources to fit
- **Survey first, no DB touches** — verify code against doc claims before refactoring
- **D1 upsert idiom** — never `INSERT OR REPLACE`; always `ON CONFLICT(id) DO UPDATE`
- **Foundry module junction** — `%LOCALAPPDATA%\FoundryVTT\Data\modules\dauligor-pairing` is an NTFS junction → repo `module/dauligor-pairing`. Never repoint at a `.claude/worktrees/*` agent sandbox.
- **No remote D1 writes without per-migration permission**
- **No push to `origin/main` without explicit green-light**
- **Public compendium pages use `CompendiumBrowserShell`** — UI conventions change in one place
- **`weapons` / `armor` / `tools` = proficiency definitions only** — game items go in `items` with FK references

---

## What to read for a fresh agent

1. **This handoff** — you're here
2. **`docs/architecture/proposal-editor-pattern.md`** — proposal-editor contract
3. **`src/components/compendium/CompendiumBrowserShell.tsx`** — the shared shell with its prop contract in the file header
4. **`src/lib/itemImport.ts`** — the file header explains the items-table-only architecture
5. **`module/dauligor-pairing/docs/*-folder-export-contract.md`** — Foundry transport contracts
6. **`AGENTS.md`** + **`DIRECTORY_MAP.md`** — top-level guardrails

---

**Delete this handoff when:** all five recommended commits have landed on `origin/main`, the four migrations are on remote D1 (with per-migration permission), and the import workbenches + public compendium pages have been smoke-tested in production.
