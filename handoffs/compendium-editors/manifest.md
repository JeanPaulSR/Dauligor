# Branch: `compendium-editors`

Started: 2026-05-27
Owner: Claude
Goal: Document the compendium-editor process end-to-end (DB shape + table relations, shared component usage, server-side endpoint composition) and ship a navigable HTML reference under `docs/architecture/compendium-editors/` that the user can drive understanding-verification dialogue against. **As of 2026-05-27 the scope widened**: section 04 is a collaborative component walkthrough where UI-side issues get flagged AND fixed inline (user approved widening this branch to carry the fixes), so the branch now also touches the shared compendium components + Pattern E editor pages under `src/`.
Status: **active**

## Background

User-driven documentation pass. The existing [docs/architecture/compendium-editor-patterns.md](../../docs/architecture/compendium-editor-patterns.md) is mainly a "which pattern to use when adding a new editor" decision tree; this branch produces a "how the existing editors actually work right now" reference so the user can spot misunderstandings and correct course. Three areas of focus:

1. **Data flow & table relations.** How a save round-trips form state → `normalizeCompendiumData` → `upsertDocument` / `batchQueryD1` → D1, plus how FKs and JSON columns relate entities.
2. **Shared component usage.** Per-component (AdvancementManager, ActivityEditor, ActiveEffectEditor, RequirementsEditor, TagPicker, FilterBar, EntityListSection, EntityEditModal, DetailPanels, the two shell components) — what it does, who uses it, what data it expects.
3. **Endpoints.** Pages Functions in `functions/api/**` + the drift-managed `api/_lib/_*Export.ts` libraries that compose payloads. Foundry-module-side consumption is **out of scope** (another agent owns that).

Permission to update documentation generally was granted.

## Primary files (exclusive)

Files this branch claims for non-trivial structural changes. Other branches should request edits via the shared-files protocol.

- `docs/architecture/compendium-editors/` (new directory — multi-page HTML reference: `index.html` + per-section pages)
- `docs/architecture/compendium-editor-patterns.md` — reconciliation pass: drift between this doc and the actual editor files (e.g. the doc says FeatsEditor uses Pattern A / DevelopmentCompendiumManager, but FeatsEditor imports `upsertFeat`/`deleteFeat`/`fetchFeat` directly = Pattern B)
- `docs/features/compendium-classes.md` — verify the save-flow narrative matches the code
- `docs/features/compendium-feats-items.md` — same
- `docs/features/compendium-items.md` — same
- `docs/features/compendium-spells.md` / `compendium-spells-editor.md` / `compendium-spells-browser.md` — same
- `docs/features/compendium-facilities.md` — same
- `docs/features/compendium-races-backgrounds.md` — same
- `docs/features/compendium-options.md` — same (unique option groups + tags)
- `docs/features/compendium-scaling.md` — same

## Code files (UI fixes — section 04 walkthrough)

Added 2026-05-27 when the branch scope widened to carry UI fixes found during the component walkthrough. This branch now owns these for the duration of the walkthrough. None of these are claimed by `system-applications` (cross-checked against its manifest). The `SystemPage*` / `SystemPageGlossary` files ARE its and stay out (see below).

- `src/components/compendium/**` — the shared compendium widgets (CompendiumEditorShell, CompendiumBrowserShell, AdvancementManager, ActivityEditor, ActiveEffectEditor, RequirementsEditor, TagPicker, FilterBar, SectionFilterPanel, SpellFilterShell, ScalingColumnsPanel, the detail panels, the mechanic field sets, the workbenches, etc.) **EXCEPT** `SystemPageGlossary.tsx` (system-applications)
- `src/pages/compendium/{FeatsEditor,ItemsEditor,RaceEditor,BackgroundEditor,FacilitiesEditor}.tsx` and their List/View siblings — the Pattern E editor pages the walkthrough touches first (roadmap step 1) **EXCEPT** `SystemPage*.tsx` (system-applications)
- `src/pages/compendium/{ClassEditor,SubclassEditor}.tsx` — touched in roadmap step 2 (bespoke cleanup); claim now to avoid surprise collisions
- `src/index.css` — the `spell-list-fullscreen` body class + compendium layout rules (append-only / scoped edits)

## Shared files (append-only)

Editing these in append-only style is fine without requesting through the protocol.

- `handoffs/BRANCH_REGISTRY.md` — add this branch's row
- `docs/database/structure/*.md` — touch only if a doc page contradicts the actual SQL (and only the contradicting part)
- `src/lib/compendium.ts` — `normalize`/`denormalize` mapping tables + per-entity helpers (append-only; coordinate with system-applications which also lists it append-only)
- `src/lib/d1.ts` — `PERSISTENT_TABLES` additions for new tables ONLY (append-only). **Do NOT** make structural changes to `queryD1` / the cache / `upsertDocument` — system-applications owns the hash-on-upsert hook there.

## Files explicitly NOT touched

The branch now carries UI fixes (see "Code files" above), so the blanket `src/**` exclusion is lifted. These specific files remain off-limits because `system-applications` owns them:

- `src/lib/d1.ts` structural changes, `api/_lib/d1-internal.ts` — owned by `system-applications` (Phase 1.5 hash-on-upsert hook). `PERSISTENT_TABLES` append-only additions in `d1.ts` are OK (see Shared files).
- `src/lib/lore.ts`, `src/lib/bbcode.ts` — owned by `system-applications` (article system revamp)
- `src/pages/wiki/**` — owned by `system-applications`
- New `module/dauligor-pairing/**` viewer/enricher/template/style files — owned by `system-applications`
- New `api/_lib/_articleExport.ts` / `_systemPageExport.ts` — owned by `system-applications`
- `functions/api/module/[[path]].ts` structural changes — owned by `system-applications` (this branch may *read* and *document* the existing handlers, but does not modify the file)
- New `src/pages/compendium/SystemPage*.tsx` / `src/components/compendium/SystemPageGlossary.tsx` — owned by `system-applications`
- `worker/migrations/**` — append-only with timestamped filenames if a UI fix genuinely needs a schema change; coordinate first

## A note on the documentation-vs-code split

The HTML reference under `docs/architecture/compendium-editors/` stays the source of truth for *what was found*. Code fixes made from this branch get a one-line entry in the relevant component sub-page's UI-issues list (status → fixed + commit ref) so the doc and the code don't drift. Larger fixes that shouldn't ride this branch get logged as `open`/`deferred` with enough detail to action on a dedicated branch later.

## Open requests to other branches

- [ ] `(2026-05-28)` Request `proposal-system` to decide cross-reference **scope** before I build Parts B + C: (1) features-as-proposable — gates "propose a class" (a proposed class is currently a feature-less shell because `feature` isn't proposable and `handleSaveFeature` 403s for content-creators); (2) the guard-#1 reference-walk gaps (advancement spell/feat-grant refs, the whole `requirements_tree`, tag refs, `item.container_id`); (3) `scaling_column` `parent_type` (class/subclass only vs all six owners). Full request: [2026-05-28-open-request-to-proposal-system.md](2026-05-28-open-request-to-proposal-system.md). Evidence: [docs/architecture/compendium-editors/proposal-cross-reference-audit.html](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html). **Holding B/C implementation until they respond.**

## Coordination notes

- The `system-applications` branch is **active**, not "planned" — its own manifest (commit `26f3d31` on that branch) marks it active with owner Claude. The registry on `main` is stale on that row; this branch updates it. See task #3 (verified) for details.
- The `pending-tasks-2026-05-27.html` precedent on `system-applications` (`docs/_drafts/pending-tasks-2026-05-27.html`) is the style reference for the new HTML reference set.

## Handoff log

- 2026-05-27 — branch created; manifest + registry row landed. Survey of editors / components / endpoints starting.

## When to retire this manifest

- `docs/architecture/compendium-editors/index.html` is structured with all six major sections (Survey / Data Flow / Tables / Components / Endpoints / per-editor walkthroughs) and the user has acknowledged the survey as a true reflection of the current state
- `docs/architecture/compendium-editor-patterns.md` has been reconciled against the actual editor code (drift items resolved)
- Each `docs/features/compendium-*.md` has been spot-checked against the corresponding editor source and corrected where it has drifted
