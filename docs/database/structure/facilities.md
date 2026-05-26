# Table Structure: `facilities`

dnd5e v5's Bastion facilities (2024 DMG). Separate from `items` because the shape
is much heavier (per-order JSON sub-blocks, roster references, build state) and
the catalog is much smaller. Public browser at `/compendium/facilities`; admin
manager at `/compendium/facilities/manage`.

Schema baseline: migration
[`worker/migrations/20260526-2000_facilities.sql`](../../../worker/migrations/20260526-2000_facilities.sql).

## Layout Specs

### Identity + catalog
| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `name` | TEXT NOT NULL | Display name |
| `identifier` | TEXT NOT NULL UNIQUE | Slug |
| `description` | TEXT | BBCode |
| `image_url` | TEXT | |
| `activities` | JSON | DEFAULT `'[]'` — orders like Craft or Empower fit cleanly as Activities |
| `effects` | JSON | DEFAULT `'[]'` — Active Effects on the facility |
| `source_id` | TEXT (FK) | → `sources.id`. ON DELETE SET NULL |
| `page` | TEXT | |
| `tags` | JSON | DEFAULT `'[]'` |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

### Type discriminators
| Column | Type | Notes |
|---|---|---|
| `facility_type` | TEXT NOT NULL DEFAULT `'basic'` | CHECK IN (`'basic'`, `'special'`). Foundry `system.type.value` |
| `facility_subtype` | TEXT | Foundry `system.type.subtype` — see vocab below |

### Size + level
| Column | Type | Notes |
|---|---|---|
| `size` | TEXT NOT NULL DEFAULT `'cramped'` | CHECK IN (`'cramped'`, `'roomy'`, `'vast'`) |
| `level` | INTEGER NOT NULL DEFAULT 5 | Required character level. Special facilities tier at 5/9/13/17 |

### Build state (INTEGER booleans)
| Column | Notes |
|---|---|
| `built` | Has the structure physically been constructed? |
| `free` | Granted at no cost (starting facility) |
| `disabled` | Damaged — runtime forces `facility_order = 'repair'` |
| `enlargeable` | Can upgrade Cramped → Roomy → Vast |

### Active order + per-order state
| Column | Type | Notes |
|---|---|---|
| `facility_order` | TEXT | NULL or one of the CHECK-constrained order slugs |
| `progress` | JSON | `{value, max, order, pct?}` — days invested toward the active order |
| `trade` | JSON | `{creatures, profit, stock, pending}` — only authored when order=`trade` |
| `craft` | JSON | `{item, quantity}` — only authored when order=`craft` |
| `defenders` | JSON | `{value: actor-uuid[], max}` |
| `hirelings` | JSON | `{value: actor-uuid[], max}` |

`facility_order` CHECK list:
`build` · `change` · `craft` · `empower` · `enlarge` · `harvest` · `maintain` ·
`recruit` · `repair` · `research` · `trade`

The editor renders sub-forms based on order — Craft / Trade get their own
sub-blocks; the others show only the generic Progress block. Switching orders
preserves the prior sub-block's column state (it's separate columns); re-
selecting brings the block back.

## Subtype vocabularies

Mirror `CONFIG.DND5E.facilities` in dnd5e 5.3+.

### Basic (6 slugs)
`bedroom` · `courtyard` · `diningRoom` · `kitchen` · `parlor` · `storage`

### Special (28 slugs)
`archive` · `arcaneStudy` · `armory` · `barrack` · `demiplane` · `garden` ·
`gamingHall` · `greenhouse` · `guildhall` · `laboratory` · `library` ·
`meditationChamber` · `menagerie` · `observatory` · `pub` · `reliquary` ·
`sacristy` · `sanctum` · `scriptorium` · `smithy` · `stable` · `storehouse` ·
`teleportationCircle` · `theater` · `trainingArea` · `trophyRoom` · `warRoom` ·
`workshop`

The editor's subtype dropdown is hardcoded to these lists; adding a new subtype
slug requires extending the editor's vocab AND the module-side handler.

## Indexes

- `idx_facilities_type` ON (`facility_type`)
- `idx_facilities_subtype` ON (`facility_subtype`)
- `idx_facilities_source` ON (`source_id`)
- `idx_facilities_order` ON (`facility_order`)

## camelCase aliases for the editor

| Column | camelCase alias |
|---|---|
| `facility_type` | `facilityType` |
| `facility_subtype` | `facilitySubtype` |
| `facility_order` | `facilityOrder` |
| `image_url` | `imageUrl` |
| `source_id` | `sourceId` |

JSON sub-blocks (`progress` / `trade` / `craft` / `defenders` / `hirelings`) keep
their column names — already lowercase single tokens.

## Auto-parsed JSON columns

`src/lib/d1.ts`'s `jsonFields` list includes: `progress`, `trade`, `craft`,
`defenders`, `hirelings`. Plus the standard `activities` / `effects` / `tags`
from the catalog template. Consumers receive typed objects on every fetch.

## Related docs

- [compendium-facilities.md](../../features/compendium-facilities.md) — feature
  guide + editor walkthrough
- [items.md](items.md) — sister catalog (separate table because shape differs)
