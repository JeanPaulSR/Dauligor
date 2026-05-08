# Database Memory — Dauligor

High-level state registry for the Dauligor data layer. Pair with [docs/database/README.md](database/README.md) for the curated index and [docs/database/structure/](database/structure/) for per-table specs.

## Status

The Firestore→D1 migration is **complete and live**. As of 2026-05-08:

- All app reads and writes go through Cloudflare D1 via the project Worker. `firebase/firestore` imports are forbidden anywhere in the codebase (guardrail comment in [src/lib/firebase.ts](../src/lib/firebase.ts)).
- Image storage is on Cloudflare R2 (`https://images.dauligor.com`); image upload, list, rename, delete, and metadata all flow through `worker/index.js`.
- The deployed app at [www.dauligor.com](https://www.dauligor.com) (Vercel) and the Foundry pairing module both consume the same `/api/module/sources` API which talks to remote D1 via the Cloudflare Worker.
- Local dev uses `wrangler dev` (port 8787) for D1 + R2 simulation and Express + Vite (port 3000) for the app. See [docs/operations/local-dev.md](operations/local-dev.md).
- Firebase Authentication is the JWT layer and is staying. The Firebase Admin SDK is still used server-side in 5 places to verify those JWTs — exit plan in `~/.claude/projects/E--DnD-Professional-Dev-Dauligor/memory/project_firebase_auth_exit_plan.md`.

The migration was completed via:
1. Schema applied to remote D1 (`0001_phase1_foundation.sql` through `0017_map_markers.sql`, plus the cleanup migration).
2. Local sqlite dump exported with `wrangler d1 export … --no-schema` and replayed against remote.
3. `worker/wrangler.toml` bindings updated; deployed worker URL set as `R2_WORKER_URL` in Vercel env.
4. Per-class Foundry endpoint shipped (server-side `exportClassSemantic` in `api/_lib/_classExport.ts` — see [DIRECTORY_MAP §3](../DIRECTORY_MAP.md#3-server--proxy--worker)).

## Master Table Registry

Per-table specs in [docs/database/structure/](database/structure/). Migration DDL in [worker/migrations/](../worker/migrations/) is the authoritative source for any table not yet covered by a structure doc.

### Phase 1 — Foundation & Taxonomy
*Sources, proficiencies, attributes, status conditions, tags, spellcasting progressions, image metadata.*
- [sources](database/structure/sources.md)
- [proficiencies_base](database/structure/proficiencies_base.md), [proficiencies_skills](database/structure/proficiencies_skills.md), [proficiencies_tools](database/structure/proficiencies_tools.md), [proficiencies_weapons](database/structure/proficiencies_weapons.md), [proficiencies_armor](database/structure/proficiencies_armor.md)
- [status_conditions](database/structure/status_conditions.md)
- [tags](database/structure/tags.md)
- [spellcasting_progressions](database/structure/spellcasting_progressions.md)
- `unique_option_groups`, `unique_option_items`, `image_metadata` — see DDL in [`worker/migrations/0001_phase1_foundation.sql`](../worker/migrations/0001_phase1_foundation.sql)

### Phase 2 — Identity & Social
*User profiles, campaigns, eras, membership.*
- [eras](database/structure/eras.md)
- [users](database/structure/users.md)
- [campaigns](database/structure/campaigns.md) (covers both `campaigns` and the `campaign_members` junction)

### Phase 3 — Wiki & Lore
*Lore articles, meta tables, secrets, eras/campaigns visibility joins.*
- [lore_articles](database/structure/lore_articles.md)
- [lore_meta_characters](database/structure/lore_meta_characters.md) — same shape applies to `lore_meta_locations`, `lore_meta_organizations`, `lore_meta_deities`
- `lore_secrets`, `lore_article_eras`, `lore_article_campaigns`, `lore_secret_eras`, `lore_secret_campaigns`, `lore_article_tags`, `lore_links` — see DDL in [`worker/migrations/0003_phase3_lore.sql`](../worker/migrations/0003_phase3_lore.sql)

### Phase 4 — Compendium
*Classes, subclasses, features, scaling columns, items, feats, spells.*
- [classes](database/structure/classes.md)
- `subclasses`, `features`, `scaling_columns` — see DDL in [`worker/migrations/0008_classes.sql`](../worker/migrations/0008_classes.sql), [`0007_features.sql`](../worker/migrations/0007_features.sql), [`0009_scalings.sql`](../worker/migrations/0009_scalings.sql)
- `items`, `feats`, `spells` — see DDL in [`worker/migrations/0004_items.sql`](../worker/migrations/0004_items.sql), [`0005_feats.sql`](../worker/migrations/0005_feats.sql), [`0006_spells.sql`](../worker/migrations/0006_spells.sql)

### Phase 5 — Character Builder
- [characters](database/structure/characters.md) (covers `character_progression`, `character_selections`, `character_inventory`, `character_spells`, `character_proficiencies`)

### Phase 6 — System
- `system_metadata` — foundation heartbeat for cross-tab cache invalidation. See [`0011_system_metadata.sql`](../worker/migrations/0011_system_metadata.sql)
- `maps`, `map_markers`, `map_highlights` — Interactive Map page. See [`0017_map_markers.sql`](../worker/migrations/0017_map_markers.sql)

## Migration files

| File | Coverage |
|---|---|
| `0001_phase1_foundation.sql` … `0011_system_metadata.sql` | Original schema (sources, taxonomy, identity/social, wiki/lore, compendium, characters, system_metadata) |
| `0012_features_is_subclass_feature.sql` | `features.is_subclass_feature` flag for subclass-choice placeholder features |
| `0013_classes_subclasses_extended_fields.sql` | wealth, asi_levels, multiclass_proficiencies, excluded_option_ids, unique_option_mappings on classes; identifier, class_identifier, lore, card_/preview_ image fields, tag_ids on subclasses |
| `0014_field_drift_fixes.sql` | features.quantity_column_id / scaling_column_id / icon_url; attributes.description; languages.`order`; campaigns.preview_image_url / card_image_url / background_image_url |
| `0015_options_created_at.sql` | `created_at` on `unique_option_groups` + `unique_option_items` (backfilled from `updated_at` on existing rows) |
| `0017_map_markers.sql` | `maps`, `map_markers`, `map_highlights` for the Interactive Map page (era-scoped maps with submap navigation via `parent_marker_id`/`parent_highlight_id`; markers and highlights cascade-delete with their map; article-link FKs use SET NULL to keep regions when the article goes away) |
| `9999_cleanup.sql` | Drops everything (used to wipe local before re-migrating from a Firestore JSON dump) |

`0016` was a stillborn JSON `map_coordinates` column that lived for ~10 minutes before being collapsed into 0017's relational design (the project rejects JSON-in-D1 carry-overs from the Firestore shape). The file is deleted and the migration chain skips from 0015 to 0017.

## Operating principles

1. **Normalization**: Use explicit columns for searchable data; use JSON columns for complex, nested rule blocks. The `queryD1` client in [src/lib/d1.ts](../src/lib/d1.ts) auto-parses a fixed list of JSON columns, so editor remap blocks must pass already-parsed values through (see [AGENTS.md §4](../AGENTS.md)).
2. **No backwards compatibility** — when the schema changes, update sources to fit the new shape; do not preserve `row.snake_case ?? row.camelCase` dual-reads. The rollback path is the Pre-Update snapshot, not parallel paths inside the live app.
3. **Idempotency** — `9999_cleanup.sql` + the migration chain reproduces the schema from scratch. Local dev can wipe and re-apply at any time. Remote D1 is now the source of truth for production data.

## Upsert Idiom — Never Use `INSERT OR REPLACE`

D1 has `PRAGMA foreign_keys = ON` by default. SQLite resolves an `INSERT OR REPLACE` PK conflict by **deleting the existing row and inserting a new one**, and that DELETE fires `ON DELETE CASCADE` on referencing rows. Result: every "save" silently nukes that row's FK children.

This caused a real data-loss incident during the migration: saving a class via ClassEditor cascade-deleted every subclass for that class, dropping the table from 65 → 39 rows over several saves. The fix is the canonical SQLite UPSERT idiom:

```sql
INSERT INTO ${table} (cols...) VALUES (...)
ON CONFLICT(id) DO UPDATE SET col1 = excluded.col1, col2 = excluded.col2, ...
```

`ON CONFLICT … DO UPDATE` modifies the row in place — no DELETE, no cascade.

**Rules:**
- Every upsert site uses `INSERT … ON CONFLICT(<pk>) DO UPDATE SET …` (single PK) or `… DO NOTHING` (no non-PK columns).
- Never `INSERT OR REPLACE`. A repo-wide grep should return zero hits in `src/`, `scripts/`, `worker/`, `api/` outside of cautionary comments.
- For composite PKs, list every PK column in the `ON CONFLICT(...)` target and exclude them from the SET clause.
- Junction tables continue to use `INSERT OR IGNORE` — that variant does not delete on conflict and is safe.
- The `ON DELETE CASCADE` constraints themselves are kept; they are correct for genuine row deletion (e.g. ClassList "Delete Class"), just not for upsert via REPLACE.

Fixed sites: `src/lib/d1.ts` (`upsertDocument`, `upsertDocumentBatch`), `src/lib/lore.ts` (`upsertLoreArticle`, `upsertLoreSecret`), `src/lib/characterShared.ts` (`generateCharacterSaveQueries`), `scripts/migrate.js` (`insert` helper). The migrate helper resolves the PK column at runtime via `pragma_table_info`, so `lore_meta_*` tables (whose PK is `article_id`) work correctly.
