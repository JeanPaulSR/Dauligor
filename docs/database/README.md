# Database

Cloudflare D1 (SQL) is the data layer. This README covers the runtime architecture, schema philosophy, and the local-dev wipe-and-reapply workflow. Per-table specs live under [structure/](structure/).

For the **client API** (how to read/write D1 from app code), see [../platform/d1-architecture.md](../platform/d1-architecture.md). The high-level state registry is in [../database-memory.md](../database-memory.md).

## Architecture at a glance

```
Browser → /api/d1/query (Vercel/Express) → Cloudflare Worker (env.DB) → D1 (dauligor-db)
```

- One Worker (`dauligor-storage`) serves both D1 (`/query`) and R2 (`/upload`, `/list`, …).
- The Worker has D1 binding `DB`, database `dauligor-db`, ID `25a9d61a-29ec-42c7-9dae-8cde8d88913d`.
- Schema migrations live in [worker/migrations/](../../worker/migrations/) — `0001_phase1_foundation.sql` through `0017_map_markers.sql`, plus `9999_cleanup.sql` (used to wipe local before re-applying the chain).
- Production reads/writes hit **remote D1**; local dev uses `wrangler dev` against a local SQLite under `worker/.wrangler/state/`.

## Migration status — complete

The Firestore→D1 migration shipped in 2026-05. Every read/write path on production data goes through Cloudflare D1; image storage is on R2; the app is live at [www.dauligor.com](https://www.dauligor.com).

| Phase | Domain | Status |
|---|---|---|
| 1 | Foundation & taxonomy | ✅ Complete (sources, tags, categories, attributes, languages, status_conditions, scaling progressions, image_metadata) |
| 2 | Identity & social | ✅ Complete (users, eras, campaigns, campaign_members) |
| 3 | Wiki & lore | ✅ Complete (lore_articles + meta + secrets + visibility junctions) |
| 4 | Compendium | ✅ Complete (classes, subclasses, features, spells, items, feats, scaling_columns, unique_option_groups + items) |
| 5 | Character builder | ✅ Complete (characters, character_progression, character_selections, character_inventory, character_spells, character_proficiencies) |
| 6 | System | ✅ Complete (system_metadata heartbeat, maps + map_markers + map_highlights) |

The historical migration plans, the firestore-cut punchlist, and the spell-summary migration walkthrough are archived under [../\_archive/](../\_archive/) for posterity.

## Schema philosophy

Decisions kept consistent across all tables:

1. **Normalised columns for searchable data.** If a field is queried by a `WHERE` clause, it's a column. Examples: `source_id`, `level`, `school`, `category`, `parent_id`, `parent_type`.
2. **JSON columns for nested rule blocks.** Things that are read as a whole and never queried piecewise stay as JSON. Examples: `proficiencies`, `advancements`, `activities`, `effects`, `image_display`, `metadata_json`.
3. **Junction tables for many-to-many.** Examples: `campaign_members`, `lore_article_eras`, `lore_article_tags`. No comma-separated strings.
4. **`snake_case` columns.** Client maps via `D1_TABLE_MAP` ([src/lib/d1Tables.ts](../../src/lib/d1Tables.ts)) and field-by-field aliasing in helpers.
5. **`id TEXT PRIMARY KEY`** everywhere. Either a UUID (for new rows) or the original Firestore document ID (for rows brought across in the migration).
6. **`created_at` / `updated_at` are `TEXT` ISO 8601** strings. SQLite has no native datetime; ISO strings sort correctly and round-trip cleanly.
7. **JSON auto-parse list lives in `d1.ts:queryD1`.** Adding a JSON column means adding it there too — see [../platform/d1-architecture.md](../platform/d1-architecture.md#json-column-convention). Downstream remap blocks must pass already-parsed values through (see AGENTS.md §4).
8. **Never `INSERT OR REPLACE`** — it deletes the row and re-inserts, firing `ON DELETE CASCADE` on FK children. Always `INSERT … ON CONFLICT(<pk>) DO UPDATE SET …`. Documented in [../database-memory.md](../database-memory.md#upsert-idiom--never-use-insert-or-replace).

## Adding a schema change

1. Decide on column shape; document in [structure/`<table>.md`](structure/) (or stub a new file).
2. Write migration: `worker/migrations/00NN_<short_description>.sql`.
3. Apply locally: `cd worker && npx wrangler d1 execute dauligor-db --local --file=migrations/00NN_*.sql`.
4. Run the app locally; validate the new column round-trips through every read and write path that touches it.
5. Apply remotely: same command with `--remote` instead of `--local`.
6. Commit. (Vercel auto-deploys; the worker code only needs `wrangler deploy` if its schema awareness changed.)

## Resetting local dev

If the local sqlite gets into an inconsistent state, wipe and re-apply:

```bash
# 1. Stop wrangler dev (it locks the sqlite file).
# 2. Remove the local sqlite.
rm worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite*

# 3. Re-apply the schema chain (0001 through 0017, skipping the stillborn 0016).
cd worker
for f in migrations/0001_*.sql migrations/0002_*.sql migrations/0003_*.sql \
         migrations/0004_*.sql migrations/0005_*.sql migrations/0006_*.sql \
         migrations/0007_*.sql migrations/0008_*.sql migrations/0009_*.sql \
         migrations/0010_*.sql migrations/0011_*.sql migrations/0012_*.sql \
         migrations/0013_*.sql migrations/0014_*.sql migrations/0015_*.sql \
         migrations/0017_*.sql; do
  npx wrangler d1 execute dauligor-db --local --file="$f"
done
cd ..

# 4. Optionally reseed from a remote dump.
cd worker
npx wrangler d1 export dauligor-db --remote --output=./remote-dump.sql --no-schema
npx wrangler d1 execute dauligor-db --local --file=./remote-dump.sql
rm ./remote-dump.sql
```

`9999_cleanup.sql` only drops Phase 1 + 2 tables and trips foreign-key checks while doing so — don't rely on it for a full wipe; the file-delete approach above is the working pattern.

## Per-table reference

The [structure/](structure/) folder has 16 files. Each documents the column-by-column layout, indexes, constraints, and implementation notes (why JSON vs columns, etc.). For tables not yet documented (`unique_option_groups`, `unique_option_items`, `image_metadata`, the lore meta sub-tables, etc.), the migration DDL in [worker/migrations/](../../worker/migrations/) is the authoritative source.

## Related docs

- [../platform/d1-architecture.md](../platform/d1-architecture.md) — client API, cache layers, JSON columns
- [../platform/runtime.md](../platform/runtime.md) — request flow including `/api/d1/query`
- [../operations/local-dev.md](../operations/local-dev.md) — full local setup
- [../operations/deployment.md](../operations/deployment.md) — applying remote migrations and shipping the worker
- [../operations/troubleshooting.md](../operations/troubleshooting.md) — D1 errors and recovery
- [../database-memory.md](../database-memory.md) — phase registry and the upsert-idiom guardrail
