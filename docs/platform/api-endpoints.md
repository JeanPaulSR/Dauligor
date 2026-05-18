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
| PUT  | `/api/lore/articles/[id]` | `isWikiStaff` | `{ ok, id }`. Idempotent create-or-update. Server runs the multi-table batch (`buildLoreArticleSaveQueries`) so the client only ships the payload; `authorId` is always the verified-token uid, never a body field. |
| DELETE | `/api/lore/articles/[id]` | `isWikiStaff` | `{ ok, id }`. FK cascade clears `lore_meta_*`, `lore_article_*`, `lore_secrets`, `lore_secret_*`, `lore_links` in one DELETE. |
| PUT  | `/api/lore/articles/[id]/secrets/[secretId]` | `isWikiStaff` | `{ ok, articleId, secretId }`. Idempotent. |
| DELETE | `/api/lore/articles/[id]/secrets/[secretId]` | `isWikiStaff` | `{ ok, id }`. FK cascade clears `lore_secret_*`. |
| DELETE | `/api/lore/secrets/[secretId]` | `isWikiStaff` | Same as above but doesn't require the client to know the parent article id. Exists so the client doesn't need to round-trip a `SELECT article_id FROM lore_secrets` lookup first (that direct SELECT is now blocked by `PROTECTED_READ_TABLES`). |
| PUT  | `/api/lore/system-metadata/wiki-settings` | `requireAdminAccess` | `{ ok, key }`. The legit write path for the `wiki_settings` singleton-config blob. Server caps the JSON at 64KB. The generic proxy refuses any non-bump write to `system_metadata`. |

The proxy gate at [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts) blocks direct writes to every `lore_*` table (`PROTECTED_WRITE_TABLES`) and direct SELECTs against `lore_secrets` (`PROTECTED_READ_TABLES`). All client-side lore writes flow through this dispatcher; raw SQL paths return 403 with a pointer at the per-route endpoint.

## /api/campaigns

[api/campaigns.ts](../../api/campaigns.ts) — dispatcher for campaign reads. `req.url` parsed after `/api/campaigns/(.*) → /api/campaigns` rewrite.

| Method | Path | Gate | Returns |
|---|---|---|---|
| GET | `/api/campaigns` | `requireAuthenticatedUser`; role-filtered | `{ campaigns }`. `isCharacterDM(role)` sees every campaign with `memberCount` pre-computed; everyone else sees only campaigns they're a member of (server-side JOIN on `campaign_members`). |
| GET | `/api/campaigns/[id]` | `requireAuthenticatedUser` + member-or-staff check | `{ campaign }`. Non-members get 404 (collapsed with "doesn't exist" so probes can't enumerate). |
| GET | `/api/campaigns/[id]/members` | Same as `/api/campaigns/[id]` | `{ members }`. Each row enriched with `username`, `display_name`, `avatar_url` only — no `recovery_email`, no PII. |
| POST | `/api/campaigns` | `isCharacterDM` (admin + co-dm) | `{ campaign }`. Server defaults `dm_id` to the verified-token uid if omitted; allow-listed fields only. |
| PATCH | `/api/campaigns/[id]` | `isCharacterDM` | `{ ok, id }`. Real UPDATE (not upsert), so partial payloads don't need to resupply NOT NULL columns like the legacy `upsertDocument` path did. |
| DELETE | `/api/campaigns/[id]` | `requireAdminAccess` (re-checked inside the handler) | `{ ok, id }`. FK cascade clears `campaign_members`; other tables that reference campaigns (`characters.campaign_id`, `lore_article_campaigns`, `lore_secret_campaigns`) are left as orphaned rows / nulls. |
| PUT | `/api/campaigns/[id]/members/[uid]` | `isCharacterDM` | `{ ok, campaign_id, user_id, role }`. Idempotent (ON CONFLICT DO UPDATE on role). Body `{ role?: 'dm'\|'co-dm'\|'player' }`, defaults to `'player'`. |
| DELETE | `/api/campaigns/[id]/members/[uid]` | `isCharacterDM` | `{ ok, campaign_id, user_id }`. |

The proxy refuses direct writes to `campaigns` and `campaign_members` (`CAMPAIGN_WRITE_PATTERN`). lore-writer is admitted by the wiki-staff gate elsewhere but is 403'd here — campaign management is admin + co-dm only per [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md).

## /api/admin

| Method | Path | Gate | File |
|---|---|---|---|
| GET | `/api/admin/characters` | `requireAuthenticatedUser` + `isCharacterDM(role)` | [api/admin/characters.ts](../../api/admin/characters.ts) — list-view columns only (no JSON blobs). |
| POST | `/api/admin/users/[id]/temporary-password` | `requireAdminAccess` | [api/admin/users/[id]/[action].ts](../../api/admin/users/[id]/[action].ts) — destructive password reset. |
| POST | `/api/admin/users/[id]/sign-in-token` | `requireAdminAccess` | Same file — non-destructive 1-hour Firebase custom token. |

`/api/admin/users` (list + admin-only role changes + delete) doesn't exist yet — that's the next audit batch (M2 closure). It'll fold into the same `api/admin/users/[id]/[action].ts` file or a sibling at `api/admin/users.ts` depending on Vercel routing constraints.

## /api/d1/query (generic proxy + table-aware gate)

[api/d1/query.ts](../../api/d1/query.ts) → [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts). The catch-all that accepts arbitrary SQL and forwards to the Cloudflare Worker. Still backs every compendium read (skills, tools, weapons, armor, spells, feats, items, classes, subclasses, tags, tag_groups, attributes, scaling_columns, etc.) — these are public-among-signed-in data with no per-row privacy contract.

The gate runs `normalizeSqlForGate(sql)` first (strips comments + unwraps SQLite identifier quoting so `"users"` / `` `users` `` / `[users]` and `INSERT/*x*/INTO/*x*/users` evasions don't slip past), then applies the first matching rule:

| Condition | Outcome |
|---|---|
| `system_metadata` write AND not the foundation-bump fingerprint | **403** → `PUT /api/lore/system-metadata/wiki-settings` |
| `campaigns` / `campaign_members` write | **403** → `POST/PATCH/DELETE /api/campaigns[/...]` |
| Mutation against `users` / `eras` / `lore_*` | `requireAdminAccess` |
| Any other mutation (INSERT / UPDATE / DELETE / REPLACE / CREATE / DROP / ALTER / TRUNCATE / ATTACH / DETACH / REINDEX / VACUUM / PRAGMA) | `requireStaffAccess` |
| SELECT against `users` / `lore_secrets` / `characters` / `character_*` | **403** → per-route endpoint (see [security-gates.md](security-gates.md) for the full pointer list) |
| Any other SELECT | `requireAuthenticatedUser` |

The mutation regex is intentionally broad — a `SELECT` containing the literal word "UPDATE" in a string literal falls to the more restrictive staff path. Safe-by-default.

This path is **not** going to be fully decommissioned. See [api-endpoint-plan.md §15](api-endpoint-plan.md) for the rationale — migrating ~30 public compendium reads to per-route endpoints would burn the function budget for no real privacy gain, and the table-aware gate already closes every sensitive-data leak the audit flagged.

For the full security model — threat model, defense layers, normalization details, per-table policy, how to extend the gate — see [security-gates.md](security-gates.md).

## /api/r2/[action]

[api/r2/[action].ts](../../api/r2/[action].ts) — dispatcher for all R2 storage operations.

| Method | Path | Gate (inside handler) |
|---|---|---|
| GET | `/api/r2/list` | `requireImageManagerAccess` |
| DELETE | `/api/r2/delete` | `requireImageManagerAccess` |
| POST | `/api/r2/rename` | `requireImageManagerAccess` |
| POST | `/api/r2/move-folder` | `requireImageManagerAccess` |
| POST | `/api/r2/upload` | `requireImageManagerAccess` |
| POST | `/api/r2/scan-references` | `requireImageManagerAccess` | Body `{ url }`. Returns `{ references: ImageReference[] }`. Server walks `SCAN_TARGETS` (the (table, column) allow-list) via `executeD1QueryInternal` so it can reach `users` / `characters` that `PROTECTED_READ_TABLES` blocks from raw SELECT. |
| POST | `/api/r2/rewrite-references` | `requireImageManagerAccess` | Body `{ oldUrl, newUrl }`. Returns `{ count }`. The (table, column) pairs are pinned server-side in `SCAN_TARGETS` — a compromised client can't ship UPDATE against arbitrary columns. Closes audit L3. |

Consolidated from five separate files in commit `b267db9`. The `scan-references` / `rewrite-references` actions arrived in commit `977d71e` to fix L2 / L3 — the client-side scan would have silently 403'd against the new `PROTECTED_READ_TABLES` gate, hiding real references on `users` and `characters` from image admin.

The `SCAN_TARGETS` list lives ONLY in [api/_lib/r2-proxy.ts](../../api/_lib/r2-proxy.ts) now. Adding a new image-bearing column means updating that one list; do not reintroduce a parallel client-side `SCAN_TARGETS`.

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

- [security-gates.md](security-gates.md) — full security model, gate regexes, per-table policy, how to extend
- [api-endpoint-plan.md](api-endpoint-plan.md) — the migration plan + remaining items
- [auth-firebase.md](auth-firebase.md) — JWT verification, server-side helpers
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and per-table policy
- [d1-architecture.md](d1-architecture.md) — D1 client API and proxy mechanics
- [runtime.md](runtime.md) — request flow examples across the runtimes
