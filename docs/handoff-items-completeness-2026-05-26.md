# Handoff — Items completeness + proficiency split (2026-05-26)

> **Status:** 5 of 8 commits landed on `main`. Remote D1 migration NOT applied yet
> (will batch with the C7 facilities migration when it lands). Context budget for the
> work session ran out before C6/C7/C8 — this doc picks up where the live agent left off.
>
> **Read first:**
> - `docs/handoff-compendium-shell-2026-05-25.md` — preceding session's context
> - `module/dauligor-pairing/docs/import-contract-index.md` — module contract index
> - This file's "Decisions locked" section before starting any C4-UI / C6 / C7 work

---

## Commits landed on `main`

| Commit | Title | Files | Status |
|---|---|---|---|
| `cd3257a` | feat(items): completeness columns + proficiency source/melee-ranged filter + Foundry slug alignment | migration + itemImport.ts | ✅ |
| `a626395` | feat(proficiency): polymorphic item-proficiency resolver + melee/ranged data shape | new `proficiencyResolver.ts` + classExport.ts + ClassEditor.tsx | ✅ |
| `b821f99` | feat(class-editor): melee/ranged 3-button category grants in Proficiencies + Multiclass | ClassEditor.tsx | ✅ |
| `96e47cd` | feat(class-export): trait advancement carries melee/ranged-restricted category arrays | classExport.ts (export-side only — UI deferred) | ✅ |
| `8fc884a` | feat(compendium): ItemUsesField — drop-in editor for items.uses block | new `ItemUsesField.tsx` | ✅ |

The 5 commits hold all the **data-model + library + proficiency-UI** infrastructure. The
remaining 3 commits are **UI + new pages + docs**, summarized below.

---

## Decisions locked this session

These were settled by the user 2026-05-26. Honor them in remaining work.

1. **Split UI**: 3 checkboxes per weapon category (`All` / `Melee only` / `Ranged only`)
   with mutually-aware behavior. Already shipped for the Class Proficiencies +
   Multiclass Proficiencies tabs (commit `b821f99`); the same pattern needs to land in
   the trait-advancement weapon picker (C4-UI, below).

2. **Existing class proficiency UI preserved.** Per-weapon checkboxes, category-header
   "All Selected" toggles, and display-name override fields all stay. The melee/ranged
   work is purely additive.

3. **`character_proficiencies` schema** got 3 new columns (commit `cd3257a`):
   - `weapon_type_filter` TEXT — NULL | 'Melee' | 'Ranged'. Only meaningful when
     `entity_type='weapon_category'`. Restricts the grant.
   - `source_entity_type` + `source_entity_id` — polymorphic "who granted this".
     Class re-import will do `DELETE WHERE source_entity_type='class' AND source_entity_id=?`
     before re-applying.

4. **`weapon_properties.identifier` standardized to Foundry codes** (commit `cd3257a`):
   `fin` / `hvy` / `lgt` / `lod` / `two` / `ver` / `thr` / `rch` / `amm` / `spc` / `sil`.
   The 4 app-custom slugs (`lance` / `net` / `range` / `improvised-weapons`) stay as
   Dauligor extensions and need module-side property-mapping contract documentation
   in C8.

5. **Weapon mastery is 2024-only** — we're 2014-rules base. `items.mastery` column
   still exists for round-trip but the items editor doesn't surface a mastery dropdown.

6. **App → Foundry direction**: custom properties (like Zweihänder's `superHeavy`) DO
   ship to Foundry; the module is responsible for interpreting them. Foundry → App
   direction does NOT invent reverse mappings for unknown codes — unknown slugs pass
   through verbatim.

7. **Vehicles**: separate table, deferred. Not built this session. When built, lives
   at `/compendium/vehicles` (new page), not in items.

8. **Facilities**: separate table, in scope (C7). `/compendium/facilities`.

9. **Trait advancement slug convention**: Foundry-exact (`weapon:simpleM` /
   `weapon:simpleR` / `weapon:martialM` / `weapon:martialR`). The "All" grant expands
   at module-bridge time to both M and R variants — dnd5e has no `weapon:simple`
   standalone.

---

## Pending work — concrete next steps

### C4-UI — Trait advancement weapon picker melee/ranged pills

**File:** `src/components/compendium/AdvancementManager.tsx`
**Where:** Lines ~2527-2597 (the `Object.entries(groupedTraitEntries)` loop that renders
the category headers with Fixed/Options/Replace columns).

**What to add:** When `traitType === 'weapons'`, render a small 3-pill row under each
category header (or in the header itself) for All/Melee/Ranged restriction. The 3 pills
toggle entries in:
- `editingAdv.configuration.categoryIds`
- `editingAdv.configuration.categoryMeleeIds` (currently undefined — initialize)
- `editingAdv.configuration.categoryRangedIds`

**Helper to add:** A new `toggleTraitCategoryRestriction(category, restriction: 'all' |
'melee' | 'ranged')` function next to the existing `toggleTraitCategory`. Mutually-aware
behavior — copy the logic from `toggleCategoryWeaponRestriction` in `ClassEditor.tsx`
(commit `b821f99`).

**Export side**: Already done (commit `96e47cd`). When the UI starts populating these
arrays, the export normalizer will fan them out into Foundry trait keys automatically.

**Module side**: `module/dauligor-pairing/scripts/class-import-service.js` →
`applyActorTraitAdvancements`. When it sees `configuration.categoryMeleeIds: ['simple']`
on a weapons trait, write the Foundry trait grant as `weapon:simpleM` (or the right
foundry-alias key). When it sees `categoryIds: ['simple']`, write BOTH `weapon:simpleM`
AND `weapon:simpleR`. Existing handler should be ~50 LOC change.

---

### C6 — Dynamic ItemsEditor body (HEADLINE FEATURE — largest remaining work)

**File:** `src/pages/compendium/ItemsEditor.tsx` (current manual editor is at
`ItemManualEditor`, lines 107-289). Refactor into a type-dispatching shell.

**Plan:**

```tsx
<ItemTypeDropdown value={itemType} onChange={...} />
{itemType !== 'loot' && <TypeSubtypeDropdown parentType={itemType} ... />}
<CommonItemFields ... />          // name/identifier/image/description/source/page
<PhysicalFields ... />            // weight/price/rarity/quantity
{itemType !== 'loot' && <EquippableFields ... />}  // attunement (3-state) + equipped + identified
{shape !== 'loot' && shape !== 'container' && <ItemUsesField uses={formData.uses} ... />}
{itemType === 'weapon' && <WeaponItemFields ... />}
{itemType === 'equipment' && <EquipmentItemFields type={typeSubtype} ... />}  // armor block when armor subtype
{itemType === 'consumable' && <ConsumableItemFields type={typeSubtype} ... />}  // damage when applicable
{itemType === 'tool' && <ToolItemFields ... />}                                  // ability + chatFlavor
{itemType === 'container' && <ContainerItemFields ... />}                        // capacity + currency
{itemType === 'loot' && <LootItemFields type={typeSubtype} ... />}                // subtype only
```

**New component files to create** (all in `src/components/compendium/`):

| File | Approx LOC | Purpose |
|---|---|---|
| `WeaponItemFields.tsx` | ~120 | damage editor (number/denomination/types/bonus), range (value/long/reach/units), base weapon dropdown sourced from `weapons` proficiency table (provides `base_weapon_id` FK), magicalBonus, ammunition dropdown, properties multiselect from `weapon_properties` |
| `EquipmentItemFields.tsx` | ~160 | type.value dropdown (light/medium/heavy/shield/clothing/ring/rod/trinket/wand/wondrous). When value is light/medium/heavy/shield, show armor.value + armor.dex + magicalBonus + strength + stealthDisadvantage-property toggle. Base armor dropdown from `armor` proficiency table. |
| `ConsumableItemFields.tsx` | ~140 | type.value dropdown (potion/scroll/poison/ammo/wand/rod/food/trinket/wondrous). Subtype dropdown when applicable (poison subtype, ammo subtype). Damage editor (acid vial, etc.). magicalBonus. |
| `ToolItemFields.tsx` | ~80 | type.value dropdown (art/game/music), base tool dropdown from `tools` proficiency table, ability dropdown (str/dex/con/int/wis/cha), chat_flavor input, bonus formula input. |
| `ContainerItemFields.tsx` | ~120 | Capacity shape: toggle between count-based and weight-based; nested {value, units} sub-input. Currency 5-coin grid. weightlessContents property toggle. |
| `LootItemFields.tsx` | ~60 | Only the type.value dropdown (art/gear/gem/junk/material/resource/trade/treasure) + subtype when applicable. No attunement/equipped (suppress in EquippableFields render). |

**Shared sub-components to extract (optional):**
- `<CategoryDropdown table="weapons|armor|tools" value={baseId} onChange ... />` — fetches the proficiency table on mount and offers as a `SingleSelectSearch`. Used in Weapon/Equipment/Tool fields.
- `<PropertiesMultiselect tableSlug="weapon_properties|item_properties" value={slugs[]} onChange ... />` — for the items.properties array. Foundry-aligned slug vocabulary (commit `cd3257a` rename).

**Proficiency badge wiring:** Once the item is saved, lookup the current character's
`character_proficiencies` (via existing app-side hook) and call
`resolveItemProficiency(item, profs)` from `src/lib/proficiencyResolver.ts` (committed
`a626395`). Show a small `[Proficient]` chip + the proficiency level + the `source`
tooltip. This is most useful on the public ItemList page; on the editor it's
informational only.

**State change**: Today's `formData` defaults at lines 118-138 don't include `uses`,
`container_id`, `currency`, `capacity`, `chat_flavor`, `ability_id`, `type_subtype`,
`unidentified_description`. Add them. Attunement is now a 3-state string (`'' /
'required' / 'optional'`) — replace the checkbox with a dropdown.

---

### C7 — Facilities (Bastions) — separate table + page

**Migration:** `worker/migrations/20260526-XXXX_facilities.sql`

```sql
CREATE TABLE facilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    -- Foundry's system.type.value: 'basic' | 'special'
    facility_type TEXT NOT NULL DEFAULT 'basic',
    -- Foundry's system.type.subtype — see CONFIG.DND5E.facilityTypes
    -- {basic: bedroom/diningRoom/parlor/courtyard/kitchen/storage,
    --  special: arcaneStudy/armory/garden/library/.../warRoom (~30)}
    facility_subtype TEXT,
    -- Size: 'cramped' | 'roomy' | 'vast' — affects price, sq, upkeep
    size TEXT NOT NULL DEFAULT 'cramped',
    level INTEGER NOT NULL DEFAULT 5,
    built INTEGER NOT NULL DEFAULT 0,    -- bool: physically constructed?
    free INTEGER NOT NULL DEFAULT 0,     -- bool: granted free vs paid
    disabled INTEGER NOT NULL DEFAULT 0, -- bool: forces order='repair'
    -- Order drives sub-block visibility:
    -- build|change|craft|empower|enlarge|harvest|maintain|recruit|repair|research|trade
    facility_order TEXT,
    -- Progress JSON: {value, max, order, pct}
    progress TEXT,
    -- Trade JSON: {creatures, pending, stock, profit} — only when order='trade'
    trade TEXT,
    -- Craft JSON: {item, quantity} — only when order='craft'
    craft TEXT,
    -- Roster JSON: {value: [actor-uuid], max}
    defenders TEXT,
    hirelings TEXT,
    -- Standard catalog fields
    description TEXT,
    image_url TEXT,
    source_id TEXT REFERENCES sources(id),
    page TEXT,
    tags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_facilities_type ON facilities(facility_type);
CREATE INDEX idx_facilities_subtype ON facilities(facility_subtype);
CREATE INDEX idx_facilities_source ON facilities(source_id);
```

**Editor page**: `src/pages/compendium/FacilitiesEditor.tsx` — uses
`DevelopmentCompendiumManager` as base (same pattern as ItemsEditor). The order
dropdown drives conditional visibility:
- `order === 'trade'` → show Trade JSON sub-form (creatures/stock/profit)
- `order === 'craft'` → show Craft JSON sub-form (item/quantity)
- All other orders → minimal additional fields

**List page**: `src/pages/compendium/FacilitiesList.tsx` — use
`CompendiumBrowserShell`. Filter axes: facility_type (basic/special), size, has order,
source. ~150 LOC.

**Routes**: Add `/compendium/facilities` (list) + `/compendium/facilities/manage`
(editor) to `App.tsx`. Add nav entry in `Sidebar.tsx`.

**Importer**: Extend `src/lib/itemImport.ts` `classifyItemShape` to route `foundryType
=== 'facility'` to a new `'facilities'` shape that writes to the facilities table. The
ItemImportWorkbench already supports per-shape routing — add the facilities branch.

**Foundry export contract**: The module already supports a generic items folder export
(`module/dauligor-pairing/scripts/export-service.js`). Verify it includes facility
items; if not, add a `facilityFolderExport` parallel to the items one. Probably out of
scope this commit; add as a follow-up.

---

### C8 — Documentation pass

Write/update these:

| File | Status | Notes |
|---|---|---|
| `docs/features/compendium-items.md` | **NEW** | Full guide: item types, dynamic field map, type.value drives subtype dropdowns, proficiency-resolution flow, custom-property contract |
| `docs/features/compendium-facilities.md` | **NEW** | Bastions page guide; order-driven sub-blocks |
| `docs/architecture/proficiency-resolution.md` | **NEW** | The polymorphic FK chain. Explain entity_type values + weapon_type_filter + source_entity_*. Reference `src/lib/proficiencyResolver.ts` as canonical impl |
| `docs/database/structure/items.md` | **UPDATE** | New columns added in 20260526-1700: uses, container_id, currency, capacity, chat_flavor, ability_id, type_subtype, unidentified_description. attunement is now TEXT 3-state. stealth dropped. |
| `docs/database/structure/character_proficiencies.md` | **UPDATE** or **NEW** | Document the 3 new columns. Cover the polymorphic source pattern. |
| `docs/database/structure/proficiencies_weapons.md` | **UPDATE** | Note the 11 standard 5e slugs renamed to Foundry codes. The `name` column stays human-readable. The 4 app-custom properties listed with explanation. |
| `module/dauligor-pairing/docs/property-mapping.md` | **NEW** | The app/foundry property slug contract. Standard ones are 1:1 (no translation). 4 app-custom listed. Module is responsible for interpreting custom properties (Zweihänder's superHeavy etc.) when round-tripping. |
| `docs/architecture/foundry-integration.md` | **UPDATE** | Link to property-mapping doc |
| `module/dauligor-pairing/docs/class-import-contract.md` | **UPDATE** | Note the new `categoryMeleeIds` / `categoryRangedIds` arrays on weapon proficiency blocks + trait advancements. Document the fan-out to Foundry trait keys. |

Update `docs/architecture/proposal-editor-pattern.md` if any of the new fields end up
proposal-mode-aware.

---

## Remote D1 migration — apply at end

The 20260526-1700 migration was applied LOCAL only. When C7 ships its facilities
migration too, apply BOTH in order:

```
cd worker
npx wrangler d1 execute dauligor-db --remote --file=migrations/20260526-1700_items_completeness_and_proficiency_source.sql
npx wrangler d1 execute dauligor-db --remote --file=migrations/20260526-XXXX_facilities.sql
```

Both are schema-only — zero data risk. Items table is empty in production (verified
2026-05-26). character_proficiencies new columns are nullable. weapon_properties rename
is on 11 standard rows; no FK references depend on the slug values.

After applying, verify:
```
npx wrangler d1 execute dauligor-db --remote --command "SELECT identifier FROM weapon_properties WHERE identifier IN ('fin','hvy','lgt','lod','two','ver','thr','rch','amm','spc','sil')"
```

Should return 11 rows.

---

## Project conventions to honor (carried from prior handoff)

- **No backwards compatibility during migrations** — when shape changes, update sources to fit.
- **Survey first, no DB touches** — verify code against doc claims before refactoring.
- **D1 upsert idiom** — never `INSERT OR REPLACE`; always `ON CONFLICT(id) DO UPDATE`.
- **Foundry module junction** — `%LOCALAPPDATA%\FoundryVTT\Data\modules\dauligor-pairing`
  is an NTFS junction → repo `module/dauligor-pairing`. Edits land instantly in Foundry
  (after Ctrl+F5).
- **No remote D1 writes without per-migration permission**.
- **No push to `origin/main` without explicit green-light**.
- **Public compendium pages use `CompendiumBrowserShell`** — UI conventions change once.
- **`weapons` / `armor` / `tools` = proficiency definitions only** — game items go in
  `items` with FK references.

---

## What to read for a fresh agent

1. **This handoff** — you're here
2. `docs/handoff-compendium-shell-2026-05-25.md` — preceding session
3. `src/lib/proficiencyResolver.ts` — the new read-side library; the file header
   explains the polymorphic walker
4. `src/components/compendium/ItemUsesField.tsx` — uses-block editor; drop-in for C6
5. `src/components/compendium/ConsumptionTabEditor.tsx` — the original USES+RECOVERY pattern (ItemUsesField is a subset)
6. `src/pages/compendium/ClassEditor.tsx` lines ~1410-1485 — the
   `toggleCategoryWeaponRestriction` helper; copy this pattern for C4-UI
7. `worker/migrations/20260526-1700_items_completeness_and_proficiency_source.sql` —
   the schema baseline for everything else in this work
8. `AGENTS.md` + `DIRECTORY_MAP.md` — top-level guardrails
