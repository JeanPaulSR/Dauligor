# Permissions & RBAC

Five roles, three enforcement points, and a preview-mode toggle for admins.

## Roles

Stored in the D1 `users.role` column.

| Role | UI Label | Capabilities |
|---|---|---|
| `admin` | GM | CRUD on all tables; user/campaign management; `/api/admin/*` routes |
| `co-dm` | Co-DM | CRUD on lore; manage campaigns where they're listed in `campaign_members.role = 'co-dm'` |
| `lore-writer` | Librarian | CRUD on lore (drafts and published) |
| `trusted-player` | Player+ | Same as `user`, with extended visibility on certain DM-tagged content |
| `user` | Adventurer | Read-only access to published lore and revealed secrets |

## Three enforcement points

RBAC is enforced at three layers, in order of strength:

### 1. Server-side route guards (the security boundary)

In [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts):

| Helper | Allows |
|---|---|
| `requireStaffAccess(authHeader)` | `admin`, `co-dm`, `lore-writer` (or hardcoded staff emails) |
| `requireImageManagerAccess(authHeader)` | Same set as `requireStaffAccess` |
| `requireAdminAccess(authHeader)` | `admin` only (or hardcoded staff) |

Each helper:
1. Reads the `Authorization: Bearer <token>` header.
2. Verifies the token via `firebase-admin`.
3. Reads the user's role from D1 `users`.
4. Throws `HttpError(401|403, ...)` on failure.

**This is the only layer that actually keeps unauthorised users out.** Bypassing the others has no security impact.

### 2. Client-side `effectiveProfile` (the UX layer)

In `App.tsx`, the resolved user identity is wrapped:

```ts
const effectiveProfile = {
  ...userProfile,
  role: previewMode ? 'user' : userProfile.role,
};
```

Pages receive `effectiveProfile` and use it to:
- Hide "Edit" / "Delete" / admin-only buttons
- Filter results to those the user is allowed to see (e.g., only published lore)
- Show preview-mode banners

`effectiveProfile` is **prop-drilled, not contextual**. Pages and major components take it as a prop. Don't reach for `userProfile` directly in feature code — always pass `effectiveProfile` so preview mode works.

### 3. D1 schema constraints (the integrity layer)

The `users.role` column has a `CHECK` constraint allowing only the five role values listed above. This catches bugs that try to write an unknown role; it does **not** stop a malicious admin from changing a role.

## Preview mode

Admins and Co-DMs can toggle a "preview as player" mode in the navbar.

### Implementation
1. `previewMode` state lives in `App.tsx`.
2. `effectiveProfile` recomputes when `previewMode` flips.
3. The UI re-renders. Server JWT is unchanged.

### What preview mode hides
- All "Edit" / "Add" / "Delete" buttons in editors and lists.
- Subcollection access for `lore_secrets` (player only sees revealed secrets).
- DM-only article metadata sections.
- Admin/Settings menu items.

### What preview mode does not change
- Server-side checks (the user's actual JWT still has admin role, so they can still hit admin endpoints from the console).
- D1 schema-level constraints.

Preview mode is a UX simulation only. **Never use it as the basis for security**.

## Hardcoded staff emails

Three principals are admin regardless of D1 role:

```
luapnaej101@gmail.com
admin@archive.internal
gm@archive.internal
```

Defined in `HARDCODED_STAFF_EMAILS` in:
- [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts)
- [server.ts](../../server.ts) (legacy temp-password endpoint)

These bootstrap the system: even if the D1 `users` table is wiped, you can still log in as one of these emails and re-create roles.

The list must stay in sync between those files. If `firestore.rules` is still around (it'll go away after migration), the same list is in there as Firestore-rule helpers.

## Per-table access patterns

D1 enforcement happens at the proxy, not at the table. The proxy decides whether to allow the SQL through.

| Domain | Read | Mutate |
|---|---|---|
| `users` | Self or staff | Self (update only, no role change), or admin |
| `campaigns` | Public read | Staff create/update; admin or campaign DM delete |
| `eras` | Public read | Staff write |
| `lore_*` | Public for `status='published'`; staff for everything | Staff |
| `lore_secrets` | Staff, or revealed via `lore_secret_campaigns` | Staff |
| `classes` / `subclasses` / `features` / `spells` / `feats` / `items` | Public read | Admin |
| `scaling_columns` / `spellcasting_progressions` | Public read | Admin |
| `tags` / `tag_groups` / proficiencies / categories | Public read | Admin |
| `characters` | Self or staff | Self (own) or staff |
| `image_metadata` | Anyone authenticated | Image-manager-eligible roles |

In practice, the proxy currently uses `requireStaffAccess` for most write paths. As individual routes are tightened, switch to `requireAdminAccess` where appropriate.

## Account lifecycle

| Action | Who can do it | Where |
|---|---|---|
| Create user | Admin | `/admin/users` (`AdminUsers.tsx`) |
| Update own profile | Owner | `/profile/settings` (`Settings.tsx`) |
| Change own role | Nobody (the schema permits it but the UI does not expose it) | — |
| Promote/demote | Admin | `/admin/users` |
| Reset password | Admin | `/admin/users` "Generate temporary password" |
| Delete user | Admin | `/admin/users` (deletes both the Firebase Auth record and the D1 row) |

See [../features/admin-users.md](../features/admin-users.md) for the UI flow.

## Auto-promotion rules

`App.tsx` auto-promotes specific principals on sign-in:

- Username `admin` → `role: admin` in D1.
- Username `gm` → `role: admin` in D1.
- Hardcoded staff emails → `role: admin` in D1.

These run as upserts on the `users` row. The intent is to make the system bootstrap-friendly: a fresh deploy with no users can still be administrated by signing in as one of these three accounts.

## Why Firebase Auth still gates D1

Even though Firestore is being decommissioned, Firebase **Authentication** is staying. It's the JWT issuer; the D1 proxy verifies tokens via `firebase-admin` and reads the role from D1. See [../platform/auth-firebase.md](../platform/auth-firebase.md) for the full chain.

## Related docs

- [../platform/auth-firebase.md](../platform/auth-firebase.md) — full auth flow, server-side helpers
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — `getAuthHeaders()` in the D1 client
- [routing.md](routing.md) — RBAC at the route boundary
- [../features/admin-users.md](../features/admin-users.md) — admin user-management UI
