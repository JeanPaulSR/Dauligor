# Campaigns, Eras & Worlds

The three world-organization scopes, managed from one admin console. Lore visibility,
character context, page backdrops, and each user's "active" campaign all hang off these.

Scope hierarchy (broad → narrow): **World → Era → Campaign**. A campaign belongs to an era
(`campaigns.era_id`); eras and campaigns are not yet linked to a world by a column — per-entity
`world_id` scoping is a later phase, so today there is effectively one world (the seeded default).

## Management console

`/admin/campaigns`, `/admin/eras`, and `/admin/worlds` are **three tabs of one console**
([AdminCampaigns.tsx](../../src/pages/admin/AdminCampaigns.tsx)) — each tab is its own route, so
the whole console is reachable from any of the three paths with that tab active (the active tab is
a `tab` prop set by the matched route). The Worlds and Eras tabs render their list managers
embedded ([AdminWorlds.tsx](../../src/pages/admin/AdminWorlds.tsx),
[AdminEras.tsx](../../src/pages/admin/AdminEras.tsx)).

Each entity follows the same **list ↔ editor split** as campaigns: the tab is a sortable list;
editing one opens a dedicated full-page editor.

## Pages

| Route | File | Purpose | Access |
|---|---|---|---|
| `/admin/campaigns` | [AdminCampaigns.tsx](../../src/pages/admin/AdminCampaigns.tsx) | Console — Campaigns tab | Staff (admin / co-dm) |
| `/admin/eras` | AdminCampaigns (Eras tab → [AdminEras.tsx](../../src/pages/admin/AdminEras.tsx)) | Console — Eras tab | Staff view; admin create/edit/delete |
| `/admin/worlds` | AdminCampaigns (Worlds tab → [AdminWorlds.tsx](../../src/pages/admin/AdminWorlds.tsx)) | Console — Worlds tab | Admin |
| `/admin/eras/edit/:id` | [EraEditor.tsx](../../src/pages/admin/EraEditor.tsx) | Era detail editor (`:id = new` creates) | Admin |
| `/admin/worlds/edit/:id` | [WorldEditor.tsx](../../src/pages/admin/WorldEditor.tsx) | World detail editor (`:id = new` creates) | Admin |
| `/campaign/:id` | [CampaignManager.tsx](../../src/pages/campaign/CampaignManager.tsx) | Campaign detail (member or staff) | Member / staff |
| `/campaign/edit/:id` | [CampaignEditor.tsx](../../src/pages/campaign/CampaignEditor.tsx) | Campaign authoring | Staff |
| `/campaign/edit/:id/homepage` | [CampaignHomeEditorPage.tsx](../../src/pages/campaign/CampaignHomeEditorPage.tsx) | Per-campaign homepage layout builder | Staff |

The standalone worlds page also still exists as `/admin/worlds` (it *is* a console tab) — there
is no separate non-tabbed worlds page.

## Tables (D1)

| Table | Key columns |
|---|---|
| `worlds` | `id`, `name`, `slug` (unique), `description`, `owner_user_id` (FK users), `is_default` (0/1, partial-unique), `sort_order`, `background_image_url` |
| `eras` | `id`, `name`, `order`, `description`, `background_image_url` |
| `campaigns` | `id`, `name`, `slug`, `description`, `dm_id` (FK users), `era_id` (FK eras), `image_url` (+ `image_display`), `background_image_url`, `recommended_lore_id`, `settings` (JSON) |
| `campaign_members` | `(campaign_id, user_id)` PK; `role` ∈ `dm`, `co-dm`, `player`; `joined_at` |

Plus user-side: `users.active_campaign_id` records each user's last-selected campaign.

`worlds.background_image_url` was added by `worker/migrations/20260604-1200_worlds_background_image.sql`
(`ALTER TABLE … ADD COLUMN` — apply once per DB; the migration also carries the legacy global
default forward, see the cascade section below).

> `campaigns` also has unused `card_image_url` / `preview_image_url` / `*_display` columns left over
> from a copy of the class image pattern; no surface reads them and the editor no longer writes them.

Per-table schemas: [worlds.md](../database/structure/worlds.md), [eras.md](../database/structure/eras.md),
[campaigns.md](../database/structure/campaigns.md). Identity-phase migration history:
[phase-2-identity.md](../_archive/migration-details/phase-2-identity.md).

## Worlds

The top-level scope dimension for compendium content (admin-only). The default world
(**Dauligor**, `is_default = 1`, seeded by migration) holds every shared/global entity and cannot
be deleted; its slug powers public catalog URLs. Additional worlds will host user-owned content as
scope-aware roles roll out. Per-entity `world_id` columns and scope enforcement are a later phase —
today worlds are foundation + the bottom of the background cascade.

CRUD is served by `/api/admin/worlds/*` ([functions/api/admin/worlds/[[path]].ts](../../functions/api/admin/worlds/[[path]].ts)),
admin-only. The world editor sets name, slug, owner, sort order, description, and the world
background.

## Eras

Eras are the world-timeline buckets with a numeric `order` for sorting (think "Age of Mortals" vs
"Age of Dreams"). The era assigned to a campaign drives:
- Default era filter in the wiki
- Era-bound lore visibility (via `lore_article_eras`)
- The era step of the background cascade (`era.background_image_url`)

CRUD writes go through `/api/admin/eras/*` ([functions/api/admin/eras/[[path]].ts](../../functions/api/admin/eras/[[path]].ts),
admin-only); reads use the generic d1 proxy. Editing is on the dedicated era editor page.

## Campaigns

A campaign is a container scoping:
- Membership (`campaign_members`)
- Lore visibility (via `lore_article_campaigns` and `lore_secret_campaigns`)
- Character ownership (`characters.campaign_id`)
- An "active" view per user (`users.active_campaign_id`)

### Roles within a campaign
A user can be `dm`, `co-dm`, or `player` of a specific campaign — orthogonal to their global app role:
- A global `user` can be `dm` of one campaign and `player` of another.
- A global `co-dm` (app role) can DM their own campaigns.
- A global `admin` can administrate any campaign regardless of `campaign_members`.

The DM is the user listed as `campaigns.dm_id`; campaign-level co-DMs come from `campaign_members.role = 'co-dm'`.

### Campaign membership migration
Original Firestore had `users.campaignIds` arrays. During migration, those arrays were synthesised
into `campaign_members` rows along with the campaign's `dmId` field. Going forward, the junction is
canonical.

## Active campaign

Each user has `users.active_campaign_id`. This drives:
- **Lore visibility filter** — secrets visible only when their `lore_secret_campaigns` includes the active campaign
- **Map markers** scoped to the active campaign
- **Character list filter** — defaults to characters in the active campaign

The Navbar's campaign switcher updates `users.active_campaign_id`. The user's allowed campaigns are
derived from `campaign_members` (plus DM ownership for the campaigns they DM).

`active_campaign_id` is plain TEXT with no FK constraint — see [users.md](../database/structure/users.md)
for the rationale (avoids a circular FK with campaigns → users).

## Background image cascade

The faint full-bleed backdrop behind **wiki/lore pages** resolves through a three-level cascade,
most specific first:

```
campaign.background_image_url  →  era.background_image_url  →  world.background_image_url  →  built-in fallback
```

It's resolved in [LoreArticle.tsx](../../src/pages/wiki/LoreArticle.tsx): the viewer's active
campaign (or a staff "preview campaign") supplies the campaign; its `era_id` supplies the era; the
default world supplies the world. Because campaigns/eras have no `world_id` yet, the "world" step is
the default world for everyone — when per-entity world scoping lands, this becomes the campaign's
own world.

This replaced the old global wiki fallback (`system_metadata.wiki_settings.defaultBackgroundImageUrl`).
That value was migrated onto the default world's `background_image_url`; the wiki-settings write path
and its admin control were removed.

> **Note:** a campaign's own page (`/campaign/:id`) uses `campaigns.image_url` for its header
> (framed avatar + blurred hero), *not* `background_image_url`. The background image is the wiki
> backdrop for the campaign's members — see the editor's "Wiki Background" field.

## Campaign editor (`CampaignEditor`)

Info tab fields:
- Name, slug, description (BBCode), era (dropdown), recommended lore article ("start here" context)
- Player assignment (writes `campaign_members`)
- **Imagery** — two side-by-side fields, each using the shared `FocalImageField` (see [image-manager.md](image-manager.md)):
  - **Campaign Image** (`image_url` + `image_display`) — the campaign-page header; positionable (drag to pan, scroll to zoom).
  - **Wiki Background** (`background_image_url`) — the campaign step of the cascade; a wide static backdrop preview.

A separate **Homepage** tab routes to the fullscreen campaign homepage builder
([CampaignHomeEditor.tsx](../../src/components/campaign/CampaignHomeEditor.tsx)).

Saves recompute the `campaigns` row + reconcile `campaign_members` via the per-route member endpoints.

## Manager (`CampaignManager`)

For members and staff of a campaign: campaign info hero (`image_url`), linked articles, and tabbed
placeholders for characters / maps / sessions / notes / timeline.

## Common tasks

### Create a campaign
`/admin/campaigns` → New Campaign (name, description, optional era) → then open its editor to set
imagery, players, and recommended lore.

### Add or edit an era
`/admin/eras` → New Era (admin), or click a row → era editor (name, order, description, background).

### Add or edit a world
`/admin/worlds` → New World (admin), or click a row → world editor. The default world can be
renamed/edited but not deleted.

### Set the wiki backdrop for a scope
Set `background_image_url` on the world (global default), an era, or a campaign — whichever level
you want it to apply to. More specific wins.

### Switch the active campaign
Click the campaign in the Navbar dropdown. Updates `users.active_campaign_id`.

### Promote a player to co-DM in one campaign
`CampaignManager` → member list → set role to `co-dm`. Writes `campaign_members`.

## Related docs

- [image-manager.md](image-manager.md) — the shared `FocalImageField` / `ImageUpload` / `IconPickerModal` image controls
- [admin-users.md](admin-users.md) — user creation (a campaign's DM must exist as a user first)
- [wiki-lore.md](wiki-lore.md) — era / campaign visibility for articles
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — global app roles vs per-campaign roles
- [../architecture/routing.md](../architecture/routing.md) — the tab-as-route console pattern
