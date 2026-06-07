# Items Editor — Foundry-fidelity pass (resume)

**2026-06-07 · branch `compendium-editors` · worktree `nostalgic-lamport-76d78d`**

## TL;DR

The **Activity Editor** rebuild is **DONE** — all 11 kinds match dnd5e 5.3.1. The next job is a
**Foundry-fidelity pass on the Items editor** (`src/pages/compendium/ItemsEditor.tsx`): close ~11
concrete gaps so each item type's sub-form matches Foundry's `details-*.hbs` item sheets. A full audit
is already written (see below) — start there.

## ⚠️ Working-tree state — READ FIRST

`origin/main == HEAD` (0 local commits). **The entire continued session is uncommitted** in the working
tree (14 items). It persists across a `/compact`, but **strongly recommend committing it locally first**
so the items work lands as a clean diff. **`main` = production — commit locally, do NOT push** without
explicit go-ahead.

- **Modified:** `src/components/compendium/ActivityEditor.tsx` · `activity/ActivationDurationEditor.tsx`
  · `activity/RangeTargetingEditor.tsx` · `activity/constants.ts` · `activity/primitives.tsx`
  · `handoffs/foundry-module/manifest.md`
- **New (untracked):** `activity/HealingEditor.tsx` · `activity/MultiSelect.tsx` · `activity/SummonEditor.tsx`
  · `activity/TransformEditor.tsx` · `docs/_drafts/items-system-deep-dive-2026-06-07.html`
  · `docs/_drafts/items-editor-foundry-audit-2026-06-07.html`
  · `handoffs/compendium-editors/2026-06-05-activity-editor-foundry-fidelity.md`
  · `handoffs/foundry-module/2026-06-05-from-compendium-editors-activity-native-conversion.md`
  · (this file)
- **tsc baseline = 3 errors**, all pre-existing/unrelated (`CompendiumBrowserShell` + `SpellList`
  `asChild` typing + `characterShared` arg-count). Keep the total at 3; none in item/activity files.
  `noUnusedLocals` is OFF.

## The two audit docs (start here)

- **`docs/_drafts/items-system-deep-dive-2026-06-07.html`** — architecture / state-of-play. Headline:
  items is a **mature, fully round-tripping system** (unified table, base-item FKs, import *and* export).
  Not a build — a polish pass.
- **`docs/_drafts/items-editor-foundry-audit-2026-06-07.html`** — **the actionable discrepancy list**
  (the activity-audit treatment). Both Foundry + our sides read directly. This is the work list.

## The fixes — suggested order (from the audit)

1. **Option-list gaps** `quick wins` — in `ItemsEditor.tsx` constants (L60–154):
   - **Rarity** stores `'none'`; Foundry uses empty (`itemRarity` has no "none"). Store `''`, label "None".
   - **Weight units** add `tn` (Tons) + `Mg` (Tonnes).
   - **Consumable subtypes** add `wondrous`; **Equipment subtypes** add `natural` (armor-bearing).
   - **Weapon Mastery** — new dropdown, 8 opts: cleave/graze/nick/push/sap/slow/topple/vex
     (`CONFIG.weaponMasteries`). Column exists + round-trips; just unsurfaced.
2. **Per-type property filtering** `clean` — `PropertiesSection` (L1851) reads `profs.weaponProperties`
   for *every* type. Foundry filters to `validProperties[type]` (weapon 17 / equipment 4 / consumable 1 /
   container mgc+weightlessContents). **Drop-in reuse:** the `item_properties` table (added for Enchant)
   already has a `valid_types` JSON column — source the catalog from it filtered by `item_type`.
3. **Weapon sub-form** `biggest` — `WeaponItemFields` (L1930): add **Mastery** (from #1), **Versatile
   damage** fieldset (when `ver` property), **Ammunition Type** select (when `amm`). Single damage-type is
   a defensible simplification; for full parity reuse **`DamagePartEditor`** (`activity/`).
4. **Consumable sub-type + ammo damage** — `ConsumableItemFields` (~L2121): add the **2-axis sub-type**
   dropdown (poison contact/inhaled/…; ammo arrow/bolt/…) + the ammo Damage fieldset. **Needs a
   persistence decision** (new `items.type_inner_subtype` column vs packed slug `"poison:contact"`).
   This closes the documented import gap at `itemImport.ts:479`.
5. **Container capacity model** — `ContainerItemFields` (~L2196): ours is an either/or toggle; Foundry has
   count + volume + weight as three fields. Lowest priority.

**Already correct (no change):** item types, loot/tool subtypes, attunement, currencies, armor & tool
blocks, weight/price shapes, base-item resolution, the Activities/Effects/Advancement/Scaling/Tags tabs.

## Items architecture (navigation)

- **Unified `items` table** (alias `items` in `d1Tables.ts`) absorbs all 6 Foundry types; legacy
  `weapons`/`armor`/`tools` are now proficiency-category definitions (AdminProficiencies). Items link via
  `base_weapon_id`/`base_armor_id`/`base_tool_id` FKs, resolved from Foundry `system.type.baseItem` slug.
- **Editor:** `ItemsEditor.tsx` (~2.3k lines), proposal-aware, 7 sub-tabs (Basics · Mechanics · Activities
  · Advancement · Scaling · Effects · Tags). Option-list constants L60–154; sub-forms L1851–2273;
  `ItemFormData` L170–249; load/save L487–965.
- **Round-trips BOTH ways:** import `src/lib/itemImport.ts` (+ `ItemImportWorkbench.tsx`) → unified table;
  export `api/_lib/_itemExport.ts` `buildItemBundle` → live `/api/module/items/<dbId>.json` (kind
  `dauligor.item-item.v1`). **Any new persisted field (e.g. consumable sub-type) must be wired in BOTH**
  import + export, plus a migration, plus a note to the foundry-module branch.
- 6 item migrations: `0004_items` → `20260524-1800` → `20260525-1800` → `20260526-1700` → `20260527-1200`.

## Foundry ground truth (how the audit was built)

- **Item sheets:** `C:\Users\Jean\AppData\Local\FoundryVTT\Data\systems\dnd5e\templates\items\details\details-*.hbs`
  (weapon/equipment/consumable/tool/container/loot) + `header.hbs`/`details.hbs`. Lang in `lang/en.json`.
- **CONFIG lists:** there are **no rich item example exports** (`E:\DnD\Professional\Foundry-JSON\items\`
  has only one feat). Extract `CONFIG.DND5E` from the **activity JSON dumps** instead — every
  `E:\DnD\Professional\Foundry-JSON\windows\activity-*.json` embeds the full config at
  `["context"]["CONFIG"]`. Useful keys: `itemRarity`, `weaponMasteries`, `weaponTypes`, `consumableTypes`,
  `equipmentTypes`, `lootTypes`, `toolTypes`, `weightUnits`, `currencies`, `validProperties[type]`,
  `itemProperties`.

## Process rules (unchanged)

- **D1:** apply schema changes **local-first**, then **stop and ask "ok to apply to remote?"** before any
  `--remote` (AGENTS.md #7 — no carry-over between migrations). Relevant if #4 adds a column.
- **`main` = production** (auto-deploys) — always get explicit permission before pushing.
- **Dev stack (this branch = default):** app `npx tsx server.ts` (no-watch, :3000, reads `.env`); worker
  from `worker/` `WRANGLER_SEND_METRICS=false npx wrangler dev --port 8787 --inspector-port 9229`. Client
  `.tsx` → **hard-refresh**; server-side (`api/_lib`, `functions/`) → **restart**. NEVER `npm install` in
  the worktree (node_modules is junctioned to the parent).

## Context — what just shipped (activities)

All 11 activity kinds matched Foundry, plus: the **override capability** (Cast/Forward inherit
activation/duration/range/target from the linked source unless overridden — `_setOverride` parity), the
full **Summon** (Profiles | Changes sub-tabs, Summon Prompt on Identity, creature searcher) and
**Transform** (Profiles | Settings sub-tabs, full Keep/Merge/Effects/Other settings panel with the
`disables` lock logic). **Two parked items** (pending the monster compendium): the Summon/Transform
profile **creature searchers** (empty now, wired via the `creatureOptions` prop), and Transform's
**Retained Spell Lists** uses our `spell_rules` (app-handled — see the module handoff). The
foundry-module contract handoff is
`handoffs/foundry-module/2026-06-05-from-compendium-editors-activity-native-conversion.md` (Cast
`spell.uuid` = our identifier slug; the four `override` flags; transform settings; the standing
"verify the full round-trip once all kinds are done" reminder).
