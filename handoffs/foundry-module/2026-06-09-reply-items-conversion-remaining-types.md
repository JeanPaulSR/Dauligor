# Reply → `compendium-editors`: items native-conversion — remaining types (weapon/equipment/tool/loot) (2026-06-09)

Follow-up to `2026-06-07-reply-items-native-conversion.md`. Your handoff grew to
cover **equipment (base/armor/vehicle), tool, and weapon** — the module side for
all of them is done. **All 6 item types are now handled module-side.**

## The round-trip stays pass-through (no module converter needed)

Everything heavy you described is **app-side** and the module already carries it
losslessly: weapon `type.value` folding (`simple`+Melee→`simpleM` …), `base_item`
FK resolution, the vehicle `system.*` merge, tool `ability` STR→str lowercasing,
REAL `proficient` (2/0.5). The module's **export emits the full native
`sourceDocument`** (`deepClone(toObject())`) and **import deep-clones**, so
`system.type.value` / `.baseItem`, `system.damage`, `system.range`,
`system.armor.{value,dex,magicalBonus}`, `system.magicalBonus`, `system.ammunition`,
`system.mastery`, `system.ability`, `system.bonus`, and the vehicle
`cover`/`crew`/`hp`/`speed` all round-trip untouched. Confirmed your note: vehicle
equipment is "no module change — the deep-clone preserves these."

## What I changed (the workbench-preview projection only)

`export-service.js` `buildItemSummary` now reflects the full contract for every type:
- **base:** added `itemBaseItem` (`system.type.baseItem`) — the base weapon/armor/
  tool slug, shared by weapon/equipment/tool. (`itemCategory` = `type.value`,
  `itemSubcategory` = `type.subtype` already there.)
- **weapon:** damage (weapon `{base,versatile}` shape, ≠ ammo `{base,replace}`),
  range, `magicalBonus`, `ammunition {type}`, `mastery` (captured-but-unused),
  proficient.
- **equipment:** armor `{value,dex,magicalBonus}`, strength, proficient, **+ vehicle
  stats** (cover/crew/hp/speed) surfaced for the vehicle subtype.
- **tool:** ability (lowercase slug), REAL proficient (handles 2 expertise / 0.5
  half), bonus.
- **loot:** base only (no type-specific extras, per the contract).

(`sourceDocument` was already complete — this is the slim preview the import
workbench renders; your `itemImport.ts` reads `sourceDocument.system.*` for fidelity.)

Verified headless: 11 assertions across weapon / armor / vehicle / tool / loot +
`sourceDocument` fidelity.

## Not module-side
- The **armor-import classifier gap** you flagged (homebrew `exotic` armor → `items`
  shape in `itemImport.ts classifyItemShape`) is app-side — noted, not ours.
- **Full export⇄import round-trip live verification** stays deferred until your
  import collapse + the items-track remote D1 migrations land (same arrangement as
  before). Folded into the module's standing live-eyeball list. Nothing broken today.
