# Table Structure: `users`

Primary identity and RBAC table. Maps Firebase authentication identities to internal
Dauligor profiles.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID / `uid` | Matches Firebase UID. |
| `username` | TEXT UNIQUE NOT NULL | `username` | Lowercase handle. |
| `display_name` | TEXT | `displayName` | |
| `role` | TEXT NOT NULL | `role` | See roles below. |
| `avatar_url` | TEXT | `avatarUrl` | R2 URL. |
| `bio` | TEXT | `bio` | |
| `pronouns` | TEXT | `pronouns` | |
| `theme` | TEXT DEFAULT `'parchment'` | `theme` | `parchment`, `light`, `dark`. |
| `accent_color` | TEXT | `accentColor` | Hex string e.g. `#c5a059`. |
| `hide_username` | INTEGER DEFAULT 0 | `hideUsername` | Boolean (0/1). |
| `is_private` | INTEGER DEFAULT 0 | `isPrivate` | Boolean (0/1). |
| `recovery_email` | TEXT | `recoveryEmail` | Optional, not publicly exposed. |
| `active_campaign_id` | TEXT | `activeCampaignId` | Last-selected campaign. No FK — avoids circular dependency with `campaigns`. |
| `created_at` | TEXT | `createdAt` | ISO 8601 string. |
| `updated_at` | TEXT | — | Set on write. |

## Roles
`admin` · `co-dm` · `lore-writer` · `trusted-player` · `user`

## Implementation Notes
- **Authentication**: Firebase handles the JWT layer. `users` is the authoritative source for RBAC and profile configuration.
- **`active_campaign_id`**: Stored as plain TEXT with no FK constraint to avoid a circular dependency (`users` → `campaigns` → `users` via `dm_id`). Validity is enforced at the application layer.
- **`campaignIds` (Firestore array)**: This field does not become a column. It is used during migration to synthesize rows in `campaign_members`.
- **Sensitive fields**: `recovery_email` is migrated but never returned in public-facing API responses.
