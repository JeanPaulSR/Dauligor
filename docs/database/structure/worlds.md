# Table Structure: `worlds`

Top-level scope dimension for compendium content. The default world (**Dauligor**) holds every
shared/global entity; additional worlds will host user-owned content once per-entity `world_id`
scoping ships. Created by `20260518-1100_worlds_and_user_permissions`.

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | The default world is seeded with id `dauligor-base`. |
| `name` | TEXT NOT NULL | e.g., "Dauligor". |
| `slug` | TEXT UNIQUE NOT NULL | Lowercase/dashes; powers public catalog URLs once worlds scope content. |
| `description` | TEXT | Optional one-line summary. |
| `owner_user_id` | TEXT (FK) | `users.id`, `ON DELETE SET NULL`. NULL = shared/admin-owned. |
| `is_default` | INTEGER NOT NULL (0/1) | Exactly one row may be 1 (partial-unique index `worlds_default_singleton`). |
| `sort_order` | INTEGER NOT NULL | UI sort order. |
| `background_image_url` | TEXT | **Wiki background — world step** (bottom) of the `campaign → era → world` cascade. Added in `20260604-1200_worlds_background_image`. |
| `created_at` | TEXT | ISO 8601 string. |
| `updated_at` | TEXT | Set on write. |

## Implementation Notes
- **The default world is protected**: `is_default` can't be cleared via PATCH, and the default
  world can't be deleted (server returns 409). It's editable (rename/description/background).
- `background_image_url` is the fallback backdrop behind wiki/lore pages when no campaign- or
  era-level background applies. The `20260604-1200` migration carried the legacy global default
  (`system_metadata.wiki_settings.defaultBackgroundImageUrl`) onto the default world; the old
  wiki-settings write path was removed. See
  [campaigns-eras.md → Background image cascade](../../features/campaigns-eras.md#background-image-cascade).
- **No `world_id` columns exist on other tables yet** — eras/campaigns/compendium content are not
  scoped to a world. That's a later phase; today there is effectively one world.
- `background_image_url` was added with `ALTER TABLE … ADD COLUMN` (no `IF NOT EXISTS` in
  SQLite/D1) — apply the migration exactly once per database.

## Access
Admin-only CRUD via `GET` / `POST` / `PATCH` / `DELETE /api/admin/worlds[/id]`
([functions/api/admin/worlds/[[path]].ts](../../../functions/api/admin/worlds/[[path]].ts)).
Reads for the wiki background cascade use `fetchCollection('worlds')` on the generic proxy
(world taxonomy is world-facing, like eras). Managed from the
[admin console's Worlds tab](../../features/campaigns-eras.md#management-console)
(list) and the [WorldEditor](../../../src/pages/admin/WorldEditor.tsx) (detail).
