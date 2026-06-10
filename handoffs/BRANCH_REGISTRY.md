# Branch Registry

Live record of in-progress branches and the files they're touching.

**Read this before editing any shared file.** If another branch already owns it, follow the shared-files protocol in [README.md § "The shared-files protocol"](README.md#the-shared-files-protocol) instead of editing directly.

**Add your row when you start a branch.** Update it as scope evolves. Remove your row when the branch lands on main.

## Dev-server port allocation

Each worktree must run on its **own** ports so launching one branch's dev server doesn't kill another's. **Do not run `scripts/dev-sysapp.mjs` from any worktree other than `settings-pages`** — its hardcoded default is `3001 / 8788 / 9230`, so running it elsewhere kills whoever holds 3001.

| Branch | Launcher | App / Worker / Debug |
|---|---|---|
| `settings-pages` | `dev-sysapp.mjs` (default ports) | 3001 / 8788 / 9230 |
| `compendium-editors` | `npm run dev:nowatch` + manual `wrangler dev --port 8787` | 3000 / 8787 / — |
| `proposal-system` | `dev-proposal.mjs` | 3002 / — / — |
| `manual-uploads` | `dev-manual-uploads.mjs` | 3003 / — / — |
| `character-creator` | `dev-character-creator.mjs` | 3005 / — / — |
| `monster-browser` | `dev-monster-browser.mjs` | 3006 / — / — |
| `foundry-module` | `dev-foundry-module.mjs` (copy of dev-sysapp) | 3008 / 8795 / 9236 |
| `relaxed-wing` | `dev-relaxed-wing.mjs` (copy of dev-sysapp) | 3010 / 8797 / 9238 |
| `crafting-commerce` | `dev-crafting-commerce.mjs` (copy of dev-sysapp) | 3011 / 8798 / 9239 |

**Two rules so collisions don't recur:**
1. In a worktree, run **no-watch** (`tsx server.ts`, not `tsx watch`) — the `node_modules` junction makes watch restart-loop.
2. **Never blanket-kill** node/workerd (no `taskkill /IM node.exe`). Scope kills to your own ports or your launcher's process tree only.

`foundry-module` / `relaxed-wing` have no launcher yet: copy `dev-sysapp.mjs` to their `dev-<branch>.mjs` and set the ports above. `dev-sysapp.mjs` therefore **stays in-tree as the template** — branches with their own launcher just must not *run* it.

## Active branches

| Branch | Started | Owner | Status | Primary files (exclusive) | Shared files (append-only) | Manifest |
|---|---|---|---|---|---|---|
| `dauligor-applications` | 2026-05-31 | Claude | active | Article system revamp (`src/pages/wiki/**`, `src/lib/lore.ts`, `src/lib/bbcode.ts`); Phase 1.5 hash-on-upsert (`src/lib/d1.ts`, `api/_lib/d1-internal.ts`); Phase 2 viewer (new files under `module/dauligor-pairing/scripts/dauligor-viewer.js`, `enrichers/`, `templates/dauligor-viewer.hbs`); new article + system-page endpoints in `functions/api/module/[[path]].ts` + new `api/_lib/_articleExport.ts` / `_systemPageExport.ts`; new system-page UI (`src/pages/compendium/SystemPage*.tsx`, `src/components/compendium/SystemPageGlossary.tsx`) | `src/lib/compendium.ts`, `src/lib/d1Tables.ts`, `src/App.tsx`, `src/components/Sidebar.tsx`, `worker/migrations/`, `docs/roadmap.md`, `module/dauligor-pairing/scripts/main.js` | [dauligor-applications/manifest.md](dauligor-applications/manifest.md) |
| `compendium-editors` | 2026-05-27 | Claude | active | `docs/architecture/compendium-editors/` (multi-page HTML reference); `docs/architecture/compendium-editor-patterns.md` + `docs/features/compendium-*.md` (reconciliation); **+ UI fixes (widened 2026-05-27): `src/components/compendium/**` except `SystemPageGlossary.tsx`; `src/pages/compendium/{Feats,Items,Race,Background,Facilities,Class,Subclass}Editor.tsx` + List/View siblings; `src/index.css` compendium rules** | `handoffs/BRANCH_REGISTRY.md`, `src/lib/compendium.ts`, `src/lib/d1.ts` (PERSISTENT_TABLES additions only — NOT the hash hook) | [compendium-editors/manifest.md](compendium-editors/manifest.md) |
| `proposal-system` | 2026-05-28 | Claude | active | Content-proposals subsystem: `src/lib/proposal{Accumulator,Aware,Block,Review}.{ts,tsx}`, `src/components/proposals/**`, `src/hooks/useProposal*.ts` + `use{DraftedEntityIds,EditBaseUnlocks,TombstoneBanner,CascadeDependent}.ts`, `src/pages/core/MyProposals.tsx`, `src/pages/admin/AdminProposals.tsx`, `api/_lib/{proposals,cascadeStrategies}.ts`, `functions/api/proposals/[[path]].ts`, `functions/api/admin/proposals/[[path]].ts` | proposal-mode branches inside `src/pages/compendium/*Editor.tsx` + `DevelopmentCompendiumManager.tsx` (coordinate w/ `compendium-editors`); `src/App.tsx` + `src/components/Sidebar.tsx` (`system-applications` owns); `worker/migrations/` | [proposal-system/manifest.md](proposal-system/manifest.md) |
| `foundry-module` | 2026-05-30 | Claude | active | Foundry-side package `module/dauligor-pairing/**` — all `scripts/**`, `templates/**`, `styles/**`, `docs/**`, `notes-for-app-team/**`, `data/**`, `module.json`, `README.md`, `TODO.md`. Phase 2 viewer files (`scripts/dauligor-viewer.js`, `scripts/enrichers/**`, `templates/dauligor-viewer.hbs`, `styles/dauligor-viewer.css`) are **jointly owned** with `system-applications` (owner-granted 2026-05-30) | `module/dauligor-pairing/scripts/main.js` (append-only, shared w/ `system-applications`); `functions/api/module/[[path]].ts` (app-side router, module only `fetch()`es it) | [foundry-module/manifest.md](foundry-module/manifest.md) |
| `crafting-commerce` | 2026-06-12 | Claude | planned | Crafting & Commerce subsystem (Phase A already on `main`; this branch owns it going forward + builds Phase B–D). Exclusive: `src/pages/compendium/{CraftingMaterials,Enchantments,Recipes,Shop}{Editor,List}.tsx` + `CraftingMaterialsList.tsx`; `src/components/compendium/{CraftingMaterialDetail,EnchantmentDetail,RecipeDetail,ShopDetail}Panel.tsx`; future `characters.currency` wallet + shop transactions + live crafting execution. **`compendium-editors` cedes these** (carved out of its broad `src/components/compendium/**` + `*Editor.tsx` claim). | `src/App.tsx`, `src/components/Sidebar.tsx`, `src/lib/d1Tables.ts`, `src/lib/d1.ts`, `api/_lib/d1-fetchers-server.ts`, `worker/migrations/`, `src/pages/compendium/ItemList.tsx` (`magicalOnly`), `src/pages/admin/AdminProficiencies.tsx` (disciplines tab) | [crafting-commerce/manifest.md](crafting-commerce/manifest.md) |
| `manual-uploads` | 2026-06-04 | Claude | active | Manual-upload / import system: new `src/lib/import/**` (registry + resolver + per-type descriptors) and new "Mark & Build" window `src/pages/compendium/ImportMarkWindow.tsx` (+ any `src/components/import/**`). Reuses the editors' real write helpers (`upsertSpell` etc.) — does **not** modify `src/lib/compendium.ts`. | `src/App.tsx`, `src/components/Sidebar.tsx` (append-only: one route + one nav link); doc-framing correction (native session tokens vs Firebase) already landed across `AGENTS.md` + several `docs/**` — one-off, not an ongoing claim | [manual-uploads/manifest.md](manual-uploads/manifest.md) |
| `monster-browser` | 2026-06-09 | Claude | planned | Public monster browser (greenfield): new `src/pages/compendium/MonsterList.tsx`, new `src/components/compendium/MonsterDetailPanel.tsx` (+ optional `MonsterArtPreview`), new `monsters` D1 table via new `worker/migrations/<ts>_create_monsters.sql`, new `docs/database/structure/monsters.md` | `src/App.tsx` (one public `/compendium/monsters` route), `src/components/Sidebar.tsx` (one nav link), `src/lib/d1.ts` (jsonFields — monster JSON cols), `src/lib/d1Tables.ts` (add `monsters`), `worker/migrations/` (timestamped), `docs/platform/d1-architecture.md` (register monster JSON cols), `handoffs/BRANCH_REGISTRY.md` | [monster-browser/manifest.md](monster-browser/manifest.md) |

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
| `compendium-editors` → Backgrounds | 2026-06-03 → `fd46b4e` | Backgrounds proficiencies/features/prerequisites + feat-style view; shared `ProficienciesEditor` + `src/lib/proficiencySelection.ts` (ClassEditor migrated onto it, export byte-identical); `src/lib/foundryHtmlCleanup.ts` `slug{Display}` mop-up; `functions/api/module/[[path]].ts` gained the `background-features` arm **and carried foundry-module's `spellcasting/multiclass-chart` arm to main** (resolves the 2026-06-02 cross-branch handoff — that endpoint is now in prod); 8 migrations (`20260601-1200`…`1500`, `20260602-1200`…`1500`) applied to remote D1. Plus the class-editor dirty-check fix. _Branch stays **active** — the broad compendium-editor scope continues._ |
| `claude/class-slug-routes` | 2026-05-27 → `a3ebb4f` | `src/lib/useClassRouteId.ts` (new), `src/App.tsx`, `src/pages/compendium/{ClassEditor,ClassList,ClassView,SpellList,SubclassEditor}.tsx`, `src/pages/sources/SourceDetail.tsx` |
| `claude/phase1-foundation` | 2026-05-27 → `2b7dea4` | `worker/migrations/20260527-{1400,1410,1420}_*.sql` (new), `module/dauligor-pairing/scripts/foundry-id.js` (new), `docs/roadmap.md` |
