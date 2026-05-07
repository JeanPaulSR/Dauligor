# Database

Cloudflare D1 (SQL) is the data layer that replaces Firestore. This README covers phase status, schema philosophy, and the Firestore-cut punchlist. Per-table specs live under [structure/](structure/), and phase-by-phase migration plans live under [migration-details/](migration-details/).

For the **client API** (how to read/write D1 from app code), see [../platform/d1-architecture.md](../platform/d1-architecture.md).

## Architecture at a glance

```
Browser → /api/d1/query → Cloudflare Worker (env.DB) → D1 (dauligor-db)
```

- One Worker (`dauligor-storage`) serves both D1 (`/query`) and R2 (`/upload`, `/list`, …).
- Local dev uses `wrangler dev` against a local SQLite under `worker/.wrangler/state/`.
- The Worker has D1 binding `DB`, database `dauligor-db`, ID `25a9d61a-29ec-42c7-9dae-8cde8d88913d`.
- Schema migrations live in [worker/migrations/](../../worker/migrations/) (`0001_phase1_foundation.sql` … `0011_system_metadata.sql`).
- Migration scripts that copy live Firestore data into local D1 live in [scripts/](../../scripts/).

## Phase status

| Phase | Domain | Status | Detail |
|---|---|---|---|
| 1 | Foundation & taxonomy | ✅ Decommissioned from Firestore | sources, tags, categories, attributes, languages, status_conditions, scaling progressions |
| 2 | Identity & social | ✅ Decommissioned | users, eras, campaigns, campaign_members |
| 3 | Wiki & lore | ✅ Local complete · App validated | lore_articles + meta + secrets + visibility junctions |
| 4 | Compendium | ⚠️ Mostly decommissioned | classes, subclasses, features, spells, items, feats, scaling_columns. Some write paths in `classExport.ts` and `spellSummary.ts` still hit Firestore. |
| 5 | Character builder | 🔧 In progress | All character tables exist; `CharacterBuilder.tsx` still has direct Firestore reads. |

Detailed per-phase plans:
- [migration-details/phase-1-foundation.md](migration-details/phase-1-foundation.md)
- [migration-details/phase-2-identity.md](migration-details/phase-2-identity.md)
- [migration-details/phase-3-wiki.md](migration-details/phase-3-wiki.md)
- [migration-details/phase-4-compendium.md](migration-details/phase-4-compendium.md)
- [migration-details/phase-5-characters.md](migration-details/phase-5-characters.md)

## Remaining-Firestore-cut punchlist

The actionable tracking doc with checkboxes lives at [firestore-cut-punchlist.md](firestore-cut-punchlist.md). For a step-by-step worked example agents can pattern-match against, see [migration-walkthrough-spellsummary.md](migration-walkthrough-spellsummary.md).

In summary, the remaining direct-Firestore call sites cluster into:

- **Phase A — Core libraries**: `spellSummary.ts`, `imageMetadata.ts`, `classExport.ts` (write half)
- **Phase B — Single-purpose pages**: `SpellcastingAdvancementManager`, `Map`, `ImageManager`, plus the `config/wiki_settings` D1-home decision
- **Phase C — `CharacterBuilder.tsx`**: the ~25-call sweep
- **Phase D — Compendium editor sweep**: `ClassEditor`, `SubclassEditor`, `SpellList`, `SpellImportWorkbench`, `DevelopmentCompendiumManager`, `ActivityEditor`, `ModularChoiceView`, `AdvancementManager`
- **Phase E — Final cleanup**: drop fallbacks, delete Firestore client init, remove legacy artefacts

The migration is finished when every box in [firestore-cut-punchlist.md](firestore-cut-punchlist.md) is ticked and the `firebase/firestore` import can be removed.

## Schema philosophy

Decisions kept consistent across all tables:

1. **Normalised columns for searchable data.** If a field is queried by a `WHERE` clause, it's a column. Examples: `source_id`, `level`, `school`, `category`, `parent_id`, `parent_type`.
2. **JSON columns for nested rule blocks.** Things that are read as a whole and never queried piecewise stay as JSON. Examples: `proficiencies`, `advancements`, `activities`, `effects`, `image_display`, `metadata_json`.
3. **Junction tables for many-to-many.** Examples: `campaign_members`, `lore_article_eras`, `lore_article_tags`. No comma-separated strings.
4. **`snake_case` columns.** Client maps via `D1_TABLE_MAP` and field-by-field aliasing in helpers.
5. **`id TEXT PRIMARY KEY`** everywhere. Either the original Firestore document ID (during migration) or a UUID for new rows.
6. **`created_at` / `updated_at` are `TEXT` ISO 8601** strings. SQLite has no native datetime; ISO strings sort correctly and round-trip cleanly.
7. **JSON auto-parse list lives in `d1.ts`.** Adding a JSON column means adding it there too — see [../platform/d1-architecture.md](../platform/d1-architecture.md#json-column-convention).

## Local-first migration workflow

Every schema change goes through this sequence before remote D1 sees it:

```
1. Finalise schema in docs/database/structure/<table>.md
2. Write migration: worker/migrations/00NN_*.sql
3. Apply locally:
     cd worker && npx wrangler d1 execute dauligor-db --local --file=migrations/00NN_*.sql
4. Run scripts/migrate.js to copy Firestore → local D1
5. Validate the app against local D1 (every editor and read path)
6. Only after step 5 passes: repeat 3–4 with --remote
```

### `scripts/migrate.js` is INSERT-only

The migration script uses `INSERT OR REPLACE` for everything. It **does not** delete D1 rows whose Firestore counterpart was removed. Practical implication:

- If you delete a doc in Firestore, the corresponding row stays in local D1 until the next wipe.
- If you delete a class/subclass, all of its children (features, scaling columns) stay too — see [the editor cascade-delete TODO](../features/compendium-classes.md#known-issues--todos).

To re-sync D1 with current Firestore state, **wipe and re-migrate**. The simplest reliable way:

```bash
# 1. Stop wrangler dev (it locks the sqlite file)
# 2. Delete the local sqlite file
rm worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite*
#    (preserve the metadata.sqlite* trio; only delete the hash-named one
#     which holds dauligor-db. If unsure, delete all and let wrangler regenerate.)
# 3. Re-apply schema migrations in order (0001 through 0011)
cd worker
for f in migrations/0001_*.sql migrations/0002_*.sql migrations/0003_*.sql migrations/0004_*.sql migrations/0005_*.sql migrations/0006_*.sql migrations/0007_*.sql migrations/0008_*.sql migrations/0009_*.sql migrations/0010_*.sql migrations/0011_*.sql; do
  npx wrangler d1 execute dauligor-db --local --file="$f"
done
cd ..
# 4. Re-run migrate.js
node scripts/migrate.js
```

**`9999_cleanup.sql` is incomplete and FK-fails** (only drops Phase 1 + 2 tables and trips foreign-key checks while doing it). Don't rely on it. The file-delete approach above is the working wipe.

A future improvement would be a "sync with deletes" mode in `migrate.js` that diffs Firestore against D1 and removes rows that no longer exist in Firestore. Until then, wipe-and-remigrate is the canonical pattern.

**Reset the local DB and start over** (useful when iterating on schema):

```
cd worker
npx wrangler d1 execute dauligor-db --local --file=migrations/9999_cleanup.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0001_phase1_foundation.sql
# … apply each migration in order …
cd ..
node scripts/migrate.js
```

`scripts/migrate.js` requires `firebase-service-account.json` at the repo root. It does **not** delete or modify Firestore — it only copies data into D1.

## Per-table reference

The [structure/](structure/) folder has one file per table. Each file documents:
- Column-by-column layout with type and Firestore equivalent
- Indexes and constraints
- Implementation notes (why JSON vs columns, etc.)

The 16 current docs are listed in alphabetical order in that folder. Pull up the matching file when you change schema or add a column.

## Related docs

- [../platform/d1-architecture.md](../platform/d1-architecture.md) — client API, cache layers, JSON columns
- [../platform/runtime.md](../platform/runtime.md) — request flow including `/api/d1/query`
- [../operations/local-dev.md](../operations/local-dev.md) — full local setup
- [../operations/deployment.md](../operations/deployment.md) — applying remote migrations safely
- [../operations/troubleshooting.md](../operations/troubleshooting.md) — D1 errors and recovery
