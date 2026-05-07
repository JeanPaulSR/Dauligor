# Admin: Users

Admin-only user management. The only way to create accounts (registration is disabled by design).

## Page

| Route | File |
|---|---|
| `/admin/users` | [src/pages/admin/AdminUsers.tsx](../../src/pages/admin/AdminUsers.tsx) |

## What this panel does

| Action | Server endpoint | Notes |
|---|---|---|
| Create user | Creates Firebase Auth record + `users` row in D1 | Username + display name + initial role |
| Edit user | Updates the D1 `users` row | No role-change UI exposed for self-edits |
| Promote / demote | Updates `users.role` | Admin only |
| Generate temporary password | `POST /api/admin/users/:id/temporary-password` | Sets a random password on Firebase Auth, marks `mustChangePassword=true` on the D1 row |
| Delete user | Removes Firebase Auth record + `users` row | Cascades aren't automatic on delete; cleanup of `characters`, `campaign_members`, etc. requires a sweep |

Source: [api/admin/spells/...](../../api/admin/) and the temp-password handler in [server.ts](../../server.ts) (still also wired through Vercel functions).

## RBAC

Every action here goes through `requireAdminAccess` on the server. The hardcoded staff emails can also act as admin without a corresponding D1 role — see [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md).

## User identity model

Two-layer mapping:
- **Username** — what the user types (`cleric_dan`)
- **Email** — what Firebase Auth stores (`cleric_dan@archive.internal`)

Conversion happens via `usernameToEmail` in [src/lib/firebase.ts](../../src/lib/firebase.ts). All login flows route through this — there is no path for users to enter a real email.

The email is essentially derived from the username; renaming the username updates the Firebase Auth email too. Recovery email (`users.recovery_email`) is the separate, real-email field used for password resets.

## Create-user flow

1. Admin enters username, display name, role.
2. Server generates a temporary password.
3. Server creates Firebase Auth record with `usernameToEmail(username)` and the temp password.
4. Server upserts `users` row in D1 with the same UID.
5. Server returns the temp password to the admin (one-time view).
6. Admin shares the temp password with the user out-of-band.
7. User signs in with username + temp password; `users.mustChangePassword=true` forces a password change before continuing.

## Reset-password flow

Same as create, minus the user creation:
1. Admin clicks "Generate temporary password".
2. Server sets new password via Firebase Admin SDK.
3. Server returns it for one-time view.
4. Admin shares; user changes on next sign-in.

The Firebase `sendPasswordResetEmail` flow is also wired but only works if `users.recovery_email` is populated and points at a real address. The temp-password mechanism avoids that requirement.

## Auto-promotion rules

`App.tsx` runs auto-promotion on every sign-in:
- Username `admin` → `users.role = admin` in D1.
- Username `gm` → `users.role = admin`.
- Hardcoded staff emails (`luapnaej101@gmail.com`, `admin@archive.internal`, `gm@archive.internal`) → `users.role = admin`.

These are bootstrap promotions — you can always sign in as one of these and recover admin access if the D1 `users` table is wiped.

## Privacy fields

| Field | Effect |
|---|---|
| `users.hide_username` | Suppresses the handle in lore attributions, comments, etc. |
| `users.is_private` | Restricts profile page (`/profile/:uid`) to admins and self |
| `users.recovery_email` | Used only for password reset. Never returned in non-admin API responses. |

## Common gotchas

- **Renaming username** updates both the Firebase Auth email and the D1 `users` row. The user's existing JWT is invalidated by the email change — they're forced to sign in again.
- **Deleting a user without sweeping** leaves `characters.user_id`, `campaign_members.user_id`, `lore.author_id`, etc. pointing at a non-existent UID. Run cleanup queries when bulk-deleting.
- **Temporary password is shown once.** No record is kept server-side. If the admin loses the password before sharing, regenerate.

## Common tasks

### Create a new player
1. `/admin/users` → New User.
2. Enter username, display name, role `user`.
3. Copy the temp password and share with the player.

### Promote a player to lore-writer
1. `/admin/users` → find the user → edit → role `lore-writer` → save.
2. The user's existing JWT continues to claim `user` role until refresh; they should sign out and back in (or `getIdToken(true)`).

### Audit recent password resets
```sql
SELECT id, username, display_name, temporary_password_generated_at, temporary_password_generated_by
FROM users
WHERE temporary_password_generated_at > date('now', '-7 days')
ORDER BY temporary_password_generated_at DESC;
```

(Field names approximate — see [../database/structure/users.md](../database/structure/users.md) for canonical column names.)

## Related docs

- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions, server-side helpers
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — JWT layer, hardcoded staff
- [campaigns-eras.md](campaigns-eras.md) — per-campaign roles (separate from app role)
- [../database/structure/users.md](../database/structure/users.md) — full schema
