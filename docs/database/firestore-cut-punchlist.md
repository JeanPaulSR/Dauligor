# Firestore-Cut Punchlist

The remaining work to finish the Firestore → D1 migration. When every box here is checked, Firebase Authentication remains but every other Firebase product can be removed.

For phase status and architectural context, see [README.md](README.md). For a worked migration example, see [migration-walkthrough-spellsummary.md](migration-walkthrough-spellsummary.md).

## Rules of engagement

1. **Local D1 first.** Schema changes go through `wrangler d1 execute … --local` and validation before `--remote`.
2. **Never push to `main`** until the punchlist is empty and the app is validated end-to-end. Vercel auto-deploys on push.
3. **Pre-Update reference** at `E:\DnD\Professional\Dev\Pre-Update\Dauligor-main` is the rollback. Every feature there must continue to work after the cut.
4. Each migration follows the same shape: replace `getDoc`/`getDocs`/`addDoc`/`setDoc`/`updateDoc`/`deleteDoc`/`onSnapshot` with `queryD1`/`fetchCollection`/`fetchDocument`/`upsertDocument`/`upsertDocumentBatch`/`deleteDocument` from [src/lib/d1.ts](../../src/lib/d1.ts).
5. Update the checkbox here as each item lands.

---

## Phase A — Core libraries

These are imported by many pages. Migrate them first; many page-level migrations become trivial as a result.

### A1. `src/lib/spellSummary.ts`
- [ ] Drop the `spellSummaries` Firestore collection entirely (the `spells` table can derive summaries on read)
- [ ] Delete `upsertSpellSummary` — no longer needed
- [ ] Delete `deleteSpellSummary` — no longer needed
- [ ] Replace `createSpellWithSummary` with a single `upsertDocument('spells', id, …)` call
- [ ] Replace `spellSummariesExist` with a thin D1 SELECT against `spells`
- [ ] Delete `backfillSpellSummaries` — no longer needed
- [ ] Drop the `firebase/firestore` import; keep only `fetchCollection` from `d1.ts`
- [ ] Audit call sites for the deleted exports (`Settings.tsx` purge action references `'spellSummaries'` string)

**Worked example**: [migration-walkthrough-spellsummary.md](migration-walkthrough-spellsummary.md). Use this as the template for similar migrations.

### A2. `src/lib/imageMetadata.ts`
- [ ] Switch all `getDoc`/`setDoc`/`getDocs`/`updateDoc`/`deleteDoc` calls on `imageMetadata` to D1 helpers against `image_metadata`
- [ ] `saveImageMetadata` → `upsertDocument('image_metadata', docId, …)`
- [ ] `getImageMetadataByPath` → `fetchDocument('image_metadata', docId, null)`
- [ ] `updateImageMetadata` → `upsertDocument('image_metadata', docId, partialData)` (D1 INSERT OR REPLACE preserves merge-like behaviour because the helper merges with existing row data; verify this matches expectations or build a UPDATE-only helper)
- [ ] `deleteImageMetadata` → `deleteDocument('image_metadata', docId)`
- [ ] `scanForReferences(url)` — replace per-collection `getDocs` with `fetchCollection` calls; the table list to scan is `classes`, `subclasses`, `characters`, `sources`, `users`, `lore_articles` (mapped to D1 names)
- [ ] `updateImageReferences` — replace per-doc `updateDoc` with `upsertDocument`-style updates

### A3. `src/lib/classExport.ts`
**Write side (lines ~80–158)** — these write to Firestore directly when an export ingests new data:
- [ ] `setDoc(doc(db, 'sources', …))` → `upsertDocument('sources', id, …)`
- [ ] `setDoc(doc(db, 'spellcastingScalings', id), …)` → `upsertDocument('spellcastingScalings', id, { ...d, type: 'standard' })` (note: `D1_TABLE_MAP` routes to `spellcasting_progressions`; **must** include `type` so the row is correctly tagged — the migrate script tags rows during initial load but client-side writes need to include it explicitly)
- [ ] `setDoc(doc(db, 'spellsKnownScalings', id), …)` → same pattern with `type: 'known'`
- [ ] `setDoc(doc(db, 'pactMagicScalings', id), …)` → same pattern with `type: 'pact'`
- [ ] `setDoc(doc(db, 'uniqueOptionGroups', group.id), …)` → `upsertDocument('uniqueOptionGroups', …)`
- [ ] `setDoc(doc(db, 'uniqueOptionItems', item.id), …)` → batch via `upsertDocumentBatch('uniqueOptionItems', items)`
- [ ] `setDoc(doc(db, 'scalingColumns', col.id), …)` → batch via `upsertDocumentBatch('scalingColumns', cols)`
- [ ] `setDoc(doc(db, 'subclasses', sub.id), …)` → batch
- [ ] `setDoc(doc(db, 'features', feat.id), …)` → batch
- [ ] `setDoc(doc(db, 'classes', classData.id), …)` → `upsertDocument('classes', id, …)`

**Read side** — direct `getDoc`/`getDocs` calls that don't go through `fetchCollection`:
- [ ] Line ~672: `getDoc(doc(db, 'classes', classId))` → `fetchDocument('classes', classId, null)`
- [ ] Line ~747: `getDoc(doc(db, 'sources', sid))` → `fetchDocument('sources', sid, null)`
- [ ] Line ~870: `getDocs(query(collection(db, 'uniqueOptionGroups'), where(documentId(), 'in', allGroupIds)))` → `fetchCollection('uniqueOptionGroups', null, { where: \`id IN (\${placeholders})\`, params: allGroupIds })`
- [ ] Line ~957: `getDocs(query(collection(db, 'uniqueOptionItems'), where('groupId', 'in', allGroupIds)))` → `fetchCollection('uniqueOptionItems', null, { where: \`group_id IN (\${placeholders})\`, params: allGroupIds })`
- [ ] Line ~1086: `getDoc(doc(db, 'sources', classDataRaw.sourceId))` → `fetchDocument('sources', sourceId, null)`
- [ ] Line ~1146: `getDoc(doc(db, 'sources', sourceId))` → same
- [ ] Line ~1290: `getDocs(query(collection(db, 'sources'), where('status', '==', 'ready')))` → `fetchCollection('sources', null, { where: "status = ?", params: ['ready'] })`
- [ ] Line ~1435: same pattern as 1290
- [ ] Line ~1486: same as 1086

**Fallback cleanup (post-migration)** — after the writes/reads above land, drop the Firestore fallbacks at lines 707–720 (15 of them) by changing the second arg to `null`. They're cosmetic — D1 is already the source of truth for these reads.

---

## Phase B — Single-purpose page migrations

Self-contained pages that don't pull in the broader compendium machinery.

### B1. `src/pages/admin/SpellcastingAdvancementManager.tsx`
- [ ] Replace `onSnapshot(collection(db, 'standardMulticlassProgression'), …)` with a `fetchCollection` + polling/refresh pattern (or just a load-on-mount refresh)
- [ ] Same for `pactMagicScalings`, `spellsKnownScalings`
- [ ] `deleteDoc(doc(db, collectionName, id))` → `deleteDocument(collectionName, id)`
- [ ] Note: `pactMagicScalings`, `spellsKnownScalings`, `spellcastingScalings` all map to `spellcasting_progressions` in D1 via `D1_TABLE_MAP` — this collapses three legacy collections into one table

### B2. `src/pages/core/Map.tsx`
- [ ] Replace `onSnapshot(query(collection(db, 'lore'), …))` with a `fetchCollection('lore', null, { where: 'category = ?', params: ['map-marker'] })` (or whichever discriminator the markers use)
- [ ] `addDoc(collection(db, 'lore'), …)` → `upsertDocument('lore', crypto.randomUUID(), …)`
- [ ] `deleteDoc(doc(db, 'lore', id))` → `deleteDocument('lore', id)`
- [ ] If the polling rate matters, build it into the page (D1 has no live `onSnapshot`); a 30–60s interval is usually fine. The foundation heartbeat will invalidate the persistent cache after mutations.

### B3. `src/pages/admin/ImageManager.tsx`
- [ ] Already partly migrated to D1 for image listing. The remaining `getDocs(collection(db, col))` calls (lines ~125, ~134) feed the System Images tab name resolution
- [ ] Replace each `getDocs(collection(db, col))` with `fetchCollection<{id, name?, displayName?, title?}>(col, null, { select: 'id, name, display_name, title' })`
- [ ] The collection-name-to-D1-table mapping is already in `D1_TABLE_MAP`; just pass the legacy name

### B4. `src/components/compendium/ActivityEditor.tsx:234`
- [ ] `getDocs(collection(db, 'attributes'))` → `fetchCollection<{ id: string; identifier?: string; name: string }>('attributes', null)`
- Single direct-Firestore call site. Five-line refactor of the `useEffect` block.

### B5. Scaling editors with wrong table names
Two editors call D1 helpers with **non-existent table names**, so reads return nothing and writes fail silently:
- [ ] [src/pages/compendium/scaling/SpellcastingScalingEditor.tsx](../../src/pages/compendium/scaling/SpellcastingScalingEditor.tsx) — uses `'spellcasting_scalings'` (no such table). Fix: change to `'spellcastingScalings'` (in `D1_TABLE_MAP` → `spellcasting_progressions`); add `where: "type = 'standard'"` on reads; add `type: 'standard'` to upsert payload.
- [ ] [src/pages/compendium/scaling/SpellsKnownScalingEditor.tsx](../../src/pages/compendium/scaling/SpellsKnownScalingEditor.tsx) — uses `'spells_known_scalings'` (no such table). Same fix with `type: 'known'`.
- [x] ~~`AlternativeSpellcastingScalingEditor.tsx`~~ — was the third broken editor; deleted as obsolete (along with its `/compendium/pact-scaling/*` routes from `App.tsx`).

After these fixes, also update the orphaned link surfaces that still point at the deleted `/compendium/pact-scaling/*` routes:
- [ ] [src/pages/admin/SpellcastingAdvancementManager.tsx](../../src/pages/admin/SpellcastingAdvancementManager.tsx) lines 189, 201 — `<Link to="/compendium/pact-scaling/…">`. Either repoint at `/compendium/spellcasting-scaling/…` (once that editor is type-aware) or remove the pact panel entirely.
- [ ] [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx) lines 2549, 2555 — same pattern in the class spellcasting config UI.

### B6. `/api/module` endpoints — server-side D1 migration
The Foundry pairing module reads from these endpoints to fetch the source catalog and class data. They currently query Firestore directly via the Admin SDK.

- [ ] [api/module.ts](../../api/module.ts) — replace `db.collection('sources').get()` and `db.collection('classes').get()` with `executeD1QueryInternal(...)` calls from [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts). The map snake_case D1 columns (`source_id`, `image_url`, etc.) back to the camelCase fields the catalog-building code expects (or inline the rename).
- [ ] [server.ts](../../server.ts) lines ~184–282 — same change for local-dev parity. The Express handler mirrors api/module.ts logic.
- [ ] [api/module/[[...path]].ts](../../api/module/[[...path]].ts) — currently filesystem-only fallback. **Leave as-is** — it serves as a static safety net even after the cut.

**Output JSON shape does not change.** Semantic IDs (`source-phb-2014`, `class-cleric`, etc.) are computed from `slug`/`identifier`/`rules`, not from row IDs. Foundry pairing module compatibility is preserved.

**No user JWT** for these endpoints — they're public (Foundry doesn't authenticate to Dauligor). `executeD1QueryInternal` uses the shared `R2_API_SECRET` that the Worker already trusts; no changes needed at the auth boundary.

### B7. Drop Firestore fallbacks — ✅ **COMPLETE**
Not cosmetic. Every fallback was a live Firestore round-trip on any empty-result D1 query: `WHERE` filters that matched no rows triggered Firestore network calls.

Cleared after each phase audit verified D1 parity:

- [x] [src/lib/classExport.ts](../../src/lib/classExport.ts) — all 17 fallbacks gone (14 Phase 1 collections after Phase 1 audit, 3 Phase 4 after Phase 4 / Classes audit)
- [x] [src/pages/compendium/SpellList.tsx](../../src/pages/compendium/SpellList.tsx) — 5 fallbacks gone (spells list/document plus sources/tagGroups/tags); `firebase/firestore` import removed
- [x] [src/pages/compendium/SubclassEditor.tsx](../../src/pages/compendium/SubclassEditor.tsx) — 7 Phase 1+4 fallbacks gone, plus 2 direct-Firestore reads (lines 243, 258) and the `doc(collection(db, 'features')).id` ID-generator (line 975)
- [x] [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx) — `doc(collection(db, 'features')).id` ID-generator (line 2654) replaced with `crypto.randomUUID()`
- [ ] [src/components/compendium/SpellImportWorkbench.tsx](../../src/components/compendium/SpellImportWorkbench.tsx) — **3 `onSnapshot` calls remain** (lines 81, 109, 114 for sources / tagGroups / tags). These are not fallbacks; they're primary Firestore real-time listeners. Migration to `fetchCollection` + manual refresh is tracked under the editor sweep below.

**Confirmation**: `grep -rE "fetchCollection\([^,]+,\s*async\s*\(\)|fetchDocument\([^,]+,[^,]+,\s*async\s*\(\)" src/` returns zero matches.

### B8. `config/wiki_settings` (referenced by 3 files)
**Decision required first**: where does this single-row config doc go in D1?

Option A: Add a new `app_config` table (`key TEXT PK`, `value JSON`).
Option B: Reuse `system_metadata` (already exists; uses `(key, value)` pattern).

Recommendation: **Option B**. The config row is small, single-write, single-read, and `system_metadata` already has the right shape. Drop a `key='wiki_settings'` row.

- [ ] Pick A or B (suggest B)
- [ ] If A, write a new `0012_app_config.sql` migration; update `D1_TABLE_MAP`
- [ ] [src/components/Sidebar.tsx:48](../../src/components/Sidebar.tsx) — replace `getDoc(docRef)` with the chosen D1 read
- [ ] [src/pages/wiki/LoreArticle.tsx:114](../../src/pages/wiki/LoreArticle.tsx) — same
- [ ] [src/pages/admin/AdminCampaigns.tsx:176](../../src/pages/admin/AdminCampaigns.tsx) — replace `setDoc` with the chosen D1 write

---

## Phase C — `CharacterBuilder.tsx` (the largest single offender)

~25 direct Firestore calls. Migrate as one focused sweep — the file is 5000+ lines but the calls cluster.

Sub-tasks (each is a `getDoc`/`getDocs` → D1 helper swap):

- [ ] Initial bulk fetch of base catalogs around line ~2073: `campaigns`, `skills`, `armor`, `armorCategories`, `weapons`, `weaponCategories`, `tools`, `toolCategories`, `languages`, `languageCategories` — replace with parallel `fetchCollection` calls
- [ ] Line ~2123: `spellcastingTypes` → `fetchCollection('spellcastingTypes', null)`
- [ ] Line ~2126: `standardMulticlassProgression/master` → `fetchDocument('standardMulticlassProgression', 'master', null)`
- [ ] Line ~2132: `attributes` → `fetchCollection('attributes', null)`
- [ ] Lines ~857, ~877: class option lookups → `fetchCollection('classes', null, { where: ... })` or `fetchDocument`
- [ ] Lines ~904, ~914: parallel option lookups → batch via `Promise.all` of `fetchDocument` calls
- [ ] Line ~948: snapshot → `fetchCollection`
- [ ] Lines ~1101, ~2807: `getDoc(doc(db, 'uniqueOptionItems', id))` → `fetchDocument('uniqueOptionItems', id, null)` (consider batching with `Promise.all`)
- [ ] Line ~1146: `getDocs(query(collection(db, 'classes')))` → `fetchCollection('classes', null)`
- [ ] Line ~1186: `getDoc(doc(db, 'subclasses', id))` → `fetchDocument('subclasses', id, null)`
- [ ] Lines ~1228, ~1277: feature / scaling queries → `fetchCollection` with `where`
- [ ] Line ~5118: deeply-nested `getDocs(q)` — find the surrounding query, replace with `fetchCollection`

When the sweep is done:
- [ ] Remove the `firebase/firestore` imports from this file (only `auth` should remain via `firebase.ts`)
- [ ] Verify the character save flow still works against local D1 — this is the integration test that catches missed call sites

---

## Phase D — Compendium editor sweep

Each of these files has some direct Firestore calls mixed in with their existing D1 paths. Most are smaller than `CharacterBuilder.tsx`. Do them one at a time, validate, mark done.

- [ ] [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx)
- [ ] [src/pages/compendium/SubclassEditor.tsx](../../src/pages/compendium/SubclassEditor.tsx)
- [ ] [src/pages/compendium/SpellList.tsx](../../src/pages/compendium/SpellList.tsx)
- [ ] [src/components/compendium/SpellImportWorkbench.tsx](../../src/components/compendium/SpellImportWorkbench.tsx)
- [ ] [src/components/compendium/DevelopmentCompendiumManager.tsx](../../src/components/compendium/DevelopmentCompendiumManager.tsx)
- [ ] [src/components/compendium/ActivityEditor.tsx](../../src/components/compendium/ActivityEditor.tsx)
- [ ] [src/components/compendium/ModularChoiceView.tsx](../../src/components/compendium/ModularChoiceView.tsx)
- [ ] [src/components/compendium/AdvancementManager.tsx](../../src/components/compendium/AdvancementManager.tsx)

For each, the procedure is the same:
1. `grep -n "getDoc\|getDocs\|setDoc\|deleteDoc\|onSnapshot\|addDoc\|updateDoc" <file>`
2. Convert each call site to the equivalent D1 helper
3. Manually validate the editor's save path against local D1
4. Tick the box

---

## Phase E — Final cleanup (do after every box above is checked)

- [ ] Remove every `firebaseFallback` argument across the app — pass `null` everywhere `fetchCollection` / `fetchDocument` is called
- [ ] Delete the Firestore client init and Firestore-specific exports in [src/lib/firebase.ts](../../src/lib/firebase.ts):
  - Keep: `auth`, `usernameToEmail`, `firebaseConfig`, the auth re-exports
  - Remove: `db`, `initializeFirestore`, `memoryLocalCache`, `memoryLruGarbageCollector`, `CACHE_SIZE_UNLIMITED`, the firestore type imports, `OperationType`, `resetFirestore`
- [ ] Search for any remaining `from 'firebase/firestore'` imports across `src/`. None should remain.
- [ ] Delete top-level Firestore artefacts: `firestore.rules`, `firebase.json`, `firebase-blueprint.json`, `storage.rules`
- [ ] Move `migration-firebase-side/` to `docs/_archive/firestore-source-mapping/` after extracting anything still useful
- [ ] Update [AGENTS.md](../../AGENTS.md):
  - Remove the "migration in flight" framing
  - Keep the rule "no direct Firestore" as a permanent guardrail against regressions
  - Update the stack table to drop Firestore
- [ ] Move this punchlist file to `docs/_archive/firestore-cut-punchlist.md`
- [ ] Update [database/README.md](README.md) to mark all phases complete and remove the punchlist section
- [ ] Smoke-test against the production deploy with the freeze lifted

---

## ⏭️ After this punchlist is empty

Open [../architecture/compendium-editor-patterns.md](../architecture/compendium-editor-patterns.md) and start the **Post-migration cleanup roadmap**. It's the structural cleanup that finishes what this punchlist starts: pattern consolidation, schema-as-source-of-truth (Kysely or hand-written types), helper consolidation, and naming-convention picks.

Estimated effort: ~1 focused week, broken into 6 prioritised sections with their own checkboxes.

**Don't start any of that mid-migration.** Refactoring while half-on-Firestore creates more risk than the cleanup is worth. The punchlist comes first; the architectural roadmap comes after.

---

## Validation matrix

After each migration, confirm against local D1:

| Path to validate | Edit / view target |
|---|---|
| Wiki | Open an article, edit it, save |
| Class | Open a class, edit advancement, save, view in `ClassView` |
| Spell | Spell list filter, manual edit, Foundry import |
| Character | Build new character, level up, export to Foundry |
| Image | Upload, rename + update links, delete with reference scan |
| Admin | Create user, generate temp password, view image manager |

The DevTools network tab should show only `/api/d1/query` and `/api/r2/*` calls — no `firestore.googleapis.com`. The console should show `[D1]` logs (green for mutations, red for deletes), no `Falling back to Firebase` warnings.

---

## Related docs

- [README.md](README.md) — phase status overview
- [migration-walkthrough-spellsummary.md](migration-walkthrough-spellsummary.md) — concrete worked example
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — full D1 client API
- [../operations/local-dev.md](../operations/local-dev.md) — running migrations and validating
- [../operations/deployment.md](../operations/deployment.md) — when to lift the migration freeze
