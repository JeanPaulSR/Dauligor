# Admin: Users

Admin-only user management. The only way to create accounts (registration is disabled by design).

## Page

| Route | File |
|---|---|
| `/admin/users` | [src/pages/admin/AdminUsers.tsx](../../src/pages/admin/AdminUsers.tsx) |

## What this panel does

| Action | Server endpoint | Notes |
|---|---|---|
| List users | `GET /api/admin/users` | Column-scoped by viewer role: admin sees `recovery_email` and the full row; co-dm / lore-writer see the basic identity columns only. Each row pre-joined with `campaign_ids: string[]` from `campaign_members`. |
| Create user | `POST /api/admin/users` | Admin only. Server provisions the Firebase Auth record via `adminAuth.createUser` and inserts the D1 row atomically. Body: `{ username, display_name, role, recovery_email? }`. |
| Edit user / promote / demote | `PATCH /api/admin/users/[id]` | Admin only. Allow-listed columns including `role` and a `campaign_ids: string[]` field the server reconciles by diffing against current `campaign_members`. Username changes push through `adminAuth.updateUser` to keep the auth email in sync. |
| Delete user | `DELETE /api/admin/users/[id]` | Admin only. Removes both the Firebase Auth record and the D1 row. FK cascade clears `campaign_members`; `characters.user_id` rows are left as orphans (separate cleanup). |
| Generate temporary password | `POST /api/admin/users/[id]/temporary-password` | **Destructive** — overwrites the target's Firebase Auth password with a random 14-char value and returns it once. The user's previous password no longer works. |
| Generate sign-in link | `POST /api/admin/users/[id]/sign-in-token` | **Non-destructive** — mints a 1-hour Firebase custom token. Admin shares a `https://<origin>/auth/redeem?token=…` URL; the SPA exchanges it via `signInWithCustomToken` and the user's existing password keeps working. |

All of these live in a single catch-all dispatcher at [api/admin/users.ts](../../api/admin/users.ts), routed via the `functions/api/admin/users/[[path]].ts` Pages Function shim — Pages's filesystem-based catch-all (`[[path]]`) matches every sub-path under `/api/admin/users/` and the dispatcher parses `req.url` to route internally. The proxy refuses raw `SELECT … FROM users` and raw mutations against `users`, so every legitimate read/write flows through this dispatcher (own-row access goes through `/api/me` instead).

## RBAC

Every action here goes through `requireAdminAccess` on the server. The hardcoded staff emails can also act as admin without a corresponding D1 role — see [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md).

## User identity model

Two-layer mapping:
- **Username** — what the user types (`cleric_dan`)
- **Email** — what Firebase Auth stores (`cleric_dan@archive.internal`)

Conversion happens via `usernameToEmail` in [src/lib/firebase.ts](../../src/lib/firebase.ts). All login flows route through this — there is no path for users to enter a real email.

The email is essentially derived from the username; renaming the username updates the Firebase Auth email too. Recovery email (`users.recovery_email`) is the separate, real-email field used for password resets.

## Create-user flow

1. Admin enters username, display name, role, and an initial password.
2. Client uses a secondary Firebase app instance (so the admin doesn't get logged out) to call `createUserWithEmailAndPassword(usernameToEmail(username), password)`.
3. Client writes the `users` row to D1 with the same UID.
4. Admin shares the initial password with the user out-of-band (Discord, in person, etc.).

There is **no `mustChangePassword` enforcement** — the D1 `users` schema has no such column, and the SPA does not force a password change on first login. If you want that behavior, it's a follow-up: add the column, add the redirect in `App.tsx`. Until then, encourage the user to change their password via `/profile/settings` once signed in.

## Recovery flows

Two flows live side by side on `/admin/users`, exposed as two buttons per user row. Both require `requireAdminAccess` on the server.

### Sign-in link (non-destructive — prefer this)

1. Admin clicks **"Sign-in Link"** on the user's row.
2. Server endpoint mints a Firebase custom token via `auth.createCustomToken(uid)` (1-hour TTL).
3. The dialog shows a copy-pastable `https://<origin>/auth/redeem?token=…` URL plus the precise expiry time.
4. Admin sends the URL to the user out-of-band.
5. User opens the URL → [`RedeemTokenPage.tsx`](../../src/pages/auth/RedeemTokenPage.tsx) calls `signInWithCustomToken(auth, token)` → they land signed in. Their stored password is untouched.

This is the preferred recovery path because it doesn't invalidate a password the user might still know.

### Temporary password (destructive)

1. Admin clicks **"Temp Password"** on the user's row.
2. Server generates a random 14-char password and calls `auth.updateUser(uid, { password })` via the Firebase Admin SDK. The user's existing password stops working immediately.
3. The dialog shows the new password once.
4. Admin shares; user signs in with it, then optionally changes it.

Use this only when you genuinely want to invalidate the existing credential (compromised account, etc.) or when the user can't follow a sign-in link.

### Firebase email reset

`sendPasswordResetEmail` is also available client-side but only works if `users.recovery_email` is populated with a real address. The two recovery flows above work regardless.

## Auto-promotion rules

`GET /api/me` runs auto-promotion on every profile load (the logic moved server-side as part of the per-route endpoint migration so the client can't dictate roles):
- Username `admin` → `users.role = admin` in D1.
- Username `gm` → `users.role = admin`.
- Hardcoded staff emails (`luapnaej101@gmail.com`, `admin@archive.internal`, `gm@archive.internal`) → `users.role = admin`.

These are bootstrap promotions — you can always sign in as one of these and recover admin access if the D1 `users` table is wiped. The same endpoint also auto-creates the `users` row on first sign-in and auto-picks the first `campaign_members` row as `active_campaign_id` if it's null.

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

D1 does **not** track temp-password issuance — the columns `temporary_password_generated_at` / `temporary_password_generated_by` don't exist. The temp-password lifecycle is owned entirely by Firebase Auth (which logs the password update internally but doesn't surface it in our D1). If you need an audit trail, check the Firebase Auth console's user activity, or add a `password_reset_log` table and write to it from the server endpoint.

## Related docs

- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions, server-side helpers
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — JWT layer, hardcoded staff
- [campaigns-eras.md](campaigns-eras.md) — per-campaign roles (separate from app role)
- [../database/structure/users.md](../database/structure/users.md) — full schema
