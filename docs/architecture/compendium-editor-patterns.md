# Compendium Editor Patterns

How CRUD currently works in the app, the four patterns in use, and the post-migration cleanup roadmap.

> **When to read this doc:**
> - You're adding a new editor for a new entity type → use the [Decision tree](#decision-tree).
> - You're refactoring an existing editor → check [Post-migration cleanup roadmap](#post-migration-cleanup-roadmap).
> - You just finished the [Firestore-cut punchlist](../database/firestore-cut-punchlist.md) → start at [Post-migration cleanup roadmap](#post-migration-cleanup-roadmap).

---

## The shared foundation

| Layer | File | Role |
|---|---|---|
| **Schema** | [worker/migrations/00*.sql](../../worker/migrations/) | The actual D1 tables |
| **Client API** | [src/lib/d1.ts](../../src/lib/d1.ts) | `queryD1`, `batchQueryD1`, `fetchCollection`, `fetchDocument`, `upsertDocument`, `upsertDocumentBatch`, `deleteDocument`, `deleteDocuments`. Cache layers and foundation heartbeat live here. |
| **Compendium helpers** | [src/lib/compendium.ts](../../src/lib/compendium.ts) | `normalizeCompendiumData` / `denormalizeCompendiumData` (camelCase ↔ snake_case + JSON/bool coercion). Plus per-entity helpers: `upsertFeature`/`fetchFeature`/`deleteFeature` (used by ClassEditor/SubclassEditor); `upsertSpell`/`fetchSpell`/`deleteSpell`/`upsertSpellBatch` (used by SpellsEditor/SpellImportWorkbench); `upsertItem`/`fetchItem`/`deleteItem`/`upsertFeat`/`fetchFeat`/`deleteFeat` (defined but **unused** — items/feats go through `DevelopmentCompendiumManager` which calls `upsertDocument` directly). |
| **Lore helpers** | [src/lib/lore.ts](../../src/lib/lore.ts) | Atomic article + metadata + junction sync via `batchQueryD1`. The model for relational entities. |

What's strong about this foundation:
- `d1.ts` cache invalidation, JSON auto-parse, and `D1_TABLE_MAP` translation work cleanly.
- `lore.ts` shows the right pattern for relational writes: one `batchQueryD1` call sets parent + metadata + 4 junction tables atomically.
- The schema is properly migrated and FK-validated in dev.

---

## The four editor patterns currently in use

### Pattern A — Generic CRUD shell

**File**: [src/components/compendium/DevelopmentCompendiumManager.tsx](../../src/components/compendium/DevelopmentCompendiumManager.tsx)
**Used by**: [FeatsEditor.tsx](../../src/pages/compendium/FeatsEditor.tsx), [ItemsEditor.tsx](../../src/pages/compendium/ItemsEditor.tsx), and the manual-editor side of [SpellsEditor.tsx](../../src/pages/compendium/SpellsEditor.tsx)

Shape: a thin editor file (~150 lines) declares `collectionName`, `defaultData`, and a `renderSpecificFields` callback. The shell handles load/save/delete via `fetchCollection` / `upsertDocument` / `deleteDocument`.

Good for: flat tables with `name`, `identifier`, `source_id`, `tags`, `automation: { activities, effects }`, plus a few entity-specific columns.
Limitations: doesn't handle FK metadata tables, junction tables, or sub-collections.

### Pattern B — Bespoke per-entity editor

**Used by**: [SourceEditor.tsx](../../src/pages/sources/SourceEditor.tsx), [SkillsEditor.tsx](../../src/pages/compendium/SkillsEditor.tsx), [ToolsEditor.tsx](../../src/pages/compendium/ToolsEditor.tsx), [ArmorEditor.tsx](../../src/pages/admin/ArmorEditor.tsx), [WeaponsEditor.tsx](../../src/pages/admin/WeaponsEditor.tsx), [StatusesEditor.tsx](../../src/pages/admin/StatusesEditor.tsx), [SpellcastingTypeEditor.tsx](../../src/pages/admin/SpellcastingTypeEditor.tsx), [StandardMulticlassEditor.tsx](../../src/pages/admin/StandardMulticlassEditor.tsx), [TagManager.tsx](../../src/pages/compendium/TagManager.tsx), [TagGroupEditor.tsx](../../src/pages/compendium/TagGroupEditor.tsx), [UniqueOptionGroupEditor.tsx](../../src/pages/compendium/UniqueOptionGroupEditor.tsx)

Shape: page-level component with hand-rolled form state, manual `useEffect` to load data, save handler that builds a payload and calls `upsertDocument` directly.

Good for: entities that need entity-specific UX (custom field shapes, multi-step flows, non-trivial validation).
Bad: each editor re-implements the load/save/delete loop. ~12 implementations of the same shape.

### Pattern C — Generic config editor

**File**: [src/pages/admin/SimplePropertyEditor.tsx](../../src/pages/admin/SimplePropertyEditor.tsx)
**Used by** (via [AdminProficiencies.tsx](../../src/pages/admin/AdminProficiencies.tsx) tabs): `toolCategories`, `weaponCategories`, `weaponProperties`, `armorCategories`, `languageCategories`, `damageTypes`, `conditions`, `attributes`, `languages`

Shape: parameterised by `(collectionName, title, descriptionText, icon, optionalCategoryCollectionName)`. Handles the `id, name, identifier, order, description` shape with optional category selector.

Good for: simple taxonomies.
Same limitations as Pattern A.

### Pattern D — Relational entity helper

**File**: [src/lib/lore.ts](../../src/lib/lore.ts) (and eventually `class.ts`, `character.ts`, etc.)
**Used by**: [LoreEditor.tsx](../../src/pages/wiki/LoreEditor.tsx), [LoreArticle.tsx](../../src/pages/wiki/LoreArticle.tsx)

Shape: page-level component calls library functions (`upsertLoreArticle`, `fetchLoreArticle`, `deleteLoreArticle`, etc.). Library uses `batchQueryD1` to write parent + metadata + junctions atomically with parameterised SQL.

Good for: parent-with-children entities (lore article + 4 metadata table variants + 5 junction tables; planned for class + features + scaling + advancements).
Best practice for transactional integrity.

---

## Decision tree

| You're adding… | Use pattern | Copy this file as a starting point |
|---|---|---|
| A new flat-table entity (name + JSON columns + source FK) | **A** | [FeatsEditor.tsx](../../src/pages/compendium/FeatsEditor.tsx) |
| A new simple taxonomy (`id`, `name`, `identifier`, `order`, `description`) | **C** | (just add a tab to `AdminProficiencies` with a new `<SimplePropertyEditor collectionName="...">` invocation) |
| A new entity with custom UX needs | **B** | [SkillsEditor.tsx](../../src/pages/compendium/SkillsEditor.tsx) |
| A new entity with multiple FK tables / junctions | **D** | Build a new `src/lib/<entity>.ts`; see [lore.ts](../../src/lib/lore.ts) |

If your new entity has 0 junctions and just sits in a table, pick A or C. If it has children, pick D from day one — refactoring from B-with-implicit-junctions to D later is painful.

---

## Known issues (rough edges in the current state)

1. **Inconsistency.** Four patterns for the same fundamental task (CRUD on a SQL table). New contributors won't know which to use without reading this doc. Documented for now; consolidation in roadmap.
2. **Two-way camelCase/snake_case dance.** Every save round-trip:
   ```
   D1 row (snake_case)
     → denormalize → form state (camelCase)
     → user edits → normalize → upsert payload (snake_case)
     → D1 row
   ```
   Two transformations per save, both routed through `normalizeCompendiumData` / `denormalizeCompendiumData` (130 lines each, growing).
3. **Inconsistent per-entity helpers in compendium.ts.** `upsertSpell` / `upsertFeature` are used by their editors (the canonical pattern). `upsertItem` / `upsertFeat` exist with the same shape but nothing calls them — `DevelopmentCompendiumManager` bypasses them and calls `upsertDocument` directly. Either flavour works (they're functionally equivalent), but having both signals that the canonical pattern hasn't been picked.
4. **No type safety on D1 rows.** Most reads are typed `<any>`. The schema lives in `worker/migrations/*.sql` and `docs/database/structure/*.md` but nothing enforces TypeScript types match.
5. **No optimistic UI.** Editors call `loadEntries()` after every save. Works but burns a round-trip.
6. **Default API doesn't push toward transactions.** `upsertDocument(name, id, data)` is one query. Multi-table writes require remembering to use `batchQueryD1`. Easy to forget.
7. **Migration script and editor save logic duplicate column knowledge.** `migrate.js` mappers (`mapClass`, `mapFeature`, etc.) mirror the editor save shape. Add a column to one without the other → silent drift.
8. **Schema knowledge spans ~5 files for a new column.** SQL migration → migrate.js mapper → `normalizeCompendiumData` → `denormalizeCompendiumData` → editor form state → `D1_TABLE_MAP` (if JSON) → JSON auto-parse list. Easy to miss one.

---

## Post-migration cleanup roadmap

> **Read this when** the [Firestore-cut punchlist](../database/firestore-cut-punchlist.md) Phase E is complete (Firestore client deleted, `firestore.rules` removed, all `firebaseFallback` args are `null`).
>
> **Don't start any of this mid-migration.** Refactoring while still half-on-Firestore creates more risk than the cleanup is worth.

Estimated total effort: 1 focused week, broken across the priorities below.

### Priority 1 — Pattern consolidation
*Estimated: 1-2 days · Goal: one canonical pattern per entity type*

- [ ] Rename `DevelopmentCompendiumManager` → `EntityEditorShell` (the "Development" prefix dates from when it was a temp scaffold).
- [ ] Decide: does Pattern A (flat-table editor) merge with Pattern C (`SimplePropertyEditor`)? They're nearly the same shape — `SimplePropertyEditor` is just `EntityEditorShell` minus the automation/source FK.
- [ ] Audit each Pattern B editor; for any that fits Pattern A's shape (no relational structure), migrate it. The bespoke ones to keep are the ones with genuinely custom UX (CharacterBuilder, ClassEditor, SubclassEditor).
- [ ] Update this doc's [Decision tree](#decision-tree) to reflect the consolidated patterns.

### Priority 2 — Schema as source of truth
*Estimated: 2-3 days · Goal: types generated from schema, no manual snake_case dance*

- [ ] Choose a query builder: [Kysely](https://kysely.dev/) (lightweight, type-only ORM-ish) is the default recommendation. Or hand-write `types/schema.ts` if you'd rather not add a dep.
- [ ] If Kysely: run `kysely-codegen` against the local D1 sqlite to generate `types/schema.d.ts`. Wire into `d1.ts` so `queryD1<T>` is properly typed.
- [ ] Replace the SQL string templates in `lore.ts` (and any future relational helpers) with type-safe query builders.
- [ ] Decide on the camelCase/snake_case strategy (see Priority 4) and have the type generator reflect that choice.

### Priority 3 — Helper consolidation
*Estimated: ~half a day*

- [ ] Decide on the canonical per-entity helper pattern in [src/lib/compendium.ts](../../src/lib/compendium.ts):
  - **Currently used**: `upsertFeature` / `fetchFeature` / `deleteFeature` (Class/SubclassEditor) and `upsertSpell` / `fetchSpell` / `deleteSpell` / `upsertSpellBatch` (SpellsEditor / SpellImportWorkbench).
  - **Currently unused**: `upsertItem` / `fetchItem` / `deleteItem` / `upsertFeat` / `fetchFeat` / `deleteFeat`.
  - **Pick one**: either refactor `EntityEditorShell` (née `DevelopmentCompendiumManager`) to call the per-entity helpers (making them universal), or delete the unused ones (making `upsertDocument(name, ...)` the canonical pattern for flat-table editors).
- [ ] Split [src/lib/compendium.ts](../../src/lib/compendium.ts)'s 130-line `normalizeCompendiumData` / `denormalizeCompendiumData` into per-entity files (`normalizeFeat`, `normalizeItem`, `normalizeSpell`). Each becomes ~20 lines and trivially testable.
- [ ] Move boolean coercion (`true`/`false` ↔ `1`/`0`) and JSON stringify into the `d1.ts` boundary layer, not the editor-side normaliser.

### Priority 4 — Naming convention
*Estimated: 1-2 days, depending on choice*

- [ ] Pick **one**: snake_case end-to-end (form state mirrors DB) **OR** camelCase end-to-end (mapping happens *only* at the `d1.ts` boundary). Don't keep both.
- [ ] Document the choice in this file.
- [ ] Refactor editors to match. (Bigger if you pick "snake_case everywhere" since most form state is currently camelCase.)

### Priority 5 — Editor quality of life
*Optional, can run in background as you touch editors*

- [ ] Optimistic UI: replace post-save `loadEntries()` with cache invalidation + local state update. The `clearCache(tableName)` in `d1.ts` already does the cache invalidation; just need editors to update their own state without refetching.
- [ ] Default to transactions: add a wrapper that auto-detects multi-step writes and routes through `batchQueryD1`. Or rename `upsertDocument` → `upsertOne` and elevate `batchQueryD1` to `upsertMany`.
- [ ] Centralise error handling: each editor today has its own `try/catch + toast.error(...)`. A small helper `withSaveErrorHandling(label, fn)` would unify the pattern.

### Priority 6 — Cross-table integrity (longer-term)
*Estimated: case-by-case*

- [ ] Class editor cascade-delete prompt (already documented in [features/compendium-classes.md](../features/compendium-classes.md)). The editor should run `scanForReferences` on delete and offer cascade / reparent / cancel.
- [ ] Migrate JSON-array tag references (`classes.tag_ids`, `feats.tags`, `items.tags`, `spells.tags`) into proper junction tables. Enables queries like "find all classes with the Combat tag" without LIKE-on-JSON. Phase 4e architecture doc explicitly defers this.
- [ ] Schema-vs-code lint: a CI check that ensures `migrate.js` mappers and editor save payloads agree with `worker/migrations/*.sql`. Or: delete `migrate.js` once Firestore is gone (the only reason it exists).
- [ ] **Adopt `<name-slug>-<source-slug>` identifier convention for source-specific entities.** Today most identifiers are bare `<name-slug>` (e.g., `blade-of-disaster`, `wall-of-force`). When a spell/feat/class appears in multiple source books with mechanical differences, this collides under D1's `UNIQUE` constraint and silently drops the loser.
  - Discovered when the Foundry import collapsed two `Blade of Disaster` versions (FRHF vs TCE) into the same identifier. Resolved one-off via `scripts/rename-blade-of-disaster.js`.
  - **Going forward**: identifiers for source-specific entities should be `<name-slug>-<source-slug>` (e.g., `blade-of-disaster-tce`, `blade-of-disaster-frhof`). The bare `<name-slug>` form is reserved for unambiguous entities or canonical/core-rules versions.
  - **Implementation paths to update**:
    - [src/lib/spellImport.ts](../../src/lib/spellImport.ts) — Foundry spell folder importer should append the source slug to the identifier when creating a candidate.
    - `slugify` callers in editors — when an editor auto-generates an identifier from name (e.g., [src/components/compendium/DevelopmentCompendiumManager.tsx](../../src/components/compendium/DevelopmentCompendiumManager.tsx) at save time), append the source slug if the entity has a `sourceId`.
  - **Migration path for existing identifiers**: a sweep-and-rename script that scans for collision-prone identifiers, resolves the source for each, and rewrites in place. Same pattern as `scripts/rename-blade-of-disaster.js` but generalised across spells/feats/items/classes/subclasses. Prefer to run this once before final Firestore cut so D1 stays clean from the start.

### Priority 7 — Final Firestore-removal cleanup
*Pulled from the [Firestore-cut punchlist](../database/firestore-cut-punchlist.md) Phase E for completeness*

- [ ] Delete [src/lib/firebase.ts](../../src/lib/firebase.ts) Firestore init (keep only Auth).
- [ ] Remove `firebase/firestore` import from every file across `src/`.
- [ ] Delete top-level `firestore.rules`, `firebase.json`, `firebase-blueprint.json`, `storage.rules`.
- [ ] Move `migration-firebase-side/` to `docs/_archive/firestore-source-mapping/`.
- [ ] Move `scripts/migrate.js`, `scripts/migrate_subclasses.js`, `scripts/check_firestore.js`, `scripts/cleanup-firestore-orphans.js`, `scripts/delete-replaced-sorcerer-set.js`, and `scripts/_audit-*.py` to `scripts/_archive/`.
- [ ] Remove `firebase-admin` from `package.json` dependencies if no longer needed (the Vercel/Express proxy still uses it for JWT verification — verify before removing).
- [ ] Update [AGENTS.md](../../AGENTS.md): drop the migration-rules section; keep "no direct Firestore" as a permanent rule against regressions.
- [ ] Move [docs/database/firestore-cut-punchlist.md](../database/firestore-cut-punchlist.md) and [docs/database/migration-walkthrough-spellsummary.md](../database/migration-walkthrough-spellsummary.md) to `docs/_archive/`.
- [ ] Update [docs/database/README.md](../database/README.md) — remove punchlist, mark all phases COMPLETE.

---

## Tracking and reminders

This doc is intentionally short on cross-references to keep it usable. The **single trigger to revisit it**:

> When [docs/database/firestore-cut-punchlist.md](../database/firestore-cut-punchlist.md) is fully checked off (every box ticked), open this file and start at Priority 1.

Each priority section has independent checkboxes. You can pick them off in any order, though Priority 1 (pattern consolidation) is what makes the others easier.

When a priority is complete, move its checkbox section into a "Completed" subsection at the bottom of this file (or just leave the boxes ticked — they survive as a record of what landed).

## Related docs

- [../database/firestore-cut-punchlist.md](../database/firestore-cut-punchlist.md) — the migration we're finishing first
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — the foundation this all builds on
- [../features/compendium-classes.md](../features/compendium-classes.md) — class-editor specifics, including the cascade-delete TODO
- [../features/compendium-spells.md](../features/compendium-spells.md), [compendium-feats-items.md](../features/compendium-feats-items.md), [compendium-options.md](../features/compendium-options.md), [compendium-scaling.md](../features/compendium-scaling.md) — per-entity feature docs
