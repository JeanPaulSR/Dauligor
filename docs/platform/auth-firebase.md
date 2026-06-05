# Authentication — Native Session Tokens (Firebase fallback during migration)

Auth runs on the Archive's **own native session tokens**: a Worker-signed HS256 JWT minted by `POST /api/auth/login` after it verifies a scrypt password hash stored in D1 (the `users_password_credentials` table). Mint + verify live entirely in our code — [`api/_lib/sessionToken.ts`](../../api/_lib/sessionToken.ts) — with no third-party issuer and no JWKS round-trip.

**Firebase Authentication is no longer the auth layer.** Having finished the Firestore→D1 / Storage→R2 move, the auth cutover replaced Firebase ID tokens with native session tokens; Firebase now survives only as a *migration-window fallback* for users not yet migrated to native credentials, and is removed in Phase 5 (the final auth-exit step). This doc covers the native flow, the Firebase fallback, and the parts that are unchanged (identity handles, RBAC helpers, privacy, account lifecycle).

> **Names lag reality:** this file stays `auth-firebase.md` and `api/_lib/firebase-admin.ts` keeps its name for link/import stability, but both now centre on the native path. Don't read the filename as "Firebase is the auth system" — it isn't.

## What's kept vs. what's gone

| Service | Status | Why |
|---|---|---|
| **Native session tokens** (`api/_lib/sessionToken.ts`) | **Primary auth** | Worker-signed HS256 JWT; scrypt passwords in D1; no third-party issuer, no JWKS round-trip. Issued by `/api/auth/login`. |
| Firebase Authentication | **Fallback only** (removed Phase 5) | Was the JWT issuer pre-cutover; now accepted only for users not yet migrated to native credentials. Verified locally via JWKS, no SDK. |
| Firestore | Removed | Replaced by Cloudflare D1 (May 2026) |
| Firebase Storage | Removed | Replaced by Cloudflare R2 |
| `firebase-admin` SDK on the proxy | **Removed** (May 2026) | Replaced by `jose` (JWKS-based JWT verify) + direct Firebase Identity Toolkit REST calls for admin operations (createUser / updateUser / deleteUser / createCustomToken). Runtime-portable: works in Node and Cloudflare Workers. |
| Firestore security rules | Removed | Replaced by per-route RBAC checks in `api/_lib/firebase-admin.ts` + the table-aware proxy gate in `api/_lib/d1-proxy.ts`. See [security-gates.md](security-gates.md). |

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

The list must stay in sync between those two files.

## End-to-end auth flow

### 1. Sign-in (native-first, Firebase fallback)
1. User enters username + password; `login()` in [`src/lib/auth.ts`](../../src/lib/auth.ts) POSTs `/api/auth/login`.
2. The server verifies the scrypt hash on the user's D1 credentials row and, on success, `issueSessionToken()` mints a 30-day sliding HS256 JWT. The client stores it (localStorage) and is signed in — **no Firebase involved.**
3. **Fallback (migration window only):** if native login fails (bad creds, `AUTH_JWT_SECRET` unset, the remote DB not yet carrying the password column, or a network error), `login()` falls through to Firebase `signInWithEmailAndPassword` (using `usernameToEmail` → `<handle>@archive.internal`), then POSTs `/api/auth/adopt` to write the D1 scrypt hash so the *next* login goes native ("hash-on-next-login" cutover).
4. `onAuthChange` in `App.tsx` (native token set, or Firebase `onAuthStateChanged`) triggers a profile refresh.

There's also a non-password sign-in path via Firebase **custom tokens** (still Firebase-backed during the migration window): an admin can mint a one-hour token through `POST /api/admin/users/[id]/sign-in-token`, share the resulting `/auth/redeem?token=…` URL, and [`RedeemTokenPage.tsx`](../../src/pages/auth/RedeemTokenPage.tsx) calls `signInWithCustomToken(auth, token)`. See [admin-users.md](../features/admin-users.md#sign-in-link-non-destructive--prefer-this).

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
1. Browser fetches the active bearer token via `getSessionToken()` ([`src/lib/auth.ts`](../../src/lib/auth.ts)): the native session token if present + unexpired, else (migration window) the current Firebase ID token.
2. Adds `Authorization: Bearer <token>` to the request.
3. Proxy verifies via `verifyEitherToken()` ([`api/_lib/firebase-admin.ts`](../../api/_lib/firebase-admin.ts)): when `AUTH_JWT_SECRET` is configured it tries the **native HS256 verify first** (`verifySessionToken`); a Firebase token is RS256 so it fails that and falls through to `jose` JWKS verification against Firebase's public keys (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`). Both paths are signature-checked — no credentials required server-side.
4. Proxy checks the user's role against the route's required role. Which helper fires depends on the endpoint — see the helpers table below.
5. Proxy forwards to the Worker with the shared `R2_API_SECRET`.

The generic `/api/d1/query` proxy has a split gate: writes / DDL go through `requireStaffAccess`, reads go through `requireAuthenticatedUser`. Per-route endpoints (`/api/me`, `/api/characters/[id]`, `/api/lore`, `/api/campaigns`, `/api/profiles/[username]`, `/api/admin/characters`, `/api/admin/users/[id]/[action]`, etc.) each enforce their own role + ownership rules. See [api-endpoints.md](api-endpoints.md) for the per-route surface.

### 4. Sign-out
1. The client clears the native session token (and signs out any Firebase fallback session).
2. Subscribers fire with `null`; `App.tsx` clears `userProfile`.
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

Each `require*` helper (via the shared `checkAccessFromToken` → `verifyEitherToken`):
1. Validates the `Bearer <token>` header is present.
2. Verifies the token — native HS256 first (`verifySessionToken`, when `AUTH_JWT_SECRET` is set), falling back to Firebase JWKS (`jwtVerify`) during the migration window.
3. Reads the user's role from the D1 `users` table.
4. Throws `HttpError(401|403|404, message)` on failure.
5. Returns `{ decoded, role }` (or richer for `requireCharacterAccess`) on success.

There is **no** signatureless fallback. Both verify paths are signature-checked (native HS256 secret / public Firebase JWKS), so every token is checked unconditionally on every request. If verification fails the helper throws 401 and the caller sees an "Invalid auth token" message.

## RBAC role matrix

The five roles (`admin`, `co-dm`, `lore-writer`, `trusted-player`, `user`) and their per-table policy live in [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — that's the canonical RBAC reference. This doc covers the auth-flow half of the picture (helpers above + auth flow below); the RBAC doc covers role definitions, enforcement points (client / server / schema), preview mode, and the per-table policy matrix.

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
| **Update own profile** | `Settings.tsx` → `PATCH /api/me`. Allow-listed columns only (`username`, `display_name`, `pronouns`, `bio`, `avatar_url`, `theme`, `accent_color`, `hide_username`, `is_private`, `recovery_email`, `active_campaign_id`). `role` is deliberately NOT in the allow-list. Username changes also call Firebase Identity Toolkit REST (`/accounts:update`) to keep the auth email in sync. |
| **Switch active campaign** | Same `PATCH /api/me`, single-field payload. Used by the navbar's campaign switcher. |
| **Reset password (destructive)** | `AdminUsers.tsx` "Temp Password" button → `POST /api/admin/users/[id]/temporary-password`. Overwrites the Firebase Auth password with a random 14-char value and returns it once. There is no `mustChangePassword` flag in D1 — the temp-password lifecycle is owned entirely by Firebase Auth. |
| **Sign-in link (non-destructive)** | `AdminUsers.tsx` "Sign-in Link" button → `POST /api/admin/users/[id]/sign-in-token`. Mints a 1-hour Firebase custom token; admin shares a `/auth/redeem?token=…` URL; the SPA's `RedeemTokenPage` calls `signInWithCustomToken` so the user signs in without their password being touched. |
| **Delete** | Deleting from `AdminUsers.tsx` removes both the Firebase Auth record and the D1 row. |

## Privacy

These promises are enforced server-side and the proxy gate makes them unforgeable from devtools — direct SELECTs against `users` return 403 (`PROTECTED_READ_TABLES`), so a hostile signed-in caller can't route around the per-route endpoints to grab columns they strip:

- `users.recovery_email` is stripped from every response that isn't the user's own (`GET /api/me`) or admin-driven (`GET /api/admin/users` returns it only when the caller's role is `admin`; staff get the basic column set). `GET /api/profiles/[username]` always strips it. The generic `/api/d1/query` proxy refuses `SELECT … FROM users` outright with a 403 pointing at these per-route endpoints, so even the staff `AdminUsers` page MUST go through the column-scoped path.
- `users.hide_username` controls whether the handle is shown in lore attributions, comments, etc.
- `users.is_private` makes `GET /api/profiles/[username]` return only the "sealed" placeholder shape (username + display_name + `is_private: true`) to non-self non-staff viewers — no bio, no campaigns, no role.

The proxy-gate decision tree (which tables are read-blocked, which are write-blocked, which 403 with a per-route pointer) lives in [security-gates.md](security-gates.md).

## Common gotchas

- **Stale token after role change**: If an admin promotes a user, the user's existing JWT continues to claim their old role until refresh. The client calls `getIdToken(true)` (force refresh) on profile snapshots that detect a role change.
- **Anonymous registration is disabled**: There is no `signInAnonymously` path. Account creation is admin-only.
- **Missing service account locally**: Without `FIREBASE_SERVICE_ACCOUNT_JSON`, JWT verification still works (JWKS is public) — only the admin user-management endpoints (`createUser`, `updateUser`, `deleteUser`, `createCustomToken` → `/api/admin/users/*` operations) return 503. The rest of the app loads normally.

## Related docs

- [api-endpoints.md](api-endpoints.md) — the per-route endpoint surface and which `require*` helper each one uses
- [runtime.md](runtime.md) — full request flow including the auth chain
- [d1-architecture.md](d1-architecture.md) — `getAuthHeaders()` in the D1 client
- [env-vars.md](env-vars.md) — `AUTH_JWT_SECRET` (signs + verifies native session tokens) and `FIREBASE_SERVICE_ACCOUNT_JSON` (Firebase admin user-management ops + fallback verify)
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and `effectiveProfile`
- [../features/admin-users.md](../features/admin-users.md) — admin user management UI
