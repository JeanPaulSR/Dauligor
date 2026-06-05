# API Endpoints

The full per-route surface that exists in `api/` today, organized by resource. Each row names the gate the server enforces (see [auth-firebase.md §Server-side helpers](auth-firebase.md#server-side-helpers)) and the file you'd open to edit it.

For the migration plan that produced this surface — including what's still on the legacy `/api/d1/query` catch-all — see [api-endpoint-plan.md](api-endpoint-plan.md).

## Function budget

Several endpoints are consolidated into dispatchers (one file → multiple routes). The pattern dates to the pre-Cloudflare Vercel Hobby 12-function cap, but the consolidation still helps cohesion on Pages (related routes co-located, single auth check) and is the established convention here. The two shapes:

- **Top-level resource file + Pages catch-all** (`api/me.ts` shared handler + `functions/api/me/[[path]].ts` Pages entry) — Cloudflare Pages' `[[path]]` catch-all syntax routes every sub-path into the same handler. The handler parses the original path out of `req.url`. (Pre-cutover this required a `vercel.json` rewrite; Pages does it natively, no rewrite file needed.)
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
| PUT  | `/api/lore/system-metadata/wiki-settings` | `requireAdminAccess` | `{ ok, key }`. The legit write path for the `wiki_settings` singleton-config blob. Server caps the JSON at 64KB. The generic proxy refuses any non-bump write to `system_metadata`. _Note: its `defaultBackgroundImageUrl` was superseded by the world background cascade (`worlds.background_image_url`) and no UI currently writes this endpoint; the route is retained for any future singleton config._ |

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

### Era writes — folded into the same dispatcher

`api/campaigns.ts` also handles `/api/admin/eras/*` — Pages Function `functions/api/admin/eras/[[path]].ts` (or whatever the current Pages routing is for that prefix) wires both prefixes to the same handler, and the dispatcher sniffs the `/api/admin/eras` URL prefix and routes to era handlers before the campaign-prefix parse runs. Eras are world-state taxonomy that own campaigns; folding into this file avoided splitting a tightly-related admin surface across two handlers.

| Method | Path | Gate | Returns |
|---|---|---|---|
| POST | `/api/admin/eras` | `requireAdminAccess` (inside the handler) | `{ era: { id, name } }`. Allow-listed fields: `name`, `description`, `order`, `background_image_url`. Server picks a uuid if `id` is omitted. `order` is a SQL reserved word so every column is quoted on write. |
| PATCH | `/api/admin/eras/[id]` | `requireAdminAccess` | `{ ok, id }`. Real UPDATE — partial payloads don't need to resupply `name`. |
| DELETE | `/api/admin/eras/[id]` | `requireAdminAccess` | `{ ok, id }`. No FK cascade onto `campaigns.era_id` (the column is nullable; campaigns assigned to the deleted era show as unassigned in the UI). |

Era reads (`fetchCollection('eras', …)` from AdminCampaigns, CampaignEditor, LoreArticle) stay on the generic proxy — eras are public-among-signed-in taxonomy and the read gate already admits the necessary callers. `eras` remains in `PROTECTED_WRITE_TABLES` as a defense-in-depth backstop: any direct write that escapes the per-route path still gets admin-gated at the proxy.

## /api/admin

| Method | Path | Gate | File |
|---|---|---|---|
| GET | `/api/admin/characters` | `requireAuthenticatedUser` + `isCharacterDM(role)` | [api/admin/characters.ts](../../api/admin/characters.ts) — list-view columns only (no JSON blobs). |

### /api/admin/users (dispatcher)

[api/admin/users.ts](../../api/admin/users.ts) — catch-all dispatcher at the resource root, mirroring `api/me.ts` / `api/lore.ts` / `api/campaigns.ts`. Cloudflare Pages `functions/api/admin/users/[[path]].ts` catch-all routes every sub-path into the same handler; the handler parses `req.url`.

| Method | Path | Gate | Returns |
|---|---|---|---|
| GET | `/api/admin/users` | `isWikiStaff` (admin / co-dm / lore-writer) | `{ users }`. Column visibility depends on viewer role: admin sees full row (including `recovery_email`, `active_campaign_id`, `bio`, `theme`, `accent_color`); co-dm and lore-writer see only the basic identity columns (`id`, `username`, `display_name`, `role`, `avatar_url`, `hide_username`, `is_private`, `created_at`). Each row enriched with `campaign_ids: string[]` via a JOIN on `campaign_members` — closes the second-leak path where the old AdminUsers also called `fetchCollection('campaignMembers')`. Closes M2. |
| POST | `/api/admin/users` | `requireAdminAccess` | `{ user }`. Creates the user via Firebase Admin SDK (`adminAuth.createUser`) and inserts the D1 row. Body: `{ username, display_name, role, recovery_email?, … }`. Server picks a uuid if `id` is omitted. |
| PATCH | `/api/admin/users/[id]` | `requireAdminAccess` | `{ user }`. Allow-listed columns including `role`, `username`, `display_name`, `recovery_email`, plus a `campaign_ids: string[]` field that the server reconciles by diffing against current `campaign_members` and INSERT/DELETEing the delta. Username changes also push through `adminAuth.updateUser` so the auth email (`<username>@archive.internal`) stays in sync. |
| DELETE | `/api/admin/users/[id]` | `requireAdminAccess` | `{ ok, id }`. Deletes the Firebase Auth record and the D1 row. FK cascade clears `campaign_members`; other tables that reference users (`characters.user_id`, `lore_articles.author_id`) are left as orphaned rows / nulls. |
| POST | `/api/admin/users/[id]/temporary-password` | `requireAdminAccess` | Destructive — overwrites the target's Firebase Auth password with a random 14-char value and returns it once. |
| POST | `/api/admin/users/[id]/sign-in-token` | `requireAdminAccess` | Non-destructive — mints a 1-hour Firebase custom token. Admin shares a `/auth/redeem?token=...` URL; the SPA exchanges via `signInWithCustomToken`. |

The proxy refuses raw SELECT against `users` (`PROTECTED_READ_TABLES`) and raw mutations against `users` (`PROTECTED_WRITE_TABLES`, admin-gated when admitted) — every legitimate path flows through one of the routes above or `GET/PATCH /api/me` for own-row access.

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

[api/module.ts](../../api/module.ts) — Foundry export endpoints. Dispatcher pattern with `req.url` parsing. Out of scope for the audit (no user-private data); it serves the Dauligor Pairing Foundry module.

All GET routes are public (the Foundry module fetches without auth), cached via R2 for the heavy bundles and live read-through with short `Cache-Control` for the lightweight summaries. POST routes are staff-only.

| Method | Path | Gate | Returns / Purpose |
|---|---|---|---|
| GET | `/api/module/sources/catalog.json` | Public | `dauligor.source-catalog.v1` — every active source. Each entry carries `counts.{classes,spells}` and `supportedImportTypes` so the wizard knows which import flows light up. |
| GET | `/api/module/<slug>/classes/catalog.json` | Public | `dauligor.class-catalog.v1` — class entries for one source, with `tagIndex` for filter chips. |
| GET | `/api/module/<slug>/classes/<class>.json` | Public (R2-cached) | `dauligor.semantic.class-export` — full class bundle (class, subclasses, features, scalings, optionGroups/Items, spellRuleAllowlists, source). |
| GET | `/api/module/<slug>/classes/<class>/spells.json` | Public | `dauligor.class-spell-list.v1` — lightweight per-class curated spell summaries (no `system` block). Live read-through, `Cache-Control: public, max-age=60`. |
| GET | `/api/module/<slug>/spells.json` | Public | `dauligor.source-spell-list.v1` — every spell in the source, same summary shape. Feeds the standalone Spell Browser. |
| GET | `/api/module/spells/<dbId>.json` | Public | `dauligor.spell-item.v1` — full Foundry-ready spell item, fetched lazily per row select / embed. |
| GET | `/api/module/tags/catalog.json` | Public | Spell-classified tag groups + tags, for the filter modal chips. |
| POST | `/api/module/queue-rebake` | `requireStaffAccess` | `{ kind: "class" \| "subclass" \| "feature" \| "scalingColumn" \| "optionGroup" \| "optionItem" \| "source", id }` — mark a bundle for regeneration. |
| POST | `/api/module/rebake-now` | `requireStaffAccess` | Same body — immediate rebake + R2 write + CDN warm. |

All GET routes fall back to a static filesystem read at `module/dauligor-pairing/data/sources/<path>` if D1 doesn't have the resource. See [../features/foundry-export.md](../features/foundry-export.md) for the wire formats and migration history.

## Related docs

- [security-gates.md](security-gates.md) — full security model, gate regexes, per-table policy, how to extend
- [api-endpoint-plan.md](api-endpoint-plan.md) — the migration plan + remaining items
- [auth-firebase.md](auth-firebase.md) — JWT verification, server-side helpers
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and per-table policy
- [d1-architecture.md](d1-architecture.md) — D1 client API and proxy mechanics
- [runtime.md](runtime.md) — request flow examples across the runtimes
