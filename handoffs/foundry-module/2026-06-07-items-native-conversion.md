# Items — app ↔ Foundry native-conversion contract (module branch)

**2026-06-07 · from `compendium-editors` · GROWING** — one section per item
type as each type's Details tab is finished. Nothing here round-trips **yet**.

## Purpose
The items editor is being rebuilt to Foundry dnd5e 5.3.1 fidelity, one item
type at a time. As each type's **Details** lands in the app, this doc records
the new / changed semantic fields the Foundry round-trip must carry. Two sides
are still TODO:
- **App-side semantic export/import** (this branch, `compendium-editors`):
  `src/lib/itemImport.ts` + `api/_lib/_itemExport.ts`.
- **Module-side native conversion** (the `foundry-module` branch):
  `module/dauligor-pairing/scripts/{import,export}-service.js`.

> **Status: PENDING** — the consumable + container UIs are done in-app, but
> neither the app-side nor the module-side round-trip is wired. Author both when
> we pick the items track back up (after the remaining item types are built).

---

## Consumable  *(app UI complete 2026-06-07)*

### Type + second axis
| App column | Foundry path | Values |
|---|---|---|
| `items.type_subtype` | `system.type.value` | potion · scroll · poison · ammo · wand · rod · food · trinket · wondrous |
| `items.type_inner_subtype` *(new — migration `20260607-1300`)* | `system.type.subtype` | **ammo:** arrow · crossbowBolt · firearmBullet · slingBullet · energyCell · blowgunNeedle · **poison:** contact · ingested · inhaled · injury |

The second-axis values are **admin-managed** in two new tables,
`ammunition_types` + `poison_types`, whose `identifier`s are exactly the Foundry
`CONFIG.consumableTypes.<value>.subtypes` keys above — so the conversion is a
pass-through of the identifier.

### Ammunition damage  *(consumable, type = ammo)*
- `system.damage.base` — a DamagePart `{ number, denomination, bonus, types[], custom{enabled,formula} }`.
- `system.damage.replace` — bool ("Replace Weapon Damage").
- **App:** stored in `items.damage` as `{ base: <DamagePart>, replace: <bool> }`.
  (NB: weapons also use `items.damage` but with a different shape — branch on `item_type`.)

### Properties → `system.properties` (slug array, Foundry-standard)
The app surfaces a per-subtype subset, but the stored slugs are standard:
- **ammo:** `mgc`, `ada`, `ret`, `sil`
- **scroll:** `mgc`, `concentration`, `ritual`, `somatic`, `vocal`
- **other consumables:** `mgc`
- (App filters the editor grid via `item_properties.valid_types`, extended with
  `ammo` / `scroll` pseudo-types in migrations `20260607-1400` / `-1500` — that's
  **editor-only**; the slugs themselves are vanilla dnd5e.)

### Magical
Now the **`mgc` property** (no separate field). The app keeps the legacy
`items.magical` boolean in sync by deriving it from `mgc` on save.

### Chat description
`items.chat_description` *(new — migration `20260607-1200`)* → `system.description.chat`.
The app export already emits it; standard Foundry field, no special conversion.

---

## Container  *(app UI complete 2026-06-08)*

Containers are Foundry-special: **Details + Contents tabs only** — no
activities, effects, advancement, or scaling. **Zero new DB columns / no
migration** — `capacity`, `currency`, `container_id`, `attunement`, and
`properties` already exist, and `item_properties` already carries `mgc` +
`weightlessContents` with `container` in `valid_types`.

### Properties → `system.properties` (slug array)
- `mgc` — Magical
- `weightlessContents` — Weightless Contents (contents ignore encumbrance, e.g. Bag of Holding)

(`items.magical` boolean stays derived from `mgc` on save, as for every type.)

### Attunement → `system.attunement`
3-state string, surfaced in the editor only when `mgc` is set (Foundry shows the
field for magic items): `''` (not required) · `required` · `optional`. Stored raw
in `items.attunement`.

### Capacity → `system.capacity`  *(dnd5e 5.x shape — CHANGED from 3.x)*
Stored in `items.capacity` (JSON) exactly as Foundry shapes it, so conversion is a
pass-through:
```json
{
  "count":  <int|null>,                              // max item count, null = unlimited
  "volume": { "value": <number>, "units": "cubicFoot" },
  "weight": { "value": <number>, "units": "lb" }
}
```
- volume `units` ∈ `CONFIG.DND5E.volumeUnits`: `cubicFoot` (default) · `liter`
- weight `units` ∈ `CONFIG.DND5E.weightUnits`: `lb` (default) · `kg` · `tn` · `Mg`
- ⚠️ OLD app shape was `{ type:'items'|'weight', value, units, weightlessContents }`
  (dnd5e 3.x). The new editor reads the 5.x shape and ignores the old keys
  (`weightlessContents` is now the *property*, not a capacity flag). Re-save any
  stale container row to normalize. **`export-service.js` still comments the 3.x
  shape — update it to 5.x.**

### Contents — TWO layers (template recipe vs character instances)
Foundry stores contents as independent child item documents (copies) whose
`system.container` = the container's item `_id`. We split that into two layers:

**1. Catalog/template recipe → `container_contents`** *(new — migration `20260608-1200`)*
A compendium container (e.g. Explorer's Pack) defines a *recipe* of contents —
references to catalog items + a quantity, no duplicate item rows:

| Column | Meaning |
|---|---|
| `container_id` → items.id | the container (FK, `ON DELETE CASCADE`) |
| `item_id` → items.id | catalog reference; `NULL` when custom |
| `is_custom` / `custom_data` | inline one-off (JSON snapshot) when not a catalog item |
| `quantity` | count |
| `sort_order` | display order |

The editor's **Contents tab authors these** (catalog picker + qty, plus a custom
one-off). It's references, not copies — catalog edits propagate to every pack.

**2. Character instances → `character_inventory`** (existing table)
A player's actual bag holds independent *copies* carrying instance state
(equipped, attuned, spent uses, identified, renamed). They are MATERIALIZED,
never referenced live — so removing an item from one character's bag never
touches the template or another character.

**Round-trip**
- **Export** a catalog container: expand each `container_contents` row → a child
  item document with `system.container = <container>`; reference rows copy the
  catalog item + set `quantity`; custom rows emit the `custom_data` snapshot.
- **Import** a catalog container with contents: collapse the children
  (`system.container` set) → `container_contents` rows; match against catalog by
  source identifier → reference row, else `is_custom` snapshot.
- **Import a character**: the actor's bag children become **`character_inventory`**
  instances (NOT `container_contents`); remap each child's container pointer from
  the Foundry `_id` to the new instance id, or it dangles. (`itemImport.ts` for a
  single item still stamps `items.container_id` with the raw Foundry `_id` —
  staging only; the character importer owns the remap.)

**Currency** the container itself holds → `system.currency` (5-coin grid
`{cp,sp,ep,gp,pp}`) ↔ `items.currency`. Already passed through on import.

---

## Equipment — base / armor / vehicle  *(app UI complete 2026-06-08)*

### Base equipment (every subtype)
| App | Foundry | Notes |
|---|---|---|
| `type_subtype` | `system.type.value` | clothing · ring · rod · trinket · wand · wondrous · vehicle · **+ armor categories** (below) |
| `proficient` | `system.proficient` | `null` Automatic / `0` Not Proficient / `1` Proficient |
| `properties` | `system.properties` | equipment set: `ada` · `foc` · `mgc` · `stealthDisadvantage` |
| `armor_magical_bonus` | `system.armor.magicalBonus` | the "Magical → Bonus" field (all equipment) |
| `attunement` | `system.attunement` | shown when `mgc` |

### Armor subtypes — DATA-DRIVEN from `armor_categories`
The Equipment Type "Armor" group is sourced from the **`armor_categories`** table,
not a fixed list — so homebrew categories appear. Remote currently holds:
`light` · `medium` · `heavy` · `shield` · `natural` · `exotic`.
- `type_subtype` = the category **identifier** → `system.type.value`.
- ✅ **Shield naming reconciled (2026-06-08):** the shield category identifier was
  renamed `shields` → **`shield`** on remote, matching Foundry's `system.type.value`.
  (Homebrew `exotic` / `natural` carry their own identifiers — Foundry accepts custom values.)
- **Base Equipment** = an `armor` proficiency row in that category
  (`armor.category_id` → `armor_categories.id`). Stored as `base_armor_id` (FK) +
  `base_item` (the armor row's slug) → `system.type.baseItem`. Hidden for
  categories with no base armors (e.g. `natural`).
- **AC / Max Dex / Strength** → `system.armor.value` / `system.armor.dex` /
  `system.strength` (existing columns).

### Vehicle equipment (`type_subtype = vehicle`) — mountable, pure pass-through
Stored in the new `items.vehicle` JSON; export merges it into `system.*`:
`system.armor.value` (AC) · `system.cover` (0..1) · `system.crew.max` ·
`system.hp{value,max,dt,conditions}` · `system.speed{value,units,conditions}`
(units `ft/mi/m/km`). **No module change** — the `system.*` deep-clone already
preserves these. Verified live (export emits every field).

### ⚠️ App-side import gap (follow-up, not done)
`itemImport.ts classifyItemShape` hardcodes `light/medium/heavy/shield/natural` →
the `armor` shape. Standard categories (now incl. `shield`) import fine; a homebrew
**`exotic`** armor still routes to the `items` shape and **skips the armor-stat +
base-armor capture**. Authoring + export work today; making that classifier
data-driven off `armor_categories` is the remaining round-trip piece — lands with
the items import round-trip pass.

---

## Tool  *(app UI complete 2026-06-08)*

Same data-driven pattern as armor: **Tool Type** = the `tool_categories` table
(`art` · `game` · `music` · `vehicle` · `OTHER`), **Base Tool** = a `tools`
proficiency row in that category (`tools.category_id` → `tool_categories.id`).

| App | Foundry | Notes |
|---|---|---|
| `type_subtype` | `system.type.value` | the tool category identifier |
| `base_item` (from `base_tool_id`) | `system.type.baseItem` | the base tool's slug |
| `properties` | `system.properties` | `foc` · `mgc` |
| `proficient` | `system.proficient` | `null` Auto / `0` / `1` / **`2` Expertise** / **`0.5` Half** (stored as REAL — no migration) |
| `ability_id` → attr identifier | `system.ability` | resolved to the **lowercase** slug (our attributes are uppercase `STR/DEX/…`; Foundry wants `str/dex/…`) |
| `bonus` | `system.bonus` | check-bonus formula |
| `attunement` | `system.attunement` | shown when `mgc` |

- ⚠️ **`OTHER` ≈ Foundry's blank tool type.** Foundry's `CONFIG.DND5E.toolTypes`
  is only `art` / `game` / `music`; our table adds `OTHER` (and `vehicle`). The
  `OTHER` category appears to correspond to a tool whose `system.type.value` is
  **empty**, so the round-trip should map our `OTHER` ↔ Foundry blank `''`
  (and treat `vehicle` as a custom value Foundry accepts).
- Export verified live: `type.value` ← `type_subtype`, `ability` `STR`→`str`,
  `proficient` `0.5`, `bonus`. (Fixed two export bugs: `type.value` read the stale
  `tool_type`; `ability` read a nonexistent column.)

---

## Weapon  *(app UI complete 2026-06-08)*

Same data-driven pattern as armor/tool, with one twist: **Weapon Type** = the
`weapon_categories` table (`simple` · `martial` · `exotic` · `natural` · `improv`
· `siege` + homebrew) — these are our **proficiency categories**, NOT Foundry's
melee/ranged split. **Base Weapon** = a `weapons` proficiency row in that category
(`weapons.category_id` → `weapon_categories.id`). The melee/ranged classification
rides the base weapon (`weapons.weapon_type` = `Melee`/`Ranged`).

### `system.type.value` — category + melee/ranged recombination
`type_subtype` stores **only** the proficiency category. The export folds in the
base weapon's Melee/Ranged to reconstruct Foundry's split weapon type; the import
reverses it (so `type_subtype` matches `weapon_categories`, the editor's dropdown):

| `type_subtype` + base weapon | `system.type.value` |
|---|---|
| `simple` + Melee | `simpleM` |
| `simple` + Ranged | `simpleR` |
| `martial` + Melee | `martialM` |
| `martial` + Ranged | `martialR` |
| `natural` / `improv` / `siege` / `exotic` (+ homebrew) | passed through raw |

- Export (`buildItemBundle`): resolves `base_weapon_id` → `weapons.weapon_type` to
  append `M`/`R` for simple/martial. **Baseless** simple/martial weapons (rare magic
  items with no SRD base) default to Melee (`simpleM`/`martialM`) so the value is
  always a real `CONFIG.DND5E.weaponTypes` key — never raw `simple`. natural/improv/
  siege/exotic export as the raw category.
- Import (`itemImport.ts`): `FOUNDRY_WEAPON_TYPE_TO_CATEGORY` maps `simpleM`/`simpleR`
  → `simple`, `martialM`/`martialR` → `martial` (others raw) into `type_subtype`;
  the melee/ranged half is preserved via the base-weapon FK.

| App | Foundry | Notes |
|---|---|---|
| `type_subtype` (+ base weapon M/R) | `system.type.value` | see recombination above |
| `base_item` (from `base_weapon_id`) | `system.type.baseItem` | the base weapon's slug ("battleaxe") |
| `damage` `{base:<DamagePart>}` | `system.damage` | intrinsic weapon dice; **weapon shape ≠ consumable ammo `{base,replace}`** — branch on `item_type` |
| `range` `{value,long,reach,units}` | `system.range` | editor shows normal/long for thrown/ranged, reach for melee |
| `magical_bonus` | `system.magicalBonus` | flat int, shown when `mgc` |
| `ammunition` `{type}` | `system.ammunition` | ammo subtype the weapon fires (shown when `amm`); from `ammunition_types` |
| `proficient` | `system.proficient` | `null` Auto / `0` / `1` |
| `attunement` | `system.attunement` | shown when `mgc` |
| `properties` | `system.properties` | `fin/hvy/lgt/lod/two/ver/thr/rch/amm/spc/sil/ada/mgc/foc/ret…` |
| `mastery` | `system.mastery` | **captured but never authored** — 2024 weapon mastery is unused (UI hidden); exports `''` |

- Export verified live 2026-06-08: martial+Melee → `martialM`, simple+Ranged →
  `simpleR`, baseless simple → `simpleM`; `ammunition` parses to `{type}`;
  `range`/`damage`/`magicalBonus`/`proficient` round-trip; `mastery` empty. (Fixed
  the recurring `type.value`-reads-stale-mirror bug — now reads `type_subtype`.)
- **Import verified against the real 232-weapon Foundry export** (`E:/DnD/.../Foundry
  Export/Items`, dnd5e 5.3.1): **100 % category coverage** (`simpleM`/`simpleR`/
  `martialM`/`martialR`/`improv` all map); **186/232 base weapons resolved** (the rest
  are improvised / baseless — legit), with the lone gap `net` (not in our `weapons`
  table) surfacing the standard "add to /admin/proficiencies, re-import to wire the FK"
  warning; **100 % ammo-type coverage** (`blowgunNeedle`/`arrow`/`crossbowBolt`/
  `slingBullet` all in `ammunition_types`); `magicalBonus` "+1"→int, `damage`
  `{base,versatile}` + `range` pass through; category↔base never disagree, so re-export
  reconstructs the original split-type. All items (incl. weapons) upsert into the
  unified **`items`** table (`targetTable` is only a column-selection / UI hint).
- No migration — every weapon column already existed.

---

## Loot  *(app UI complete 2026-06-08)*

Trivial: `type_subtype` (`art`/`gear`/`gem`/`junk`/`material`/`resource`/`trade`/
`treasure`) → `system.type.value`, plus the `mgc` property. No usage / attunement /
bonus. Handled by the generic export else-branch (`type.value` ← `type_subtype`) +
`itemImport.ts` common payload — no weapon/armor-style extras. Editor restricts loot
to Basics + Details (matches Foundry's loot sheet).

---

## TODO checklist

**App-side (`compendium-editors`):**
- [x] `_itemExport.ts buildItemBundle`: emit `system.type.value` ← `type_subtype`,
      `system.type.subtype` ← `type_inner_subtype`, `system.damage` ← `damage`,
      container `system.currency` ← `currency`. *(Done 2026-06-08; fixed the
      consumable-subtype-always-"potion" bug.)*
- [x] `itemImport.ts`: capture `system.type.subtype` → `type_inner_subtype`,
      `system.damage` → `damage`. (`type_subtype`, `capacity`, `currency`,
      `container_id` already captured.) *(Done 2026-06-08.)*
- [x] `_itemExport.ts`: expand a catalog container's `container_contents` rows →
      child item docs (`contents[]`, option C — reference copies + custom
      snapshots, slug-keyed). *(Done + verified live 2026-06-08.)*
- [x] `itemImport.ts`: collapse a catalog container's child docs →
      `container_contents` rows (slug-match → reference, else `is_custom`).
      *Done 2026-06-08 — folder children grouped by `system.container` ↔
      container `sourceDocument._id`, committed as recipe rows (idempotent
      replace) in the import workbench. Grouping verified by fixture; a live
      end-to-end pass through the workbench is the remaining check.*
- [x] equipment: `_itemExport.ts` emits `system.type.value`/`armor`/`strength`/
      `type.baseItem`/`proficient`/`armor.magicalBonus` + vehicle `system.*`
      (cover/crew/hp/speed); `itemImport.ts` captures `proficient` + the vehicle
      JSON + equipment magical bonus. *(Done + verified 2026-06-08.)*
- [ ] equipment armor IMPORT: make `classifyItemShape` armor routing data-driven
      off `armor_categories` so homebrew categories (e.g. `exotic`) capture armor
      stats + base armor on import. (`shields`→`shield` already reconciled on remote.)
      *(Export + editor done; this import path is the gap.)*
- [x] tool: `_itemExport.ts` emits `system.type.value` ← `type_subtype`,
      `system.ability` ← `ability_id` (lowercased), `proficient` (incl `0.5`/`2`),
      `bonus`, `type.baseItem`. *(Done + verified 2026-06-08.)*
- [ ] tool `OTHER` ↔ blank: round-trip should map our `OTHER` tool category ↔
      Foundry's blank `system.type.value` (`''`). (App import + module conversion.)
- [x] weapon: `_itemExport.ts` folds `type_subtype` (category) + the base weapon's
      Melee/Ranged → Foundry split-type (`simpleM`/`simpleR`/…), parses `ammunition`
      `{type}`, emits `damage`/`range`/`magicalBonus`/`proficient`/`type.baseItem`;
      `itemImport.ts` maps Foundry's split-type back to our category. No migration.
      *(Done + verified live 2026-06-08.)*

**Module-side (`foundry-module`):**
- [x] import/export-service: per-field consumable + container pass-through +
      container capacity 5.x. *(Done per reply `2026-06-07-reply-items-native-conversion.md`.)*
- [ ] container CONTENTS: materialize `contents[]` on import (create container +
      children, remap `system.container`) + keep children in container exports.
      Full contract: [2026-06-08-to-foundry-module-container-contents.md](2026-06-08-to-foundry-module-container-contents.md).
- [ ] armor: standard categories now match Foundry (`shield` reconciled on remote
      2026-06-08). Homebrew `exotic` carries a custom `system.type.value` — Foundry
      accepts it. Base equipment + vehicle are pure `system.*` pass-through (no change).
- [ ] weapon: pure `system.*` pass-through — the export already emits the Foundry
      split-type, `ammunition` `{type}`, and `damage`/`range`/`magicalBonus`/
      `properties`. No module change beyond standard item materialization.

## DB migrations
**Applied local + remote (2026-06-08):** `20260607-1200_items_chat_description` ·
`20260607-1300_consumable_taxonomies` · `20260607-1400_ammo_item_properties` ·
`20260607-1500_scroll_item_properties` · `20260608-1200_container_contents`
**Applied local + remote (2026-06-09):** `20260608-1300_items_vehicle` (vehicle-equipment
JSON column) · `20260609-1200_armor_identifier_foundry_align` (renamed 6 hyphenated armor
identifiers → Foundry slugs: chain-mail→chainmail, chain-shirt→chainshirt, half-plate→
halfplate, ring-mail→ringmail, scale-mail→scalemail, studded-leather→studded; + local
`armor_categories` shields→shield drift fix). **All migrations now applied to both
environments — none pending.**

## Full-export import verification (2026-06-09)
Validated import against the real Foundry export (`E:/DnD/.../Foundry Export/Items`,
1,691 items, dnd5e 5.3.1), **all six types**:
- **Weapon 232:** 100 % category map; 186/232 base resolved (rest baseless/improv; gap `net`).
- **Equipment 840:** 100 % subtypes; **armor 48/48 base resolved after the identifier
  alignment** (was 19/48 — the hyphen mismatch). Vehicle subtype → `items.vehicle` JSON.
- **Consumable 233:** 100 % subtypes; ammo/poison `type.subtype` inner values all present
  (arrow/crossbowBolt/slingBullet/blowgunNeedle, contact/ingested/inhaled/injury).
- **Tool 76:** 100 % categories; 49/76 base resolved (gap `chess`; 6 blank → the OTHER↔blank TODO).
- **Loot 280:** 100 % subtypes. **Container 30:** capacity + currency on all.
- Items with no `system.type.value` (25 consumable / 33 loot) import as `null` (generic) — correct.
- All types upsert into the unified **`items`** table (`upsertItemBatch`).

The consumable + container editor UIs are **live on prod** as of 2026-06-08
(`main` @ `87fac50`); remote D1 carries all five migrations. The round-trip code
(checklist above) is the remaining work — app-side and module-side.

---

## Type coverage
**All item types documented:** consumable · container (+contents) · equipment
(base / armor / vehicle) · tool · **weapon** · loot. Weapon was the last Details
tab — the per-type editor rebuild is feature-complete. Remaining work is the
open round-trip checklist items above (app-side armor IMPORT data-driven routing,
tool `OTHER`↔blank; module-side container contents materialization + the standard
per-type pass-through).
