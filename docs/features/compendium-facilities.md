# Compendium — Facilities (Bastions)

Bastion facilities — the 2024 DMG's downtime system. Each facility is a room or
outbuilding attached to a character's bastion; the dnd5e v5 schema models them as
their own item type with build state, active orders, and per-order JSON sub-blocks.

The catalog is much smaller than items (~30 special subtypes vs 1700+ items), the
shape is heavier (orders / progress / trade / craft / defenders / hirelings), and
the rules don't overlap with normal item mechanics — so facilities get their own
table and their own pages.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/facilities` | [FacilitiesList.tsx](../../src/pages/compendium/FacilitiesList.tsx) | Public browser — filter by source / type / size |
| `/compendium/facilities/manage` | [FacilitiesEditor.tsx](../../src/pages/compendium/FacilitiesEditor.tsx) | Admin manager — order-dispatching form body |

Sidebar entry next to Items; Compendium hub tile in **Magic & Equipment**.

## Data layer (D1)

Table: `facilities`. Migration:
[`worker/migrations/20260526-2000_facilities.sql`](../../worker/migrations/20260526-2000_facilities.sql).
Schema details: [facilities.md](../database/structure/facilities.md).

Headline columns:

| Column | Foundry | Notes |
|---|---|---|
| `facility_type` | `system.type.value` | `basic` or `special` (CHECK-constrained) |
| `facility_subtype` | `system.type.subtype` | 6 basic / 28 special slugs (see below) |
| `size` | `system.size` | `cramped` / `roomy` / `vast` (CHECK-constrained) |
| `level` | `system.level` | character level required (1–9 for special variants) |
| `built` / `free` / `disabled` / `enlargeable` | `system.building.built` / `.free` / `.disabled` / `.enlargeable` | INTEGER booleans |
| `facility_order` | `system.order` | Active order — drives sub-block visibility |
| `progress` | `system.progress` | JSON `{value, max, order, pct?}` |
| `trade` | `system.trade` | JSON — only authored when order=`trade` |
| `craft` | `system.craft` | JSON — only authored when order=`craft` |
| `defenders` / `hirelings` | `system.defenders` / `.hirelings` | JSON `{value: actor-uuid[], max}` |

Plus the standard catalog fields (name / identifier / source_id / description /
image_url / activities / effects / page / tags) so `CompendiumBrowserShell` +
`DevelopmentCompendiumManager` work without per-entity branching.

## Type vocabularies (dnd5e v5)

Mirrors `CONFIG.DND5E.facilities` in dnd5e 5.3+. The list landed in the 2024 DMG.

### Basic subtypes (6)
`bedroom`, `courtyard`, `diningRoom`, `kitchen`, `parlor`, `storage`

Available at level 5 (the "Bastion Granted" milestone). Don't unlock any orders
beyond Build / Repair / Enlarge.

### Special subtypes (28)
`archive` · `arcaneStudy` · `armory` · `barrack` · `demiplane` · `garden` ·
`gamingHall` · `greenhouse` · `guildhall` · `laboratory` · `library` ·
`meditationChamber` · `menagerie` · `observatory` · `pub` · `reliquary` ·
`sacristy` · `sanctum` · `scriptorium` · `smithy` · `stable` · `storehouse` ·
`teleportationCircle` · `theater` · `trainingArea` · `trophyRoom` · `warRoom` ·
`workshop`

Each special facility unlocks specific orders + has a level gate (5 / 9 / 13 / 17
depending on tier).

### Sizes (3)

| Slug | Square Footage | Price | Build Days |
|---|---|---|---|
| `cramped` | 4 sq | 500 gp | 20 days |
| `roomy` | 16 sq | 1,000 gp | 45 days |
| `vast` | 36 sq | 3,000 gp | 125 days |

### Orders (11)
`build` · `change` · `craft` · `empower` · `enlarge` · `harvest` · `maintain` ·
`recruit` · `repair` · `research` · `trade`

`repair` is auto-applied when `disabled = 1` — the editor reveals it but the
runtime forces it on disabled facilities.

## The order-dispatching editor

`FacilitiesEditor.tsx`'s `FacilityFields` mirrors the dynamic items editor's
type-dispatch pattern. The Active Order dropdown drives an optional sub-block:

```text
[TYPE]              — facility_type + facility_subtype
[SIZING]            — size + required character level
[STATE]             — built / free / disabled / enlargeable booleans
[ACTIVE ORDER]      — facility_order dropdown + Progress {value, max}
[CRAFT ORDER]       — shown when order='craft'  → item UUID + quantity
[TRADE ORDER]       — shown when order='trade'  → daily profit + stock {value, max, stocked}
[DEFENDERS]         — always shown — UUID[] + max
[HIRELINGS]         — always shown — UUID[] + max
```

Switching the Order from Craft to Trade preserves the previous Craft sub-block's
state in the database (it's a separate column) — re-selecting Craft brings it
back. The shell only renders the *active* sub-block to keep authoring focused.

### Defender / hireling roster authoring

Both rosters are presented as line-separated UUID textareas:

```
Compendium.dnd5e.actors.Actor.xxxxxxxxxxxxxxxx
Compendium.dnd5e.actors.Actor.yyyyyyyyyyyyyyyy
```

One UUID per line. Trimmed + de-duplicated on save. There's no actor picker on
the admin side yet — the character sheet rewrite will introduce a pickable
control that resolves UUIDs against the player's allied actors. For now,
paste UUIDs from Foundry (or leave them empty + let the runtime in-Foundry add
them per session).

## Foundry round-trip

**Import**: NOT YET WIRED. `src/lib/itemImport.ts` `classifyItemShape` returns one
of `'items' | 'weapons' | 'armor' | 'tools'` — adding `'facilities'` as a fifth
target requires:

1. Routing `foundryType === 'facility'` to a new `'facilities'` classification.
2. A parallel `buildUnifiedFacilitySavePayload` builder.
3. An `upsertFacilityBatch` write path that targets the `facilities` table.
4. Extending the `ItemImportWorkbench`'s per-shape preview rendering.

Tracked as a follow-up to this commit.

**Export**: NOT YET WIRED either. The module's
[`export-service.js`](../../module/dauligor-pairing/scripts/export-service.js)
has a generic items folder export but doesn't currently surface facility items.
A `facilityFolderExport` parallel to the items one (or a unified
"compendium-folder export" that includes facility-typed Foundry items) is the
clean fix.

In the meantime, facilities are authored manually via the editor — there's no
bulk-import path. The catalog is small enough (a dozen-ish core facilities) that
this is manageable until the importer/exporter work lands.

## Common tasks

### Author the "Smithy" special facility
1. New row → Type = Special → Subtype = `smithy`.
2. Size = `roomy` (16 sq), Level = 5 (smithies unlock at character level 5).
3. State: `enlargeable = true` (smithies upgrade to vast). Leave `built` off
   for the template row — that's character-state.
4. Description: BBCode-author the rules text from DMG 2024.
5. (Optional) Activities tab → add a Craft activity that triggers the item-
   crafting flow.

### Add a custom Bastion facility
1. New row → Type = Basic or Special based on rules-tier you want.
2. Pick the closest subtype to anchor against (or add a new one — but note
   that the subtype dropdown is a hardcoded list mirroring `CONFIG.DND5E.facilities`;
   adding a new subtype slug requires extending the editor's vocab AND the
   module-side handler).
3. The standard rules apply — size / level / order vocab is fixed by the
   schema's CHECK constraints.

## Related docs

- [facilities.md](../database/structure/facilities.md) — full column reference
- [compendium-items.md](compendium-items.md) — items catalog (related but distinct)
- [foundry-integration.md](../architecture/foundry-integration.md) — round-trip philosophy

## Known follow-ups

These were flagged at C7 ship time (commit `7772972`); pick up opportunistically:

- **Foundry Import for facilities** — extend `itemImport.ts` + `ItemImportWorkbench`
  as described above.
- **Foundry Export** — `facilityFolderExport` in the module's export-service.js.
- **Actor picker** — defender/hireling rosters as UUID textareas is workable but
  not friendly; the character-sheet rewrite will introduce a proper actor-UUID
  control that the admin editor can re-use.
- **Facility favorites** — shell's favorites pane is wired with empty no-op props;
  add a `useFacilityFavorites` hook parallel to `useFeatFavorites` if/when starring
  becomes useful.
