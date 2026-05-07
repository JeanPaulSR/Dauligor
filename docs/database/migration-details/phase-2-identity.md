# Phase 2 Migration Details: Identity & Social

## Table Definitions

### 1. Eras
- **Table**: `eras`
- **Primary Key**: `id` (TEXT)
- **Columns**: `name`, `description`, `"order"` (INTEGER), `background_image_url`, `created_at`, `updated_at`.

### 2. Users
- **Table**: `users`
- **Primary Key**: `id` (TEXT)
- **Columns**: `username` (UNIQUE), `display_name`, `role` (Enum: admin, co-dm, lore-writer, trusted-player, user), `avatar_url`, `bio`, `pronouns`, `theme` (Enum: parchment, light, dark), `accent_color`, `hide_username` (BOOLEAN), `is_private` (BOOLEAN), `recovery_email`, `active_campaign_id` (TEXT), `created_at`, `updated_at`.
- **Indices**: `idx_users_role` (role), `idx_users_username` (username).

### 3. Campaigns
- **Table**: `campaigns`
- **Primary Key**: `id` (TEXT)
- **Columns**: `name`, `slug` (UNIQUE), `description`, `dm_id` (FK: `users.id`), `era_id` (FK: `eras.id`), `image_url`, `recommended_lore_id`, `settings` (JSON), `created_at`, `updated_at`.
- **Indices**: `idx_campaigns_dm_id` (dm_id), `idx_campaigns_era_id` (era_id).

### 4. Campaign Members
- **Table**: `campaign_members`
- **Primary Key**: `(campaign_id, user_id)`
- **Columns**: `campaign_id` (FK: `campaigns.id`), `user_id` (FK: `users.id`), `role` (Enum: dm, co-dm, player), `joined_at`.
- **Indices**: `idx_campaign_members_user_id` (user_id).
- **Note**: Rows synthesized from Firestore `campaignIds` arrays and campaign `dmId` fields during migration.
