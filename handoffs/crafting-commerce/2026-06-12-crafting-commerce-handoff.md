# crafting-commerce — dedicated-branch pickup (2026-06-12)

Hand-off so a branch can own Crafting & Commerce end-to-end while `compendium-editors` continues on the
core compendium editors. **Phase A is already LIVE on `main`** — this branch owns those files going forward
and builds Phase B–D on top. Base the branch off `origin/main` (currently `f78b5bb`).

---

## 0. What "this branch" is for
The Crafting & Commerce subsystem has a shipped foundation (catalogs + magic-items tab + a basic shop) and a
clear deferred roadmap (economy/prices, shop transactions, live crafting execution, prod system-page
content). Rather than keep growing it inside the broad `compendium-editors` branch, it gets its own branch so
the two streams stop contending for `src/pages/compendium/**` and `src/components/compendium/**`.

- **You inherit:** all crafting/enchantment/recipe/material/shop files (already on main — see manifest).
- **`compendium-editors` keeps:** Items/Feats/Spells/Class/Subclass/Race/Background/Facilities editors,
  shared widgets, importer, monster work, etc.
- **Boundary:** if a change is about *crafting, materials, enchantments, recipes, disciplines, magic-item
  surfacing, or shops/economy* → this branch. Everything else compendium → the other branch.

## 1. What already shipped (the foundation — do NOT rebuild)
Shipped to `main` 2026-06-10 (`73ebf2a`) + shorthand fix (`f78b5bb`). All LIVE on prod + remote D1.

| Area | Editor route | Public route | Table |
|---|---|---|---|
| Crafting Materials | `/compendium/materials/manage` | `/compendium/materials` | `crafting_materials` (+ backing `items` row) |
| Enchantments | `/compendium/enchantments/manage` | `/compendium/enchantments` | `enchantments` |
| Recipes | `/compendium/recipes/manage` | `/compendium/recipes` | `recipes` |
| Disciplines | `/admin/proficiencies` → Crafting Disciplines | — | `crafting_disciplines` |
| Magic Items | (uses ItemsEditor) | `/compendium/magic-items` | `items` (`magicalOnly` filter) |
| Shops | `/compendium/shops/manage` | `/compendium/shops` | `shops` |

Key shipped behaviors:
- **Materials are item-backed.** Saving a material mints/mirrors a `loot` `items` row with
  `type_subtype='material'` (carryable + valid recipe input) via `upsertItem(itemId, snakePayload)`. The
  material is **hidden** from the gear Items browser (ItemList excludes `type_subtype==='material'`).
- **Enchantments** carry full **Activities** (`ActivityEditor`, `context="item"`) AND **Effects**
  (`ActiveEffectEditor`) — a magic weapon's swipe attack is an activity; passive buffs are effects. New
  `activities` column. Restrictions = item-type → category/property taxonomies + `allowMagical`.
- **Recipes** inputs can be a **specific item** OR a **material slot** (category + subtype + rarity, e.g.
  "any common curative reagent"). `RecipeInput = {kind:'item'|'slot', itemId, category, subtype, rarity, quantity}`.
- **Magic-items split**: `ItemList` `magicalOnly` prop → `/compendium/magic-items`; the general Items browser
  excludes magical rows.
- **Shop** pool = `shopItems` JSON `[{itemId, priceOverride?}]`. Items are **not** in any shop by default.
  **Prices only — no buy/sell** (that's Phase C, blocked on a wallet — see below).
- **Disciplines** carry `tool_id` (→`tools`) + `ability_id` (→`attributes`) via `ProficiencyEntityShell`
  (`includeAbility` + `categoryFK={{column:'tool_id', referenceTable:'tools', label:'Tool'}}`,
  `columnCase='camel'`). **Facility intentionally NOT stored** — that's a per-case DM/module call.
- **Crafting sidebar section** (Overview/Materials/Recipes/Enchantments/Shops) → header → `/system/crafting`
  **system page** (DB-backed, authored via the System Page Designer — NOT hardcoded).

## 2. Files you own (all already on main)
Pages: `CraftingMaterialsEditor.tsx`, `CraftingMaterialsList.tsx`, `EnchantmentsEditor.tsx`,
`EnchantmentsList.tsx`, `RecipesEditor.tsx`, `RecipesList.tsx`, `ShopEditor.tsx`, `ShopList.tsx`
(all under `src/pages/compendium/`).
Detail panels: `CraftingMaterialDetailPanel.tsx`, `EnchantmentDetailPanel.tsx`, `RecipeDetailPanel.tsx`,
`ShopDetailPanel.tsx` (all under `src/components/compendium/`).
Shared (append-only — coordinate): `src/App.tsx`, `src/components/Sidebar.tsx`, `src/lib/d1Tables.ts`,
`src/lib/d1.ts`, `api/_lib/d1-fetchers-server.ts`, `src/pages/compendium/ItemList.tsx` (`magicalOnly`),
`src/pages/admin/AdminProficiencies.tsx` (disciplines tab).

## 3. Data layer cheatsheet
- New tables are **camelCase columns** → they SKIP the `src/lib/compendium.ts` normalize/denormalize alias
  layer entirely. Do NOT add them there.
- `src/lib/d1Tables.ts` `D1_TABLE_MAP`: `enchantments`, `recipes`, `craftingDisciplines`,
  `craftingMaterials`, `shops` already mapped alias→snake table.
- JSON auto-parse is **global** in two lists (a column name in either is parsed for ALL tables, so names must
  be distinctive): `jsonFields` in `src/lib/d1.ts` (~line 360) + `JSON_COLUMNS` in
  `api/_lib/d1-fetchers-server.ts` (~line 98). Already include: `restrictions`, `riders`, `inputs`,
  `goldCost`, `craftTime`, `craftRequirements`, `usedFor`, `shopItems`, `activities`.
- Writes go through `upsertDocument(alias, id, payload)` (camelCase tables) + `upsertItem`/`deleteItem`
  (the material's backing items row) from `src/lib/compendium.ts`.
- `items.identifier` is source-scoped unique: `UNIQUE(COALESCE(source_id,''), identifier)`.

## 4. Migrations (all 8 applied to remote D1 + verified 2026-06-10)
`20260605-1200_enchant_restriction_tables` · `20260609-1300_create_enchantments` ·
`20260609-1350_create_crafting_disciplines` · `20260609-1400_create_recipes` ·
`20260609-1500_create_crafting_materials` · `20260610-1200_enchantments_activities` ·
`20260610-1300_crafting_disciplines_tool_ability` · `20260610-1400_create_shops`.
Nothing pending. New migrations you add: **local-first**, then apply to remote **one file at a time** with
permission (never `migrations apply --remote`).

## 5. The roadmap (your actual work — pick up only what the owner asks)
Ordered roughly by dependency:

1. **`/system/crafting` + per-discipline page content on PROD.** Blank shells exist LOCAL only
   (`docs/database/seeds/crafting-system-pages.sql`) → the page 404s on prod until authored via the System
   Pages admin or the shells are seeded to remote. ⚠ **Prose is the DM's to author — do NOT transcribe
   Kibbles' Compendium verbatim (copyright). Structure/mechanics only, original wording.**
2. **Economy / item prices.** `compendium-editors` user **skipped** an Economy tab; shops currently read
   `items.price`. If revived: where buy/sell prices live (per-item base + per-shop override already exists
   via `shopItems[].priceOverride`).
3. **`characters.currency` wallet.** JSON column matching Foundry `system.currency` (pp/gp/ep/sp/cp). This is
   the **blocker** for shop transactions and crafting cost consumption. New migration + character-sheet wiring.
4. **Shop buy/sell transactions.** Needs #3. The `shops` model already has a NULL `campaignId` for future
   per-campaign scoping (global vs per-campaign shop pools).
5. **Live crafting execution (Phase D).** Roll the recipe's `craftChecks`/`craftDifficultyDC`, consume input
   inventory (specific item or material-slot match), produce the output (item / enchantment / enchant an item).
   This is where recipes, materials, disciplines, and the wallet all converge.
6. **Foundry round-trips (coordinate w/ `foundry-module`):**
   - Materials already export via the loot path (`system.type.value='material'`) — handoff
     `handoffs/foundry-module/2026-06-10-to-foundry-module-crafting-materials.md`.
   - `trivial → ''` rarity on Foundry export = **module's** job (user's call), not app-side.
   - Enchantments → Foundry enchantment activities is unspecified; design before building.

## 6. Process constraints (CRITICAL — same as every branch here)
- **`main` = production**, auto-deploys on push. **NEVER push without explicit permission;** show
  `git log origin/main..HEAD` first.
- **Remote D1:** apply ONE migration file at a time via
  `wrangler d1 execute dauligor-db --remote --config worker/wrangler.toml --file <m> -y`. **NEVER**
  `wrangler d1 migrations apply --remote` (empty tracker → replays ALL → corrupts prod). Detect success by
  **exit code**, not output grep.
- **camelCase columns** for new tables (skip the compendium.ts alias layer).
- **Never `npm install` in a worktree** (node_modules junction → dual-React breaks the dev server). Run the
  app **no-watch**.
- **Dev ports for this branch: `3011 / 8798 / 9239`** (App / Worker / Debug) — copy `dev-sysapp.mjs` →
  `dev-crafting-commerce.mjs` and set those ports. **Do NOT run `dev-sysapp.mjs`** (it defaults to 3001 =
  `settings-pages`). Two rules: run no-watch in the worktree; never blanket-kill node/workerd. See
  `handoffs/BRANCH_REGISTRY.md` § "Dev-server port allocation".
- **Copyright:** do NOT reproduce Kibbles' Compendium prose/tables verbatim — mechanics/structure only.
- **No example/seed data on prod** — local-only seeds at `docs/database/seeds/crafting-{system-pages,examples}.sql`.
- tsc baseline = **3**.
- Cross-branch file needs → shared-files protocol (handoffs/README.md); don't edit other branches' files.

## 7. References
- Memory note: `project_crafting_commerce_roadmap.md` (full shipped state).
- Prior compaction handoff: `handoffs/compendium-editors/2026-06-10-crafting-shipped-plus-shorthand-fix.md`.
- Design/draft docs: `docs/_drafts/crafting-commerce-design-2026-06-09.html`,
  `crafting-commerce-explained-2026-06-09.html`, `crafting-commerce-current-situation-2026-06-10.html`,
  `crafting-editors-implementation-guide-2026-06-10.md`, `kibbles-reconciliation-2026-06-09.html`.
- Foundry handoffs: `handoffs/foundry-module/2026-06-10-to-foundry-module-crafting-materials.md`.
- Editor patterns: `CompendiumEditorShell` (flat editors; pass `tagsSubTabs={[]}` if no tags),
  `CompendiumBrowserShell` (public browsers; `hideFavorites`/`hideFilters`), `ProficiencyEntityShell`
  (taxonomies; `columnCase='camel'`, `includeAbility`, `categoryFK`), `ActivityEditor`, `ActiveEffectEditor`,
  `SingleSelectSearch`.
