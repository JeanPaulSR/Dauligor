# Branch: `system-applications`

Started: 2026-05-27
Owner: Claude
Goal: Wire Phase 1.5 hash-on-upsert, complete the article-system schema revamp, then ship Phase 2 of the live-content bridge (read-only live viewer + DauligorViewer + custom enrichers + endpoints).
Status: **active** (branch created 2026-05-27 off `main`)

## Background

This branch picks up the work documented in [2026-05-27-live-content-bridge-phase1.md](2026-05-27-live-content-bridge-phase1.md) — Phase 1 foundation patches have already landed on main; this branch carries the next three phases.

Full plan + reference material:
- [docs/roadmap.md § "Live-content bridge — Phase 2+ work"](../../docs/roadmap.md)
- [docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html](../../docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html) (working spec)

## Primary files (exclusive)

Files this branch claims for non-trivial structural changes. Other branches should request edits via the shared-files protocol rather than editing directly.

**BBCode audit + fixes (current step):**
- `src/lib/bbcode.ts` — fix enumerated defects in tag parsing, rendering, and round-trip; also adds new `[ref|…]` kinds (overlap with Article system revamp below — same file, coordinated)
- `api/_lib/_bbcode.ts` — drift-managed server mirror of `bbcodeToHtml`; quote + hr fixes mirrored here. Any render-side BBCode change must land in both.
- `src/components/BBCodeRenderer.tsx` — display-side defect fixes if any are renderer-level
- `src/components/MarkdownEditor.tsx` — TipTap-extension level fixes if any are editor-level
- `src/components/MarkdownToolbar.tsx` — Visual-mode toolbar handlers (spoiler toggle + literal-marker fallback). NOTE: also listed under cross-ref authoring below (Cross-Reference button) — same file, coordinated.
- `src/index.css` — BBCode render styles under `@layer components` (`.prose .ref-link`, `.prose a`, `.prose .spoiler`, etc.). Append-only: add new `.prose …` selectors, don't reorder existing rules.
- `src/pages/dev/BBCodeTester.tsx` (new) — dev page for capturing and reproducing BBCode bugs (editor + live preview + round-trip diff + presets)

**Cross-reference authoring (current step):**
- `src/components/MarkdownToolbar.tsx` — add "Cross-Reference" button
- `src/components/CrossRefPicker.tsx` (new) — picker dialog: choose kind, search by name, click to insert

**Article system revamp:**
- `src/pages/wiki/Wiki.tsx` — routes consume identifier instead of slug
- `src/pages/wiki/LoreArticle.tsx` — viewer wired to new identifier resolution
- `src/pages/wiki/LoreEditor.tsx` — editor surfaces identifier field
- `src/lib/lore.ts` — slug/identifier helpers
- `src/lib/bbcode.ts` — `[article=…]` / `@article[…]` resolver

**Phase 1.5 hash-on-upsert:**
- `src/lib/d1.ts` — extend `upsertDocument` with content-hash compute hook (technically append-only but the hook itself is a structural change)
- `api/_lib/d1-internal.ts` — server-side mirror of the hash hook
- One-shot backfill script (new): `scripts/backfill-content-hashes.mjs`

**Phase 2 viewer + enrichers (new files):**
- `module/dauligor-pairing/scripts/dauligor-viewer.js` (new — ApplicationV2 class)
- `module/dauligor-pairing/scripts/enrichers/` (new directory — custom enricher registration for `@article`, `@condition`, `@rule`, etc.)
- `module/dauligor-pairing/templates/dauligor-viewer.hbs` (new)
- `module/dauligor-pairing/styles/dauligor-viewer.css` (new)
- `functions/api/module/[[path]].ts` — new `/articles/<slug>`, `/articles/<slug>/summary`, `/system-pages/<system>/<key>` route handlers
- `api/_lib/_articleExport.ts` (new) — serves article content with BBCode → HTML
- `api/_lib/_systemPageExport.ts` (new)

**System page article type (new files):**
- `src/pages/compendium/SystemPagesList.tsx` (new)
- `src/pages/compendium/SystemPageEditor.tsx` (new)
- `src/components/compendium/SystemPageGlossary.tsx` (new)

## Shared files (append-only)

Editing these in append-only style is fine without requesting through the protocol. Treat them like log files.

- `src/lib/compendium.ts` — likely adds `upsertArticle` / `upsertSystemPage` entries
- `src/lib/d1Tables.ts` — adds new tables to the registry
- `src/App.tsx` — adds routes for system page list/editor
- `src/components/Sidebar.tsx` — adds nav entry for system pages
- `worker/migrations/` — new timestamped migrations for article identifier/source_id + system_pages table + content_hash hook artifacts
- `docs/roadmap.md` — update entries as phases ship
- `module/dauligor-pairing/scripts/main.js` — register the new enrichers + DauligorViewer

## Open requests to other branches

None currently. Add `- [ ] (date) Request <other-branch> to <change> in <file>` entries here as they come up.

## Handoff log

- 2026-05-27 — [2026-05-27-live-content-bridge-phase1.md](2026-05-27-live-content-bridge-phase1.md) — Phase 1 status + complete pickup context for Phases 1.5 / 2 / 3 / 4 / 5

## When to retire this manifest

- Phase 1.5 hash-on-upsert is wired AND the backfill has been run on remote D1
- Article schema revamp has landed (identifier + source_id + composite UNIQUE)
- Phase 2 is shipped (DauligorViewer renders in a real Foundry world against a real article endpoint)

At that point either branch this further or merge to main and remove the row from `BRANCH_REGISTRY.md`.
