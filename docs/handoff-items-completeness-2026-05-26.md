# Handoff — Items completeness + proficiency split (2026-05-26)

> **Status:** 9 of 9 commits landed on `main`. Remote D1 migration NOT applied yet
> (two migrations now batch-pending: 20260526-1700 + 20260526-2000). C7 facilities
> shipped; only C8 docs pass remains.
>
> **Read first:**
> - `docs/handoff-compendium-shell-2026-05-25.md` — preceding session's context
> - `module/dauligor-pairing/docs/import-contract-index.md` — module contract index
> - This file's "Decisions locked" section

---

## Commits landed on `main`

| Commit | Title | Files | Status |
|---|---|---|---|
| `cd3257a` | feat(items): completeness columns + proficiency source/melee-ranged filter + Foundry slug alignment | migration + itemImport.ts | ✅ |
| `a626395` | feat(proficiency): polymorphic item-proficiency resolver + melee/ranged data shape | new `proficiencyResolver.ts` + classExport.ts + ClassEditor.tsx | ✅ |
| `b821f99` | feat(class-editor): melee/ranged category grants in Proficiencies + Multiclass (initial standalone section — superseded by `207baca`) | ClassEditor.tsx | ✅ |
| `96e47cd` | feat(class-export): trait advancement carries melee/ranged-restricted category arrays | classExport.ts (export-side only — UI deferred) | ✅ |
| `8fc884a` | feat(compendium): ItemUsesField — drop-in editor for items.uses block | new `ItemUsesField.tsx` | ✅ |
| `207baca` | refactor(class-editor): inline Melee/Ranged pills into category headers — drop standalone section | ClassEditor.tsx | ✅ |
| `f038305` | feat(trait-adv): weapon picker melee/ranged pills + module-side category-grant expansion | AdvancementManager.tsx + class-import-service.js | ✅ (C4-UI) |
| `e2e6911` | feat(items): dynamic ItemsEditor body — type-dispatching shell with per-type sub-forms | ItemsEditor.tsx + compendium.ts + d1.ts + itemImport.ts | ✅ (C6) |
| `7772972` | feat(facilities): bastions table + manage page + public browser | new migration + FacilitiesEditor.tsx + FacilitiesList.tsx + routes/nav | ✅ (C7) |

The 9 commits hold the full **data-model + library + proficiency-UI + trait-advancement +
dynamic items editor + facilities** stack. The only remaining work is **C8 documentation
pass** (+ the batched remote D1 migration application).

---

## Decisions locked this session

These were settled by the user 2026-05-26. Honor them in remaining work.

1. **Split UI**: inline Melee/Ranged pill buttons next to each existing weapon
   category-header checkbox in BOTH the Weapon Options and Fixed Weapons columns —
   not a standalone "Category-Level Grants" section. The Options-column pills bulk-
   toggle individual weapons in `optionIds`; the Fixed-column pills bulk-toggle
   `fixedIds` AND maintain section-level `categoryMeleeIds` / `categoryRangedIds`
   arrays for export round-trip. Toggling the existing "All" header checkbox clears
   any melee/ranged restriction for that category (canonical whole-category
   representation lives only in `categoryIds`). Already shipped for the Class
   Proficiencies + Multiclass Proficiencies tabs (commit `207baca`, superseding
   `b821f99`'s initial separate-section attempt); the same inline-pill pattern needs
   to land in the trait-advancement weapon picker (C4-UI, below).

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

### Known gaps from the melee/ranged work (not blocking C6+ but worth picking up)

The C4-UI commit added weapon-category expansion to `normalizeSemanticFeatureTraitAdvancement`
(via the new `expandWeaponCategoryGrants` helper) — that handles **trait advancements**.
Two parallel module paths still consume only `categoryIds` (not the new Melee/Ranged
arrays) and emit a single `weapon:simple` token which dnd5e v5 doesn't recognize:

- **`module/dauligor-pairing/scripts/class-import-service.js:4633`** —
  `buildTraitKeysFromProfileBlock(type, block, …)`. Used by `applyActorTraitProfile`
  for **multiclass proficiencies**. When `block.categoryIds` / `categoryMeleeIds` /
  `categoryRangedIds` come through, emit `weapon:simpleM` etc. via the same probe-and-
  split logic as `expandWeaponCategoryGrants`. Hoist that helper into a shared spot or
  copy the logic into `normalizeProfileTraitKey` so the M/R split is honored.

- **`module/dauligor-pairing/scripts/importer-base-features.js:130`** —
  `'base-weapons': { kind: 'weapons', block: profile.weapons }`. The importer wizard
  builds advancement entries from the class's main `proficiencies.weapons` block here.
  It currently only reads `fixedIds` / `optionIds`. Should also expand
  `categoryIds` / `categoryMeleeIds` / `categoryRangedIds` into advancement entries
  (probably mapped into `entry.fixed` with the right Foundry trait keys via the same
  helper).

These are class-level proficiency block consumers — separate from the trait-advancement
path C4-UI just wired. Until they're updated, multiclass weapon-category grants and the
importer wizard's base-weapon row won't honor the new Melee/Ranged split. Low priority
because most class-level weapon grants are still expressed per-item; the homebrew exotic
ones authored via the new pills are the only ones affected today.

**Module canonical doc updates needed (flag for next session):**
- `module/dauligor-pairing/docs/class-import-contract.md` — document the
  `categoryMeleeIds` / `categoryRangedIds` arrays on proficiency blocks AND on trait
  advancement configurations, and the fan-out to Foundry trait keys (`weapon:simpleM` /
  `weapon:simpleR` / both when `categoryIds`).
- `module/dauligor-pairing/docs/class-semantic-export-notes.md` — already shows the
  `categoryIds` example block; extend with `categoryMeleeIds` / `categoryRangedIds`.

---

### C6 — Dynamic ItemsEditor (LANDED, `e2e6911`)

The editor's `ItemManualEditor` is now a type-dispatching shell. Sub-forms shipped inline
in `src/pages/compendium/ItemsEditor.tsx` (~870 LOC total) rather than separate files —
the originally-spec'd `WeaponItemFields.tsx` / `EquipmentItemFields.tsx` / etc. files
weren't extracted because the components share enough props + helpers that inlining read
cleaner. Extract later only if a sub-form gets reused elsewhere.

**Known follow-ups for C6** (not blocking — opportunistic):

- **Loot sub-form**: no dedicated section was added because the shared Type section
  (with its subtype dropdown sourced from `LOOT_SUBTYPES`) already covers everything
  authors need for loot. If we add weight-bracket / value-tier metadata on loot rows
  later, a dedicated `LootItemFields` block becomes worth it.
- **Secondary-axis subtype (consumable.poison.contact, consumable.ammo.arrow)**:
  Foundry's `system.type.subtype` for the two-axis consumable case currently has no
  landing column. `itemImport.ts` was repurposed to put the PRIMARY axis
  (`system.type.value`) into `items.type_subtype` so the primary subtype isn't lost
  for consumable / loot / equipment-non-armor (which previously had nowhere to land it).
  The secondary axis is dropped on import until either:
  - A new `items.type_inner_subtype` column lands, or
  - A packed-slug convention (`type_subtype = "poison:contact"`) is adopted.
  Tracked for C8 docs + a follow-up migration if needed.
- **Proficiency badge**: deliberately not surfaced in the editor (per the original
  C6 plan — "informational only on editor; useful on the public list pages").
  `resolveItemProficiency(item, profs)` from `proficiencyResolver.ts` (commit
  `a626395`) is ready when the C8 docs pass wires it into `/compendium/items`.
- **`uses` decomposition guard**: `normalizeCompendiumData` now skips the legacy
  `uses → uses_max/uses_spent/uses_period/uses_recovery` flat-column decomposition
  when the payload has `item_type` set (i.e. it's an items payload). Features still
  decompose. If a NEW entity ever adopts the items-style uses JSON column it must
  either (a) set `item_type` (yuck) or (b) gain its own collection hint — flag for
  refactor when that lands.

---

### C7 — Facilities (Bastions) — LANDED (`7772972`)

Schema shipped at `worker/migrations/20260526-2000_facilities.sql` (applied LOCAL).
The editor (`FacilitiesEditor.tsx`, ~440 LOC) and public browser (`FacilitiesList.tsx`,
~320 LOC) live at `/compendium/facilities` and `/compendium/facilities/manage`. Routes
wired in `App.tsx`; sidebar entry next to Items; Compendium hub tile in Magic & Equipment.

**Known follow-ups for C7** (flag for next session, not blocking):

- **Foundry Import**: `src/lib/itemImport.ts` `classifyItemShape` returns
  `'items' | 'weapons' | 'armor' | 'tools'`. Adding `'facilities'` as a fifth target
  needs the `ItemImportWorkbench` per-shape routing to grow a new branch and a new
  write path (facilities go into `facilities`, not `items`). Punted because the
  workbench's per-shape preview + write code is item-specific and would need a
  reasonable refactor.
- **Foundry Export**: `module/dauligor-pairing/scripts/export-service.js` already
  has a generic items folder export but doesn't currently surface facilities.
  Either a `facilityFolderExport` parallel to the items one, or a single generic
  "compendium folder" export that includes all item-shaped Foundry documents
  including facility items.
- **Actor picker for defenders / hirelings**: the editor surfaces them as
  line-separated UUID textareas. The character sheet rewrite will close this gap
  by introducing an actor-UUID picker control.
- **Facility favorites**: shell's favorites pane is wired with empty no-op props.
  A `useFacilityFavorites` hook parallel to `useFeatFavorites` would enable
  starring; the catalog is small enough this hasn't been requested yet.

The original spec block (CREATE TABLE plus editor/list plans) has been removed —
the migration header at `worker/migrations/20260526-2000_facilities.sql` and the
file-level docs in `FacilitiesEditor.tsx` / `FacilitiesList.tsx` are now the
canonical references.

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
