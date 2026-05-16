# Per-Route Endpoint Migration Plan

Replace the generic `/api/d1/query` SQL proxy with purpose-built endpoints that
scope rows and columns server-side. The reference shape is
[`api/spell-favorites.ts`](../../api/spell-favorites.ts) — explicit auth scope,
user id derived from the verified token, table-specific SQL kept inside the
handler, ownership checks before writes.

This document is the planning artifact for that work. It does **not** introduce
any new endpoints — it audits every client call site, groups them into
endpoint-shaped buckets, calls out the concrete leaks the current model
permits, and stack-ranks the order in which the endpoints should land.

## Status

The audit was executed; H-items are all closed as of the per-route endpoint
work shipped in commits `77a5af1` → `aaa310f`. For the surface that exists
today see [api-endpoints.md](api-endpoints.md). This doc is kept as the
historical record + remaining-work tracker.

| Risk | Status | Closed in |
|---|---|---|
| H1 — `recovery_email` PII | ✅ Closed | `815e74c` — `GET /api/me` + `GET /api/profiles/[username]` strip the column |
| H2 — `lore_articles.dm_notes` | ✅ Closed | `5b585c7` — `/api/lore` strips for non-staff |
| H3 — `lore_secrets` visibility | ✅ Closed | `5b585c7` — server-filtered by `users.active_campaign_id` |
| H4 — read others' characters | ✅ Closed | `77a5af1` — `GET /api/characters/[id]` enforces owner-or-DM |
| H5 — write others' characters | ✅ Closed | `77a5af1` (+ `33cac35` create-vs-update fix) |
| H6 — client role self-promote | ✅ Closed | `815e74c` — `PATCH /api/me` allow-list, auto-promote moved server-side |
| H7 — campaign_members enumeration | ✅ Closed | `aaa310f` — `/api/campaigns` + `/api/me/campaign-memberships` |
| M1 — draft titles via map | Open | Next batch |
| M2 — `users` table fully enumerable (PII) for staff | Open | Next natural target — `/api/admin/users` family |
| M3 — `system_metadata` writes not column-scoped | Open | Backlog |
| M4 — class_spell_lists rebuild from client | Open | Backlog |
| L1 — `eras` writes through staff gate | Open | Backlog |
| L2 — image scan returns `users` rows | Open | Backlog |
| L3 — image rename `updateDocument` against any column | Open | Backlog |
| L4 — `checkFoundationUpdate` polling raw SELECT | Open | Backlog |

Out-of-scope / drift items from Section 5 below remain open and are tracked
there.

## Threat model (one paragraph)

Today every signed-in user (including `user` / `trusted-player`) can SELECT
anything on any table the client-side `queryD1` / `fetchCollection` /
`fetchDocument` helpers reach. The proxy gate
([`api/_lib/d1-proxy.ts`](../../api/_lib/d1-proxy.ts)) was recently split so
that mutations require `requireStaffAccess` and reads require
`requireAuthenticatedUser` — but reads are still raw SQL: a hostile signed-in
user can paste `SELECT * FROM users` (or any other table) into devtools and
exfiltrate the entire row. The fix is to remove the generic read path entirely
and replace each call site with a route that returns only the columns + rows
the caller is allowed to see.

---

## 1. Inventory

Compiled from a `Grep` for `queryD1(` / `fetchDocument(` / `fetchCollection(` /
`upsertDocument(` / `deleteDocument(` / `deleteDocuments(` / `batchQueryD1(` /
`updateDocument(` / `upsertDocumentBatch(` across `src/`.

Identical patterns are grouped on one row (e.g. dozens of admin editors all
hitting `fetchCollection('skills')` are one row). Counts are approximate; full
list lives in the codebase.

### 1.1 User profile and identity (sensitive)

| File:line | Helper | Table(s) | Columns | Caller / trigger | Audience | Leak? |
|---|---|---|---|---|---|---|
| `src/App.tsx:127` | `fetchDocument` | `users` | `SELECT *` | Sign-in profile load | owner-only | **YES — `recovery_email`** |
| `src/App.tsx:142,146,154,176` | `upsertDocument` | `users` | full profile incl. `role` | Auto-promote / first-login profile create | owner-only (with role-change danger) | role mutation gated only by signed-in |
| `src/App.tsx:151` | `fetchCollection` | `campaign_members` | `where: user_id = ?` | Resolve active campaign | owner-only | enumerates membership |
| `src/pages/core/Settings.tsx:117` | `upsertDocument` | `users` | display_name, pronouns, bio, avatar_url, theme, accent_color, username, hide_username, is_private, recovery_email | "Save Profile" | owner-only | client can spread `{ ..., role: 'admin' }` |
| `src/pages/core/Settings.tsx:634` | `queryD1` | `eras`/`campaigns`/etc. | `DELETE FROM <table>` | Admin "Purge Collection" | admin | DDL-shaped path |
| `src/pages/core/Profile.tsx:26` | `fetchCollection` | `users` | `where: username = ?` | Public profile page | any-signed-in | **YES — `recovery_email`** |
| `src/pages/core/Profile.tsx:33,40` | `fetchCollection` | `campaign_members`, `campaigns` | `*` then filter | Profile sidebar | any-signed-in | enumerates other users' memberships |
| `src/components/Navbar.tsx:56,64` | `fetchCollection` | `campaigns`, `campaign_members` | `*` | Campaign switcher | owner-only | enumerates everyone's memberships |
| `src/components/Navbar.tsx:83` | `upsertDocument` | `users` | `{ ...userProfile, active_campaign_id }` | Switch active campaign | owner-only | spreads full profile (role) |
| `src/components/Sidebar.tsx:50` | `fetchDocument` | `campaigns` | `SELECT *` | Sidebar campaign header | any-signed-in | low — most fields are public |
| `src/components/Sidebar.tsx:94` | `queryD1` | `characters` | `id, name, level WHERE user_id = ?` | Sidebar recent characters | owner-only | scoped fine, but client could rewrite |
| `src/pages/admin/AdminUsers.tsx:55,59,63,127,129,177,370` | `fetchCollection` | `users`, `campaigns`, `campaign_members` | `*` | Admin user list | admin | role-gated client side only |
| `src/pages/admin/AdminUsers.tsx:101,168,196,358,417` | `upsertDocument` | `users`, `campaign_members`, `lore` | new row | Create user / change role / seed | admin | role-gated client side only |
| `src/pages/admin/AdminUsers.tsx:142,166` | `deleteDocument`/`deleteDocuments` | `users`, `campaign_members` | delete | Delete user | admin | role-gated client side only |
| `src/pages/admin/AdminCampaigns.tsx:56,59,62,67,80` | `fetchCollection` | `campaigns`, `eras`, `users`, `campaign_members`, `lore` | `*` | Admin campaign manager | admin | role-gated client side only |
| `src/pages/admin/AdminCampaigns.tsx:97,132,160,183,200,218,328` | `upsertDocument`/`deleteDocument` | `campaigns`, `eras` | mixed | Create / update / delete campaigns + eras | admin | role-gated client side only |

### 1.2 Characters (per-user owned data)

| File:line | Helper | Table(s) | Columns | Caller / trigger | Audience | Leak? |
|---|---|---|---|---|---|---|
| `src/pages/characters/CharacterList.tsx:37` | `queryD1` | `characters` | `SELECT * FROM characters [WHERE user_id = ?]` | List page | owner-only (or staff) | scope is client-decided; user can drop `WHERE` |
| `src/pages/characters/CharacterBuilder.tsx:3184-3191` | `queryD1` × 8 | `characters`, `character_progression`, `character_selections`, `character_inventory`, `character_spells`, `character_proficiencies`, `character_spell_list_extensions`, `character_spell_loadouts` | `SELECT * WHERE [character_]id = ?` | Open builder | owner-only (or staff) | **YES — no server ownership check; pass any id** |
| `src/pages/characters/CharacterBuilder.tsx:3459` | `batchQueryD1` | character_* | full character save | "Save" | owner-only | client can write to any character |
| `src/pages/characters/CharacterBuilder.tsx:3495`, `CharacterErrorBoundary.tsx:81` | `deleteDocument` | `characters` | by id | "Delete character" | owner-only | client can delete anyone's character |
| `src/lib/characterExport.ts:10` | `queryD1` (via `buildCharacterExport`) | character_* | many | "Export JSON" button | owner-only | client can export anyone's character |

### 1.3 Lore / Wiki

| File:line | Helper | Table(s) | Columns | Caller / trigger | Audience | Leak? |
|---|---|---|---|---|---|---|
| `src/pages/wiki/Wiki.tsx:55` | `fetchCollection` | `lore` | `*` (+ optional `WHERE status='published'`) | Wiki index | public (published) / staff (drafts) | **YES — `dm_notes` always returned** |
| `src/pages/wiki/LoreArticle.tsx:129` | `fetchDocument` | `lore` | `SELECT *` | Article view | public if published | **YES — `dm_notes` always returned** |
| `src/pages/wiki/LoreArticle.tsx:152,158,162,168,174,180,184,185,208,225` | `queryD1` | `lore_meta_characters`, `lore_meta_locations`, `lore_meta_organizations`, `lore_meta_deities`, `lore_article_tags`, `lore_article_eras`, `lore_article_campaigns`, `lore_secrets`, `lore_secret_eras`, `lore_secret_campaigns`, `lore_links` | `*` filtered by article_id | Article view | public if parent published | **YES — `lore_secrets.content` exposed before client-side reveal filter** |
| `src/pages/wiki/LoreArticle.tsx:196,234,235` | `fetchDocument`/`fetchCollection` | `lore`, `campaigns`, `eras` | `*` | Parent article + foundation data | public | low — see `dm_notes` row above |
| `src/pages/wiki/LoreEditor.tsx:142-146` | `fetchCollection` | `campaigns`, `eras`, `tagGroups`, `tags`, `lore` | `*` | Editor load | staff | role-gated client only |
| `src/lib/lore.ts:6-113` | `batchQueryD1` | `lore_articles`, `lore_meta_*`, `lore_article_*`, `lore_links` | upsert | Save lore article | staff | role-gated client only |
| `src/lib/lore.ts:118-137` | `batchQueryD1` | `lore_secrets`, `lore_secret_*` | upsert | Save lore secret | staff | role-gated client only |
| `src/lib/lore.ts:142-205, 210-227` | `fetchDocument`/`queryD1` | `lore_articles`, `lore_meta_*`, `lore_secrets`, junctions | `*` | `fetchLoreArticle` / `fetchLoreSecrets` helpers | public for articles, **STAFF for secrets** | secret read path runs server-side as plain SELECT — no enforcement |
| `src/lib/lore.ts:233,240` | `deleteDocument` | `lore_secrets`, `lore_articles` | by id | Delete article/secret | staff | role-gated client only |
| `src/pages/core/Home.tsx:31,42,48` | `fetchCollection`/`fetchDocument` | `lore`, `campaigns` | special-title list / active campaign / recommended | Home page | public (published) | `dm_notes` leak per row above |
| `src/pages/campaign/CampaignManager.tsx:35,41,44,45` | `fetchDocument`/`fetchCollection` | `campaigns`, `lore`, `lore_article_campaigns`, `lore_article_eras` | `*` | Campaign view | any-signed-in (filtered client-side) | `dm_notes` leak per row above |
| `src/pages/campaign/CampaignEditor.tsx:65,69,73,78,82,137` | `fetchCollection`/`fetchDocument` | `eras`, `lore`, `users`, `campaigns`, `campaign_members` | `*` | Campaign editor | staff | role-gated client only; `users` leaks `recovery_email` |
| `src/pages/campaign/CampaignEditor.tsx:133,143,154` | `upsertDocument`/`deleteDocuments` | `campaigns`, `campaign_members` | mixed | Save campaign | staff | role-gated client only |

### 1.4 Map

| File:line | Helper | Table(s) | Columns | Caller / trigger | Audience | Leak? |
|---|---|---|---|---|---|---|
| `src/pages/core/Map.tsx:91` | `fetchDocument` | `campaigns` | `*` | Resolve era | any-signed-in | low |
| `src/pages/core/Map.tsx:107,130` | `fetchCollection` | `maps`, `lore` | `*` | Maps list / article picker | any-signed-in | `lore` leaks `dm_notes` |
| `src/pages/core/Map.tsx:154-178` | `queryD1` JOINs | `map_markers`, `map_highlights`, `lore_articles`, `maps` | many | Map render | any-signed-in (filtered client-side) | exposes draft article titles via JOIN |
| `src/pages/core/Map.tsx:203,220` | `upsertDocument`/`deleteDocument` | `map_markers` | mixed | Admin add/remove pin | staff | role-gated client only |

### 1.5 Compendium reads (effectively public)

These are all foundation/taxonomy data that any signed-in user can already see
through the UI — the leak risk is low. Listed once per shape to keep this
inventory short.

| File:line (representative) | Helper | Tables touched | Caller / trigger | Audience | Leak? |
|---|---|---|---|---|---|
| `src/pages/sources/Sources.tsx:53`, `SourceDetail.tsx:49,54` | `fetchCollection`/`fetchDocument` | `sources`, `classes` | Public source pages | public | no |
| `src/pages/compendium/ClassList.tsx`, `ClassView.tsx` | many `fetchCollection` | `classes`, `subclasses`, `features`, `scaling_columns`, `unique_option_groups`, `unique_option_items`, `tags`, `tag_groups`, etc. | Class browsers | public | no |
| `src/pages/compendium/ClassEditor.tsx:629-648` | `fetchCollection` × 17 | `sources`, `spellcasting_progressions`, `skills`, `tools`, `tool_categories`, `armor`, `armor_categories`, `weapons`, `weapon_categories`, `languages`, `language_categories`, `attributes`, `unique_option_groups`, `unique_option_items`, `tag_groups`, `tags` | Class editor load | admin (read), public (data) | foundation collections are effectively public; editor itself role-gated |
| `src/pages/compendium/SubclassEditor.tsx:207-213` | `fetchCollection` | same as ClassEditor subset | Subclass editor | admin | foundation is public |
| `src/pages/compendium/UniqueOptionGroupEditor.tsx:120-143` | `fetchCollection` × 14 | spellRules + same foundation set | Option-group editor | admin | foundation is public |
| `src/pages/compendium/ToolsEditor.tsx`, `SkillsEditor.tsx`, `admin/ArmorEditor.tsx`, `admin/WeaponsEditor.tsx`, `admin/SimplePropertyEditor.tsx`, `admin/StatusesEditor.tsx`, `admin/SpellcastingTypeEditor.tsx`, `admin/StandardMulticlassEditor.tsx`, `admin/SpellcastingAdvancementManager.tsx` | mix | foundation tables | Foundation editors | admin | public read / admin write |
| `src/pages/compendium/SpellsEditor.tsx:509`, `SpellList.tsx`, `SpellListManager.tsx`, `SpellRulesEditor.tsx` | `fetchCollection`/`queryD1` | `sources`, `spells`, `spell_rules`, `spell_rule_applications`, `class_spell_lists`, `tags`, `tag_groups` | Spell browser & manager | public (read), admin (manage) | no |
| `src/pages/compendium/FeatsEditor.tsx`, `FeatList.tsx` | `fetchCollection` | `feats`, taxonomy | Feats browser | public | no |
| `src/pages/compendium/TagsExplorer.tsx:374,419,446,447,998,1022,1023,1158` | `upsertDocument`/`deleteDocument` | `tags`, `tag_groups` | Tag admin | admin | role-gated client only |
| `src/pages/compendium/scaling/*Editor.tsx` | mix | `scaling_columns`, `spellcasting_progressions` | Scaling editor | admin | role-gated client only |
| `src/lib/compendium.ts` exports (`upsertItem`, `upsertFeat`, `upsertSpell`, `upsertFeature`, `purgeAllSpells`, `upsertSpellBatch`) | many | `items`, `feats`, `spells`, `features` | Compendium CRUD | admin | role-gated by proxy on write |
| `src/lib/spellRules.ts` (~20 calls) | `queryD1`/`batchQueryD1` | `spell_rules`, `spell_rule_applications`, `class_spell_lists`, `spells`, `tags` | Rule CRUD + rebuild + recompute | admin (write), public (read) | low |
| `src/lib/classSpellLists.ts` (~13 calls) | `queryD1`/`batchQueryD1` | `class_spell_lists`, `spells`, `classes`, `spell_rule_applications`, `spell_rules` | Per-class spell list | public (read), admin (write) | low |
| `src/lib/classExport.ts` (~58 calls) | `upsertDocument`/`upsertDocumentBatch`/`fetchCollection` | `classes`, `subclasses`, `features`, `scaling_columns`, `unique_option_groups`, `unique_option_items`, `sources`, `spellcasting_progressions`, etc. | Bulk module import | admin | role-gated client only |
| `src/lib/spellImport.ts:482` | `updateDocument` | `spells` | `description` backfill | admin tooling | role-gated client only |
| `src/lib/tagMerge.ts:160,170,176,186` | `queryD1` | every tag-storing table | Tag merge | admin | role-gated client only |
| `src/lib/tagMove.ts:95` | `updateDocument` | `tags` | Tag reparent | admin | role-gated client only |
| `src/lib/tagUsage.ts` (~4 calls) | `queryD1` | UNION across tag-storing tables | Tag-usage scan | admin (read) | low |
| `src/lib/spellSummary.ts:79` | `fetchCollection` | `spells` (subset) | Catalog browse | public | no |
| `src/lib/compendium.ts:554` | `queryD1` | `spells` | `DELETE FROM spells` | Admin purge | admin | DDL-shaped path |
| `src/lib/d1.ts` (`getSystemMetadata`/`setSystemMetadata`/`bumpFoundationUpdate`/`checkFoundationUpdate`) | `queryD1` | `system_metadata` | global KV | mixed | low |

### 1.6 Image metadata

| File:line | Helper | Table(s) | Columns | Caller / trigger | Audience | Leak? |
|---|---|---|---|---|---|---|
| `src/lib/imageMetadata.ts:99` | `upsertDocument` | `image_metadata` | row | Upload | image-manager (admin/co-dm/lore-writer) | role-gated only on `upsertDocument`'s mutation path |
| `src/lib/imageMetadata.ts:104` | `fetchDocument` | `image_metadata` | `*` | Read metadata | any-signed-in | low |
| `src/lib/imageMetadata.ts:117,180` | `updateDocument` | `image_metadata`, **and every table in `SCAN_TARGETS` (classes / subclasses / features / characters / sources / users / lore)** | varied | Rename / move image references | image-manager | leaks `users.avatar_url` reference scan over the full `users` table |
| `src/lib/imageMetadata.ts:122` | `deleteDocument` | `image_metadata` | by id | Delete image | image-manager | role-gated |
| `src/lib/imageMetadata.ts:134,168` | `fetchCollection` × 7 | classes, subclasses, features, characters, sources, **users**, lore | image reference scan | image-manager | reads `users.*` and `lore.dm_notes` across the full table |

### 1.7 Cross-cutting helper internals (in `src/lib/d1.ts`)

Not call sites per se, but these are the seams every other file flows through:

- `queryD1` (line 203) – the only path to `/api/d1/query`.
- `batchQueryD1` (line 340) – batched variant.
- `fetchDocument` / `fetchCollection` / `upsertDocument` / `updateDocument` /
  `deleteDocument` / `deleteDocuments` / `upsertDocumentBatch` – thin wrappers
  that build SQL and call `queryD1`.
- `bumpFoundationUpdate` / `checkFoundationUpdate` / `getSystemMetadata` /
  `setSystemMetadata` – `system_metadata` KV (line 145-179).
- 5-minute in-memory cache, longer-lived `sessionStorage` for `PERSISTENT_TABLES`,
  auto-parse for JSON columns. The migration needs equivalent caching at the new
  endpoint layer or pages will get noticeably slower.

---

## 2. Proposed endpoint groups

Sorted by domain. For each: the route, the role gate (one of
`requireAuthenticatedUser` / `requireImageManagerAccess` /
`requireStaffAccess` / `requireAdminAccess` from
[`api/_lib/firebase-admin.ts`](../../api/_lib/firebase-admin.ts) — no new role
names), the request shape, the response shape, what gets stripped, and the
row-scope rule.

### 2.1 Identity / user profile

#### `GET /api/me`
- Role: `requireAuthenticatedUser`
- Response: the caller's own `users` row, with `recovery_email` **stripped** unless
  the caller is admin/staff requesting via `/api/admin/users/[id]` (next route).
  Includes `id`, `username`, `display_name`, `role`, `avatar_url`, `bio`,
  `pronouns`, `theme`, `accent_color`, `hide_username`, `is_private`,
  `active_campaign_id`, `created_at`, `updated_at`.
- Replaces: `fetchDocument('users', uid)` in `App.tsx:127`, the implicit profile
  read in Settings/Profile/Navbar.

#### `PATCH /api/me/profile`
- Role: `requireAuthenticatedUser`
- Body: allow-listed fields only — `display_name`, `pronouns`, `bio`,
  `avatar_url`, `theme`, `accent_color`, `username`, `hide_username`,
  `is_private`, `recovery_email`. **Never** `role`, **never** `id`, **never**
  `active_campaign_id` (that goes through `PATCH /api/me/active-campaign`).
- Replaces: the `upsertDocument('users', uid, {...})` in `Settings.tsx:117`,
  `Navbar.tsx:83`, and the auto-promotion paths in `App.tsx:142,146,154,176`
  (auto-promotion should be folded into `GET /api/me` server-side so the client
  never writes its own role).
- Strips `role` from incoming payload silently and logs the attempt — the
  current Settings code spreads `{ ...userProfile }` which includes `role`.

#### `PATCH /api/me/active-campaign`
- Role: `requireAuthenticatedUser`
- Body: `{ campaignId: string | null }`
- Server check: caller must be a `campaign_members` row on that campaign, OR
  staff. Reject otherwise.
- Replaces: the `active_campaign_id` write inside `Navbar.tsx:83` and
  `App.tsx:154`.

#### `GET /api/me/campaign-memberships`
- Role: `requireAuthenticatedUser`
- Response: `[{ campaign_id, role, joined_at }, …]` for the caller only.
- Replaces: `fetchCollection('campaign_members', { where: 'user_id = ?', params: [uid] })`
  in `App.tsx:151` and `Navbar.tsx:64`.

#### `GET /api/profiles/[username]`
- Role: `requireAuthenticatedUser`
- Response: public profile fields only — `username`, `display_name`,
  `avatar_url`, `bio`, `pronouns`, `role`, `created_at`. **Strips**
  `recovery_email`, `theme`, `accent_color`, `active_campaign_id`,
  `hide_username`, `is_private` (the privacy check is server-side; private
  profiles return a slim public stub).
- Server enforces `is_private`: non-owner non-admin gets just
  `{ username, display_name, is_private: true }`.
- Side-channel: `GET /api/profiles/[username]/campaigns` returns just the
  campaign names the viewer is also a member of (no full enumeration).
- Replaces: `Profile.tsx:26,33,40`.

#### `GET /api/admin/users`
- Role: `requireAdminAccess`
- Response: every users row, full columns including `recovery_email`.
- Replaces: `AdminUsers.tsx:55,127,370`, the `users` fetch in
  `AdminCampaigns.tsx:62`, and `CampaignEditor.tsx:73`.

#### `PATCH /api/admin/users/[id]`
- Role: `requireAdminAccess`
- Body: any users column including `role`, `username`, `display_name`.
- Replaces: `AdminUsers.tsx:101,168,196,358,417` (the role-change /
  user-creation / admin-side edits).

#### `DELETE /api/admin/users/[id]`
- Role: `requireAdminAccess`
- Replaces: `AdminUsers.tsx:142`.

Existing `POST /api/admin/users/[id]/temporary-password` and
`POST /api/admin/users/[id]/sign-in-token` stay as-is.

### 2.2 Campaigns

#### `GET /api/campaigns`
- Role: `requireAuthenticatedUser`
- Response: campaigns the caller can see — staff get all, players get only the
  ones they're a `campaign_members` row on. Columns: `id`, `name`, `slug`,
  `description`, `era_id`, `image_url`, `image_display`, `card_image_url`,
  `card_display`, `preview_image_url`, `preview_display`,
  `background_image_url`, `recommended_lore_id`, `created_at`, `updated_at`.
  **Strips** the `settings` JSON for non-staff (may carry DM flags).
- Replaces: `fetchCollection('campaigns')` in `Navbar.tsx:56`, `Home.tsx` (via
  campaign read), `LoreArticle.tsx:234`.

#### `GET /api/campaigns/[id]`
- Role: `requireAuthenticatedUser` + (member-or-staff check)
- Response: same column set as the list.
- Replaces: `fetchDocument('campaigns', id)` in `Sidebar.tsx:50`,
  `CampaignManager.tsx:35`, `Map.tsx:91`, `CampaignEditor.tsx:78`,
  `Home.tsx:42`.

#### `GET /api/campaigns/[id]/members`
- Role: `requireAuthenticatedUser` + (member-or-staff check)
- Response: `[{ user_id, display_name, username, avatar_url, role, joined_at }]`
  — joined with `users`, with `recovery_email` and other PII columns stripped.
- Replaces: the `campaign_members` + `users` fetch combinations in
  `CampaignEditor.tsx:82,137`, `AdminCampaigns.tsx:67`.

#### `POST /api/campaigns` / `PATCH /api/campaigns/[id]` / `DELETE /api/campaigns/[id]`
- Role: `requireStaffAccess` (create/update), `requireAdminAccess` (delete) —
  matches the existing doc claim "admin or campaign DM delete".
- Replaces: `CampaignEditor.tsx:133`, `AdminCampaigns.tsx:97,183,200,218`.

#### `PUT /api/campaigns/[id]/members/[uid]` and `DELETE /api/campaigns/[id]/members/[uid]`
- Role: `requireStaffAccess` for now (move to per-campaign-DM later).
- Replaces: `CampaignEditor.tsx:143,154` and `AdminUsers.tsx:111,166,168`.

#### `GET /api/admin/eras` / `POST /api/admin/eras` / `PATCH /api/admin/eras/[id]` / `DELETE /api/admin/eras/[id]`
- Role: read = `requireAuthenticatedUser`, mutate = `requireAdminAccess`.
- `eras` rows are world-facing so read can be public-among-signed-in.
- Replaces: `AdminCampaigns.tsx:59,132,160,328`, `Home.tsx` (implicit),
  `LoreArticle.tsx:235`, `Map.tsx` (implicit via maps' era_id).

### 2.3 Characters

#### `GET /api/me/characters`
- Role: `requireAuthenticatedUser`
- Response: caller's own characters, summary columns only (`id`, `name`,
  `level`, `image_url`, `campaign_id`, `updated_at`).
- Replaces: `CharacterList.tsx:37` (non-staff path) and `Sidebar.tsx:94`.

#### `GET /api/admin/characters`
- Role: `requireStaffAccess`
- Response: all characters with `user_id` exposed.
- Replaces: `CharacterList.tsx:37` (staff path).

#### `GET /api/characters/[id]`
- Role: `requireAuthenticatedUser` + ownership/staff check (return 404 to
  non-owners non-staff, same pattern `spell-favorites.ts` uses).
- Response: full character bundle — the 8 SELECTs CharacterBuilder needs,
  combined into one response: `{ character, progression, selections, inventory,
  spells, proficiencies, spellListExtensions, spellLoadouts }`.
- Replaces: `CharacterBuilder.tsx:3184-3191` (the 8 parallel `queryD1` calls).

#### `PUT /api/characters/[id]`
- Role: `requireAuthenticatedUser` + ownership/staff
- Body: full character payload (server fans out to the same batched writes
  `batchQueryD1(queries)` currently does, but server-side and ownership-gated).
- Replaces: `CharacterBuilder.tsx:3459`.

#### `DELETE /api/characters/[id]`
- Role: `requireAuthenticatedUser` + ownership/staff
- Replaces: `CharacterBuilder.tsx:3495`, `CharacterErrorBoundary.tsx:81`.

#### `GET /api/characters/[id]/export`
- Role: `requireAuthenticatedUser` + ownership/staff
- Response: the Foundry/D&D Beyond-shape JSON `buildCharacterExport` produces.
- Replaces: `characterExport.ts:10` (run on server so we don't ship raw rows
  to the client).

### 2.4 Lore / wiki

#### `GET /api/lore/articles`
- Role: `requireAuthenticatedUser`
- Query: `?category=`, `?folder=`, `?status=` (`status=draft` requires staff)
- Response: `[{ id, title, slug, category, folder, excerpt, status, image_url,
  card_image_url, preview_image_url, parent_id, author_id, tags, updated_at,
  visibility_era_ids, visibility_campaign_ids }]`. **Strips `dm_notes`** for
  every caller; staff get a separate `GET /api/lore/articles/[id]/dm-notes`.
- Server-side visibility filter: non-staff see only `status='published'` AND
  (no campaign scope OR caller's active campaign ∈ scope) AND (no era scope OR
  caller's active campaign's era ∈ scope). Move the gating currently in
  `LoreArticle.tsx:419-447` and `Wiki.tsx:75` into the route.
- Replaces: `Wiki.tsx:55`, `LoreEditor.tsx:146`, `Home.tsx:31`,
  `CampaignManager.tsx:41`, `Map.tsx:130`, `CampaignEditor.tsx:69`,
  `AdminCampaigns.tsx:80`.

#### `GET /api/lore/articles/[id]`
- Role: `requireAuthenticatedUser`
- Response: one article with metadata, tags, visibility, mentions
  pre-resolved. Same `dm_notes` strip rule.
- Replaces: `LoreArticle.tsx:129,152,158,162,168,174,180,184,185,196,225`,
  `Home.tsx:48`, `Sidebar.tsx` hover preview (currently routes through
  `fetchLoreArticle` in `lib/lore.ts`).

#### `GET /api/lore/articles/[id]/dm-notes`
- Role: `requireStaffAccess`
- Response: `{ dm_notes: string }`.
- Replaces: the `dm_notes` portion of `LoreArticle.tsx`'s SELECT, lets us
  strip it from the main read.

#### `GET /api/lore/articles/[id]/secrets`
- Role: `requireAuthenticatedUser`
- Response: secrets the caller can see — staff get all; players get only
  secrets whose `lore_secret_campaigns.campaign_id` includes the caller's
  active campaign. The current model leaks every secret to every client and
  filters in JS (`LoreArticle.tsx:453-458`); that's the leak this closes.
- Replaces: `LoreArticle.tsx:208`, `lore.ts:210-227`.

#### `POST /api/lore/articles` / `PATCH /api/lore/articles/[id]` / `DELETE /api/lore/articles/[id]`
- Role: `requireStaffAccess`
- Body: the lore-article-plus-metadata-plus-junctions blob `upsertLoreArticle`
  in `lib/lore.ts` currently assembles. Move the batch into the handler so the
  client just POSTs one JSON.
- Replaces: `lore.ts:6-113,232-241`.

#### `POST /api/lore/articles/[id]/secrets` / `PATCH /api/lore/articles/[id]/secrets/[secretId]` / `DELETE /api/lore/articles/[id]/secrets/[secretId]`
- Role: `requireStaffAccess`
- Replaces: `lore.ts:118-137,232`.

### 2.5 Compendium foundation (public-read)

Pattern: every foundation/taxonomy table that's already public should land
behind one read route per family with body-shape `?orderBy=&where=` allowed but
parameterized. Writes go through admin-gated per-route mutate endpoints.

#### `GET /api/compendium/<table>`
A single dispatcher route OR (preferred) one route per table. Tables to cover
(all currently fetched via `fetchCollection` for browsing):

`sources`, `eras`, `classes`, `subclasses`, `features`, `scaling_columns`,
`spellcasting_progressions`, `unique_option_groups`, `unique_option_items`,
`skills`, `tools`, `tool_categories`, `weapons`, `weapon_categories`,
`weapon_properties`, `armor`, `armor_categories`, `languages`,
`language_categories`, `attributes`, `damage_types`, `status_conditions`,
`condition_categories`, `multiclass_master_chart`, `tags`, `tag_groups`,
`spells` (summary only — heavy `foundry_data` stays on the per-id route),
`feats`, `items`.

- Role: `requireAuthenticatedUser` (all of these are effectively public among
  signed-in users — they're the rules content of the site).
- Response: full table or filtered subset based on a tightly enumerated
  whitelist of `where` predicates (`id IN (…)`, `type = 'pact'`, etc.). Reject
  arbitrary user SQL.
- Replaces: ~70+ `fetchCollection` calls across the compendium pages.

#### `GET /api/compendium/<table>/[id]`
- Role: `requireAuthenticatedUser`
- Response: full row.
- Replaces: every `fetchDocument` against a foundation table.

#### `POST /api/compendium/<table>` / `PATCH /api/compendium/<table>/[id]` / `DELETE /api/compendium/<table>/[id]`
- Role: `requireAdminAccess` (matches doc claim — "Admin write" for most
  taxonomy tables).
- For tag merge/move, `tag_groups` reorganisation, and `spell_rules` editing,
  the same `requireAdminAccess` applies but the body needs to carry the full
  multi-statement intent so the server can do the batch atomically (current
  `tagMerge.ts` runs 7 parallel SQL statements client-side).

### 2.6 Spells / spell-rules / class-spell-lists

These are special enough to call out:

- `GET /api/spells` – summary list (already shape-defined by
  `spellSummary.ts`). Role: `requireAuthenticatedUser`.
- `GET /api/spells/[id]` – full row including `foundry_data`. Role: same.
- `POST/PATCH/DELETE /api/spells[/id]` – Role: `requireAdminAccess`. The
  server-side `upsertSpell` should call `recomputeAppliedRulesForSpell`
  itself so the client doesn't import that internal helper.
- `GET /api/spell-rules`, `POST /api/spell-rules`, `PATCH /api/spell-rules/[id]`,
  `DELETE /api/spell-rules/[id]`.
- `GET /api/spell-rules/[id]/applications`, `PUT /api/spell-rule-applications`,
  `DELETE /api/spell-rule-applications` for the apply/unapply pair.
- `GET /api/classes/[id]/spell-list` – live read of `class_spell_lists` JOIN
  `spells` (already lives at `/api/module/<source>/classes/<class>/spells.json`;
  this is the in-app read).
- `POST /api/classes/[id]/spell-list/rebuild` – staff-only batch rebuild.

### 2.7 Map

- `GET /api/maps?eraId=` – Role: `requireAuthenticatedUser`.
- `GET /api/maps/[id]/markers` and `/highlights` – server-side filter: non-staff
  only see markers whose linked `lore_articles.status='published'` (current
  page does this client-side after the SELECT).
- `POST /api/maps/[id]/markers`, `DELETE /api/markers/[id]` etc. – Role:
  `requireStaffAccess`.

### 2.8 Image metadata

- `GET /api/images/metadata/[storagePath]` – Role: `requireAuthenticatedUser`.
- `PUT /api/images/metadata/[storagePath]` – Role: `requireImageManagerAccess`.
- `DELETE /api/images/metadata/[storagePath]` – same.
- `GET /api/images/references?url=...` – Role: `requireImageManagerAccess`.
  Server runs the SCAN_TARGETS sweep — stops the client from doing 14 raw
  `fetchCollection(col, ...)` calls (one of which is over `users`).
- `POST /api/images/references/rewrite` – body `{ oldUrl, newUrl }`. Role:
  `requireImageManagerAccess`.

### 2.9 System metadata

- `GET /api/system-metadata/[key]` – Role: `requireAuthenticatedUser` (these
  are public settings like the wiki background).
- `PUT /api/system-metadata/[key]` – Role: `requireAdminAccess`.
- `GET /api/system-metadata/last-foundation-update` – Role:
  `requireAuthenticatedUser`. Replaces `checkFoundationUpdate` polling on every
  page (currently does a raw SELECT every 30 s for every signed-in user).

### 2.10 Admin maintenance

- `POST /api/admin/purge/[table]` – Role: `requireAdminAccess`. Server enforces
  an enum of purgable tables. Replaces `Settings.tsx:634` and
  `compendium.ts:554` (`purgeAllSpells`).

---

## 3. Risk list

Concrete scenarios under the current "any signed-in user can SELECT anything"
model. Each entry: what data leaks, the call that exposes it, severity, and the
proposed endpoint that closes it.

### High severity

**H1 — `users.recovery_email` PII leaked to every signed-in user.**
- Path: any signed-in client can call `fetchCollection('users')` from devtools,
  or just navigate to `/profile/<any-username>` which triggers
  `Profile.tsx:26` (`SELECT * FROM users WHERE username = ?`). Both return the
  raw row.
- Affected fields: `recovery_email`, plus `theme`, `accent_color`,
  `active_campaign_id`, `hide_username`, `is_private` (less sensitive but
  documented as not-for-public).
- The docs at [`docs/database/structure/users.md:33`](../database/structure/users.md)
  and [`docs/platform/auth-firebase.md:130`](auth-firebase.md) explicitly
  promise `recovery_email` is never returned to non-admins. **The code
  currently violates that promise.**
- Closed by: `GET /api/profiles/[username]`, `GET /api/me`,
  `GET /api/admin/users`.

**H2 — `lore_articles.dm_notes` (private DM notes) shipped on every wiki page
read.**
- Path: `LoreArticle.tsx:129` is `fetchDocument('lore', id)` which is a `SELECT
  * FROM lore_articles`. `dm_notes` is in the result. The client only renders
  it to staff (line 200), but the column is in the JSON the network sent.
- Same leak on `Wiki.tsx:55`, `Home.tsx:31`, `CampaignManager.tsx:41`,
  `Map.tsx:130`, `CampaignEditor.tsx:69`.
- Closed by: `GET /api/lore/articles` and `GET /api/lore/articles/[id]` with
  `dm_notes` stripped; `GET /api/lore/articles/[id]/dm-notes` for staff only.

**H3 — `lore_secrets` content readable by any signed-in user.**
- Path: `LoreArticle.tsx:208` is a raw SQL `SELECT s.* FROM lore_secrets s
  WHERE s.article_id = ?` with no visibility check. The page filters in JS
  (line 454-458) so the cards only render for the right campaign, but the
  unrendered secrets are still in the React state and the network payload.
- Closed by: `GET /api/lore/articles/[id]/secrets` with server-side visibility
  filter.

**H4 — Other users' character sheets are readable by any signed-in user.**
- Path: `CharacterBuilder.tsx:3184-3191` runs 8 raw `queryD1("SELECT * FROM
  characters WHERE id = ?", [id])` calls with no ownership check. A
  signed-in user can paste any character id and get back the full sheet,
  including `info_json` (which holds character backstory / private notes per
  `docs/database/structure/characters.md:21`).
- Closed by: `GET /api/characters/[id]` with the
  `assertCharacterOwnership(userId, characterId)` pattern from
  `api/spell-favorites.ts:31`.

**H5 — Other users' characters can be modified or deleted.**
- Path: `CharacterBuilder.tsx:3459` (`batchQueryD1(queries)` for save) and
  `:3495` (`deleteDocument("characters", id)`) both run with no server-side
  ownership check beyond "is signed-in". A regular `user` can `PATCH` or
  `DELETE` any character row.
- This is technically gated by the `requireStaffAccess` write rule in
  `d1-proxy.ts:84` — except the current rule routes writes through the staff
  gate, which means a `user` who DELETEs their own character would be blocked
  too. Spot-check: `CharacterBuilder.tsx`'s save path is called by regular
  users. Either the proxy gate isn't actually working for writes from regular
  users (in which case the leak is real) or character saves are broken for
  non-staff (in which case the docs/code disagree). **Both are bugs worth
  closing now via `PUT /api/characters/[id]` + ownership check.**
- Closed by: `PUT /api/characters/[id]`, `DELETE /api/characters/[id]`.

**H6 — A user can promote themselves to admin.**
- Path: `Settings.tsx:117` calls `upsertDocument('users', user.uid, { …profile,
  recovery_email, … })`. The proxy's mutation gate is
  `requireStaffAccess` (line 84 of `d1-proxy.ts`), so a regular `user` *should*
  be 403-blocked from this write — but at the same time, `App.tsx:142,146,154,176`
  also calls `upsertDocument('users', uid, {…})` from non-staff users to write
  their own auto-promotion / new-profile / active-campaign rows. **Either the
  proxy is letting users write to `users` (and they can ship `role: 'admin'`),
  or the App.tsx self-profile flow is permanently 403'd for non-staff.** Worth
  verifying in production logs.
- Even if the proxy currently blocks this, the client codepath spreads
  `{ ...userProfile, role: 'admin' }` if a malicious extension mutates state —
  the role mutation must move to a server-side allow-list.
- Closed by: `PATCH /api/me/profile` (allow-list, never `role`),
  `PATCH /api/admin/users/[id]` (admin-only role changes).

**H7 — Full `campaign_members` and `users` enumeration on every page load.**
- Path: `Navbar.tsx:56,64` fetches every campaign and every membership row for
  the signed-in user. `AdminCampaigns.tsx:67` and `CampaignEditor.tsx:73`
  fetch every users row including PII. Either path returns the full user list
  to staff, which is intended; but `Profile.tsx:33,40` enumerates *other
  users'* memberships to any signed-in viewer of a public profile.
- Closed by: `GET /api/profiles/[username]/campaigns` (filtered server-side to
  the intersection of viewer+target memberships) and
  `GET /api/me/campaign-memberships`.

### Medium severity

**M1 — Draft lore article titles + images leak via the map.**
- Path: `Map.tsx:154` JOINs `map_markers` against `lore_articles`. The query
  also returns `a.title` and `a.status`. The page filters out
  `article_status !== 'published'` markers client-side (line 162-164), but the
  full marker rows including draft titles are in the response.
- Closed by: `GET /api/maps/[id]/markers` with the visibility filter
  server-side.

**M2 — `users` table is fully enumerable by signed-in users, exposing the
attack surface for username harvesting.**
- Path: `CampaignEditor.tsx:73` fetches `users` to populate the player picker.
  Reachable from any signed-in viewer (the page checks `isStaff` client-side,
  but the network call fires from the same React effect that loads the page).
- Even with the staff role-gate enforced at the proxy, this returns every
  user's `display_name`, `username`, `recovery_email`, etc., to anyone who
  passes the staff check.
- Closed by: `GET /api/admin/users` strips columns based on role and includes
  a `?fields=` allow-list for the player picker use-case.

**M3 — `system_metadata` writes are not column-scoped.**
- Path: `setSystemMetadata(key, value)` in `d1.ts:174` runs an UPSERT against
  any key from the client. Currently used legitimately for `wiki_settings`,
  but any signed-in staff member can stomp any key (including
  `last_foundation_update`, which would force every other client to bust its
  cache).
- Closed by: `PUT /api/system-metadata/[key]` with a server-side enum of
  writable keys.

**M4 — `class_spell_lists` rebuild and `spell_rules` recompute fire from the
client.**
- Path: `compendium.ts:516` calls `recomputeAppliedRulesForSpell(id)` inside
  `upsertSpell`, which then runs ~5 raw `queryD1` calls including DELETEs
  against `class_spell_lists`. A signed-in user with the staff gate can DoS
  the table by saving a spell repeatedly.
- Closed by: folding the recompute into a server-side post-save hook on
  `POST /api/spells`.

### Low severity

**L1 — `eras` writes flow through the staff gate even though the docs say
admin-only.** Mismatch between `docs/architecture/permissions-rbac.md:111`
("Admin write") and the actual proxy behavior. Closed by tightening
`POST/PATCH/DELETE /api/admin/eras/*` to `requireAdminAccess`.

**L2 — `image_metadata.scanForReferences` does 14 round-trips that include
`users`.** The function is staff-only but the SELECTs aren't column-scoped.
Closed by `GET /api/images/references` server-side scan.

**L3 — `image_metadata` rename/move runs an `updateDocument(col, m.id, {
[field]: newUrl })` against any column on any table.** No server-side
allow-list on which (table, column) pairs are writable. Closed by
`POST /api/images/references/rewrite`.

**L4 — `checkFoundationUpdate` polling every 30 s is a raw SELECT against
`system_metadata`.** Low data sensitivity, but it means every signed-in tab
fires one D1 read every 30 s through the SQL proxy. Closed by
`GET /api/system-metadata/last-foundation-update` with cacheable headers.

---

## 4. Priority order

Implement top-down. Each item lists the route(s) and the call sites it removes
so it can be checked off concretely. Leaks first, convenience second.

1. **`GET /api/me`, `PATCH /api/me/profile`, `PATCH /api/me/active-campaign`**
   — closes H1 (own-row leak), H6 (role-self-promotion). Highest user-facing
   impact and unblocks dropping the `upsertDocument('users', uid, full
   profile)` pattern. Removes `App.tsx:127,142,146,154,176`,
   `Settings.tsx:117`, `Navbar.tsx:83`.
2. **`GET /api/profiles/[username]` + `GET /api/profiles/[username]/campaigns`**
   — closes H1 for public profile views and H7. Removes `Profile.tsx:26,33,40`.
3. **`GET /api/lore/articles`, `GET /api/lore/articles/[id]`,
   `GET /api/lore/articles/[id]/dm-notes`,
   `GET /api/lore/articles/[id]/secrets`** — closes H2 and H3. Removes
   `Wiki.tsx:55`, `LoreArticle.tsx:129,152-185,208,225`, `Home.tsx:31,48`,
   `CampaignManager.tsx:41,44,45`, `Map.tsx:130`, `CampaignEditor.tsx:69`.
4. **`GET /api/characters/[id]`, `PUT /api/characters/[id]`, `DELETE
   /api/characters/[id]`, `GET /api/me/characters`,
   `GET /api/admin/characters`, `GET /api/characters/[id]/export`** — closes
   H4 and H5. Removes `CharacterList.tsx:37`,
   `CharacterBuilder.tsx:3184-3191,3459,3495`, `CharacterErrorBoundary.tsx:81`,
   `Sidebar.tsx:94`, `characterExport.ts:10`.
5. **`GET /api/me/campaign-memberships`, `GET /api/campaigns`,
   `GET /api/campaigns/[id]`, `GET /api/campaigns/[id]/members`** — closes the
   broader H7 (enumeration), trims the per-page-load footprint dramatically.
   Removes `Navbar.tsx:56,64`, `App.tsx:151`, `Sidebar.tsx:50`,
   `CampaignManager.tsx:35`, `Map.tsx:91`, `Home.tsx:42`, `CampaignEditor.tsx:78,82,137`,
   `LoreArticle.tsx:234`.
6. **`POST /api/lore/articles`, `PATCH /api/lore/articles/[id]`,
   `DELETE /api/lore/articles/[id]` + secrets variants** — moves the
   multi-table batch into the handler. Removes `lib/lore.ts` external surface.
7. **`GET /api/admin/users`, `PATCH /api/admin/users/[id]`,
   `DELETE /api/admin/users/[id]`** — closes M2 (column-scoped admin reads).
   Removes `AdminUsers.tsx:55,101,127,142,168,196,358,370,417`,
   `AdminCampaigns.tsx:62`, `CampaignEditor.tsx:73`.
8. **`POST /api/campaigns`, `PATCH /api/campaigns/[id]`,
   `DELETE /api/campaigns/[id]`, member PUT/DELETE,
   `POST/PATCH/DELETE /api/admin/eras/*`** — finishes the campaigns surface.
   Removes `CampaignEditor.tsx:133,143,154`,
   `AdminCampaigns.tsx:97,132,160,183,200,218,328`, `AdminUsers.tsx:111,166`.
9. **`GET /api/maps/[id]/markers`, `GET /api/maps/[id]/highlights`,
   `POST/PATCH/DELETE /api/markers/*`** — closes M1. Removes `Map.tsx:154-178,203,220`.
10. **`GET/POST/PATCH/DELETE /api/spells` family + `/api/spell-rules` family
    + `/api/classes/[id]/spell-list` family** — folds the rule-recompute
    server-side (closes M4). Removes
    `compendium.ts:476-616`, `spellRules.ts` external surface,
    `classSpellLists.ts` external surface.
11. **`GET /api/compendium/<table>` foundation reads + per-table mutate
    endpoints** — large surface but mechanically simple. Pick a sub-batch per
    PR (tags/tag_groups; skills/tools/weapons/armor; etc.). Removes the bulk
    of the `fetchCollection` foundation reads in `ClassEditor.tsx`,
    `SubclassEditor.tsx`, `UniqueOptionGroupEditor.tsx`, `ToolsEditor.tsx`,
    `SkillsEditor.tsx`, `admin/ArmorEditor.tsx`, `admin/WeaponsEditor.tsx`,
    `admin/SimplePropertyEditor.tsx`, `admin/StatusesEditor.tsx`,
    `admin/SpellcastingTypeEditor.tsx`, `admin/StandardMulticlassEditor.tsx`,
    `admin/SpellcastingAdvancementManager.tsx`, scaling editors,
    `TagsExplorer.tsx`, `compendium.ts` items/feats/features helpers.
12. **`GET/PUT/DELETE /api/images/metadata/*`, `GET /api/images/references`,
    `POST /api/images/references/rewrite`** — closes L2 + L3. Removes
    `lib/imageMetadata.ts` external surface.
13. **`GET /api/system-metadata/[key]` + `PUT` + the polling-friendly
    `last-foundation-update` variant** — closes M3 + L4. Removes
    `d1.ts:143-179` external surface.
14. **`POST /api/admin/purge/[table]`** — closes the maintenance DDL hole.
    Removes `Settings.tsx:634`, `compendium.ts:554`.
15. **Decommission `/api/d1/query`** — remove `api/_lib/d1-proxy.ts`,
    `api/d1/query.ts`, and the `queryD1` / `batchQueryD1` /
    `fetchCollection` / `fetchDocument` / `upsertDocument` /
    `updateDocument` / `deleteDocument` / `deleteDocuments` /
    `upsertDocumentBatch` exports from `src/lib/d1.ts`. Keep the in-memory and
    sessionStorage caches but reshape them around the new endpoint URLs
    (replace the SQL-keyed cache with route-keyed caching).

---

## 5. Out of scope (drift notes)

Things noticed while reading the code that aren't endpoint work but should be
filed somewhere:

- **`docs/database/structure/users.md:33`** claims `recovery_email` is
  "migrated but never returned in public-facing API responses." The code
  returns it from every `SELECT * FROM users`. This is risk H1; the doc is
  aspirational, not descriptive.
- **`docs/platform/auth-firebase.md:130`** makes the same promise: "The proxy
  strips it from any response that leaves the server." There is no such strip
  — the proxy in `api/_lib/d1-proxy.ts` is column-blind.
- **`docs/architecture/permissions-rbac.md:104-117`** documents a `Per-table
  access patterns` matrix ("Self or staff" / "Public read" / etc.) that the
  code does not enforce. The matrix is currently a spec for the work this doc
  plans, not a description of behavior.
- **`docs/architecture/permissions-rbac.md:117`** says "the proxy currently
  uses `requireStaffAccess` for most write paths." It does — but writes from
  `App.tsx`/`Settings.tsx`/`Navbar.tsx` profile-save paths and from
  `CharacterBuilder.tsx` save paths come from non-staff users. Either those
  writes are silently failing for non-staff users in production (in which case
  there's a bug to file), or the proxy is admitting them (in which case the
  doc is wrong). Worth a 10-minute spot check in Vercel logs.
- **`src/App.tsx:142,146,154,176`** auto-promotes the username `admin` / `gm`
  / the owner email to `role: 'admin'` from the client. This works because
  the proxy's mutation gate currently sees a fresh-signed-in user without a
  D1 row — but the logic could be moved server-side into `GET /api/me`, which
  is more defensible.
- **`src/lib/imageMetadata.ts:35-43`** (the `SCAN_TARGETS` constant) duplicates
  knowledge of every image-referencing column across the codebase. When the
  scan moves to the server (`GET /api/images/references`), this constant
  should move with it; do not leave a copy on the client.
- **`src/lib/tagMerge.ts:38-46`** and **`src/lib/tagUsage.ts:88-130`** maintain
  parallel lists of "every tag-storing column." The migration is a good moment
  to consolidate into one server-side helper.
- **`src/lib/d1.ts:14-28`** (the `PERSISTENT_TABLES` const) and
  `:261-284` (`jsonFields`) both encode schema knowledge in the client. After
  the migration, these should move to server-side response shaping so the
  client only sees parsed JSON and never has to know which tables are cacheable.
- **`api/_lib/d1-internal.ts:35`** has its own mutation detection regex that
  doesn't include `CREATE/DROP/ALTER/TRUNCATE/etc.` (only
  `INSERT/UPDATE/DELETE/REPLACE`). That's fine for the internal path (the
  server controls the SQL), but worth a comment so it doesn't accidentally
  drift toward being a generic client-callable surface.
- **`src/lib/d1.ts:340-389`** (`batchQueryD1`) is a backdoor around the
  per-route migration — it lets any signed-in caller (after the gate split)
  ship an arbitrary array of SQL statements. Decommissioning this is part of
  step 15 above but is worth its own audit pass to make sure no
  not-yet-migrated caller is using it.
- **`src/pages/core/Settings.tsx:628-633`** ("purge collection") synthesises
  table names from collection names client-side via `replace(/[A-Z]/g, …)`. If
  the `POST /api/admin/purge/[table]` endpoint lands first, the client should
  pass the collection name (e.g. `'tagGroups'`) and let the server resolve
  it — the table-name calculation logic lives twice today
  (`src/lib/d1Tables.ts` and `api/_lib/d1-fetchers-server.ts:19-78`).
- **`src/lib/lore.ts:142,210`** uses dynamic `await import("./d1")` inside
  `fetchLoreArticle` and `fetchLoreSecrets`. Once those go through dedicated
  endpoints, the dynamic import dance can go away.
- **`docs/platform/auth-firebase.md:90`** documents the signatureless-token
  fallback in `api/_lib/firebase-admin.ts:80-101`. The fallback grants admin
  if no service-account is configured, which is a real foot-gun in any
  environment that isn't local dev. The new per-route endpoints inherit this
  fallback — when migrating, make sure prod still has
  `FIREBASE_SERVICE_ACCOUNT_JSON` set so the fallback path never fires for
  real users.
