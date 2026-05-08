# Campaigns & Eras

Campaign containers and world-timeline eras. Lore visibility, character context, and per-user "active" campaign all hang off these.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/admin/campaigns` | [AdminCampaigns.tsx](../../src/pages/admin/AdminCampaigns.tsx) | Manage all campaigns + eras (admin) |
| `/campaigns/:id` | [CampaignManager.tsx](../../src/pages/campaign/CampaignManager.tsx) | Campaign detail (DM/Co-DM) |
| `/campaigns/edit/:id` | [CampaignEditor.tsx](../../src/pages/campaign/CampaignEditor.tsx) | Campaign authoring |

## Tables (D1)

| Table | Key columns |
|---|---|
| `eras` | `id`, `name`, `order`, `description`, `background_image_url` |
| `campaigns` | `id`, `name`, `slug`, `description`, `dm_id` (FK users), `era_id` (FK eras), `image_url`, `recommended_lore_id`, `settings` (JSON) |
| `campaign_members` | `(campaign_id, user_id)` PK; `role` ∈ `dm`, `co-dm`, `player`; `joined_at` |

Plus user-side: `users.active_campaign_id` records each user's last-selected campaign.

Schema: [../database/structure/eras.md](../database/structure/eras.md), [../database/structure/campaigns.md](../database/structure/campaigns.md), [../_archive/migration-details/phase-2-identity.md](../_archive/migration-details/phase-2-identity.md).

## Eras

Eras are the world-timeline buckets. Lore can be scoped to specific eras (think "Age of Mortals" vs "Age of Dreams"). Eras have a numeric `order` for sorting.

The era assigned to a campaign drives:
- Default era filter in the wiki
- Background image on the campaign view (`era.background_image_url`)
- Era-bound lore visibility (via `lore_article_eras`)

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
Original Firestore had `users.campaignIds` arrays. During migration, those arrays were synthesised into `campaign_members` rows along with the campaign's `dmId` field. Going forward, the junction is canonical.

## Active campaign

Each user has `users.active_campaign_id`. This drives:
- **Lore visibility filter** — secrets visible only when their `lore_secret_campaigns` includes the active campaign
- **Map markers** scoped to the active campaign
- **Character list filter** — defaults to characters in the active campaign

The Navbar's campaign switcher updates `users.active_campaign_id`. The user's allowed campaigns are derived from `campaign_members` (plus DM ownership for the campaigns they DM).

`active_campaign_id` is plain TEXT with no FK constraint — see [../database/structure/users.md](../database/structure/users.md) for the rationale (avoids circular FK with campaigns → users).

## Editor (`CampaignEditor`)

Fields:
- Name, slug
- Era (dropdown from `eras`)
- DM (dropdown from `users` with role staff or admin)
- Description (BBCode)
- Cover image (R2)
- Recommended lore article (foreign reference for "start here" context)
- Settings (JSON column for game-specific options)

Saves recompute `campaigns` row + `campaign_members` rows.

## Manager (`CampaignManager`)

For DMs and co-DMs of an active campaign:
- Lore feed filtered to the campaign
- Player roster (`campaign_members.role = 'player'`)
- Quick actions for revealing secrets, advancing era, etc.

## Admin panel (`AdminCampaigns`)

Admin-only. Lists all campaigns + all eras. Inline create / edit / delete. Same panel hosts era management.

This page also writes to `config/wiki_settings` (a Firestore document during migration) — flagged in [../database/README.md](../database/README.md) for designation of a D1 home.

## Common tasks

### Create a new campaign
1. `/admin/campaigns` → New Campaign.
2. Pick era and DM.
3. Add players via the member editor.

### Switch the active campaign
- Click the campaign in the Navbar dropdown. Updates `users.active_campaign_id`.

### Promote a player to co-DM in one campaign
- `CampaignManager` → member list → set role to `co-dm`. Writes to `campaign_members`.

### Add a new era
- `/admin/campaigns` → Eras tab → add. Set `order` to control list sequence.

## Related docs

- [admin-users.md](admin-users.md) — user creation (a campaign's DM must exist as a user first)
- [wiki-lore.md](wiki-lore.md) — era / campaign visibility for articles
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — global app roles vs per-campaign roles
- [../database/structure/eras.md](../database/structure/eras.md), [../database/structure/campaigns.md](../database/structure/campaigns.md)
