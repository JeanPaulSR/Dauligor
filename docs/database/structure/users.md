# Table Structure: `users`

Primary identity and RBAC table. Maps Firebase Authentication identities (the JWT issuer) to internal Dauligor profiles.

## Layout Specs

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | Matches Firebase UID. |
| `username` | TEXT UNIQUE NOT NULL | Lowercase handle. |
| `display_name` | TEXT | |
| `role` | TEXT NOT NULL | See roles below. |
| `avatar_url` | TEXT | R2 URL. |
| `bio` | TEXT | |
| `pronouns` | TEXT | |
| `theme` | TEXT DEFAULT `'parchment'` | `parchment`, `light`, `dark`. |
| `accent_color` | TEXT | Hex string e.g. `#c5a059`. |
| `hide_username` | INTEGER DEFAULT 0 | Boolean (0/1). |
| `is_private` | INTEGER DEFAULT 0 | Boolean (0/1). |
| `recovery_email` | TEXT | Optional, not publicly exposed. |
| `active_campaign_id` | TEXT | Last-selected campaign. No FK — avoids circular dependency with `campaigns`. |
| `created_at` | TEXT | ISO 8601 string. |
| `updated_at` | TEXT | Set on write. |

## Roles
`admin` · `co-dm` · `lore-writer` · `trusted-player` · `user`

## Implementation Notes
- **Authentication**: Firebase handles the JWT layer. `users` is the authoritative source for RBAC and profile configuration.
- **`active_campaign_id`**: Stored as plain TEXT with no FK constraint to avoid a circular dependency (`users` → `campaigns` → `users` via `dm_id`). Validity is enforced at the application layer.
- **Campaign membership**: Lives in the `campaign_members` junction table — not on the `users` row.
- **Sensitive fields**: `recovery_email` is stripped from every API response except the ones explicitly serving it — `GET /api/me` returns it to the user themselves; `GET /api/admin/users` returns it only when the caller's role is `admin` (wiki-staff lists get the basic column set without it); `GET /api/profiles/[username]` never returns it. The generic `/api/d1/query` proxy refuses any `SELECT … FROM users` with a 403 pointing at the per-route endpoints, so the promise above is unforgeable from devtools — see [../../platform/security-gates.md](../../platform/security-gates.md).
- **No `mustChangePassword` column**: the temp-password recovery flow ([api/admin/users/[id]/[action].ts](../../api/admin/users/[id]/[action].ts)) doesn't write any "force change on next login" flag. Firebase Auth owns the password lifecycle; if a forced-change behavior is desired, it'd need a new column here plus a redirect gate in `App.tsx`.
