# Branch Registry

Live record of in-progress branches and the files they're touching.

**Read this before editing any shared file.** If another branch already owns it, follow the shared-files protocol in [README.md § "The shared-files protocol"](README.md#the-shared-files-protocol) instead of editing directly.

**Add your row when you start a branch.** Update it as scope evolves. Remove your row when the branch lands on main.

## Active branches

| Branch | Started | Owner | Status | Primary files (exclusive) | Shared files (append-only) | Manifest |
|---|---|---|---|---|---|---|
| `system-applications` | 2026-05-27 | Claude | active | Article system revamp (`src/pages/wiki/**`, `src/lib/lore.ts`, `src/lib/bbcode.ts`); Phase 1.5 hash-on-upsert (`src/lib/d1.ts`, `api/_lib/d1-internal.ts`); Phase 2 viewer (new files under `module/dauligor-pairing/scripts/dauligor-viewer.js`, `enrichers/`, `templates/dauligor-viewer.hbs`); new article + system-page endpoints in `functions/api/module/[[path]].ts` + new `api/_lib/_articleExport.ts` / `_systemPageExport.ts`; new system-page UI (`src/pages/compendium/SystemPage*.tsx`, `src/components/compendium/SystemPageGlossary.tsx`) | `src/lib/compendium.ts`, `src/lib/d1Tables.ts`, `src/App.tsx`, `src/components/Sidebar.tsx`, `worker/migrations/`, `docs/roadmap.md`, `module/dauligor-pairing/scripts/main.js` | [system-applications/manifest.md](system-applications/manifest.md) |
| `compendium-editors` | 2026-05-27 | Claude | active | `docs/architecture/compendium-editors/` (multi-page HTML reference); `docs/architecture/compendium-editor-patterns.md` + `docs/features/compendium-*.md` (reconciliation); **+ UI fixes (widened 2026-05-27): `src/components/compendium/**` except `SystemPageGlossary.tsx`; `src/pages/compendium/{Feats,Items,Race,Background,Facilities,Class,Subclass}Editor.tsx` + List/View siblings; `src/index.css` compendium rules** | `handoffs/BRANCH_REGISTRY.md`, `src/lib/compendium.ts`, `src/lib/d1.ts` (PERSISTENT_TABLES additions only — NOT the hash hook) | [compendium-editors/manifest.md](compendium-editors/manifest.md) |
| `proposal-system` | 2026-05-28 | Claude | active | Content-proposals subsystem: `src/lib/proposal{Accumulator,Aware,Block,Review}.{ts,tsx}`, `src/components/proposals/**`, `src/hooks/useProposal*.ts` + `use{DraftedEntityIds,EditBaseUnlocks,TombstoneBanner,CascadeDependent}.ts`, `src/pages/core/MyProposals.tsx`, `src/pages/admin/AdminProposals.tsx`, `api/_lib/{proposals,cascadeStrategies}.ts`, `functions/api/proposals/[[path]].ts`, `functions/api/admin/proposals/[[path]].ts` | proposal-mode branches inside `src/pages/compendium/*Editor.tsx` + `DevelopmentCompendiumManager.tsx` (coordinate w/ `compendium-editors`); `src/App.tsx` + `src/components/Sidebar.tsx` (`system-applications` owns); `worker/migrations/` | [proposal-system/manifest.md](proposal-system/manifest.md) |

## Status legend

- **planned** — branch reserved in the registry but code work hasn't started yet; protects scope so concurrent branches route around the planned files
- **active** — branch is currently being worked on
- **paused** — branch is on hold; shared files OK for others to claim
- **ready-to-merge** — branch is feature-complete, awaiting review

## "Shared files (append-only)" examples

Some files are routinely touched by multiple branches at once. As long as edits stay additive (new entries in a registry, new branches in a switch, new cases in a normalizer), parallel changes merge mechanically. These are flagged in a branch's manifest under "Shared files" rather than "Primary files":

- `src/lib/compendium.ts` — `normalizeCompendiumData` / `denormalizeCompendiumData` mapping tables, forbidden list, `upsertX` helpers
- `src/lib/d1.ts` — `jsonFields` auto-parse list inside `queryD1`
- `src/lib/d1Tables.ts` — table-name registry
- `src/App.tsx` — route definitions
- `src/components/Sidebar.tsx` — nav links
- `worker/migrations/` — new migration files (use timestamp-based filenames to avoid collision)

A branch CAN claim one of these as exclusive if it's doing a structural refactor of that file. In that case, mark it under "Primary files" in your manifest and notify other active branches.

## Recently merged (last 7 days, FYI only)

Removed entries land here briefly so other agents can see what just changed before doing a `git pull` rebase. Move to git history after a week.

| Branch | Merged | Touched files |
|---|---|---|
| `claude/class-slug-routes` | 2026-05-27 → `a3ebb4f` | `src/lib/useClassRouteId.ts` (new), `src/App.tsx`, `src/pages/compendium/{ClassEditor,ClassList,ClassView,SpellList,SubclassEditor}.tsx`, `src/pages/sources/SourceDetail.tsx` |
| `claude/phase1-foundation` | 2026-05-27 → `2b7dea4` | `worker/migrations/20260527-{1400,1410,1420}_*.sql` (new), `module/dauligor-pairing/scripts/foundry-id.js` (new), `docs/roadmap.md` |
