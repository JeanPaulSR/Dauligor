# API Endpoints

The full per-route surface that exists in `api/` today, organized by resource. Each row names the gate the server enforces (see [auth-firebase.md §Server-side helpers](auth-firebase.md#server-side-helpers)) and the file you'd open to edit it.

For the migration plan that produced this surface — including what's still on the legacy `/api/d1/query` catch-all — see [api-endpoint-plan.md](api-endpoint-plan.md).

## Function budget

Vercel Hobby plan caps each deployment at **12 serverless functions**. Several endpoints are consolidated into dispatchers (one file → multiple routes) specifically to fit. The pattern is:

- **Top-level resource file + rewrite** (`api/me.ts` + `vercel.json` rewrite `/api/me/(.*) → /api/me`) — used for catch-all paths because Vercel's pure-functions filesystem routing doesn't support real catch-all syntax. The handler parses the original path out of `req.url`.
- **Dynamic action segment** (`api/r2/[action].ts`, `api/admin/users/[id]/[action].ts`) — used where the sub-path has a fixed set of action names.

Current count: **11 / 12** functions.

## /api/me

[api/me.ts](../../api/me.ts) — single dispatcher for the calling user's own data. Path captured from `req.url` after the `/api/me/(.*) → /api/me` rewrite.

| Method | Path | Gate | Returns |
|---|---|---|---|
| GET  | `/api/me` | `requireAuthenticatedUser` | `{ profile }`. Auto-creates the `users` row on first sign-in. Auto-promotes hardcoded admin emails + `admin` / `gm` usernames. Auto-picks first `campaign_members` row as `active_campaign_id` if null. |
| PATCH | `/api/me` | `requireAuthenticatedUser` | `{ profile }`. Allow-listed columns: `username`, `display_name`, `pronouns`, `bio`, `avatar_url`, `theme`, `accent_color`, `hide_username`, `is_private`, `recovery_email`, `active_campaign_id`. `role` is deliberately not in the allow-list. Username changes push through Firebase Admin SDK so the auth email stays in sync. |
| GET  | `/api/me/characters` | `requireAuthenticatedUser` | `{ characters }`. Own characters only (uid from token). `?fields=id,name,level` (allow-listed) and `?limit=N` (capped at 500). |
| GET  | `/api/me/campaign-memberships` | `requireAuthenticatedUser` | `{ memberships }`. Each membership enriched with the campaign's basics (`name`, `slug`, `description`, `era_id`, `image_url`, `dm_id`) in a single round trip. |

## /api/profiles

[api/profiles/[username].ts](../../api/profiles/[username].ts) — public profile reads with server-side field stripping.

| Method | Path | Gate | Returns |
|---|---|---|---|
| GET | `/api/profiles/[username]` | `requireAuthenticatedUser` | `{ profile, campaigns }`. Field visibility branches on viewer role: owner/staff see the full row; non-private targets show a curated subset (`id`, `username`, `display_name`, `avatar_url`, `bio`, `pronouns`, `role`, `is_private`, `created_at`); private targets show only the "sealed" placeholder (`username`, `display_name`, `is_private: true`). `recovery_email` never leaves the server for non-self non-staff viewers. |

## /api/characters

Two files in this family. The single-character endpoint uses `[id]` (single-segment dynamic), the lists are siblings.

| Method | Path | Gate | File |
|---|---|---|---|
| GET  | `/api/characters/[id]` | `requireCharacterAccess` | [api/characters/[id].ts](../../api/characters/[id].ts) |
| PUT  | `/api/characters/[id]` | `requireAuthenticatedUser` + inline owner/DM check that handles create-vs-update | [api/characters/[id].ts](../../api/characters/[id].ts) |
| DELETE | `/api/characters/[id]` | `requireCharacterAccess` | [api/characters/[id].ts](../../api/characters/[id].ts) |
| GET  | `/api/admin/characters` | `requireAuthenticatedUser` + `isCharacterDM(role)` | [api/admin/characters.ts](../../api/admin/characters.ts) |

GET returns the reconstructed character (8 `character_*` tables joined via `rebuildCharacterFromSql`). PUT accepts the full character object as `{ character }`, server runs `generateCharacterSaveQueries` and batches. DELETE relies on D1's FK cascade. Non-owners non-DMs get 404 (not 403) so probes can't enumerate ids.

The PUT branch handles **both create and update**:
- Existing row → must be owner or DM (else 404).
- No row → players can create their own (any body `userId` must match caller's uid, else 403); DMs can create for anyone.

## /api/lore

[api/lore.ts](../../api/lore.ts) — dispatcher for wiki reads. `req.url` parsed after `/api/lore/(.*) → /api/lore` rewrite.

| Method | Path | Gate | Returns |
|---|---|---|---|
| GET | `/api/lore/articles` | `requireAuthenticatedUser` | `{ articles }`. Non-staff see `status='published'` only; `dm_notes` stripped from every row. `?fields=` (allow-listed), `?folder=`, `?category=`, `?orderBy=`. |
| GET | `/api/lore/articles/[id]` | `requireAuthenticatedUser` | `{ article, parent, mentions }`. Full packet: base row + category-specific metadata + tags + visibility junctions + parent + mentions. `dm_notes` included for wiki-staff (`isWikiStaff(role)`), stripped otherwise. 404 for drafts when caller isn't staff. |
| GET | `/api/lore/articles/[id]/secrets` | `requireAuthenticatedUser` | `{ secrets }`. Server-filtered: staff see all; non-staff see only secrets whose `revealedCampaignIds` includes the viewer's `active_campaign_id` (looked up from `users` on the server — not trusted from the request). |

Lore writes (`upsertLoreArticle`, `upsertLoreSecret`, delete...) still go through the legacy `/api/d1/query` path. They're already staff-gated by the proxy's write check; the audit's priority #6 will fold them into this dispatcher.

## /api/campaigns

[api/campaigns.ts](../../api/campaigns.ts) — dispatcher for campaign reads. `req.url` parsed after `/api/campaigns/(.*) → /api/campaigns` rewrite.

| Method | Path | Gate | Returns |
|---|---|---|---|
| GET | `/api/campaigns` | `requireAuthenticatedUser`; role-filtered | `{ campaigns }`. `isCharacterDM(role)` sees every campaign with `memberCount` pre-computed; everyone else sees only campaigns they're a member of (server-side JOIN on `campaign_members`). |
| GET | `/api/campaigns/[id]` | `requireAuthenticatedUser` + member-or-staff check | `{ campaign }`. Non-members get 404 (collapsed with "doesn't exist" so probes can't enumerate). |
| GET | `/api/campaigns/[id]/members` | Same as `/api/campaigns/[id]` | `{ members }`. Each row enriched with `username`, `display_name`, `avatar_url` only — no `recovery_email`, no PII. |

Campaign writes (create / update / delete + member add/remove) still go through `/api/d1/query`. Audit priority #8.

## /api/admin

| Method | Path | Gate | File |
|---|---|---|---|
| GET | `/api/admin/characters` | `requireAuthenticatedUser` + `isCharacterDM(role)` | [api/admin/characters.ts](../../api/admin/characters.ts) — list-view columns only (no JSON blobs). |
| POST | `/api/admin/users/[id]/temporary-password` | `requireAdminAccess` | [api/admin/users/[id]/[action].ts](../../api/admin/users/[id]/[action].ts) — destructive password reset. |
| POST | `/api/admin/users/[id]/sign-in-token` | `requireAdminAccess` | Same file — non-destructive 1-hour Firebase custom token. |

`/api/admin/users` (list + admin-only role changes + delete) doesn't exist yet — that's the next audit batch (M2 closure). It'll fold into the same `api/admin/users/[id]/[action].ts` file or a sibling at `api/admin/users.ts` depending on Vercel routing constraints.

## /api/d1/query (legacy generic proxy)

[api/d1/query.ts](../../api/d1/query.ts) → [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts). The catch-all that accepts arbitrary SQL and forwards to the Cloudflare Worker. Still backs most compendium reads / writes that haven't migrated yet.

Gate is split:
- **Reads** (`SELECT`) → `requireAuthenticatedUser`. Any signed-in user.
- **Writes / DDL** (INSERT, UPDATE, DELETE, REPLACE, CREATE, DROP, ALTER, TRUNCATE, ATTACH, DETACH, REINDEX, VACUUM, PRAGMA) → `requireStaffAccess`. Admin / co-dm / lore-writer.

The mutation regex is intentionally broad — a `SELECT` containing the literal word "UPDATE" in a string literal falls to the more restrictive staff path. Safe-by-default.

The long-term goal is to retire this path entirely; everything still using it is a follow-up in the audit plan.

## /api/r2/[action]

[api/r2/[action].ts](../../api/r2/[action].ts) — dispatcher for all R2 storage operations.

| Method | Path | Gate (inside handler) |
|---|---|---|
| GET | `/api/r2/list` | `requireImageManagerAccess` |
| DELETE | `/api/r2/delete` | `requireImageManagerAccess` |
| POST | `/api/r2/rename` | `requireImageManagerAccess` |
| POST | `/api/r2/move-folder` | `requireImageManagerAccess` |
| POST | `/api/r2/upload` | `requireImageManagerAccess` |

Consolidated from five separate files in commit `b267db9`. Same client URLs, no behavior change.

## /api/spell-favorites

[api/spell-favorites.ts](../../api/spell-favorites.ts) — per-user spell favorite reads/writes. The reference shape every other per-route endpoint was modeled on.

| Method | Path | Gate | Behavior |
|---|---|---|---|
| GET | `/api/spell-favorites` | `requireAuthenticatedUser` | `{ spellIds }`. `?characterId=` switches to per-character scope (ownership-verified first). |
| POST | `/api/spell-favorites` | `requireAuthenticatedUser` | Body discriminator: `{ action: 'add' \| 'remove' \| 'bulkAdd', spellId / spellIds, characterId? }`. The row's `user_id` is always the verified-token uid — never a body field. |

## /api/module

[api/module.ts](../../api/module.ts) — Foundry export endpoints. Dispatcher pattern with `req.url` parsing. Out of scope for the audit; it serves the Dauligor Pairing Foundry module.

| Method | Path family | Gate | Purpose |
|---|---|---|---|
| GET | `/api/module/sources/...` | Public (cached) | Source / class / spell bundles for the Foundry module to fetch. |
| POST | `/api/module/queue-rebake` | `requireStaffAccess` | Mark a bundle for regeneration. |
| POST | `/api/module/bake/...` | `requireStaffAccess` | Force-regenerate a specific bundle. |

See [../features/foundry-export.md](../features/foundry-export.md) for the full export contract.

## Related docs

- [api-endpoint-plan.md](api-endpoint-plan.md) — the migration plan + remaining items
- [auth-firebase.md](auth-firebase.md) — JWT verification, server-side helpers
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and per-table policy
- [d1-architecture.md](d1-architecture.md) — D1 client API and the legacy proxy
- [runtime.md](runtime.md) — request flow examples across the runtimes
