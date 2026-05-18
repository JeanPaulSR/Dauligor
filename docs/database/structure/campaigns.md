# Table Structure: `campaigns` + `campaign_members`

Campaign containers and their membership junction table.

---

## Table: `campaigns`

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT NOT NULL | `name` | |
| `slug` | TEXT UNIQUE NOT NULL | — | Generated from `name` during migration (not in Firestore). |
| `description` | TEXT | `description` | |
| `dm_id` | TEXT (FK) | `dmId` | Links to `users.id`. |
| `era_id` | TEXT (FK) | `eraId` | Links to `eras.id`. Nullable. |
| `image_url` | TEXT | `imageUrl` | R2 URL for cover/background. Optional. |
| `recommended_lore_id` | TEXT | `recommendedLoreId` | Soft reference to `lore_articles.id` (Phase 3). No FK constraint. |
| `settings` | JSON | `settings` | Rules, visibility flags, and feature toggles. Optional. |
| `created_at` | TEXT | `createdAt` | ISO 8601 string. |
| `updated_at` | TEXT | — | Set on write. |

---

## Table: `campaign_members`

Junction table for the many-to-many relationship between users and campaigns.

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `campaign_id` | TEXT (FK) | Links to `campaigns.id`. |
| `user_id` | TEXT (FK) | Links to `users.id`. |
| `role` | TEXT NOT NULL | `dm`, `co-dm`, `player`. |
| `joined_at` | TEXT | ISO 8601 string. |

**Primary Key**: `(campaign_id, user_id)`

---

## Migration Notes

### Slug generation
`slug` does not exist in Firestore. During migration it is derived from `name`:
lowercase, spaces → hyphens, strip non-alphanumeric characters. Collisions get a
numeric suffix.

### `campaign_members` synthesis
No `campaign_members` collection exists in Firestore. Rows are built from two sources:
1. `campaigns.dmId` → one row per campaign with `role = 'dm'`.
2. `users.campaignIds` array → one row per entry with `role = 'player'`.

The DM row from source 1 takes precedence — if the DM's UID also appears in their own
`campaignIds`, the duplicate is skipped.

### `recommended_lore_id`
Stored as plain TEXT with no FK constraint because `lore_articles` is a Phase 3 table.
Referential integrity is enforced at the application layer.

## Access

All reads and writes flow through [`api/campaigns.ts`](../../../api/campaigns.ts) — see [the endpoint table in `api-endpoints.md`](../../platform/api-endpoints.md) for method-by-method gates. The generic `/api/d1/query` proxy refuses direct writes to `campaigns` and `campaign_members` (`CAMPAIGN_WRITE_PATTERN`) with a 403 pointing at the per-route endpoint, so a hostile client can't route around the role checks. lore-writer is admitted by the wiki-staff gate elsewhere but is 403'd here — campaign management is `isCharacterDM` (admin + co-dm) only. DELETE additionally re-checks for admin. Schema-side, `campaign_members` has FK ON DELETE CASCADE on both `campaign_id` and `user_id`, so a campaign or user delete sweeps the junction rows automatically.
