# Handoff — Class Importer SHIPPED + recent deploys (compaction snapshot)

**Date:** 2026-06-08 · **Branch:** `manual-uploads` · **Author:** Claude
**Purpose:** resume cleanly after a context compaction. The class importer is
**live on production**; this captures what shipped, what to watch, the
push-discipline correction, and where to read.

---

## ⭐ Orientation — read these FIRST (every new session)

- **`AGENTS.md`** (repo root) — the project briefing: stack, non-negotiable
  rules (1–7), durable rules, where-to-look table, multi-agent/handoff protocol.
  **Rule 7** (D1 schema → local first, `--remote` only with a FRESH explicit
  go-ahead; an earlier "go ahead" does NOT transfer) — see "Push discipline" below.
- **`docs/`** — the documentation tree. Resolve files via `DIRECTORY_MAP.md`;
  feature logic in `docs/features/`, data shapes in `docs/database/structure/`,
  runtime in `docs/platform/`, UI in `docs/ui/`. Import-system component guide +
  "how to add a type": **`docs/architecture/import-system.md`**.
- **`handoffs/README.md`** — the handoff folder convention (BRANCH_REGISTRY,
  per-branch journals, shared-files protocol, append-only files, timestamped
  migrations, pre-commit rebase). This file lives under that convention.
- **Deep import detail:** `handoffs/manual-uploads/2026-06-06-class-importer-state.md`
  (the exhaustive architecture + the ⭐ 2026-06-07 "mark-up sections pass" update
  block at its top — partition/decouple, Feature mark, Proficiencies section,
  popover portal, etc.). READ THIS for how the importer is built.
- **Memory:** `project_import_system` (⭐, now marked SHIPPED), `MEMORY.md` index,
  `feedback_main_is_production_deploy`, `project_d1_remote_migration_apply`,
  `reference_style_guide`, `project_d1_local_seed_method`, `feedback_handoffs_folder`.

---

## TL;DR — state right now

The **Mark & Build importer** at `/compendium/import` (admin) imports **spells**
and **classes** end-to-end. The **class importer is feature-complete and SHIPPED
to `main`** (Cloudflare Pages auto-deploys main → production at www.dauligor.com).
`manual-uploads` is **0 ahead / 0 behind `origin/main`** — fully synced; working
tree clean except 4 untracked `scripts/_*` throwaways (keep them OUT of commits).

No DB migration was ever needed — the importer uses existing prod tables
(`classes`, `features`, `attributes`, the `is_subclass_feature` column, etc.).

---

## 🔭 Recent deploys to WATCH (user wants to confirm no issues)

All pushed straight to `main` = live prod. Watch for regressions, esp. in the
class editor (the one shared-file change is the `proficiencySelection.ts`
display-name fix) and the importer route. Commits (SHAs are post-rebase):

- `a0bed2e` **sections-default entry, rich-text bodies + paste, overwrite-existing**
  — selecting Class opens straight into the Sections drop-zone workspace
  (type-reset effect → `phase 'single'` when `hasSections`; "Edit text" returns to
  the paste box). Feature bodies editable via MarkdownEditor (per-row edit/done).
  Section drop-zones convert pasted `text/html` → BBCode (`richPasteInto`). An
  **"Overwrite existing class"** picker (`SingleSelectSearch` of name·identifier)
  sets `existingId` so Create writes to that row's id. Kept `identifier =
  slugify(name)` (routing already disambiguates by identifier+source abbrev;
  DB key is the UUID — source-scoping would double-suffix the slug).
- `704a3e0` **post-process polish** — Primary-Ability pills now populate
  (line-bounded `Primary Ability:` parse → ability codes; spellcasting sentence =
  low-conf fallback); proficiency display-names auto-sync on resolve
  (`buildGroupedProficiencyDisplayName` in `resolveClassProficiencies`); feature
  remove COLLAPSES into the row above (+ a ⊟ Split button); class prose + feature
  bodies are reflowed (`reflowText` in classParse — dependency-free).
- `4141eae` (`72eca1c` is the rebased "class preview" piece) **editor-control
  reuse + class preview + proficiency Sync display** — ability pill picker
  (`'abilities'` field kind + `attributes` catalog), MarkdownEditor for
  description/lore/multiclassing (`'markdown'` kind), `ClassPreviewPane` "Preview"
  button, `showDisplayNames` on the grid.
- (earlier, also on prod) the section model itself: Paste-by-section drop-zones,
  Proficiencies section + grouped popover, Feature mark, partition/decouple
  mark-up, popover portal fix, bulk feature auto-split, subclass `is_subclass_feature`
  row, weapon-category fix, notes channel. See the 2026-06-06 handoff for these.

NOTE: `main` also now carries a **foundry-module** branch's work (the
`feat(foundry-module)…` / `docs(module)…` commits interleaved in `git log`) — not
mine. The clean rebases means no textual conflicts, but if a prod issue appears,
check whether it's importer or module.

---

## ⚠️ Push discipline (correction — apply going forward)

I pushed to `main` (= live prod deploy) **three separate times across turns** on
the strength of ONE earlier "we can push so stop asking." That stretched a single
authorization across multiple independent production deploys — exactly the pattern
**AGENTS.md rule 7** forbids: *an earlier go-ahead does NOT transfer to the next
production-affecting operation.* (Letter of rule 7 is about `--remote` D1
migrations, which I did NOT do — my only remote-D1 calls were read-only SELECTs;
all D1 writes were local. But the principle applies to prod pushes.)

**Going forward: ask for a FRESH explicit OK before each `git push … :main`.**
`main` = production. Show `git log origin/main..HEAD` first; rebase onto
`origin/main` first (it moves — the foundry-module branch shares it).

---

## Architecture (where the importer lives)

Pure core `src/lib/import/`: `types.ts` (the `ImportDescriptor` contract + field
kinds + assign hooks), `registry.ts` (DESCRIPTORS, `resolveEntity(type,fields,ctx)`
with `id = ctx.existingId ?? randomUUID()`, `commitEntity`, assign passthroughs),
`index.ts` (barrel), `spell.ts`/`spellParse.ts` (reference type), `clazz.ts` (the
class descriptor — `buildPayload` mirrors `ClassEditor.handleSave`'s snake_case
`d1Data`; `commit` = `upsertDocument('classes')` + `queueRebake` + per-feature
`upsertFeature` incl. the `isSubclassFeature` flag), `classParse.ts` (pure parser:
identity + `splitClassSections`/`groupClassFeatures` + `parseFeatureSpan` +
`splitFeatures` + `resolveClassProficiencies`/`resolveProficiencyKind` +
`reflowText`).

Window `src/pages/compendium/ImportMarkWindow.tsx` (type-agnostic): `EntityWorkspace`
(left = Sections drop-zones OR Mark-text annotated source [toggle], right =
Fields/Preview), `FieldControl` (kinds incl. `proficiencies`/`features`/`markdown`/
`abilities`), `SectionsPanel` + `BlockDropZone`/`FeatureDropZone`, `FeaturesPanel`
(merge/split/collapse + body MarkdownEditor), the assign popover (PORTALED to
`document.body` so `fixed` escapes the blurred wrapper), the grouped popover
(Blocks vs Within-Proficiencies), `ClassPreviewPane` preview, the Overwrite picker.
Catalogs (skills/armor/weapons/tools/languages + categories + **attributes**)
loaded once + shared via `ImportCatalogsContext`.

Shared-file change on prod: `src/lib/proficiencySelection.ts`
`buildGroupedProficiencyDisplayName` matches id OR identifier (skills display name).

---

## Dev / test setup (how to resume)

- **Relaunch the stack:** `preview_start("manual-uploads")` (`.claude/launch.json`)
  → app **:3003**, worker **:8790** (LOCAL D1). `serverId` changes per launch; the
  stack dies on PC restart/sleep — just `preview_start` again, poll `curl :3003`
  until 200. App is **no-watch** → reload the page after a source edit. NEVER
  `npm install` in the worktree (junctioned `node_modules`).
- **Auth:** `node scripts/_mint-token.mjs` → admin JWT; inject
  `localStorage.setItem('dauligor:authToken', <jwt>)` then reload. Clears on PC restart.
- **Local D1 query:** `POST http://localhost:8790/query` with
  `Authorization: Bearer q9nHN9H3Ny2ilWXWFlViQD5LBI63sc1KirhrwTyc` (local API_SECRET)
  + `{sql,params}` (heredoc body to dodge shell escaping).
- **Remote D1 (READ-ONLY, user-invited):** `npx wrangler d1 execute dauligor-db
  --remote --command "SELECT …" --config worker/wrangler.toml`. **NEVER
  `migrations apply --remote`** (per rule 7 + memory — replays all migrations).
- **Pure-parser tsx tests:** write a temp `scripts/_test-*.ts`, `npx tsx …`, delete.
- **tsc:** `npx tsc --noEmit` — current baseline is **3 pre-existing errors**, 0 in
  import files (main fixed some of the old `asChild` ones; expect ~3 total).
- Browser-driving gotchas: `preview_eval` only (click-by-text, not selectors);
  native value-setter + dispatch for inputs; **one mutation per eval** (React
  batches); React `onBlur` fires on **`focusout`** (dispatch `focusout`, not `blur`);
  read the resolved payload from `document.querySelector('pre')` (it IS what commit writes).

---

## Open / next work

1. **Watch the recent deploys** for prod issues (user's ask) — class editor +
   importer.
2. **Subclass importer** — the natural next type. `subclazz.ts` mirroring
   `SubclassEditor.handleSave` (`upsertDocument('subclasses')` + `queueRebake`),
   a parent-class picker (`fetchCollection('classes')` → `class_id` +
   `class_identifier`), reuse `classParse`'s feature pipeline routing features to
   `parentType:'subclass'`; source REQUIRED on save. Catalog:
   `docs/_drafts/class-subclass-importer-parts-2026-06-05.html`.
3. Then feat / item importers (reuse the descriptor pattern).

---

## Pointers (one place)

- Briefing + rules: **`AGENTS.md`**.
- Docs tree: **`docs/`** (resolve via `DIRECTORY_MAP.md`); importer guide
  `docs/architecture/import-system.md`.
- Handoff convention: **`handoffs/README.md`**.
- Deep importer state: `handoffs/manual-uploads/2026-06-06-class-importer-state.md`.
- Memory: `project_import_system` (⭐ SHIPPED), `feedback_main_is_production_deploy`.
