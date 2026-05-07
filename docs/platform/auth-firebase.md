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

### 2. Profile load
1. `App.tsx` reads `users.id = auth.currentUser.uid` from **D1** via `fetchDocument('users', uid, null)`.
2. The role and active-campaign fields drive the `effectiveProfile` passed to the rest of the UI.
3. If the user logs in with `admin` or `gm`, an upsert auto-promotes them to `role: admin` in D1.

### 3. Authorised request to D1 / R2
1. Browser fetches an ID token: `await auth.currentUser.getIdToken()`.
2. Adds `Authorization: Bearer <id-token>` to the request.
3. Proxy verifies the token via `firebase-admin` (`auth.verifyIdToken`).
4. Proxy checks the user's role against the route's required role (`requireImageManagerAccess`, `requireStaffAccess`, `requireAdminAccess`).
5. Proxy forwards to the Worker with the shared `R2_API_SECRET`.

### 4. Sign-out
1. `signOut(auth)` clears the local Firebase session.
2. `onAuthStateChanged` fires with `null`; `App.tsx` clears `userProfile`.
3. All cached D1 data is cleared via `clearCache()` in `d1.ts`.

## Server-side helpers

All in [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts):

| Helper | Allows |
|---|---|
| `requireStaffAccess(authHeader)` | `admin`, `co-dm`, `lore-writer` (or hardcoded staff) |
| `requireImageManagerAccess(authHeader)` | Same staff set as above |
| `requireAdminAccess(authHeader)` | `admin` only (or hardcoded staff) |

Each helper:
1. Validates the `Bearer <token>` header is present.
2. Verifies the token via `firebase-admin`.
3. Reads the user's role from the D1 `users` table.
4. Throws `HttpError(401|403, message)` on failure.
5. Returns `{ decoded, role }` on success.

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
| **Create** | `AdminUsers.tsx` (`/admin/users`) — admin only. Calls server-side `createUserWithEmailAndPassword` then upserts a row into D1 `users`. |
| **Update profile** | `Settings.tsx`. Updates Firebase Auth email/password if the username changes; updates the D1 `users` row. |
| **Reset password** | `AdminUsers.tsx` "Generate temporary password" button calls `/api/admin/users/:id/temporary-password`. Requires admin. Updates Firebase Auth password and writes `mustChangePassword: true` on the D1 row. |
| **Delete** | Deleting from `AdminUsers.tsx` removes both the Firebase Auth record and the D1 row. |

## Privacy

- `users.recovery_email` is **never** returned to non-admin clients. The proxy strips it from any response that leaves the server.
- `users.hide_username` controls whether the handle is shown in lore attributions, comments, etc.
- `users.is_private` restricts the profile page to admins and the owner.

## Common gotchas

- **Stale token after role change**: If an admin promotes a user, the user's existing JWT continues to claim their old role until refresh. The client calls `getIdToken(true)` (force refresh) on profile snapshots that detect a role change.
- **Anonymous registration is disabled**: There is no `signInAnonymously` path. Account creation is admin-only.
- **Lost service account locally**: If `firebase-admin` can't initialise, the proxy falls back to signatureless JWT parsing and logs a warning. Production must always have a real service account configured.

## Related docs

- [runtime.md](runtime.md) — full request flow including the auth chain
- [d1-architecture.md](d1-architecture.md) — `getAuthHeaders()` in the D1 client
- [env-vars.md](env-vars.md) — `FIREBASE_SERVICE_ACCOUNT_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and `effectiveProfile`
- [../features/admin-users.md](../features/admin-users.md) — admin user management UI
