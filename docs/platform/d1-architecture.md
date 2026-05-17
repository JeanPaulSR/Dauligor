# D1 Architecture

The data layer that replaces Firestore. This doc covers the D1 client API, the three-layer cache, the foundation heartbeat, and migration patterns. Schema details for individual tables live in [../database/structure/](../database/structure/).

## The pieces

| Piece | Path | Role |
|---|---|---|
| Client lib | [src/lib/d1.ts](../../src/lib/d1.ts) | All D1 reads and writes from the browser |
| Express/Vercel proxy | [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts) | Verifies Firebase JWT, forwards to Worker |
| Worker endpoint | [worker/index.js](../../worker/index.js) (`/query`) | `env.DB.prepare(sql).bind(...).all()` |
| Schema migrations | [worker/migrations/](../../worker/migrations/) | `0001_phase1_foundation.sql` … `0011_system_metadata.sql` |
| Migration scripts | [scripts/migrate.js](../../scripts/migrate.js) | Copies live Firestore data into local D1 |

## Client API

Everything is exported from [src/lib/d1.ts](../../src/lib/d1.ts). Use these instead of any direct `firebase/firestore` calls.

### Read

```ts
// Higher-level helpers — preferred for most call sites
const rows = await fetchCollection<Class>('classes', null, {
  where: 'source_id = ?',
  params: [sourceId],
  orderBy: 'name ASC',
});

const cls = await fetchDocument<Class>('classes', classId, null);

// Direct SQL — when you need joins, aggregates, or non-trivial WHERE clauses
const rows = await queryD1<{ count: number }>(
  'SELECT COUNT(*) as count FROM spells WHERE level = ?',
  [3]
);
```

### Write

```ts
// Single upsert
await upsertDocument('classes', classId, {
  name: 'Cleric',
  source_id: phbId,
  hit_die: 8,
  proficiencies: { ... },   // objects auto-stringified
});

// Batch upsert (single network round-trip)
await upsertDocumentBatch('features', featureRows);

// Delete
await deleteDocument('classes', classId);
await deleteDocuments('features', 'parent_id = ?', [classId]);
```

### Collection-name → table-name resolution

`d1.ts` keeps a `D1_TABLE_MAP` that translates the Firestore-era collection names callers still use into snake_case D1 table names:

```ts
'damageTypes'        → 'damage_types'
'standardMulticlassProgression' → 'multiclass_master_chart'
'spellcastingScalings' → 'spellcasting_progressions'
'lore'                → 'lore_articles'
…
```

If a name isn't in the map, the helper falls back to a generic camelCase → snake_case conversion. **Add new entries to `D1_TABLE_MAP` rather than depending on the fallback** — being explicit prevents drift if the table is later renamed.

## The three-layer cache

`queryD1` reads run through a three-layer cache that sits on top of the network call.

| Layer | TTL | Where | What |
|---|---|---|---|
| **Inflight de-dup** | duration of one query | Module-scoped `INFLIGHT_REQUESTS` map | If the same `(sql, params)` key is mid-flight, both callers share the single promise |
| **In-memory** | 5 minutes | Module-scoped `QUERY_CACHE` map | Lasts for the tab's session; reset on hard reload |
| **sessionStorage** | 1 hour | Browser sessionStorage with `dauligor_cache_` prefix | Survives page reload; **only used for "persistent" tables** |

### What counts as a "persistent" table

Tables that change rarely and can be aggressively cached. The list lives in `PERSISTENT_TABLES` inside `d1.ts`:

```
eras, sources, skills, tools, weapons, armor, languages, damage_types,
status_conditions, attributes, tag_groups, tags, scaling_columns,
weapon_properties, armor_categories, weapon_categories, tool_categories,
language_categories, condition_categories, lore_articles, lore_meta_*,
lore_secrets, lore_article_*, lore_secret_*, lore_links, campaigns,
items, feats
```

A query against any of these tables auto-populates sessionStorage. A query against any other table is in-memory only.

### Bypassing the cache

```ts
const fresh = await queryD1(sql, params, { noCache: true });
```

Use `noCache` when:
- The result must be a definitive read after a same-tab mutation (rare — mutations already invalidate).
- Polling for change detection (the foundation heartbeat below uses this).
- Debugging cache-related behaviour.

## Mutation invalidation

Every non-SELECT query inspects the SQL for the affected table and clears the cache for that table — both layers (in-memory and, where applicable, sessionStorage).

```ts
// Internally, after an INSERT/UPDATE/DELETE/REPLACE:
const tableName = matched_from_sql;
clearCache(tableName);
```

If the affected table is in `PERSISTENT_TABLES`, the mutation also calls `bumpFoundationUpdate()`, which writes `CURRENT_TIMESTAMP` to a row in the `system_metadata` table.

If a mutation's SQL doesn't match the simple regex for table extraction, the cache is cleared globally. That's a "nuclear option" for complex multi-table writes.

## Foundation heartbeat (cross-tab cache invalidation)

When the user has multiple tabs of the app open and an admin mutates a persistent table in one tab, the other tabs need to invalidate their sessionStorage caches. The mechanism:

1. `App.tsx` polls `checkFoundationUpdate()` on a 30-second interval.
2. `checkFoundationUpdate()` reads `system_metadata.last_foundation_update` with `noCache: true`.
3. If the timestamp is newer than the last seen, every tab clears its persistent caches.

The polling SQL is the only call that's intentionally uncached so that the heartbeat actually heartbeats.

## Row shape — snake_case is the wire shape

Rows returned by `queryD1` / `fetchCollection` / `fetchDocument` arrive with their **raw D1 column names**. The schema convention is `snake_case` (see [../database/README.md §schema philosophy](../database/README.md#schema-philosophy)) so reads look like:

```ts
const rows = await fetchCollection<any>('spellcastingTypes', { orderBy: 'name ASC' });
const row = rows[0];
row.foundry_name      // ← string ("full") — read the column name verbatim
row.foundryName       // ← undefined. The d1 layer does NOT snake→camel by default.
row.created_at        // ← ISO string
row.proficiencies     // ← already-parsed object (auto-parse JSON list, below)
```

There is **no automatic snake→camel conversion** in the fetch path. Adding one would conflict with [database-memory.md §2 — no backwards compatibility](../database-memory.md#operating-principles): a `row.snake_case ?? row.camelCase` dual-read pattern is explicitly forbidden, so picking a single shape and sticking with it is the rule.

### When to denormalize

Editor state code often wants camelCase (so it can spread directly into form controls bound to `setName` / `setHitDie` etc.). For those call sites the explicit opt-in is `denormalizeCompendiumData(row)` in [src/lib/compendium.ts](../../src/lib/compendium.ts), which maps a known set of snake→camel keys (`source_id` → `sourceId`, `hit_die` → `hitDie`, etc.).

```ts
import { denormalizeCompendiumData } from '../lib/compendium';

const raw = await fetchDocument<any>('classes', classId);
const cls = denormalizeCompendiumData(raw);
cls.sourceId       // ← camelCased — safe to read here.
cls.foundry_name   // ← still works; the helper merges, doesn't strip.
```

**Decision tree:**
- *Reading a row to use server-side or in an export pipeline*: read raw snake_case keys. Skip the helper.
- *Reading a row into editor state*: pass through `denormalizeCompendiumData` once, then everything downstream sees camelCase consistently.
- **Never** write `row.field_name ?? row.fieldName` fallbacks. If a column doesn't have a known camelCase alias in `denormalizeCompendiumData`, either add it to that map or use the snake_case form directly.

### Auditing existing dual-reads

Several legacy call sites still have `row.snake_case ?? row.camelCase` patterns left over from the Firestore→D1 transition. These are flagged in `memory/project_dual_shape_cleanup.md` as a pending cleanup. New code must not add to that list.

### Gotchas

- `denormalizeCompendiumData` only maps the keys listed in its `mapping` table. If you add a new snake_case column the editor needs in camelCase, **add the mapping entry too** — otherwise editor state reads will silently see undefined.
- `JSON.parse` ordering: `queryD1` auto-parses a fixed list of JSON columns BEFORE handing the row back. The auto-parse list is keyed by column name (snake_case). If you add a new JSON column, add its snake_case name to the auto-parse list in `d1.ts` (see [JSON column convention](#json-column-convention) below).
- Server-side reads via `executeD1QueryInternal` go through the same Worker `/query` endpoint, so rows arrive with the same snake_case shape. The drift mirror `api/_lib/_classExport.ts` of `src/lib/classExport.ts` must keep the same column names on both sides.

## JSON column convention

D1 is plain SQLite — there is no native JSON type. Complex nested values are stored as JSON-stringified TEXT and parsed client-side.

`queryD1` automatically parses these column names if their value is a string:

```
proficiencies, spellcasting, activities, effects, tags, class_ids,
class_levels, progression, selections, inventory, spells, meta_data,
classifications, values, levels, option_ids, fixed_ids, category_ids,
optionIds, fixedIds, categoryIds, prerequisites_items, tag_ids, tagIds,
properties, advancements, uses_recovery
```

If you add a new JSON-stored column, also add it to the auto-parse list in `d1.ts`. Otherwise callers will see strings instead of objects and silently break.

`upsertDocument` automatically stringifies any object value, so the write side requires no special handling.

## Adding a new table

1. Add the schema to a new `worker/migrations/00NN_*.sql` file.
2. Apply locally: `cd worker && npx wrangler d1 execute dauligor-db --local --file migrations/00NN_*.sql`.
3. Add an entry to `D1_TABLE_MAP` in [src/lib/d1Tables.ts](../../src/lib/d1Tables.ts). Mirror it in [api/_lib/d1-fetchers-server.ts](../../api/_lib/d1-fetchers-server.ts) if the table is also read by server-side endpoints.
4. If the new table holds JSON columns, add them to the auto-parse list in `src/lib/d1.ts:queryD1` (and the matching list in `api/_lib/d1-fetchers-server.ts`).
5. Add it to `PERSISTENT_TABLES` only if it's read-mostly.
6. Add its schema doc to [../database/structure/](../database/structure/).
7. Apply locally first; validate the affected call sites; then apply with `--remote`.

### Adding a new query path

- Prefer `fetchCollection` / `fetchDocument` for simple reads. They handle caching and JSON parsing.
- Use `queryD1` directly for joins, aggregates, or non-`SELECT *` projections.
- Use `batchQueryD1` when you have multiple writes that should run in a single round-trip (e.g., character save: characters + character_progression + character_selections + character_inventory at once).

### Common idioms

```ts
// Conditional load on selector change
useEffect(() => {
  if (!classId) return;
  fetchDocument<Class>('classes', classId, null).then(setClassData);
}, [classId]);

// Bulk fetch then set state once
const [skills, tools, languages] = await Promise.all([
  fetchCollection<Skill>('skills', null, { orderBy: 'name ASC' }),
  fetchCollection<Tool>('tools', null, { orderBy: 'name ASC' }),
  fetchCollection<Language>('languages', null, { orderBy: 'name ASC' }),
]);

// Save flow with batch
const ops: { sql: string; params: any[] }[] = [];
ops.push({ sql: 'INSERT OR REPLACE INTO characters (...) VALUES (...)', params: [...] });
for (const row of progression) ops.push({ sql: '...', params: [...] });
for (const sel of selections)  ops.push({ sql: '...', params: [...] });
await batchQueryD1(ops);
```

## Per-route endpoints — the preferred shape for new work

The generic `/api/d1/query` proxy still handles most compendium reads, but every new endpoint should be modeled on the per-route pattern: one Vercel function per resource (e.g. `api/me.ts`, `api/lore.ts`, `api/campaigns.ts`, `api/characters/[id].ts`, `api/profiles/[username].ts`), each with its own role gate and its own SQL kept inside the handler. The reference example is [api/spell-favorites.ts](../../api/spell-favorites.ts) — explicit auth scope, user id derived from the verified token, table-specific SQL, ownership checks before writes.

Why this matters: under the legacy generic-proxy path, any signed-in user can paste an arbitrary `SELECT` into devtools and exfiltrate columns the UI never shows. Per-route endpoints column-scope the response so the wire never sees data the caller isn't allowed to read.

See [api-endpoints.md](api-endpoints.md) for the full surface that exists today, and [../../docs/platform/api-endpoint-plan.md](api-endpoint-plan.md) for the migration plan and remaining items.

### Per-user / per-character tables

Two tables back the [spell-favourites](../features/spell-favorites.md) system. Both go through a dedicated Vercel route ([api/spell-favorites.ts](../../api/spell-favorites.ts)) rather than the generic `/api/d1/query` because they're auth-gated to "any signed-in user" (not staff) — `requireAuthenticatedUser` enforces that the row's `user_id` is always the verified-token uid, never a request-body field.

| Table | Migration | Composite PK | Notes |
|---|---|---|---|
| `user_spell_favorites` | [20260514-1522_user_spell_favorites.sql](../../worker/migrations/20260514-1522_user_spell_favorites.sql) | `(user_id, spell_id)` | Universal scope (account-level favourites). |
| `character_spell_favorites` | [20260514-2030_character_spell_favorites.sql](../../worker/migrations/20260514-2030_character_spell_favorites.sql) | `(user_id, character_id, spell_id)` | Per-character scope. `user_id` is denormalised so the WHERE clause can short-circuit ownership checks without joining `characters`. |

Both use `ON CONFLICT(...) DO NOTHING` on INSERT so the client can re-issue an add safely (the bulk-add path during local↔cloud merge relies on this idempotence).

## Server-side D1 access

Some flows (e.g., Foundry export, scheduled jobs) need to run D1 queries from the proxy layer without going through a browser. Use `executeD1QueryInternal` from `api/_lib/d1-proxy.ts`:

```ts
import { executeD1QueryInternal } from "../_lib/d1-proxy.js";

const rows = await executeD1QueryInternal(sql, params);
```

This bypasses the JWT check (since the caller is server-side and trusted), but it does still hit the Worker via the shared `API_SECRET`.

## Logging

Mutations log a coloured timestamped line:

```
[D1][13:27:42] Successfully updated/added document <id> in <table>
[D1][13:27:43] Successfully deleted document <id> from <table>
[D1][13:27:44] Batch mutation successful (12 queries)
```

This is intentional — when debugging save flows you can scan the console for the green/red lines to see what landed.

## Related docs

- [runtime.md](runtime.md) — overall request flow
- [auth-firebase.md](auth-firebase.md) — JWT flow that gates D1 access
- [env-vars.md](env-vars.md) — `R2_WORKER_URL`, `R2_API_SECRET`, etc.
- [../database/README.md](../database/README.md) — phase status, remaining-Firestore punchlist
- [../database/structure/](../database/structure/) — per-table schema
- [../operations/local-dev.md](../operations/local-dev.md) — running `wrangler dev`
