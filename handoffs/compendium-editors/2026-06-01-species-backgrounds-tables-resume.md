# Handoff — `compendium-editors`: promote Backgrounds + Species to their own tables

> **Date:** 2026-06-01 · **Branch:** `compendium-editors` · **Worktree:**
> `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d`
> **New step starts here.** The modular-options work (browser + editor) is DONE and on main.
> Prior resume: [2026-05-30-modular-options-resume.md](2026-05-30-modular-options-resume.md).

## TL;DR — what this step is

Roadmap **Step 1**: promote **Backgrounds** and **Species** (the 2024 name for "Race") out of the
shared `feats` table into their own dedicated tables, then give each a real editor (replacing the
thin `FeatsEditor` wrappers). We were blocked waiting on Foundry data shapes — **those arrived** and
are analyzed. Two product decisions are locked (below). Next actionable work is **table design +
migration**, then exporter wiring, then editors.

## Git state (read with `git -C "<worktree>"` — Bash CWD resets each call)

- **HEAD = `fff679b`**, **in sync with origin/main (0 ahead / 0 behind).** Everything from the prior
  session (inline 3-pane option editor, full-width browser filter bar, multiclass-prof fix, skills
  display-name, bake subrequest fix, doc reconciliation) is on main.
- **Working tree:** clean except `.claude/scheduled_tasks.lock` (harness-internal, NEVER stage/commit)
  and one untracked HTML draft — `docs/_drafts/bg-species-data-shapes-2026-06-01.html` (the analysis
  doc for this step; keep it as reference or delete when the tables land).
- `npx tsc --noEmit` baseline = **6 errors** (pre-existing: `Button asChild` ×N + `characterShared.ts`).
  Verify against 6, not 0, after edits.
- Dev stack: worker `:8787` + Express/Vite `:3000` were up this session (image-serve route present).
  Per AGENTS.md, drive them yourself — don't ask the user. NOTE: multiple sibling worktrees run their
  own stacks (proposal-system, system-applications); `:3000`/`:8787` may be **another tree's**. Check
  `netstat` + the process's worktree path before assuming a running stack is ours, and never kill a
  sibling's processes. (This bit us once — see the prior session.)

## Locked product decisions (from the user, 2026-06-01)

1. **Naming: "Species"** (not "Race") for the user-facing table / editor / route. The Foundry export
   `type` stays **`"race"`** for dnd5e compatibility (the export folder is `species/` but every item is
   `type:"race"`). So: our table = `species`, UI says "Species", exporter still emits `type:"race"`.
2. **Ship the empty Background columns anyway.** Backgrounds' `advancement` + `startingEquipment` are
   empty in this data source (5etools-sourced), but add the columns regardless — "that may change later."

## The data — verified against `E:\DnD\Professional\Foundry Export`

Four files; the two relevant: `backgrounds/backgrounds-backgrounds-export.json` (152) and
`species/species-races-export.json` (280). Each = an envelope (`kind`, `schemaVersion`, `summary`) +
payload array; the **authoritative shape is each item's `sourceDocument.system`**. Full analysis is in
the HTML draft; the column-relevant summary:

**Backgrounds** — `system`: `description.value` (HTML), `source` {book,page,rules:"2024",…},
`identifier` (slug), `wealth` (formula string, e.g. "50"), `advancement` ({} — empty in all 152),
`startingEquipment` ([] — empty in all 152). 5etools origin (`flags.plutonium`, `cdn.5e.tools` imgs).

**Species** — `system`: `description.value`, `source`, `identifier`, `movement`
{walk,fly,swim,climb,units,hover,ignoredDifficultTerrain}, `senses`
{ranges:{darkvision,blindsight,truesight,tremorsense},units,special}, `type`
{value:"humanoid",subtype:"<species name>",custom}, `advancement` (keyed object — `Size` on 279/280,
`ScaleValue` on 10/280, e.g. Dragonborn breath). Advancement entries are the **exact dnd5e shape** our
`AdvancementManager` already handles (`{_id,type,configuration,value,level,title,flags,hint}`).

## Proposed table columns (camelCase per the roadmap decision)

> New compendium tables use **camelCase** column names from day one (roadmap 2026-05-27 decision), and
> go in the `PERSISTENT_TABLES` allowlist in `src/lib/d1.ts` (read-heavy, changes rarely).

**`backgrounds`**: `id`, `identifier`, `name`, `sourceId`, `description`, `wealth`,
`startingEquipment` (JSON), `advancements` (JSON), `tags` (JSON), `imageUrl`, timestamps.

**`species`**: `id`, `identifier`, `name`, `sourceId`, `description`, `movement` (JSON), `senses`
(JSON), `creatureType` (JSON), `advancements` (JSON), `tags` (JSON), `imageUrl`, timestamps.

## What already exists (the scaffolding to build on)

The earlier session built the **export half** anticipating this — it currently ships empties because
the `feats` table lacks the columns:
- `api/_lib/_backgroundExport.ts` — emits `system.startingEquipment` + `system.wealth`; reads
  `row.starting_equipment` / `row.wealth` (currently absent → empty). Bundle kind
  `dauligor.background-item.v1`.
- `api/_lib/_raceExport.ts` — emits `system.movement` + `system.senses` + `system.type`; reads
  `row.movement`/`row.senses`/`creature type` (currently absent → empty). Bundle `dauligor.race-item.v1`.
- `functions/api/module/[[path]].ts` — GET route arms `/api/module/backgrounds/<id>.json` (~line 375)
  + `/api/module/races/<id>.json` (~line 391); `VALID_KINDS` includes `background`/`race`.
- `src/lib/moduleExport.ts` + `api/_lib/module-export-{queue,pipeline}.ts` — `ExportEntityKind`
  includes `background`/`race`; rebake cases reuse the feat catalog-only path.
  **Drift-managed pairs apply** (AGENTS.md rule #5): `api/_lib/_requirements.ts ↔ src/lib/requirements.ts`,
  `_classExport ↔ classExport`, etc. — but `_backgroundExport`/`_raceExport` are server-only (no `src/`
  twin today).

**Editors (the swap seam):**
- `src/pages/compendium/RaceEditor.tsx` + `BackgroundEditor.tsx` are ~20-line wrappers that just render
  `<FeatsEditor scopeFeatType="race|background" />`. Their own doc-comments say: *"When a dedicated
  table lands later, this wrapper becomes the replacement point — swap FeatsEditor for a
  <thing>-specific editor and the route + sidebar entry stay untouched."* ← **that's the seam.**
- Routes in `src/App.tsx` (~line 309): `/compendium/races` + `/races/manage`, `/compendium/backgrounds`
  + `/backgrounds/manage`. RacesList/BackgroundsList list pages exist.
- Current local `feats` table has **0** rows with `feat_type IN ('race','background')` — so the new
  tables start empty; content comes from the Foundry export (if an importer is built) or hand-authoring.

## OPEN QUESTION to resolve with the user before coding

**Scope / import path** (asked, not yet answered): is this export purely the **schema reference** for
the editor side, OR do we also build an **importer** that ingests these JSON files (152 bg + 280
species) into the new tables? This decides whether the next deliverable is "tables + editors" or
"tables + editors + import script." **Confirm before starting the migration.**

## Suggested sequence (once scope is confirmed)

1. **Migration** — create `backgrounds` + `species` tables (camelCase cols above). Apply to **local
   first** (`wrangler d1 execute dauligor-db --local --file=…`); remote only with **explicit
   in-conversation go-ahead** (AGENTS.md rule #7 — a prior "go ahead" does NOT transfer). Timestamped
   filename `worker/migrations/YYYYMMDD-HHMM_*.sql`.
2. **d1 plumbing** — add both to `PERSISTENT_TABLES` (`src/lib/d1.ts`) + `D1_TABLE_MAP`
   (`src/lib/d1Tables.ts`); JSON-column auto-parse list for the JSON cols. compendium.ts normalize/
   denormalize mapping if the editors go through it.
3. **Exporters** — point `_backgroundExport`/`_raceExport` at the real columns (drop the empty
   fallbacks). Verify a bundle round-trips (`npx wrangler pages dev` for `/api/module/*`).
4. **Editors** — replace the `RaceEditor`/`BackgroundEditor` wrapper bodies with real editors against
   the new tables (the species one needs movement/senses/type/advancement UI; background needs
   description/wealth/startingEquipment/advancement). Keep routes + sidebar entries intact.
5. **(If in scope)** importer script: read the export JSON → upsert into the new tables.
6. Docs: update `docs/features/compendium-races-backgrounds.md` + the roadmap memory. Use
   `/documentation-clarity` for the doc pass.

## Sibling-branch status (context, not our action)

- **proposal-system:** Part D + guard #1 shipped; authored-block e2e (Druid+WildShape+column+group
  through the editors) is the remaining joint UI-path test — unblocked, ours to run when the user wants.
  Manifest open-request R1/R2/R3 (line 71) may be stale — verify against their branch before treating
  as open.
- **foundry-module:** delivered the bg/species data shapes (this step's unblock). Creatures/NPC table
  is still future work (NPC is an Actor, not an Item — separate, larger).
