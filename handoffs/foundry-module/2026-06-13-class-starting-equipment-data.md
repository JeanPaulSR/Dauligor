# → foundry-module: class bundles now carry structured `startingEquipmentData`

**From:** compendium-editors · **Date:** 2026-06-13
**Status:** app side SHIPPED (export emits it). Import wiring is yours (currently a documented stub).

## What changed app-side

The class editor now has a real **starting-equipment builder** (AND/OR choice
groups → specific items / category choices / focus / currency), stored in a new
`classes.starting_equipment_data` column. The baked **class bundle now includes
a new field**:

```jsonc
"startingEquipmentData": EquipmentEntryData[]   // dnd5e system.startingEquipment shape
```

The existing **`startingEquipment` (string, prose) is UNCHANGED** — keep using it
for the importer's read-only review text. `startingEquipmentData` is the new
*structured* field; it's `[]` when the author hasn't built a structured tree.

## The shape — dnd5e `EquipmentEntryData[]`

A **flat** array; the tree is reconstructed from `group` (parent `_id`) + `sort`.
This is exactly `system.startingEquipment`'s schema (verified against dnd5e 5.x
`StartingEquipmentTemplate` / `EquipmentEntryData`):

```ts
{
  _id: string;                 // 16-char id (we generate valid ones)
  group: string | null;        // parent entry _id; null = top-level line
  sort: number;                // 100, 200, … within a group
  type: 'AND' | 'OR'           // grouping
      | 'linked' | 'weapon' | 'armor' | 'tool' | 'focus' | 'currency';  // option
  count?: number;              // quantity (20 arrows, 10 gp)
  key?: string;                // see below
  requiresProficiency?: boolean;
}
```

### `key` by type
- **`linked`** → **our item _source identifier_** (e.g. `"chain-mail"`, `"longbow"`),
  **NOT a Foundry UUID.** ⚠️ **You must resolve identifier → item UUID** at import
  time (against the imported item compendium / the `/api/module/<slug>/items.json`
  catalog), the same way base-item slugs resolve. We can't emit a Foundry UUID —
  it doesn't exist until your import creates the item.
- **`weapon`** → `sim` | `mar`  (CONFIG.DND5E.weaponProficiencies)
- **`armor`** → `light` | `medium` | `heavy` | `shield`  (CONFIG.DND5E.armorTypes)
- **`tool`** → `art` | `game` | `music`  (CONFIG.DND5E.toolTypes)
- **`focus`** → `arcane` | `druidic` | `holy`  (CONFIG.DND5E.focusTypes)
- **`currency`** → denomination (`pp`/`gp`/`ep`/`sp`/`cp`), with `count` = amount

## What we'd like you to do

1. Map `startingEquipmentData` → the class item's `system.startingEquipment`,
   resolving every `linked` `key` (our identifier) to the real item UUID. Entries
   whose identifier doesn't resolve should warn (and can be dropped or left for
   re-resolution) rather than fail the whole import.
2. Wire the **equipment choice step** in the class importer — `class-import-contract.md`
   currently lists it as a deliberate stub. With this field you can drive Foundry's
   native equipment prompt instead of just showing the prose text.

Top-level entries have `group: null`; reconstruct the tree by grouping on `group`
and ordering by `sort`. Nothing else in the bundle changed.

## Round-trip example (Fighter)

Authoring tree → exported `startingEquipmentData`:

> Chain Mail · **OR** · (Leather Armor **and** Longbow **and** 20 Arrows)
> Any Martial Weapon (if proficient) · **OR** · A Shield

```jsonc
[
  { "_id":"…1","group":null,    "sort":100,"type":"OR" },
  { "_id":"…2","group":"…1","sort":100,"type":"linked","key":"chain-mail","count":1 },
  { "_id":"…3","group":"…1","sort":200,"type":"AND" },
  { "_id":"…4","group":"…3","sort":100,"type":"linked","key":"leather","count":1 },
  { "_id":"…5","group":"…3","sort":200,"type":"linked","key":"longbow","count":1 },
  { "_id":"…6","group":"…3","sort":300,"type":"linked","key":"arrows","count":20 },
  { "_id":"…7","group":null,    "sort":200,"type":"OR" },
  { "_id":"…8","group":"…7","sort":100,"type":"weapon","key":"mar","requiresProficiency":true },
  { "_id":"…9","group":"…7","sort":200,"type":"armor","key":"shield" }
]
```

## App-side references
- Model + flatten: `src/lib/startingEquipment.ts` (mirror `api/_lib/_startingEquipment.ts`).
- Export: `src/lib/classExport.ts` + `api/_lib/_classExport.ts` (`bakedStartingEquipmentData`,
  resolves item PK → identifier before flattening).
- Editor: `src/components/compendium/StartingEquipmentEditor.tsx` in the ClassEditor Equipment tab.
- DB: migration `20260613-1200_classes_starting_equipment_data.sql` (local applied; remote pending).
