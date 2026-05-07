# Database Memory - Dauligor

This document tracks the high-level architecture of the Dauligor database systems.

## Status — Firestore migration complete (local)

As of 2026-05-07 the Firestore → Cloudflare D1 cut is **functionally complete on local D1**. Every phase is done:

- **Phase 1–4** (foundation, identity/social, wiki/lore, compendium) — D1 schemas live, app reads + writes go through D1 only.
- **Phase 5** (character builder) — D1-only; `CharacterBuilder.tsx` (~30 calls) was migrated cluster-by-cluster.
- **Editor sweep + final cleanup** — every `firebase/firestore` import outside `src/lib/firebase.ts` is gone. The library file is auth-only; `db`/`initializeFirestore`/Firestore-rules artefacts have been deleted.
- **Server-side** — `api/_lib/firebase-admin.ts`, `api/module.ts`, `server.ts`, and `api/_lib/d1-proxy.ts` all hit D1 (via the new `api/_lib/d1-internal.ts` `executeD1QueryInternal` + `loadUserRoleFromD1` helpers). User role lookups for admin endpoints query D1's `users` table by Firebase Auth UID.

Pending: **deploy to remote D1** + flip `experimental_remote = true` on both bindings in [worker/wrangler.toml](../worker/wrangler.toml). Until that happens, `wrangler dev` writes to local sqlite + miniflare-simulated R2; image uploads return URLs that 404 in production.

## Master Table Registry
Detailed layouts for each table can be found in the [database-structure](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/) folder.

### Phase 1: Foundation & Taxonomy (COMPLETE — FIRESTORE DECOMMISSIONED)
*Core dependencies and taxonomy system. Full exit from Firestore read/write paths.*
- [x] [sources](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/sources.md): Book/Source metadata.
- [x] [proficiencies_base](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/proficiencies_base.md): Armor/Weapon/Tool categories, Languages, Damage Types, Attributes.
- [x] [proficiencies_skills](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/proficiencies_skills.md): Skill definitions.
- [x] [proficiencies_tools](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/proficiencies_tools.md): Tool definitions.
- [x] [proficiencies_weapons](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/proficiencies_weapons.md): Weapon definitions and properties.
- [x] [proficiencies_armor](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/proficiencies_armor.md): Armor definitions.
- [x] [status_conditions](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/status_conditions.md): Mechanical states and ActiveEffects.
- [x] [tags](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/tags.md): Global taxonomy system.
- [x] [spellcasting_progressions](file:///e:/DnD\Professional\Dev\Dauligor/docs/database-structure/spellcasting_progressions.md): Slot tables, scaling types, and multiclass charts.

### Phase 2: Identity & Social (COMPLETE — FIRESTORE DECOMMISSIONED)
*User profiles and campaign containers. Full exit from Firestore read/write paths for Identity/Social modules.*
- [x] [eras](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/eras.md): World timeline containers.
- [x] [users](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/users.md): Profile and RBAC data (snake_case remapping).
- [x] [campaigns](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/campaigns.md): Campaign containers.
- [x] [campaign_members](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/campaigns.md): Membership junction table.
- [x] **App Refactor**: Replaced `onSnapshot` with `refreshProfile` pattern in `App.tsx` and `Navbar.tsx`.


### PHASE 3: WIKI & LORE (LOCAL COMPLETE — APP VALIDATED)
*The world-building and narrative layer.*
- [x] `lore_articles` (Base + DM Notes)
- [x] `lore_meta_characters` (NPC/PC Data)
- [x] `lore_meta_locations` (Geo/Settlement Data)
- [x] `lore_meta_organizations` (Guild/Religion Data)
- [x] `lore_meta_deities` (Divine Data)
- [x] `lore_secrets` (Revelations)
- [x] `lore_article_eras` / `lore_article_campaigns` (Visibility)
- [x] `lore_secret_eras` / `lore_secret_campaigns` (Secret Logic)
- [x] `lore_article_tags` (Taxonomy)
- [x] `lore_links` (Mentions/Relations)

### Phase 4: Core Compendium (COMPLETE — FIRESTORE DECOMMISSIONED)
*The most complex gameplay data. Finalized backend exit for spells and integration endpoints.*
- [x] Phase 4e: Class List D1 Remapping (Thin/Fat Fetching)
- [x] Phase 4f: Class View D1 Remapping & Foundation Alignment
- [x] Phase 4g: Class Editor D1 Refactoring
- [x] Phase 4h: Subclass Editor D1 Refactoring
- [x] `classes` (Thin/Fat fetching validated in List & View)
- [x] `subclasses` (Migrated and validated in View)
- [x] `features` (Class and subclass features validated)
- [x] `spells` (Full Spell Database with Automation)
- [x] `items` (Loot, Consumables, Tools, Containers)
- [x] `feats` (General Feats, Origin Feats, Fighting Styles)

### Phase 5: Character Builder (COMPLETE — FIRESTORE DECOMMISSIONED)
*The transition of player character data to SQL.*
- [x] [characters](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/characters.md): Identity and vitals.
- [x] [character_progression](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/characters.md): Class levels and HP history.
- [x] [character_selections](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/characters.md): Advancement choices.
- [x] [character_inventory](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/characters.md): Equipment and attunement.
- [x] [character_spells](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/characters.md): Prepared and known spells.
- [x] [character_proficiencies](file:///e:/DnD/Professional/Dev/Dauligor/docs/database-structure/characters.md): Skills, saves, and traits.

### BUG FIXES & OPTIMIZATIONS
- [x] **ClassList Loop**: Fixed infinite render loop in foundation loading.
- [x] **JSON Parsing**: Added safety mapping for stringified JSON columns in D1 fetches.
- [x] **D1 Mapping**: Registered multiclass and scaling tables in `D1_TABLE_MAP`.
- [x] **Class View Validation**: Remapping logic and foundation data verified in `ClassView.tsx`.
- [x] **D1 Mutation Logging**: Implemented color-coded, timestamped logging for all D1 mutations (INSERT/UPDATE/DELETE) on both client and server (proxy) layers.
- [x] **Internal D1 Proxy**: Added `executeD1QueryInternal` to allow server-side operations (like Foundry export or Spell admin) to bypass client headers.
- [x] **Fallback Decommissioning**: Explicitly removed `firebaseFallback` logic from Phase 1 and Phase 4 core components to ensure strict D1-only operation.

### DATA ACCESS OPTIMIZATION (Load-Once Architecture)
- [x] **In-Memory Caching**: Implemented a global `QUERY_CACHE` in `d1.ts` with a 5-minute TTL to reduce redundant network traffic.
- [x] **Session Persistence**: Enabled `sessionStorage` caching for "Persistent Tables" (eras, proficiencies, tags). Data survives page refreshes with a 1-hour TTL.
- [x] **Request De-duplication**: Added `INFLIGHT_REQUESTS` tracking to ensure simultaneous identical fetches share a single network promise.
- [x] **Foundation Heartbeat**: Implemented a 30-second polling system in `App.tsx` using a new `system_metadata` table.
- [x] **Cache Invalidation**: Mutations to persistent tables automatically bump the `last_foundation_update` timestamp, triggering a global cache clear across all active client tabs.

### ARCHITECTURAL DECISIONS (Phase 4e)
- **Thin vs. Fat Fetching**: Classes list will use `SELECT` for grid fields only. Details (Lore, Proficiencies) are fetched on-demand when the preview is opened.
- **JSON vs. Normalized Tables**: `proficiencies` and `advancements` will remain as JSON columns for Phase 4e to maintain compatibility with complex Editor logic.
- **D1 Migration Foundation**: Completed migration of `scaling_columns` to restore UI tables in Compendium.
    - *Future Note*: Consider migrating these to junction tables in a future "Character Builder" phase to enable advanced querying (e.g., "Find classes with Stealth proficiency").

### REVIEW EXPORTS
*Transitioning internal library functions to use D1 logic.*
- [x] `exportClassSemantic` (Mapped to `fetchDocument`/`fetchCollection` for semantic bundles)
- [x] `ModularChoiceView` (Remapped for option group/item fetches)
- [x] Character Builder D1 Fetch (Subtables)
- [x] Character Builder D1 Save (Batch Queries)
- [x] Shared `characterLogic.ts` and `characterShared.ts`
- [x] Character List D1 Migration
- [x] Foundry Export API (`/api/characters/:id/json`)
- [x] Foundry Export R2 Caching (`/api/characters/:id/export`)

---

## Local Development Setup

The app reads D1 through an Express proxy (`/api/d1/query`) that forwards to the Cloudflare Worker. For local dev, the worker runs via `wrangler dev` on port 8787 using the local D1 state.

**Required: run two processes in parallel**

Terminal 1 — start the local Cloudflare Worker:
```
cd worker && npx wrangler dev
```

Terminal 2 — start the Vite/Express dev server:
```
npm run dev
```

**Environment variables** (already configured in `.env`):
- `R2_WORKER_URL=http://localhost:8787` — Express reads this to proxy D1 queries to the local worker
- `R2_API_SECRET=dauligor-asset-secret` — shared secret between Express and the worker
- `worker/.dev.vars` — provides `API_SECRET=dauligor-asset-secret` to the worker process

**Switching to production D1**: change `R2_WORKER_URL` in `.env` to `https://dauligor-storage.jeanruizmelo.workers.dev` and redeploy. Do not do this until local validation is complete.

---

## Deployment Workflow

Each phase follows this sequence before any data reaches the remote database:

1. Schema finalized in `database-structure/` docs.
2. `0001_phase1_foundation.sql` applied to **local** D1 (`--local` flag).
3. `scripts/migrate.js` run against **local** D1 to copy Firestore data.
4. App validated locally — all editors and read paths confirmed working.
5. Only after local validation passes: repeat steps 2–3 with `--remote`.

**Do not push schema or data to remote until local validation is complete.**

To reset local and re-migrate from scratch:
```
cd worker && npx wrangler d1 execute dauligor-db --local --file=migrations/9999_cleanup.sql
npx wrangler d1 execute dauligor-db --local --file=migrations/0001_phase1_foundation.sql
cd .. && node scripts/migrate.js
```

---

## Migration Philosophy
1. **Normalization**: Use explicit columns for searchable data; use JSON for complex, nested rule blocks.
2. **Total Exit**: Every piece of data in Firestore must have a designated home in D1 or R2.
3. **Audit First**: No migration code is written until the table structure is finalized in the `database-structure/` documentation.
4. **Non-Destructive Copy**: When migrating, we do not change or delete the original Firestore data; we only perform a copy to the SQL destination.
5. **Idempotency & Reversibility**: It is acceptable to wipe the local/dev D1 database and re-migrate as needed during development to verify schema changes and data integrity.
6. **No backwards compatibility**: When the new system requires a different shape, update the source on migration rather than keeping dual forms in code. Don't preserve legacy fallbacks (e.g. `row.snake_case ?? row.camelCase`) past the cutover — the rollback path is the Pre-Update reference at `E:\DnD\Professional\Dev\Pre-Update\Dauligor-main`, not a parallel code path inside the live app.

---

## Migration files (current state)

The chain in [worker/migrations/](../worker/migrations/) at the time of cutover:

| File | What |
|---|---|
| `0001_phase1_foundation.sql` … `0011_system_metadata.sql` | Original schema (sources, taxonomy, identity/social, wiki/lore, compendium, characters, system_metadata) |
| `0012_features_is_subclass_feature.sql` | `features.is_subclass_feature` flag for subclass-choice placeholder features |
| `0013_classes_subclasses_extended_fields.sql` | Wealth, asi_levels, multiclass_proficiencies, excluded_option_ids, unique_option_mappings on classes; identifier, class_identifier, lore, card_*/preview_* image fields, tag_ids on subclasses |
| `0014_field_drift_fixes.sql` | features.quantity_column_id / scaling_column_id / icon_url; attributes.description; languages.`order`; campaigns.preview_image_url / card_image_url / background_image_url |
| `0015_options_created_at.sql` | `created_at` on `unique_option_groups` + `unique_option_items` (both shipped without it; backfilled from `updated_at` on existing rows) |
| `0017_map_markers.sql` | `maps`, `map_markers`, `map_highlights` for the Interactive Map page (era-scoped maps with submap navigation via `parent_marker_id`/`parent_highlight_id`; markers and highlights cascade-delete with their map; article-link FKs use SET NULL to keep regions when the article goes away) |
| `9999_cleanup.sql` | Drops everything (used to wipe local before re-migrating from Firestore) |

`0016` was a stillborn JSON `map_coordinates` column that lived for ~10 minutes before being collapsed into 0017's relational design (the user pushed back on JSON-in-D1 as a Firestore-shape carry-over). The file is deleted and the migration chain skips from 0015 to 0017.

---

## Remote cutover plan (pending)

When you're ready to flip from local sqlite to Cloudflare's hosted D1:

```
# 1. Wipe remote (the database can be safely deleted at this point)
cd worker
npx wrangler d1 execute dauligor-db --remote --file=migrations/9999_cleanup.sql

# 2. Apply schema migrations in order
for f in migrations/0001_*.sql migrations/0002_*.sql ... migrations/0017_*.sql; do
  npx wrangler d1 execute dauligor-db --remote --file=$f
done

# 3. Push local data → remote
npx wrangler d1 export dauligor-db --local --output=./local-dump.sql --no-schema
npx wrangler d1 execute dauligor-db --remote --file=./local-dump.sql

# 4. Flip wrangler.toml bindings
# Add `experimental_remote = true` to both [[r2_buckets]] and [[d1_databases]]
# After this, plain `wrangler dev` reads/writes real R2 + real D1 — no --remote flag needed.
```

After cutover the local sqlite is no longer the source of truth. Ongoing schema changes go to remote with `--remote` migrations; ongoing data changes through the app land in production directly.

---

## Upsert Idiom — Never Use `INSERT OR REPLACE`

D1 has `PRAGMA foreign_keys = ON` by default. SQLite resolves an `INSERT OR REPLACE` PK conflict by **deleting the existing row and inserting a new one**, and that DELETE fires `ON DELETE CASCADE` on referencing rows. Result: every "save" silently nukes that row's FK children.

This caused a real data-loss incident: saving a class via ClassEditor cascade-deleted every subclass for that class, dropping the table from 65 → 39 rows over several saves. The fix, applied throughout the codebase:

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
- The actual `ON DELETE CASCADE` constraints are kept; they are correct for genuine row deletion (e.g. ClassList "Delete Class").

Fixed sites: `src/lib/d1.ts` (`upsertDocument`, `upsertDocumentBatch`), `src/lib/lore.ts` (`upsertLoreArticle`, `upsertLoreSecret`), `src/lib/characterShared.ts` (`generateCharacterSaveQueries`), `scripts/migrate.js` (`insert` helper). The migrate helper resolves the PK column at runtime via `pragma_table_info`, so `lore_meta_*` tables (whose PK is `article_id`) work correctly.
