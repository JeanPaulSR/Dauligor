# Items Editor rebuild — pre-compaction pickup (WEAPON is next) — 2026-06-08

**Branch:** `compendium-editors` · **worktree:** `…/.claude/worktrees/nostalgic-lamport-76d78d`

## TL;DR
Rebuilding `src/pages/compendium/ItemsEditor.tsx` to **faithfully match Foundry
dnd5e 5.3.1 item sheets, one item type at a time**, driven by the user's Foundry
screenshots. The **Details** sub-tab early-returns a per-type component.

- **DONE:** Basics · Consumable · Container (+Contents) · Equipment (base / armor /
  vehicle) · Loot · Tool.
- **NEXT = WEAPON** — the last item type. **Wait for the user's Foundry weapon
  sheet screenshot** (they drive each type from the screenshot), then build it
  following the pattern below.
- **All post-push work is UNCOMMITTED** (9 files). tsc has stayed at the **3-error
  baseline** throughout (the 3 are pre-existing + unrelated: `CompendiumBrowserShell`
  asChild, `characterShared` arg count, `SpellList` asChild).
- The user said **STOP ASKING ABOUT COMMITS** — commit only when explicitly told;
  don't prompt. `main` = production (auto-deploys) — never push without permission.

## The per-type pattern (FOLLOW THIS for weapon)
1. **Early-return** in `MechanicsTab` (ItemsEditor): `if (itemType === 'weapon') return <WeaponDetails formData setFormData profs />;` (consumable/container/equipment/tool/loot already do this).
2. **`<XDetails>` component** built with the house controls: `<fieldset className="config-fieldset"><legend className="section-label text-gold/60 px-1">…</legend>`, `FieldRow`, `FieldSelect` (local base-ui Select wrapper), `SingleSelectSearch` (searchable, for base-item pickers), `Checkbox`, `Input`, `Label className="field-label"`. Reuse `ItemUsesField` for Usage (`showAutoDestroy={false}` for non-consumables).
3. **Properties** are data-driven from `item_properties` filtered by `valid_types` (a JSON-string array) including the type slug — e.g. `JSON.parse(p.valid_types||'[]').includes('weapon')`. Render as a stacked checkbox grid (`grid-cols-2 sm:grid-cols-3`), toggling `formData.properties` (slugs).
4. **Category-based types** (armor/tool — and weapon): the type/category dropdown is **data-driven from a `*_categories` table** (so homebrew shows), and **Base X** is the proficiency table (`weapons`/`armor`/`tools`) filtered by **`category_id`** (the row's `*_type` mirror column is STALE — use `category_id`). Load the categories table into `profs` (see the armor/tool wiring) and the base-item FK is `base_weapon_id`/`base_armor_id`/`base_tool_id` + `base_item` (the proficiency row's slug → `system.type.baseItem`).
5. **Magical = the `mgc` property** (no separate field). Save derives the legacy `items.magical` boolean from `mgc`. **Attunement** (3-state, `CONTAINER_ATTUNEMENT_OPTIONS`) is shown only when `mgc` is set.
6. **Proficiency** → `items.proficient` (`number|null`): equipment = null/0/1 (`PROFICIENCY_LEVEL_OPTIONS`); tool = null/0/1/2/0.5 (`TOOL_PROFICIENCY_OPTIONS`, REAL 0.5 survives SQLite). Weapon: TBD from the screenshot.
7. **Round-trip:** wire the new fields in `api/_lib/_itemExport.ts` (`buildTypeSpecificSystem` per-type `system.*` block + `buildItemBundle`) and `src/lib/itemImport.ts` (`buildUnifiedItemSavePayload`). **VERIFY EXPORT LIVE** by seeding a row via the worker `/query` and GETting `/api/module/items/<id>.json`.

### ⚠️ Recurring export bug to watch for
`buildTypeSpecificSystem` per-type blocks historically read the **stale mirror
column** for `system.type.value` instead of the canonical `items.type_subtype` the
editor writes. Fixed for consumable / equipment / tool / loot. **Weapon is
different** — see Weapon section.

## What's done, per type (all in ItemsEditor.tsx unless noted)
- **Basics:** identity (name/slug, source/page), rarity, quantity, weight, price, then 3 description blocks (Description / Unidentified / Chat) with an in-place full-pane MarkdownEditor (Back button). Item Type selector lives in the editor header (`headerActionsLeading`). Magical moved out of Basics (it's the `mgc` property on Details).
- **Consumable (`ConsumableDetails`):** Consumable Type (`type_subtype`) + conditional Ammunition/Poison Type (`type_inner_subtype`, from `ammunition_types`/`poison_types` admin tables) + per-subtype properties (ammo: ada/ret/sil; scroll: concentration/ritual/somatic/vocal; all: mgc) + ammo Damage (`DamagePartEditor` → `items.damage` `{base,replace}`) + Uses.
- **Container (`ContainerDetails` + `ContainerContents`):** Details = properties (mgc/weightlessContents) + conditional attunement + capacity (5.x `{count, volume{value,units}, weight{value,units}}`, units `cubicFoot/liter`, `lb/kg/tn/Mg`). Tabs restricted to **Basics/Details/Contents** (no activities/effects). Contents tab = currency grid + `ContainerContentsPanel` (the `container_contents` recipe: catalog refs + qty + custom; save-first). **Container Details + Contents are already ON MAIN** (commit `12963b5`); the contents round-trip (export `contents[]` option-C + import collapse) is uncommitted.
- **Equipment (`EquipmentDetails`):** base = Equipment Type + Proficiency Level + properties (ada/foc/mgc/stealthDisadvantage) + Magical→Attunement+Bonus (`armor_magical_bonus`) + Usage. **Armor** subtypes = a **grouped** Equipment Type dropdown (`SelectGroup`/`SelectLabel`, ungrouped `EQUIPMENT_BASE_SUBTYPES` + an "Armor" group from `armor_categories`) + **Base Equipment** (`armor` rows by `category_id`; hidden when none, e.g. natural) + Armor row (AC/Max-Dex/Strength → `armor_value`/`armor_dex`/`strength`). **Vehicle** subtype = a VEHICLE PROPERTIES fieldset (new `items.vehicle` JSON: `armor.value`/`cover`/`crew.max`/`hp`/`speed`).
- **Loot (`LootDetails`):** Loot Type (`type_subtype`) + just Magical. **Tabs restricted to Basics/Details** (matches Foundry; removed the app's old loot-Activities extension — flag if the user wants it back).
- **Tool (`ToolDetails`):** Tool Type (from `tool_categories`) + Base Tool (`tools` by `category_id`) + properties (foc/mgc) + Ability Check (Proficiency 5-level + Ability: Default + 6 stats → resolved to the `attributes` row id, our attribute identifiers are **UPPERCASE** STR/DEX/…) + Tool Bonus (`bonus`) + Attunement (when mgc) + Usage. `OTHER` tool category ≈ Foundry's blank tool type (noted in the module handoff).

## WEAPON — what it'll need (build after the screenshot)
The most complex type. Existing data + likely fields:
- **Weapon Type / Base Weapon:** weapon uses `base_weapon_id` (FK → `weapons`) + `base_item` (slug). `weapons.category_id` → `weapon_categories` (verify it exists + is populated, like armor/tool). **NUANCE:** Foundry's weapon `system.type.value` is the **weapon category** (`simpleM`/`simpleR`/`martialM`/`martialR`), NOT `type_subtype`. The current export reads `row.weapon_type` for `type.value` — decide whether to keep `weapon_type` or resolve `base_weapon_id`→`weapons` category. This is the weapon-specific round-trip call.
- **Damage:** `items.damage` via `DamagePartEditor` (already imported). Weapon damage shape differs from consumable ammo damage — branch on `item_type`.
- **Range** (`items.range` JSON), **Magical Bonus** (`magical_bonus`), **Ammunition** (`items.ammunition`), **Mastery** (2024 weapon mastery — user said **we DON'T use it / 2014 base**; captured but UI-hidden — keep it hidden).
- **Properties** (item_properties valid `weapon`: fin/hvy/lgt/lod/two/ver/thr/rch/amm/spc/sil/ada/mgc/foc/ret…), **Proficiency**, **Attunement** (when mgc), **Usage**.
- The generic `MechanicsTab` fallback + `WeaponItemFields` currently still handle weapon (no early-return yet) — replace with `WeaponDetails` like the others.

## Key files
- `src/pages/compendium/ItemsEditor.tsx` — the editor. `ItemFormData` + `ITEM_DEFAULTS`, load (`cached.*`) + save (`payload`), `MechanicsTab` (per-type early-returns), the `*Details` components, `editorSubTabs` useMemo (container/loot tab restrictions via `isContainer`/loot checks), the fetch `useEffect` + `ProficiencyBucket`/`EMPTY_BUCKET`/`setProfs` (add `weaponCategories`-style if needed — note: `weaponCategories` is ALREADY loaded for the filter axis), constants near the top (`EQUIPMENT_*`, `TOOL_*`, `PROFICIENCY_*`, `CONTAINER_ATTUNEMENT_OPTIONS`, `*_SUBTYPES`).
- `api/_lib/_itemExport.ts` — `buildTypeSpecificSystem(itemType,row)` per-type `system.*`; `buildItemBundle` (async, has `fetchers`: resolved tool ability via `fetchDocument('attributes',…)`, container `contents[]` expansion). `ItemDocBundle` type + `contents?: ItemDoc[]`.
- `src/lib/itemImport.ts` — `buildUnifiedItemSavePayload` (commonPayload + per-foundryType blocks: consumable damage, equipment magical-bonus/vehicle, container capacity/currency/container_id, proficient, type_inner_subtype), `buildItemImportCandidates` (folder → candidates; container-contents grouping via `containerContent`), `classifyItemShape` (hardcoded armor categories — the homebrew-armor import gap).
- `src/components/compendium/ItemImportWorkbench.tsx` — import commit (`handleImportVisible`): item rows + container_contents collapse.
- `src/components/compendium/ContainerContentsPanel.tsx` (new) · `ItemUsesField.tsx` (Usage) · `activity/DamagePartEditor.tsx` (damage).
- `src/lib/d1.ts` — `jsonFields` auto-parse allowlist (added `vehicle`), generic `fetchCollection`/`upsertDocument`/`deleteDocuments`/`upsertDocumentBatch`. `src/lib/d1Tables.ts` — camel→snake alias map (`containerContents` added).
- `handoffs/foundry-module/2026-06-07-items-native-conversion.md` — **the growing module round-trip contract** (sections per type: consumable / container / equipment(base/armor/vehicle) / tool, TODO checklist, migrations). Update it as weapon lands. Module replies: `2026-06-07-reply-…`, `2026-06-08-reply-container-contents.md` (their worktree `nifty-franklin-e09ca2`). My requests/replies: `2026-06-08-to-foundry-module-container-contents.md`, `2026-06-08-reply-container-contents-collapse-done.md`.

## Data-model facts (verified)
- `armor_categories` (remote): `light/medium/heavy/shield/natural/exotic`; `shields`→`shield` was reconciled on remote 2026-06-08 (local synced). `armor.category_id` → category id; `armor.armor_type` is stale.
- `tool_categories`: `art/game/music/vehicle/OTHER`. `tools.category_id` is the real link; `tools.tool_type` stale. `attributes` identifiers are **UPPERCASE** (STR/DEX/CON/INT/WIS/CHA).
- `item_properties.valid_types` = JSON-string array; `mgc` is valid for every type; ammo/scroll/container pseudo-types were added via migrations.
- `items` columns of note: `type_subtype`, `type_inner_subtype`, `damage`, `range`, `mastery`, `magical_bonus`, `ammunition`, `armor_value`/`armor_dex`/`armor_magical_bonus`/`strength`/`armor_type`, `tool_type`/`bonus`/`ability_id`, `base_weapon_id`/`base_armor_id`/`base_tool_id`/`base_item`, `proficient`, `attunement`, `capacity`/`currency`/`container_id`, `vehicle`, `chat_description`, `properties`, `uses`.

## Migrations
- **Applied LOCAL + REMOTE (2026-06-08):** `20260607-1200_items_chat_description`, `…1300_consumable_taxonomies`, `…1400_ammo_item_properties`, `…1500_scroll_item_properties`, `20260608-1200_container_contents`.
- **LOCAL ONLY — REMOTE PENDING:** `20260608-1300_items_vehicle` (the `items.vehicle` JSON column). **Must be applied to remote before any prod deploy** of the vehicle-equipment work. Apply ONE file: `npx wrangler d1 execute dauligor-db --remote --file worker/migrations/20260608-1300_items_vehicle.sql --config worker/wrangler.toml -y` (NEVER `migrations apply --remote`). Confirm with the owner first.

## Git state (IMPORTANT — read before any git op)
- HEAD = `bdfd54f` (on `main`'s history), **0 ahead / 5 behind `origin/main`** — other branches pushed 5 commits to main since the last items push.
- **9 uncommitted files** = the ENTIRE post-`bdfd54f` items session (round-trip field mappings, container-contents export+import collapse, equipment base/armor/vehicle, loot, tool, the `…1300_items_vehicle` migration, and the handoff updates/new module handoffs). The working tree survives compaction — nothing is lost.
- **Do NOT rebase/reset/checkout with these uncommitted** — you'd need to commit or stash first. To ship later: commit → `git fetch` → rebase onto `origin/main` (5 commits; expect a trivial `handoffs/foundry-module/manifest.md` union conflict like last time) → run tsc → apply the vehicle migration to remote → push (only with explicit permission).
- Already on `main` (pushed earlier this session): activity editor, basics+consumable, container Details+contents, subclass-catalog `img`, doc fixes.

## Dev stack + verification
- **Worker:** `cd worker && WRANGLER_SEND_METRICS=false npx wrangler dev --port 8787` (local D1/R2 in `worker/.wrangler/`). **App:** `npm run dev:nowatch` (tsx `server.ts`, :3000, reads `.env` `R2_WORKER_URL=http://localhost:8787`). API_SECRET (`worker/.dev.vars`): `q9nHN9H3Ny2ilWXWFlViQD5LBI63sc1KirhrwTyc`.
- **Client `.tsx` edits → hard-refresh** the browser. **Server-side edits** (`api/_lib/_itemExport.ts`, `server.ts`, `functions/`) **→ restart the app server** (kill the `:3000` listener, relaunch `npm run dev:nowatch`).
- **Local D1 query/seed:** `POST http://localhost:8787/query` with `Authorization: Bearer <API_SECRET>`, body `{sql, params}` (array for batch). Apply a local migration the same way (or `wrangler d1 execute dauligor-db --local --file … --config worker/wrangler.toml -y`).
- **Export-verify a type:** seed a row, `GET http://localhost:3000/api/module/items/<id>.json`, inspect `item.system.*`, then delete the row. (Used this all session.)
- **Remote D1 reads are safe** for checks: `wrangler d1 execute dauligor-db --remote --config worker/wrangler.toml -y --json --command "…"` (occasional transient `7403` — just retry). `served_by: v3-prod` / `Resource location: remote` confirm it's prod.
- **NEVER `npm install` in the worktree** (node_modules is junctioned to the parent).

## Process constraints (CRITICAL)
- `main` = production, auto-deploys on push. **Never push to main without explicit permission.** Show `git log origin/main..HEAD` first.
- **Don't ask about commits** (user's standing instruction). Commit only when told.
- D1 migrations: apply **local-first**; **confirm before any `--remote`**.
- Run **`/documentation-clarity` before editing existing docs.**
- UI: tokens + documented classes only (`config-fieldset`, `field-label`, `field-hint`, `section-label`, `btn-*`); square corners; gold=accent, ink=text, blood=warnings. Use our stylings, not new ones.
