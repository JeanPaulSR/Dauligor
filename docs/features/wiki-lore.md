# Wiki & Lore

The world-building layer: hierarchical articles, DM secrets, NPC/location/organisation/deity metadata, and per-era / per-campaign visibility.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/wiki` | [src/pages/wiki/Wiki.tsx](../../src/pages/wiki/Wiki.tsx) | Article browser (grid + tree views) |
| `/wiki/article/:id` | [src/pages/wiki/LoreArticle.tsx](../../src/pages/wiki/LoreArticle.tsx) | Article reader |
| `/wiki/new`, `/wiki/edit/:id` | [src/pages/wiki/LoreEditor.tsx](../../src/pages/wiki/LoreEditor.tsx) | Article authoring (staff only) |
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

Full schema: [../database/structure/lore_articles.md](../database/structure/lore_articles.md), [../database/structure/lore_meta_characters.md](../database/structure/lore_meta_characters.md), and [../database/migration-details/phase-3-wiki.md](../database/migration-details/phase-3-wiki.md).

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

## Editor (`LoreEditor.tsx`)

- **Metadata mapping**: form fields render conditionally based on `category`. Pickers for parent article (`parent_id`) come from a `fetchCollection('lore_articles', null, { select: 'id, title' })` query.
- **Content**: BBCode via `MarkdownEditor` (TipTap visual + raw source toggle). See [../ui/bbcode.md](../ui/bbcode.md).
- **Images**: hero, card, preview slots. Each uses `ImageUpload` with a path like `images/lore/<articleId>/`. The upload writes to R2 via [src/lib/r2.ts](../../src/lib/r2.ts) and stores the URL in the relevant column (`image_url`, `card_image_url`, `preview_image_url`).
- **Display config**: each image slot has a JSON column (`image_display`, `card_display`, `preview_display`) for focal-point and scale overrides.
- **Tags**: writes to `lore_article_tags` junction.
- **Era / campaign visibility**: writes to `lore_article_eras` / `lore_article_campaigns`.
- **Secrets**: managed in a dedicated panel within the editor; CRUD on `lore_secrets` and the secret junction tables.

## Reader (`LoreArticle.tsx`)

- **Filtering** happens server-side (the SQL `WHERE` excludes non-visible articles). Client-side, the page just renders.
- **Recursive content rendering** — articles can contain section/quote/inset/table blocks (see [../ui/content-rendering.md](../ui/content-rendering.md)).
- **Cross-references** in `lore_links` render as inline links to other articles.
- **DM banner**: staff see a small bar with edit / view-as-player / DM-notes toggles.

## Map (`Map.tsx`)

A geographic surface for placing markers that link back to lore articles. Currently a thin layer:
- Markers are rows in `lore` (legacy collection name during migration); each marker references an `articleId`.
- Click-through opens the linked article.

This page is in the punchlist for Firestore-cut — it still uses direct `onSnapshot` on the legacy `lore` collection. Switch to `lore_articles` via D1.

## Image references and deletion

When deleting an image from the Image Manager, `scanForReferences(url)` queries `lore_articles` (and other tables) for any column that references the URL. The user is shown the list before deletion confirms. See [image-manager.md](image-manager.md).

## Common tasks

### Add a new article category
1. Update the category enum in `LoreEditor.tsx`.
2. If structured metadata is needed, add `lore_meta_<category>` schema migration.
3. Update the metadata-rendering switch in `LoreArticle.tsx`.
4. Add the new category to the filter UI in `Wiki.tsx`.

### Make a secret visible to a campaign
The secret editor in `LoreEditor.tsx` writes to `lore_secret_campaigns`. The reader query joins on `active_campaign_id`.

### Migrate the Map page off Firestore
- Replace `onSnapshot(query(collection(db, 'lore'), …))` with a polling D1 query, or move markers into `lore_articles` directly with a `category='map-marker'` style field.

## Related docs

- [../database/structure/lore_articles.md](../database/structure/lore_articles.md), [../database/structure/lore_meta_characters.md](../database/structure/lore_meta_characters.md), [../database/migration-details/phase-3-wiki.md](../database/migration-details/phase-3-wiki.md)
- [../ui/bbcode.md](../ui/bbcode.md) — rich-text storage format
- [../ui/content-rendering.md](../ui/content-rendering.md) — recursive entry types
- [image-manager.md](image-manager.md) — image upload flow used by hero/card/preview slots
- [campaigns-eras.md](campaigns-eras.md) — visibility scopes
- [admin-users.md](admin-users.md) — RBAC for lore editing
