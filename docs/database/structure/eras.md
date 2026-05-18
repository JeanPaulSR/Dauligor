# Table Structure: `eras`

World timeline containers. Campaigns are associated with a single era, which provides
a background image and narrative framing for the wiki and home page.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT NOT NULL | `name` | e.g., "Age of Magic". |
| `description` | TEXT | `description` | |
| `order` | INTEGER | `order` | UI sort order. |
| `background_image_url` | TEXT | `backgroundImageUrl` | R2 URL for wiki/home background. |
| `created_at` | TEXT | `createdAt` | ISO 8601 string. |
| `updated_at` | TEXT | — | Set on write. |

## Implementation Notes
- No FK dependencies — migrated before `campaigns`.
- `background_image_url` is optional; pages fall back to a global default from the `config` collection.

## Access
Reads are public-among-signed-in (eras are a world-facing taxonomy). Writes are admin-only — enforced both at the proxy gate (`PROTECTED_WRITE_TABLES` admits the table mutation, then routes through `requireAdminAccess`) and in the UI (AdminCampaigns hides the era CRUD for non-admin viewers so co-dm doesn't see buttons that 403). Audit priority #9 will eventually move era writes to dedicated `/api/admin/eras/*` per-route endpoints; until then the proxy gate is the enforcement boundary.
