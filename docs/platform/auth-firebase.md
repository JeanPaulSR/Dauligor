# Firebase Authentication (the part of Firebase that's staying)

After the Firestore-to-D1 migration, **Firebase Authentication remains the JWT layer**. Firestore and Firebase Storage are being decommissioned. This doc explains what stays, why, and the full auth flow end-to-end.

## What's kept vs. what's going

| Service | Status | Why |
|---|---|---|
| Firebase Authentication | **Kept** | Solid JWT issuer; integrates with the existing Admin SDK on the proxy; user accounts already exist |
| Firestore | Being decommissioned | Replaced by Cloudflare D1 |
| Firebase Storage | Decommissioned | Replaced by Cloudflare R2 |
| `firebase-admin` SDK on the proxy | **Kept** | Verifies the JWT and reads RBAC role from D1 `users` |
| Firestore security rules | Going | Replaced by per-route RBAC checks in `api/_lib/firebase-admin.ts` |

## Pseudo-username identity layer

Firebase Authentication uses email addresses as principals. The Archive maps user-facing handles to an internal email domain.

```ts
// src/lib/firebase.ts
export const usernameToEmail = (username: string) =>
  `${username.toLowerCase().trim()}@archive.internal`;
```

A user types `cleric_dan` → the app calls `signInWithEmailAndPassword(auth, "cleric_dan@archive.internal", password)`.

This means:
- Real email addresses are never used for login. PII stays out of the auth layer.
- Recovery flows use the optional `recovery_email` field on the D1 `users` row.
- Display names (`display_name`) are independent from the login handle.

## Bootstrap accounts

Three email addresses are hardcoded as administrative principals in the proxy:

```
luapnaej101@gmail.com         (project owner — uses real Google account)
admin@archive.internal        (default admin handle)
gm@archive.internal           (default GM handle)
```

These addresses bypass the role lookup and are always treated as `admin` on the server. The list is in `HARDCODED_STAFF_EMAILS` in:
- [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts)
- [server.ts](../../server.ts)

The list must stay in sync between those files. `firestore.rules` (legacy, going away) also has the same list.

## End-to-end auth flow

### 1. Sign-in
1. User enters username + password.
2. `usernameToEmail` converts the handle to `<handle>@archive.internal`.
3. `signInWithEmailAndPassword` issues a Firebase ID token.
4. `onAuthStateChanged` in `App.tsx` triggers a profile refresh.

There's also a non-password sign-in path via Firebase **custom tokens**: an admin can mint a one-hour token through `POST /api/admin/users/[id]/sign-in-token`, share the resulting `/auth/redeem?token=…` URL, and [`RedeemTokenPage.tsx`](../../src/pages/auth/RedeemTokenPage.tsx) calls `signInWithCustomToken(auth, token)`. See [admin-users.md](../features/admin-users.md#sign-in-link-non-destructive--prefer-this).

### 2. Profile load
1. `App.tsx` calls `GET /api/me` with the Bearer token.
2. The server-side handler ([`api/me.ts`](../../api/me.ts)) does all of:
   - Look up the `users` row by uid.
   - If missing, insert one with bootstrap defaults (auto-create on first sign-in).
   - If the caller is one of the hardcoded admin emails or signed in as `admin` / `gm`, force `role = admin` (auto-promote). The client never gets to suggest a role.
   - If `active_campaign_id` is null and the user has at least one `campaign_members` row, pin the first one as the active campaign.
3. The endpoint returns the (post-write) row as `{ profile }`. `App.tsx` stores it and computes `effectiveProfile` for the rest of the UI.

This whole sequence used to live on the client (with `fetchDocument('users', uid)` + conditional `upsertDocument('users', uid, {...})`). Moving it server-side closes the H6 risk where a coerced client could spread `{ ..., role: 'admin' }` into the upsert.

### 3. Authorised request to D1 / R2
1. Browser fetches an ID token: `await auth.currentUser.getIdToken()`.
2. Adds `Authorization: Bearer <id-token>` to the request.
3. Proxy verifies the token via `firebase-admin` (`auth.verifyIdToken`).
4. Proxy checks the user's role against the route's required role. Which helper fires depends on the endpoint — see the helpers table below.
5. Proxy forwards to the Worker with the shared `R2_API_SECRET`.

The generic `/api/d1/query` proxy has a split gate: writes / DDL go through `requireStaffAccess`, reads go through `requireAuthenticatedUser`. Per-route endpoints (`/api/me`, `/api/characters/[id]`, `/api/lore`, `/api/campaigns`, `/api/profiles/[username]`, `/api/admin/characters`, `/api/admin/users/[id]/[action]`, etc.) each enforce their own role + ownership rules. See [api-endpoints.md](api-endpoints.md) for the per-route surface.

### 4. Sign-out
1. `signOut(auth)` clears the local Firebase session.
2. `onAuthStateChanged` fires with `null`; `App.tsx` clears `userProfile`.
3. All cached D1 data is cleared via `clearCache()` in `d1.ts`.

## Server-side helpers

All in [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts):

| Helper | Allows |
|---|---|
| `requireAuthenticatedUser(authHeader)` | Any signed-in user with any role (the broadest gate; used for own-data reads) |
| `requireStaffAccess(authHeader)` | `admin`, `co-dm`, `lore-writer` (or hardcoded staff) |
| `requireImageManagerAccess(authHeader)` | Same set as `requireStaffAccess` |
| `requireAdminAccess(authHeader)` | `admin` only (or hardcoded staff) |
| `requireCharacterAccess(authHeader, characterId)` | Either the character's owner OR a character-DM role. Throws 404 (not 403) when the row doesn't exist OR the caller isn't allowed — same shape on purpose so probes can't enumerate ids. |
| `isCharacterDM(role)` | Predicate: `admin` or `co-dm` (deliberately NOT `lore-writer` — that role is for wiki content, not character management) |
| `isWikiStaff(role)` | Predicate: `admin`, `co-dm`, or `lore-writer` (broader than the character set because `lore-writer` exists to author wiki content and needs draft + dm_notes visibility) |

Each `require*` helper:
1. Validates the `Bearer <token>` header is present.
2. Verifies the token via `firebase-admin`.
3. Reads the user's role from the D1 `users` table.
4. Throws `HttpError(401|403|404, message)` on failure.
5. Returns `{ decoded, role }` (or richer for `requireCharacterAccess`) on success.

There's also a fallback path that parses the JWT signaturelessly when Firebase Admin credentials aren't configured — used only for local dev when no service account is loaded. It logs a warning and grants admin to make development possible without secrets. **Never trust this path in production**; verify your Vercel env has `FIREBASE_SERVICE_ACCOUNT_JSON` set.

## RBAC role matrix

Defined in the D1 `users.role` column. Five roles:

| Role | UI label | Capabilities |
|---|---|---|
| `admin` | GM | Full CRUD on all collections; user/campaign management; can access `/api/admin/*` |
| `co-dm` | Co-DM | CRUD on lore; manage campaigns where they're listed in `campaign_members.role = 'co-dm'` |
| `lore-writer` | Librarian | CRUD on lore (drafts and published) |
| `trusted-player` | Player+ | Same as `user`, but with extended visibility on certain DM-tagged content |
| `user` | Adventurer | Read-only access to published lore and revealed secrets |

Role enforcement happens in three places:
- **Client** — `effectiveProfile` hides UI affordances. Not a security boundary; it's UX.
- **Proxy** — `requireXAccess` helpers reject the request before it reaches the Worker. This is the security boundary.
- **D1 schema** — `users.role` is constrained by a `CHECK` clause in the schema migrations.

## Preview mode (RBAC simulation)

Admins and Co-DMs can toggle `previewMode` in `App.tsx` to see the app as a regular `user`:

1. State: `previewMode: boolean` in `App.tsx`.
2. Computed: `effectiveProfile = { ...userProfile, role: previewMode ? 'user' : userProfile.role }`.
3. `effectiveProfile` is prop-drilled to all page components.

Preview mode does not bypass server-side checks — it only simulates the UI as a regular user would see it. The actual JWT still carries the admin's identity.

## Account lifecycle

| Action | How |
|---|---|
| **Create** | `AdminUsers.tsx` (`/admin/users`) — admin only. Uses a secondary Firebase app instance (so the admin doesn't get logged out) to call `createUserWithEmailAndPassword`, then writes the D1 `users` row. |
| **Update own profile** | `Settings.tsx` → `PATCH /api/me`. Allow-listed columns only (`username`, `display_name`, `pronouns`, `bio`, `avatar_url`, `theme`, `accent_color`, `hide_username`, `is_private`, `recovery_email`, `active_campaign_id`). `role` is deliberately NOT in the allow-list. Username changes also push through the Firebase Admin SDK to update the auth email. |
| **Switch active campaign** | Same `PATCH /api/me`, single-field payload. Used by the navbar's campaign switcher. |
| **Reset password (destructive)** | `AdminUsers.tsx` "Temp Password" button → `POST /api/admin/users/[id]/temporary-password`. Overwrites the Firebase Auth password with a random 14-char value and returns it once. There is no `mustChangePassword` flag in D1 — the temp-password lifecycle is owned entirely by Firebase Auth. |
| **Sign-in link (non-destructive)** | `AdminUsers.tsx` "Sign-in Link" button → `POST /api/admin/users/[id]/sign-in-token`. Mints a 1-hour Firebase custom token; admin shares a `/auth/redeem?token=…` URL; the SPA's `RedeemTokenPage` calls `signInWithCustomToken` so the user signs in without their password being touched. |
| **Delete** | Deleting from `AdminUsers.tsx` removes both the Firebase Auth record and the D1 row. |

## Privacy

These promises are now enforced server-side via the per-route endpoint family — none of them rely on the client to filter:

- `users.recovery_email` is stripped from every response that isn't the user's own (`GET /api/me`) or admin-driven (`GET /api/profiles/[username]` when viewer is admin/co-dm). Reads via the generic `/api/d1/query` proxy still return the column for staff, so the staff `AdminUsers` page sees it. Tightening that — column-scoping the staff read — is the audit's M2 item.
- `users.hide_username` controls whether the handle is shown in lore attributions, comments, etc.
- `users.is_private` makes `GET /api/profiles/[username]` return only the "sealed" placeholder shape (username + display_name + `is_private: true`) to non-self non-staff viewers — no bio, no campaigns, no role.

## Common gotchas

- **Stale token after role change**: If an admin promotes a user, the user's existing JWT continues to claim their old role until refresh. The client calls `getIdToken(true)` (force refresh) on profile snapshots that detect a role change.
- **Anonymous registration is disabled**: There is no `signInAnonymously` path. Account creation is admin-only.
- **Lost service account locally**: If `firebase-admin` can't initialise, the proxy falls back to signatureless JWT parsing and logs a warning. Production must always have a real service account configured.

## Related docs

- [api-endpoints.md](api-endpoints.md) — the per-route endpoint surface and which `require*` helper each one uses
- [runtime.md](runtime.md) — full request flow including the auth chain
- [d1-architecture.md](d1-architecture.md) — `getAuthHeaders()` in the D1 client
- [env-vars.md](env-vars.md) — `FIREBASE_SERVICE_ACCOUNT_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and `effectiveProfile`
- [../features/admin-users.md](../features/admin-users.md) — admin user management UI
