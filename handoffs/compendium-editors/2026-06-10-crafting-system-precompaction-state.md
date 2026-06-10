# Crafting & Commerce system + requirements fixes — compaction pickup — 2026-06-10

**Branch:** `compendium-editors` · **worktree:** `…/.claude/worktrees/nostalgic-lamport-76d78d`
**origin/main = `79fb59c`** (requirements fixes ONLY — NOT the crafting work).
**Branch local:** `f79c806 → ba44956 (R, also on main) → b4cbbb4 (W = all crafting WIP)` + uncommitted docs.
tsc baseline = **3**.

## TL;DR
Two tracks this session:
1. **Requirements fixes — SHIPPED TO MAIN** (commit `ba44956`, cherry-picked onto main as `79fb59c`):
   class-level prereqs now show in the AdvancementManager levels column; the spell/feature requirement
   leaf pickers are wired. DONE + live.
2. **Crafting & Commerce — Phase A data layer + RecipesEditor built, COMMITTED as `b4cbbb4` on the
   branch (NOT on main).** This is the in-progress work; **resume here.**

## ⭐ READ FIRST when resuming
- **`docs/_drafts/crafting-editors-implementation-guide-2026-06-10.md`** — dense code/styling reference
  (file map, camelCase data-layer conventions, `CompendiumEditorShell` minimal admin props, VERIFIED
  component props, styling classes, `ProficiencyEntityShell` taxonomy + `columnCase`, routes/nav, and
  exactly what the two remaining editors need).
- Memory `project_crafting_commerce_roadmap.md` — durable state + all decisions.
- Design: `docs/_drafts/crafting-commerce-design-2026-06-09.html` · Kibbles reconciliation (KEEP/DEFER/CUT):
  `docs/_drafts/kibbles-reconciliation-2026-06-09.html` · friendly overview: `…/crafting-commerce-explained-2026-06-09.html`.

## Track 1 — requirements fixes (SHIPPED to main, DONE)
- `src/lib/requirements.ts`: new **`topLevelLevelGate()`** — `effectiveOptionLevel` now counts top-level
  `levelInClass` ("Class Level") leaves, not just `level`, so the AdvancementManager choice-selection
  **levels column** reflects class-level prereqs (was showing "Lvl 0+"). Display/sort only; the strict
  `level`-only `extractTopLevelLevelLeaf` that feeds the flat character-level mirror is UNCHANGED.
  (User confirmed "subclass level" = `levelInClass`; no new leaf type needed.)
- `FeatsEditor.tsx` + `UniqueOptionGroupEditor.tsx`: the `spell` ("Spell") + `feature` ("Class Feature")
  requirement leaf pickers were **unwired** — the leaf types existed but neither editor passed
  `lookups.spells` / `lookups.features` (stale "deferred until search UI" comment; the picker is
  searchable now). Fix: load spells (slim `id,name`; UniqueOptionGroupEditor already loaded features as
  `allFeatures`), pass spells + features to the lookups, + `spellNameById`/`featureNameById` in each
  `requirementsTextLookup`. `spellRule` leaf was already wired.

## Track 2 — crafting & commerce (built, COMMITTED `b4cbbb4`, NOT on main)
**Data layer** (camelCase entity tables — Foundry-aligned; SKIP the `compendium.ts` alias layer):
- **Migrations — UNAPPLIED to any DB (local files only):** `20260609-1300_create_enchantments` ·
  `-1350_create_crafting_disciplines` (seeded taxonomy) · `-1400_create_recipes` ·
  `-1500_create_crafting_materials`.
- **Wiring:** `D1_TABLE_MAP` (d1Tables.ts) += enchantments / recipes / craftingDisciplines /
  craftingMaterials; `jsonFields` (d1.ts) + server `JSON_COLUMNS` (api/_lib/d1-fetchers-server.ts) +=
  `restrictions`/`riders` (enchantments), `inputs`/`goldCost`/`craftTime`/`craftRequirements`
  (recipes), `usedFor` (materials). (jsonFields is GLOBAL → distinctive names on purpose.)
- **Schemas:** `docs/database/structure/{enchantments,recipes,crafting_materials,crafting_disciplines}.md`.
- **`RecipesEditor.tsx`** (THE reference editor) — route `/compendium/recipes/manage` (App.tsx, no
  AdminOnly wrapper — self-gates) + admin-only sidebar link (Sidebar.tsx). Built on
  `CompendiumEditorShell` (admin-only, camelCase, direct `upsertDocument`). Sub-tabs: Basics · Output
  (3-mode switch item/enchantment/enchant-item with `SingleSelectSearch` pickers) · Inputs & Cost · Tags.
- **Crafting-disciplines admin tab** in `AdminProficiencies` via `ProficiencyEntityShell` + the **NEW
  opt-in `columnCase='camel'` prop** (persists `sort`/`updatedAt`; default `'snake'` leaves the 10
  legacy taxonomies untouched — first step of the snake→camel migration, see
  `docs/database/camelcase-column-migration.md`).

## Resume plan (NEXT)
1. Apply the 4 crafting migrations to **LOCAL D1** (local-first; never `--remote` without permission).
2. Live-test RecipesEditor (renders, saves, pickers populate). Add the **`trivial`** rarity tier to the
   app rarity vocab (zero migration — rarity is bare TEXT, app-validated).
3. **EnchantmentsEditor** — copy RecipesEditor; reuse `ActivityEditor` (`enchant` kind) +
   `ActiveEffectEditor` for `effects`; restrictions; rarity/attunement/price.
4. **CraftingMaterials editor** — loot-item-backed (`itemId` → a `loot` items row,
   `type_subtype='material'`); category/rarity/subtype/usedFor(discipline ids)/price/weight.
5. Later: **Magic-Items tab** (filtered view of items `magical=1`); **Shop = MULTIPLE named shops**
   (global + per-campaign; `shops` + `shop_inventory`) — blocked on the **character-wallet GAP** (add a
   `characters.currency` JSON column, matches Foundry `system.currency`).

## Key decisions (durable)
- Recipe = universal `inputs → output`; 3 output modes; KEPT recipe-native `craftChecks` +
  `craftDifficultyDC`. (Source: Kibbles' Compendium of Craft & Creation, Ch.6 — reconciliation doc has
  the full KEEP/DEFER/CUT.)
- Materials = own `crafting_materials` table **backed by a loot-type items row** (so it's carryable);
  Foundry surfaces it as the loot subtype `material`.
- Disciplines = lightweight seeded taxonomy (camelCase, `sort`); execution fields (ability/tool/facility)
  deferred to Phase D.
- NEW tables = camelCase (Foundry is camelCase; ordering field = `sort`).
- Shop = MULTIPLE shops, not one global price list (decided 2026-06-10).

## Uncommitted on the branch (on disk — commit when resuming)
`crafting-editors-implementation-guide-2026-06-10.md`, this handoff, and the shop edits to the design/
explained HTML docs sit on top of `b4cbbb4`, uncommitted. (Memory notes live outside the repo.)

## Dev stack + process (CRITICAL)
- Dev stack (full details incl. API_SECRET): see `2026-06-09-items-importer-and-detail-view-state.md`
  — Worker `cd worker && WRANGLER_SEND_METRICS=false npx wrangler dev --port 8787`; App
  `npm run dev:nowatch` (:3000). NEVER `npm install` in the worktree (node_modules junctioned).
- `main` = production, auto-deploys on push. **NEVER push without explicit permission;** show
  `git log origin/main..HEAD` first. tsc baseline = 3.
- Migrations: local-first; apply ONE file via `d1 execute --remote --file <m> --config
  worker/wrangler.toml -y` ONLY with permission (NEVER `migrations apply --remote`).
- **Shipping crafting later:** rebase `compendium-editors` onto `origin/main` (commit `ba44956`/R drops
  as already-applied), then push with permission.
