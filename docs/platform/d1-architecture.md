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
