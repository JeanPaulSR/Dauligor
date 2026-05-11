# Table Structure: `status_conditions`

Mechanical states and status icons applied to actors.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `identifier` | TEXT (INDEX) | `identifier` | Foundry key (e.g., `blinded`). This is what goes into an Active Effect's `statuses[]` array on export. |
| `name` | TEXT | `name` | |
| `image_url` | TEXT | `img` | R2 URL for the icon. |
| `reference` | TEXT | `reference` | Foundry compendium path. |
| `description` | TEXT | `description` | |
| `order` | INTEGER | `order` | |
| `implied_ids` | JSON | `impliedStatuses` | Array of condition identifiers. |
| `changes` | JSON | `changes` | Array of ActiveEffect changes. |
| `source` | TEXT | `source` | dnd5e, custom, imported. |
| `category_id` | TEXT (FK) | — | FK to [`condition_categories`](#sister-table-condition_categories). Drives the badge shown next to each condition in the Active Effect editor's Status Conditions picker. Nullable for uncategorised rows. Added by migration `20260511-0043_status_condition_categories.sql`. |
| `created_at` | DATETIME | `createdAt` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Implementation Notes
- **Active Effects**: The `changes` column stores a list of mechanical adjustments (e.g., `{"key": "system.attributes.movement.walk", "mode": 5, "value": "0"}`).
- **Condition Hierarchy**: `implied_ids` allows the system to automatically apply parent conditions (e.g., being Paralyzed implies being Incapacitated).
- **JSON auto-parse**: `implied_ids` and `changes` are listed in `src/lib/d1.ts`'s `jsonFields` so `fetchCollection('statuses')` returns them as parsed arrays. Without that they come back as raw JSON strings — see the bug fix in commit `cc20bd5`.

## Sister table: `condition_categories`

Defines the groupings shown as the right-hand badge on each condition in the AE editor's picker (PHB Conditions / Combat States / Spell States / System Extras, plus any custom categories).

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `identifier` | TEXT (UNIQUE) | Slug-style key. |
| `name` | TEXT | Human label shown in pickers. |
| `order` | INTEGER | Sort order. |
| `description` | TEXT | Optional. |
| `updated_at` | DATETIME | |

Defined originally in migration `0001_phase1_foundation.sql`; seeded with four canonical rows by `20260511-0043_status_condition_categories.sql`, which also added the `category_id` FK on `status_conditions` and backfilled the well-known dnd5e identifiers.

## Admin UI

Both tables are edited from `/admin/statuses` ([`StatusesEditor.tsx`](../../../src/pages/admin/StatusesEditor.tsx)) via a two-tab layout:
- **Conditions** — the rich condition form (icon, markdown description, implied conditions, AE changes, category dropdown, etc.).
- **Condition Categories** — a `SimplePropertyEditor` against `conditionCategories`.

Previously the `AdminProficiencies` page had a thin `SimplePropertyEditor` tab pointed at `status_conditions`; that was removed in commit `9c99ada` to deduplicate authoring surfaces.

## Table mapping

The `D1_TABLE_MAP` in [`src/lib/d1Tables.ts`](../../../src/lib/d1Tables.ts) exposes:
- `statuses` and `conditions` → `status_conditions`
- `conditionCategories` → `condition_categories`
