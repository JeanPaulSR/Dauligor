# Security Gates

How the app keeps unauthorised callers out of sensitive data. Two layers run in series — per-route endpoints with column-scoping / ownership checks, and a generic SQL proxy with a table-aware gate that catches anything that tries to skip the per-route path. This doc covers the model, the per-table policy, the regex shapes the proxy uses, how to extend the gate, and what is intentionally deferred.

For the role definitions (`admin`, `co-dm`, `lore-writer`, `trusted-player`, `user`) and the `require*` helpers, see [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md). For the per-route endpoint surface, see [api-endpoints.md](api-endpoints.md). For the migration history that produced this state, see [api-endpoint-plan.md](api-endpoint-plan.md).

## Threat model

Every signed-in user has a Firebase JWT. The token is verified server-side and the caller's `role` is read from D1. Without further checks, an authenticated user could:

1. Open devtools and `fetch('/api/d1/query', { body: JSON.stringify({ sql: 'SELECT * FROM users' }) })` to exfiltrate every user's `recovery_email`, `bio`, etc.
2. `fetch('/api/d1/query', { body: JSON.stringify({ sql: "UPDATE users SET role = 'admin' WHERE id = '<their-uid>'" }) })` to self-promote.
3. `fetch('/api/d1/query', { body: JSON.stringify({ sql: 'SELECT * FROM characters WHERE id = ?' }) })` to read someone else's character sheet.
4. `setSystemMetadata('last_foundation_update', 'fake')` to force every other client to bust its cache (cheap DoS).

The per-route endpoints answer #1–#3 by column-scoping responses and adding ownership / membership checks. The proxy gate hardens against the same attacks by refusing the raw SQL shape — so the per-route promises hold even when a caller bypasses the UI.

The gates do NOT defend against:

- A compromised admin token (admin can do everything by design).
- The signatureless-token fallback in `api/_lib/firebase-admin.ts:80-101` if a deploy is missing `FIREBASE_SERVICE_ACCOUNT_JSON` — that fallback grants admin and exists for local dev only. See [auth-firebase.md](auth-firebase.md).
- Anything the Cloudflare Worker would accept directly via `R2_API_SECRET`, which is server-only.

## Two layers, in series

### Layer 1 — Per-route endpoints (the preferred path)

One Vercel function per resource. Each handler:

1. Reads the `Authorization: Bearer <token>` header.
2. Calls one of the `require*` helpers (`requireAuthenticatedUser`, `requireStaffAccess`, `requireImageManagerAccess`, `requireAdminAccess`, `requireCharacterAccess`).
3. Selects only the columns the caller is allowed to see, or runs the ownership / membership check before the query.
4. Returns a shaped JSON envelope (`{ profile }`, `{ articles }`, `{ campaigns }`, etc.) — never the raw row from D1.

The reference example is [api/spell-favorites.ts](../../api/spell-favorites.ts): explicit auth scope, user id derived from the verified token (never a body field), table-specific SQL kept inside the handler, ownership checks before writes.

The full surface lives in [api-endpoints.md](api-endpoints.md).

### Layer 2 — Proxy gate (`/api/d1/query`)

The generic SQL proxy at [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts) still handles compendium reads (skills, tools, weapons, armor, spells, feats, items, classes, subclasses, tags, tag_groups, attributes, scaling_columns, etc.) — these are public-among-signed-in data with no per-row privacy contract.

For sensitive tables, the proxy refuses the SQL and points the caller at the per-route endpoint. This means the column-scoping promises in Layer 1 actually hold from a devtools perspective — a hostile signed-in user cannot route around the per-route endpoint to read a column it strips.

The proxy is intentionally NOT being decommissioned. See [api-endpoint-plan.md §15](api-endpoint-plan.md) for the rationale (migrating ~30 public compendium reads to per-route endpoints would burn the function budget for no real privacy gain).

## How the proxy gate decides

Every request to `/api/d1/query` runs through this decision tree:

```
1. Normalize the SQL (strip comments + unwrap quoted identifiers).
2. Test the normalized SQL against the table-policy regexes:
   - Is it a mutation?               → MUTATION_KEYWORDS
   - Does it touch a protected write table? → PROTECTED_WRITE_TABLES
   - Does it touch a protected read table?  → PROTECTED_READ_TABLES
   - Is it a system_metadata write?  → SYSTEM_METADATA_WRITE_PATTERN
   - Is it a campaigns write?        → CAMPAIGN_WRITE_PATTERN
3. Apply the first matching rule from the table below.
```

| Condition | Outcome | Notes |
|---|---|---|
| System-metadata write AND not the foundation-bump fingerprint | **403** | Pointed at `PUT /api/lore/system-metadata/wiki-settings` |
| Campaign-table write (campaigns or campaign_members) | **403** | Pointed at `POST/PATCH/DELETE /api/campaigns[/...]` |
| Mutation AND protected-write table (`users`, `eras`, `lore_*`) | `requireAdminAccess` | The L1 / H6 closures |
| Mutation (any other table) | `requireStaffAccess` | Compendium edits, the foundation bump fingerprint, etc. |
| SELECT AND protected-read table (`users`, `lore_secrets`, `characters`, `character_*`) | **403** | Pointed at the per-route endpoint family |
| SELECT (any other table) | `requireAuthenticatedUser` | Compendium reads, lore_articles list, etc. |

The two **403** branches surface the per-route endpoint name in the error message so a legitimate caller knows where to go.

### Normalization

`normalizeSqlForGate(sql)` runs before any regex test. Two transforms in order:

1. Strip SQL comments. `/* ... */` block and `-- ...` line comments both let a hostile caller break up keywords so `INSERT/*x*/INTO/*x*/users` could evade the bare-identifier gate. Each comment becomes a single space so adjacent tokens stay separated.
2. Unwrap SQLite identifier-style quotes. `"users"`, `` `users` ``, and `[users]` are all valid SQLite identifier quoting and would otherwise slip past `\b users \b`. The unwrap only fires on identifier shapes (`[a-z_][a-z0-9_]*`) — string literals (`'…'`) are left alone, both because they're values not tables and because mangling them could distort the gate's read.

The normalized SQL is **only** used for the gate decision. The original SQL is what the Worker actually executes.

### The protected-table regexes

| Constant | Pattern | Tables |
|---|---|---|
| `MUTATION_KEYWORDS` | `\b(INSERT\|UPDATE\|DELETE\|REPLACE\|CREATE\|DROP\|ALTER\|TRUNCATE\|ATTACH\|DETACH\|REINDEX\|VACUUM\|PRAGMA)\b` | Any DML or DDL keyword |
| `PROTECTED_WRITE_TABLES` | `\b(?:INTO\|FROM\|UPDATE\|TABLE)\s+(?:users\|eras\|lore_\w+)\b` | `users`, `eras`, every `lore_*` table |
| `PROTECTED_READ_TABLES` | `\bFROM\s+(?:users\|lore_secrets\|characters\|character_\w+)\b` | `users`, `lore_secrets`, `characters`, every `character_*` table |
| `SYSTEM_METADATA_WRITE_PATTERN` | `\b(?:INTO\|FROM\|UPDATE\|TABLE)\s+system_metadata\b` | `system_metadata` |
| `FOUNDATION_BUMP_PATTERN` | `^\s*UPDATE\s+system_metadata\s+SET\s+value\s*=\s*CURRENT_TIMESTAMP\s+WHERE\s+key\s*=\s*'last_foundation_update'\s*$` | The exact `bumpFoundationUpdate()` SQL shape |
| `CAMPAIGN_WRITE_PATTERN` | `\b(?:INTO\|FROM\|UPDATE\|TABLE)\s+(?:campaigns\|campaign_members)\b` | `campaigns`, `campaign_members` |

`MUTATION_KEYWORDS` is intentionally broad. A SELECT that happens to mention "UPDATE" inside a string literal falls to the more restrictive staff path — safe by default. The audit's H6 closure added the DDL verbs so a signed-in user can't `DROP TABLE users` through the proxy.

`FOUNDATION_BUMP_PATTERN` is fingerprint-tight on purpose. The bump call site in `src/lib/d1.ts:bumpFoundationUpdate` emits exactly this SQL; any drift in that helper would silently start failing here, which forces the call site to either match or move to a per-route endpoint.

## Per-table policy

Every D1 table sits in one of five cells. The intended policy below is the one actually enforced today — the cells are aligned across the per-route handlers, the proxy gate, and the database constraints.

| Table | Read | Write |
|---|---|---|
| `users` (own) | Per-route `GET /api/me` (full row including `recovery_email`) | Per-route `PATCH /api/me` (allow-listed columns, no `role`) |
| `users` (others) | Per-route `GET /api/profiles/[username]` (curated subset; `recovery_email` never leaves the server for non-self non-admin) | Per-route `PATCH /api/admin/users/[id]` (admin only) |
| `users` (admin list) | Per-route `GET /api/admin/users` (column-scoped: admin gets `recovery_email`, wiki staff gets the basic set) | Same as above |
| `characters` / `character_*` | Per-route `GET /api/characters/[id]` (owner-or-DM) or `GET /api/me/characters` (own list); proxy refuses raw SELECT | Per-route `PUT/DELETE /api/characters/[id]` (owner-or-DM); proxy admits staff for the FK-cascade DELETE during character save |
| `lore_articles` | Per-route `GET /api/lore/articles[/id]` (non-staff get published only; `dm_notes` stripped); proxy admits raw reads but it's defensive — the per-route is the documented path | Per-route `PUT/DELETE /api/lore/articles/[id]` (wiki staff); proxy refuses (`PROTECTED_WRITE_TABLES`) |
| `lore_secrets` | Per-route `GET /api/lore/articles/[id]/secrets` (server-filtered by viewer's `active_campaign_id`); proxy refuses raw SELECT | Per-route `PUT/DELETE /api/lore/articles/[id]/secrets/[secretId]` (wiki staff); proxy refuses |
| `lore_meta_*` / `lore_article_*` / `lore_secret_*` / `lore_links` | Proxy admits raw reads (no privacy contract — they're junction / metadata tables for already-public articles) | Proxy refuses (every `lore_*` is in `PROTECTED_WRITE_TABLES`); per-route write goes through the article-upsert handler |
| `campaigns` | Per-route `GET /api/campaigns[/id]` (member-or-staff filtered) | Per-route `POST/PATCH/DELETE /api/campaigns[/id]` (admin + co-dm); proxy refuses (`CAMPAIGN_WRITE_PATTERN`) |
| `campaign_members` | Per-route `GET /api/campaigns/[id]/members` or `GET /api/me/campaign-memberships` | Per-route `PUT/DELETE /api/campaigns/[id]/members/[uid]` (admin + co-dm); proxy refuses |
| `eras` | Proxy (signed-in read) | Proxy admits admin only (`PROTECTED_WRITE_TABLES`); UI hides the CRUD for non-admin |
| `system_metadata` | Proxy (signed-in read — values are non-sensitive config blobs) | Proxy admits only the foundation-bump fingerprint; legit `wiki_settings` write goes through `PUT /api/lore/system-metadata/wiki-settings` (admin) |
| `image_metadata` | Proxy admits signed-in reads | Proxy admits image-manager writes; reference scan / rewrite moved to `POST /api/r2/scan-references` and `POST /api/r2/rewrite-references` so they can reach `users` / `characters` past the read gate |
| `maps` / `map_markers` / `map_highlights` | Proxy (signed-in read); marker queries do their own lore-article filter client-side via the gate-filtered `allArticles` array | Proxy (staff write) |
| `spell_favorites` (per user) | Per-route `GET /api/spell-favorites` only | Per-route `POST /api/spell-favorites` only |
| Compendium foundation (`skills`, `tools`, `weapons`, `armor`, `spells`, `feats`, `items`, `classes`, `subclasses`, `features`, `scaling_columns`, `spellcasting_progressions`, `unique_option_*`, `tags`, `tag_groups`, `attributes`, `damage_types`, `status_conditions`, `condition_categories`, `multiclass_master_chart`, `sources`) | Proxy (signed-in read — these are the public rules content) | Proxy (staff write; intended admin-only but currently gated to the wider staff set) |

## How to extend

### Adding a new sensitive read

If a new table joins the privacy-contract category (per-row privacy that the proxy must NOT serve raw):

1. Extend `PROTECTED_READ_TABLES` in `api/_lib/d1-proxy.ts`. Use the same `\bFROM\s+(?:…)\b` shape so quoted-identifier and SQL-comment evasions stay blocked.
2. Add a per-route endpoint that does the row-level check + column-scoping.
3. Migrate every client caller. **Crucial** — without this, the page silently 403s (the try/catch in many client helpers swallows the error).
4. Run the probe set (see "Verification" below) and confirm the new pattern blocks every shape you expect.
5. Update this doc's per-table table.

### Adding a new sensitive write

If a new table needs admin-only writes (matching the `users` / `eras` / `lore_*` pattern):

1. Extend `PROTECTED_WRITE_TABLES` (broad: catches every mutation keyword + the four `INTO|FROM|UPDATE|TABLE` shapes).
2. If the table needs ANY write to go through a per-route endpoint (not just admin-gated), add a new `*_WRITE_PATTERN` constant and a 403 branch that points at the per-route endpoint name.
3. Repeat the migration + probe steps from above.

### Adding a new singleton-config key (like `wiki_settings`)

The `system_metadata` proxy gate refuses **any** non-bump write. Don't try to relax it. Instead:

1. Add a dedicated per-route endpoint — e.g. `PUT /api/<domain>/system-metadata/<key>`. Fold it into an existing dispatcher to save the function slot.
2. The handler:
   - Gates on the appropriate role (`requireAdminAccess` for admin-only config).
   - Validates the body shape (size cap + JSON-serializability at minimum).
   - Runs the `INSERT … ON CONFLICT(key) DO UPDATE` against `system_metadata` via `executeD1QueryInternal` (the internal path bypasses the proxy gate intentionally — we run with the shared worker secret).
3. Never add a generic `PUT /system-metadata/[key]` — it'd be abusable to invent new keys.

### Adding a new per-route endpoint with new behavior

The pattern (mirrored from `api/me.ts`, `api/lore.ts`, `api/campaigns.ts`):

1. One file at `api/<resource>.ts`.
2. `vercel.json` rewrite `/api/<resource>/(.*) → /api/<resource>` so sub-paths work despite Vercel pure-functions filesystem routing not supporting real catch-all syntax.
3. Inside the handler, parse the original path out of `req.url` (the rewrite preserves it).
4. Dispatch on `(req.method, parsed-path)`.
5. Validate body shape (allow-list of fields; type / length / shape checks).
6. Hit `executeD1QueryInternal` for the actual queries — bypasses the proxy gate.

## Verification

The proxy gate has a 30-probe set covering every branch (writes vs. reads vs. system_metadata vs. campaigns), quoted-identifier evasions, comment-evasion shapes, and the boundary between sensitive and compendium tables.

A standalone Node script can reproduce it locally — the gate regexes are pure functions of the SQL string:

```bash
# From the repo root, paste each commit's probe block into `node -e "<script>"`.
# Each commit message names the probe count for that change (e.g.,
# "30/30 pass", "13/13 pass"). The session log in
# docs/platform/api-endpoint-plan.md tracks which closures were verified.
```

When extending `PROTECTED_READ_TABLES` or `PROTECTED_WRITE_TABLES`, add probes covering:

- The bare unquoted name (`SELECT * FROM <table>`).
- The three SQLite identifier-quoting forms (`"<table>"`, `` `<table>` ``, `[<table>]`).
- A comment-evasion variant (`SELECT/*x*/*/*x*/FROM/*x*/<table>`).
- A legitimate non-target query that should still pass (`SELECT * FROM <similarly-named-but-different-table>`).

## Known limitations / deferred items

The following are open in [api-endpoint-plan.md](api-endpoint-plan.md):

- **M4** — `recomputeAppliedRulesForSpell` runs ~5 raw queryD1 calls from the client during `upsertSpell`. Staff-only, but a DoS vector (repeatedly save → repeatedly recompute). Closing this needs a `POST /api/spells` family that doesn't exist yet.
- **L4** — `checkFoundationUpdate` polling. A raw SELECT against `system_metadata.last_foundation_update` from every signed-in tab every 30s. Low data sensitivity; deferred for function-budget pressure.
- **Audit #9** — ✅ Closed. `POST` / `PATCH` / `DELETE /api/admin/eras[/id]` folded into `api/campaigns.ts` (dispatcher sniffs the `/api/admin/eras` prefix; admin-only via per-handler `requireAdminAccess`). `eras` stays in `PROTECTED_WRITE_TABLES` as defense-in-depth.
- **LoreEditor `dm_notes` raw read** — closed via `8f70135`; the per-route GET now returns `dm_notes` for staff. The historical defensive fallback in `src/lib/lore.ts:fetchLoreArticle` is removed.

## Audit history

Six commits closed the high + medium + most low items between `515eb0e` and `c065c17`:

| Commit | Closes | Notes |
|---|---|---|
| `515eb0e` | H1, H3, H4 (read leaks) | `PROTECTED_READ_TABLES` + lore_secrets + SpellList characters migration |
| `977d71e` | L2, L3 | Image scan / rewrite moved to `POST /api/r2/scan-references` and `POST /api/r2/rewrite-references` |
| `8f70135` | LoreEditor reads migration | `fetchLoreArticle` → per-route GET |
| `c2ea4d6` | M1 | Map JOIN dropped; titles looked up from gate-filtered `allArticles` |
| `4548518` | M3 | Foundation-bump fingerprint allowlist + `PUT /api/lore/system-metadata/wiki-settings` |
| `c065c17` | Audit #8 | Per-route campaign writes; proxy refuses direct writes |

Earlier closures (H1 read side, H2, H5, H6, H7, M2, L1, audit #6) landed in the work tracked at the top of [api-endpoint-plan.md](api-endpoint-plan.md).

## Related docs

- [api-endpoints.md](api-endpoints.md) — full per-route surface
- [api-endpoint-plan.md](api-endpoint-plan.md) — migration history + remaining items
- [d1-architecture.md](d1-architecture.md) — D1 client API + caching
- [auth-firebase.md](auth-firebase.md) — JWT verification, server-side helpers
- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions and per-table policy summary
