# Wiki & Lore

The world-building layer: hierarchical articles, DM secrets, NPC/location/organisation/deity metadata, and per-era / per-campaign visibility.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/wiki` | [src/pages/wiki/Wiki.tsx](../../src/pages/wiki/Wiki.tsx) | Article browser (grid + tree views) |
| `/wiki/article/:id` | [src/pages/wiki/LoreArticle.tsx](../../src/pages/wiki/LoreArticle.tsx) | Article reader |
| `/wiki/new`, `/wiki/edit/:id` | [src/pages/wiki/LoreArticleDesigner.tsx](../../src/pages/wiki/LoreArticleDesigner.tsx) | Block-based article designer (staff only) |
| `/map` | [src/pages/core/Map.tsx](../../src/pages/core/Map.tsx) | Geographic markers linked to lore articles |

## Data layer (D1)

| Table | Role |
|---|---|
| `lore_articles` | Base article (title, slug, category, content BBCode, status, image fields) |
| `lore_meta_characters` | NPC metadata (race, age, alignment, …) |
| `lore_meta_locations` | Location metadata (type, climate, ruler, …) |
| `lore_meta_organizations` | Organisation metadata (HQ, leader, motto, …) |
| `lore_meta_deities` | Deity metadata (domains, holy symbol) |
| `lore_secrets` | DM-only revelations attached to articles |
| `lore_article_eras`, `lore_article_campaigns` | Article visibility junctions |
| `lore_secret_eras`, `lore_secret_campaigns` | Secret visibility junctions |
| `lore_article_tags` | Tag assignment |
| `lore_links` | Article-to-article cross-references |

Full schema: [../database/structure/lore_articles.md](../database/structure/lore_articles.md), [../database/structure/lore_meta_characters.md](../database/structure/lore_meta_characters.md), and [../_archive/migration-details/phase-3-wiki.md](../_archive/migration-details/phase-3-wiki.md).

Helper module: [src/lib/lore.ts](../../src/lib/lore.ts).

## Categories

The `lore_articles.category` column drives both filtering and which `lore_meta_*` table holds the secondary metadata. Current categories include:

```
generic, building, character, country, military, deity, geography,
item, organization, religion, species, vehicle, settlement, condition,
conflict, document, culture, language, material, formation, myth,
law, plot, profession, prose, title, spell, technology, tradition, session
```

Adding a new category means:
1. Add it to the editor's category enum.
2. If it needs structured metadata, create a new `lore_meta_<category>` table with `article_id` PK/FK.
3. Add the new metadata table to the auto-parse list in `d1.ts` if it stores JSON columns.

## Visibility model

Three layers of visibility, evaluated in order:

1. **Status.** `lore_articles.status` is `draft` or `published`. Drafts are staff-only.
2. **Eras.** If `lore_article_eras` has rows for an article, the article is only visible in those eras. Otherwise it's universal.
3. **Campaigns.** Same as eras for `lore_article_campaigns`. Used to scope an article to a specific campaign.

Secrets layer on top of articles. A secret is visible to a player only if `lore_secret_campaigns` includes the user's `active_campaign_id`. Staff always see all secrets.

DM notes (a single `dm_notes` column on `lore_articles`) are staff-only — never returned to player clients.

## Editor (`LoreArticleDesigner.tsx`)

The block-based article designer (the classic tabbed `LoreEditor` was retired): a fullscreen layout editor (`LayoutEditor` / `LayoutBlocks`) for the body, plus a settings side-panel for everything else.

- **Category metadata**: `TemplateFields` renders category-specific metadata sub-forms (character/deity, location, organisation/religion) into the `metadata` map — the same `lore_meta_*`-backed fields the classic editor had. Parent / era / tag pickers load via `fetchCollection`.
- **Content**: authored as layout blocks; text blocks use BBCode via `MarkdownEditor` (TipTap visual + raw source toggle). See [../ui/bbcode.md](../ui/bbcode.md). Blocks persist to `lore_article_blocks`; a plain BBCode mirror is derived into `lore_articles.content` for search / excerpts / mention extraction.
- **Images**: the **Article Header** (default), **Wiki Card**, and **Hover Preview** windows are authored with the shared `ImageSetEditor` — each a focal-positioned crop of the same artwork, individually overridable. Picking / uploading uses the image manager scoped to the **System Images** library (see [image-manager.md](image-manager.md)); URLs land in `image_url` / `card_image_url` / `preview_image_url`.
- **Display config**: each image slot has a JSON column (`image_display`, `card_display`, `preview_display`) for focal-point and scale overrides.
- **Tags**: writes to `lore_article_tags` junction.
- **Era / campaign visibility**: writes to `lore_article_eras` / `lore_article_campaigns`.
- **Secrets**: authored as self-contained **secret blocks** in the layout (per-campaign reveal); the server strips them for viewers without access. Existing `lore_secrets` rows lazy-migrate to secret blocks when an article is re-saved.

## Reader (`LoreArticle.tsx`)

- **Filtering** happens server-side (the SQL `WHERE` excludes non-visible articles). Client-side, the page just renders.
- **Recursive content rendering** — articles can contain section/quote/inset/table blocks (see [../ui/content-rendering.md](../ui/content-rendering.md)).
- **Cross-references** in `lore_links` render as inline links to other articles.
- **DM banner**: staff see a small bar with edit / view-as-player / DM-notes toggles.

## Map (`Map.tsx`)

A geographic surface for placing markers that link back to lore articles. Backed by relational tables added in [`worker/migrations/0017_map_markers.sql`](../../worker/migrations/0017_map_markers.sql):

- `maps` — era-scoped map images, with optional `parent_marker_id` / `parent_highlight_id` for submap navigation.
- `map_markers` — pin entities; each can reference an `article_id` (SET NULL on article delete).
- `map_highlights` — region overlays with the same article-link convention.

Click-through opens the linked article.

## Image references and deletion

When deleting an image from the Image Manager, `scanForReferences(url)` queries `lore_articles` (and other tables) for any column that references the URL. The user is shown the list before deletion confirms. See [image-manager.md](image-manager.md).

## Common tasks

### Add a new article category
1. Update the `CATEGORIES` list in `LoreArticleDesigner.tsx` (and its `TemplateFields` if it needs structured metadata).
2. If structured metadata is needed, add `lore_meta_<category>` schema migration.
3. Update the metadata-rendering switch in `LoreArticle.tsx`.
4. Add the new category to the filter UI in `Wiki.tsx`.

### Make a secret visible to a campaign
Add a **secret block** in the designer and set its revealed campaigns; the reader shows it only when the viewer's `active_campaign_id` matches (staff always see secrets).

## Related docs

- [../database/structure/lore_articles.md](../database/structure/lore_articles.md), [../database/structure/lore_meta_characters.md](../database/structure/lore_meta_characters.md)
- [../ui/bbcode.md](../ui/bbcode.md) — rich-text storage format
- [../ui/content-rendering.md](../ui/content-rendering.md) — recursive entry types
- [image-manager.md](image-manager.md) — image upload flow used by hero/card/preview slots
- [campaigns-eras.md](campaigns-eras.md) — visibility scopes
- [admin-users.md](admin-users.md) — RBAC for lore editing
