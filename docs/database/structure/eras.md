# Table Structure: `eras`

World timeline containers. Campaigns are associated with a single era, which provides
a background image and narrative framing for the wiki and home page.

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Age of Magic". |
| `description` | TEXT | |
| `order` | INTEGER | UI sort order. |
| `background_image_url` | TEXT | R2 URL for wiki/home background. |
| `created_at` | TEXT | ISO 8601 string. |
| `updated_at` | TEXT | Set on write. |

## Implementation Notes
- No FK dependencies — campaigns reference eras, not vice-versa.
- `background_image_url` is optional; pages fall back to a global default.

## Access
Reads are public-among-signed-in (eras are a world-facing taxonomy) and still flow through `fetchCollection('eras', …)` on the generic proxy. Writes go through `POST` / `PATCH` / `DELETE /api/admin/eras[/id]` — admin-only, folded into `api/campaigns.ts` (the dispatcher sniffs the `/api/admin/eras` URL prefix). The proxy retains `eras` in `PROTECTED_WRITE_TABLES` as a defense-in-depth backstop, so any direct write that escapes the per-route path still gets admin-gated at the proxy. See [../../platform/api-endpoints.md](../../platform/api-endpoints.md) for the route table.
