# Interactive Maps

Era-scoped world maps with clickable **pins** (points) and **highlights** (regions)
that link to lore articles and to other maps. Reader + pin-authoring live in one page;
see [Limitations](#limitations--gaps) for what isn't authorable in-app yet.

## Routes & access

| Route | Component | Who |
|---|---|---|
| `/map` | `src/pages/core/Map.tsx` | Any signed-in member with an active campaign |
| Sidebar → "Maps" (world section) | — | links to `/map` |

- **Admin** here means `role ∈ { admin, co-dm, lore-writer }` (`isAdmin` in `Map.tsx`).
  Admins get the pin-drop affordance + pin delete; everyone else is read-only.
- The page needs an **active campaign** (navbar switcher) that has an **era** assigned —
  maps are scoped to the era, not the campaign directly.

## Data model

Three tables, all created in `worker/migrations/0017_map_markers.sql`.

| Table | Key columns | Notes |
|---|---|---|
| `maps` | `id`, `identifier`, `name`, `description`, `background_image_url`, `era_id`, `parent_marker_id`, `parent_highlight_id` | A map belongs to one era. `parent_*` record the entry-point on a parent map (for the submap hierarchy). `UNIQUE(era_id, identifier)`. |
| `map_markers` | `id`, `map_id`, `article_id`, `x`, `y`, `label`, `icon` | Point pin. `x`/`y` are 0–100 percentages. `article_id` optional (placeholder pins allowed). |
| `map_highlights` | `id`, `map_id`, `article_id`, `child_map_id`, `shape`, `x`, `y`, `width`, `height`, `label` | Region. `shape` is `'rect'` today (`'circle'`/`'polygon'` reserved). May link an article AND/OR a `child_map_id` (drill-down). |

**FK behaviour:**
- `maps.era_id → eras(id)` is **NO ACTION** — an era can't be deleted while maps reference it (forces explicit cleanup).
- `map_markers.map_id` / `map_highlights.map_id → maps(id)` **ON DELETE CASCADE** — deleting a map removes its pins/highlights.
- `*.article_id → lore_articles(id)` **ON DELETE SET NULL** — deleting an article just unlinks the pin; the pin survives as a placeholder.
- `map_highlights.child_map_id → maps(id)` **ON DELETE SET NULL**.

## How it works

1. **Era resolution** — `Map.tsx` reads the active campaign via `/api/campaigns/:id` and
   takes its `era_id`. No era → no maps.
2. **Map selection** — maps for the era are loaded with `fetchCollection('maps', …)`. The
   last-viewed map is remembered per-era in `localStorage` (`dauligor:activeMapId:<eraId>`).
3. **Markers + highlights** — loaded with `queryD1` for the selected map. Titles are joined
   client-side from `allArticles` (fetched once via `/api/lore/articles?fields=id,title`,
   which is already gate-filtered server-side).
4. **Visibility** — for non-admins, any marker/highlight whose `article_id` isn't in the
   gate-filtered `allArticles` set is dropped (so a pin pointing at a **draft** article is
   invisible to players). Label-only pins (no `article_id`) always show. Admins see all.
   *(This closes the M1 draft-leak — the old `LEFT JOIN lore_articles` shipped draft titles
   in the payload; the current path never does.)*
5. **Detail panel** — clicking a pin/highlight fills the right-hand Details card:
   "Read Full Lore" → `/wiki/article/:id`; highlights with a `child_map_id` also get a
   "Travel to <submap>" button that switches the selected map.

## Authoring today

- **Pins** — an admin clicks anywhere on the map (cursor is a crosshair) to open the *Add
  Pin* dialog: optional label + an optional **article dropdown** (populated from
  `allArticles`). Pins can be deleted from the Details panel ("Delete Pin (article kept)").
- **Highlights** — **display-only.** There is no draw/edit/delete UI; highlights must be
  created in D1 directly. (Documented TODO in `Map.tsx`.)
- **Map records themselves** — **not authorable in-app** (see below).

## Limitations & gaps

- **No map CRUD UI.** The app can read maps and author pins, but there is **no in-app way to
  create a map, set its era, or upload its `background_image_url`** — the only `maps`-table
  access in `src/` is the read in `Map.tsx`. New maps must be inserted via direct D1 /
  admin tooling. This is the largest gap for end-to-end usability.
- **No highlight authoring UI** — draw mode, edit/delete, and non-`rect` shapes are TODO.
- **No marker edit** — a pin's label/article can't be changed after creation (delete +
  recreate only).
- **`icon` column unused** — `map_markers.icon` exists but isn't exposed in the Add Pin form.
- **No viewport culling** — every marker renders at once (fine for modest counts).
- **No background image** now shows a quiet "No map image uploaded yet" empty state (was
  previously an external `picsum.photos` placeholder).

## Key files

- `src/pages/core/Map.tsx` — the entire viewer + pin authoring.
- `worker/migrations/0017_map_markers.sql` — schema for all three tables.
- `src/components/Sidebar.tsx` — "Maps" nav entry (world section).
- `src/index.css` — `.map-container` / `.map-marker` styles.

## Related docs

- [campaigns-eras.md](campaigns-eras.md) — eras (which scope maps) + the active-campaign model.
- [wiki-lore.md](wiki-lore.md) — the lore articles that pins/highlights link to.
- [../database/structure/](../database/structure/) — per-table schema specs.
