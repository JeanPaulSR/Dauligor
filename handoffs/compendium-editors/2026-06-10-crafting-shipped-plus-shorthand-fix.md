# compendium-editors — crafting & commerce SHIPPED + class-export shorthand fix SHIPPED — compaction pickup (2026-06-10)

**Branch:** `compendium-editors` · **worktree:** `…/.claude/worktrees/nostalgic-lamport-76d78d`
**`compendium-editors == origin/main == f78b5bb`, clean tree, nothing unpushed.** tsc baseline = **3**.

## TL;DR — two things shipped to prod this session, both verified
1. **Crafting & Commerce — SHIPPED `73ebf2a`** (Phase A catalogs + magic-items tab + basic shop). 7 new
   migrations applied to **remote D1 + verified**.
2. **Class-export shorthand fix — SHIPPED `f78b5bb`** (per foundry-module handoff `f20e6e3`): `@<col>`
   class-shorthand now expands in effect/activity FORMULAS at export. Code-only, no migration.

Nothing is in-flight. The next handoff (`foundry-module/f20e6e3`) is **DONE + replied**. This is a clean
stopping point.

## 1. Crafting & Commerce (SHIPPED `73ebf2a`)
LIVE on main + prod D1:
- **Crafting Materials** — `crafting_materials` table, each backed by a `loot`/`type_subtype='material'`
  `items` row minted on save (carryable + valid recipe input). Editor `/compendium/materials/manage`;
  public `/compendium/materials`. Hidden from the gear Items browser.
- **Enchantments** — own table. Editor `/compendium/enchantments/manage` (Restrictions → categories/
  properties + allowMagical; **Activities** via `ActivityEditor`; **Effects** via `ActiveEffectEditor`;
  magicalBonus/rarity/attunement/price). Public `/compendium/enchantments`. New `activities` column.
- **Recipes** — universal inputs→output (item/enchantment/enchant-item). Inputs = specific item **OR**
  material slot (category+subtype+rarity). `/compendium/recipes/manage` + public `/compendium/recipes`.
- **Disciplines** — `crafting_disciplines` (13 seeded, camelCase); now carry `tool_id` (→tools) +
  `ability_id` (→attributes) via `ProficiencyEntityShell` (`includeAbility` + `categoryFK`). Edited at
  `/admin/proficiencies` → Crafting Disciplines. **Facility deliberately not stored** (DM/module call).
- **Magic Items tab** — `/compendium/magic-items` = `ItemList` w/ `magicalOnly`; general Items browser
  **excludes** magical rows.
- **Basic Shop** — `shops` table; pool = `shopItems` JSON `[{itemId, priceOverride?}]` (items not in any
  shop by default). Editor `/compendium/shops/manage` + public `/compendium/shops`. **Prices only — no
  buy/sell** (needs `characters.currency` wallet).
- **Crafting sidebar section** (Overview/Materials/Recipes/Enchantments/Shops) → header → `/system/crafting`
  **system page** (blank shells, DM authors; old wiki "Crafting" lore link renamed "Technology").

**Remote D1:** 7 migrations applied one-file-at-a-time + verified (enchantments-1300 / disciplines-1350 /
recipes-1400 / materials-1500 / enchantments-activities-`20260610-1200` / disciplines-tool-ability-
`20260610-1300` / shops-`20260610-1400`). Existing data intact (1669 items); **no example data on prod**
(shops=0). Local D1 keeps example/test data + the `/system/crafting` blank shells (LOCAL only — seeds at
`docs/database/seeds/crafting-{system-pages,examples}.sql`, NOT applied to remote).

## 2. Class-export shorthand fix (SHIPPED `f78b5bb`)
**Bug (foundry-module diag):** the in-class column shorthand (`@rite-die` → `@scale.<class>.rite-die`) was
only expanded in the reference help panel, not in effect change values / activity formulas → shipped to
Foundry verbatim → resolved to **0**.
**Fix:** at the `automation:{activities,effects}` choke point, run
`normalizeSemanticReferenceText(value,'formula',{classIdentifier,classColumns})` over effect
`changes[].value` + activity formula keys (`formula`/`bonus`/`max` — damage custom/bonus/scaling, save &
check `dc.formula`, `uses.max`, roll, attack, healing). Applied to **both drift-paired files**:
`src/lib/classExport.ts` + `api/_lib/_classExport.ts` (helpers `expandActivityFormulas` +
`expandEffectChanges`, built after `scalingColumns`). DB keeps author shorthand; expansion is export-only.
Only rewrites THIS class's known columns; idempotent on already-`@scale`.
**Verified:** 10/10 headless (incl. the exact `@rite-die[acid]` repro), tsc 3/0. Reply:
`handoffs/foundry-module/2026-06-10-reply-shorthand-in-effects-activities.md`.
**Empirically confirmed on prod data:** the real **Dark Augmentation** effect (on `alternate-blood-hunter`,
feature `5648bdd8`: `system.abilities.{str,dex,con}.bonuses.save = @rite-die`) WILL expand correctly —
`rite-die` is a registered scaling column of that class. ⚠ NOTE: the duplicate **`blood-hunter`** class has
**no rite-die column** (its Dark Augmentation `1311f005` has no effect, so no break today) — but any future
`@rite-die` effect added to a `blood-hunter` feature would NOT expand (data gap, not a fix limitation).

## Git / refs
- `compendium-editors == origin/main == f78b5bb`. Clean tree. **This handoff is uncommitted on disk** —
  commit + push with permission if wanted (docs-only).
- Backup branch `backup/pre-rebase-2026-06-10` @ `9d19768` (pre-crafting-rebase safety) — **safe to delete**.

## Open / deferred (none in-flight; pick up only if asked)
- **`/system/crafting` + discipline pages content on PROD** — blank shells are LOCAL only; will 404 on prod
  until created (System Pages admin) or I seed the shells to remote. **Prose is the DM's to author — do NOT
  transcribe Kibbles verbatim (copyright); structure only.**
- **Economy tab** (item buy/sell prices) — user **skipped**; shop reads `items.price`.
- **Shop buy/sell transactions** — needs a `characters.currency` JSON wallet (matches Foundry
  `system.currency`). Shop model already has a NULL `campaignId` for future per-campaign scoping.
- **Live crafting execution** (roll checks, consume inventory) — Phase D.
- **`trivial → ''` rarity on Foundry export** — handled by the **module** (user's call), not app-side.
- **Import round-trip** of `@scale.<thisClass>.<col>` → `@<col>` (foundry-module secondary item) — not done;
  full form re-exports identically, harmless.
- **Dev stack restart** recommended locally (code was rebased; local D1 untouched, has example data).

## Process (CRITICAL)
- `main` = prod, auto-deploys on push. **NEVER push without explicit permission;** show
  `git log origin/main..HEAD` first.
- Remote D1 migrations: **one file at a time** via `d1 execute --remote --file <m> --config worker/wrangler.toml -y`;
  **NEVER `migrations apply --remote`** (corrupts prod). Use **exit code** for success, not output grep.
- **Drift-paired files (update BOTH):** `src/lib/classExport.ts` ↔ `api/_lib/_classExport.ts`;
  `src/lib/referenceSyntax.ts` ↔ `api/_lib/_referenceSyntax.ts`.
- Dev ports: this worktree = **3000/8787** (`npm run dev:nowatch` + manual `wrangler dev --port 8787`).
  **Never run `dev-sysapp.mjs`** (collides on 3001 = settings-pages). Port table:
  `handoffs/BRANCH_REGISTRY.md` → "Dev-server port allocation".
- New tables camelCase (skip compendium.ts alias). tsc baseline = 3. Never `npm install` in a worktree
  (node_modules junction). Cross-branch = handoff, don't edit other branches' files.
