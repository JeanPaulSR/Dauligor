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
| `requireAuthenticatedUser(authHeader)` | Any signed-in user — the broadest gate. Used for own-data reads. |
| `requireStaffAccess(authHeader)` | `admin`, `co-dm`, `lore-writer` (or hardcoded staff emails) |
| `requireImageManagerAccess(authHeader)` | Same set as `requireStaffAccess` |
| `requireAdminAccess(authHeader)` | `admin` only (or hardcoded staff) |
| `requireCharacterAccess(authHeader, characterId)` | Owner OR character-DM. Throws 404 (not 403) when the row doesn't exist OR the caller isn't allowed — same shape on purpose so probes can't enumerate ids. |
| `isCharacterDM(role)` | Predicate: `admin` or `co-dm`. **Excludes** `lore-writer` deliberately — that role is for wiki content, not character management. |
| `isWikiStaff(role)` | Predicate: `admin`, `co-dm`, or `lore-writer`. Broader than the character set because `lore-writer` exists to author wiki content and needs draft + dm_notes visibility. |

Each `require*` helper:
1. Reads the `Authorization: Bearer <token>` header.
2. Verifies the token via `firebase-admin`.
3. Reads the user's role from D1 `users`.
4. Throws `HttpError(401|403|404, ...)` on failure.
5. Returns `{ decoded, role }` (or richer for `requireCharacterAccess`) on success.

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
- [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts) — used by every per-route endpoint
- [server.ts](../../server.ts) — local Express dev server
- [api/me.ts](../../api/me.ts) — `HARDCODED_OWNER_EMAILS` / `HARDCODED_INTERNAL_ADMIN_USERNAMES` for the auto-promote-on-profile-load logic

These bootstrap the system: even if the D1 `users` table is wiped, you can still log in as one of these emails and re-create roles. The auto-promote logic in `/api/me` forces `role = admin` for any of these three on every profile load, so role drift can't lock you out.

The lists must stay in sync between those files. `firestore.rules` is no longer relevant — Firestore has been decommissioned.

## Per-table access patterns

Two enforcement paths run in series today (per-route endpoints first, generic proxy as a defense-in-depth layer that the proxy gate makes table-aware):

- **Per-route endpoints** (`/api/me`, `/api/lore`, `/api/campaigns`, `/api/characters/[id]`, `/api/profiles/[username]`, `/api/admin/*`, etc.) — each handler owns its own SQL and gate. Preferred path for anything sensitive. See [../platform/api-endpoints.md](../platform/api-endpoints.md).
- **Generic `/api/d1/query` proxy** ([api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts)) — still handles compendium reads / writes, but the gate is table-aware: sensitive tables (`users` / `lore_secrets` / `characters` / `character_*` reads; `users` / `eras` / `lore_*` writes; any `campaigns` / `campaign_members` / `system_metadata` write outside the foundation-bump fingerprint) are refused with 403 and a pointer at the per-route endpoint. Full model in [../platform/security-gates.md](../platform/security-gates.md).

The matrix below is the enforced policy.

| Domain | Read | Mutate | Enforced via |
|---|---|---|---|
| `users` (own) | Self | Self (allow-listed columns, no `role` change) | **Per-route** — `GET` / `PATCH /api/me`; proxy refuses raw `FROM users` |
| `users` (others) | Curated subset; private targets show sealed stub | Admin only | **Per-route** — `GET /api/profiles/[username]`, `GET` / `PATCH` / `DELETE /api/admin/users[/id]`; proxy refuses raw `FROM users` |
| `campaigns` | Member or staff | Admin + co-dm (delete: admin only) | **Per-route** — `GET` / `POST` / `PATCH` / `DELETE /api/campaigns[/id]`; proxy refuses `INTO`/`UPDATE`/`FROM campaigns` |
| `campaign_members` | Member or staff | Admin + co-dm | **Per-route** — `GET /api/campaigns/[id]/members`, `GET /api/me/campaign-memberships`, `PUT` / `DELETE /api/campaigns/[id]/members/[uid]`; proxy refuses raw writes |
| `eras` | Any signed-in user | Admin | Generic proxy (admin-gated via `PROTECTED_WRITE_TABLES`); audit #9 will move writes to a per-route admin endpoint |
| `lore_articles` | Any signed-in user for `status='published'`; wiki-staff for drafts. `dm_notes` stripped for non-staff. | Wiki staff (admin + co-dm + lore-writer) | **Per-route** — `GET` / `PUT` / `DELETE /api/lore/articles[/id]`; proxy admits reads, refuses raw writes |
| `lore_secrets` | Server-filtered to viewer's active campaign; staff see all | Wiki staff | **Per-route** — `GET` / `PUT` / `DELETE /api/lore/articles/[id]/secrets[/secretId]` and `DELETE /api/lore/secrets/[id]`; proxy refuses raw SELECT |
| `lore_meta_*` / `lore_article_*` / `lore_secret_*` / `lore_links` | Any signed-in user (junction / metadata for already-public articles) | Wiki staff (via the article-upsert handler) | Proxy admits reads; refuses writes (every `lore_*` in `PROTECTED_WRITE_TABLES`) |
| `characters` | Owner or character-DM (admin + co-dm) | Owner or character-DM | **Per-route** — `GET` / `PUT` / `DELETE /api/characters/[id]`, `GET /api/me/characters`, `GET /api/admin/characters`; proxy refuses raw SELECT |
| `character_*` (progression / selections / inventory / spells / proficiencies / spell_list_extensions / spell_loadouts) | Same as `characters` (joined) | Same (joined in the server-side save batch) | **Per-route** — same handler as `/api/characters/[id]`; proxy refuses raw SELECT |
| `classes` / `subclasses` / `features` / `spells` / `feats` / `items` | Any signed-in user | Admin (intended); currently staff at the proxy | Generic proxy |
| `scaling_columns` / `spellcasting_progressions` | Any signed-in user | Admin (intended); currently staff at the proxy | Generic proxy |
| `tags` / `tag_groups` / proficiencies / categories | Any signed-in user | Admin (intended); currently staff at the proxy | Generic proxy |
| `system_metadata` | Any signed-in user | Admin for `wiki_settings`; staff for the `last_foundation_update` bump fingerprint; nothing else | **Per-route** `PUT /api/lore/system-metadata/wiki-settings` (admin); proxy refuses any other write |
| `image_metadata` | Any signed-in user | Image-manager roles | Generic proxy for the row itself; reference scan / rewrite go through `POST /api/r2/scan-references` and `POST /api/r2/rewrite-references` (server-side via `executeD1QueryInternal` so the scan reaches `users` / `characters` past the read gate) |
| `maps` / `map_markers` / `map_highlights` | Any signed-in user | Staff | Generic proxy. Marker queries no longer JOIN `lore_articles` — titles are looked up client-side from the gate-filtered `allArticles` array so draft titles never reach non-staff. |
| `spell_favorites` (per user) | Self only | Self only | **Per-route** — `/api/spell-favorites` |

`lore-writer` counts as wiki staff (sees drafts and dm_notes, can edit articles) but **not** as character DM and **not** as campaign DM. The two role sets live in `WIKI_STAFF_ROLES` and `CHARACTER_DM_ROLES` in `firebase-admin.ts`; campaign-write endpoints additionally use `isCharacterDM` to reject lore-writer.

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

`GET /api/me` (in [api/me.ts](../../api/me.ts)) auto-promotes specific principals on every profile load — the logic lives server-side so the client can never dictate roles:

- Username `admin` → `role: admin` in D1.
- Username `gm` → `role: admin` in D1.
- Hardcoded staff emails (`luapnaej101@gmail.com`, etc.) → `role: admin` in D1.

The same endpoint also auto-creates the `users` row on first sign-in (with role = `user` unless one of the bootstrap rules above fires) and auto-picks the user's first `campaign_members` row as `active_campaign_id` when it's null. The intent is to make the system bootstrap-friendly: a fresh deploy with no users can still be administrated by signing in as one of these three accounts.

## Why Firebase Auth still gates D1

Even though Firestore is being decommissioned, Firebase **Authentication** is staying. It's the JWT issuer; the D1 proxy verifies tokens via `firebase-admin` and reads the role from D1. See [../platform/auth-firebase.md](../platform/auth-firebase.md) for the full chain.

## Related docs

- [../platform/security-gates.md](../platform/security-gates.md) — gate decision tree, normalization, per-table policy, how to extend
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — full auth flow, server-side helpers
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — `getAuthHeaders()` in the D1 client
- [routing.md](routing.md) — RBAC at the route boundary
- [../features/admin-users.md](../features/admin-users.md) — admin user-management UI
