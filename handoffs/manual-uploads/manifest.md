# Branch: `manual-uploads`

**Status:** active · **Owner:** Claude · **Started:** 2026-06-04

## What this branch is doing

Building a **manual-upload / import system** — an in-app "Mark & Build" window that takes pasted source text (from a PDF or anywhere), lets a user mark/fill fields for a compendium entity, and creates it through the **editors' exact write calls**. The PDF→fields parsing is out of scope; the value is faithful field-filling + saving for every compendium type.

Design spec: [docs/_drafts/manual-uploads-import-system-2026-06-04.html](../../docs/_drafts/manual-uploads-import-system-2026-06-04.html).

Proof of concept: **spells** (this pass).

## Core principle (fidelity)

The import core never reimplements the D1 write layer. Each type's `commit()` delegates to the same function the matching editor calls:
- spell → `upsertSpell(id, payload)` (from `src/lib/compendium.ts`)
- feat/item/feature → `upsertFeat`/`upsertItem`/`upsertFeature`
- class/subclass/options/species/background/etc. → direct `upsertDocument(collection, id, payload)` with the verbatim per-editor payload shape (+ `queueRebake` where the editor fires it).

## Primary files (exclusive)

- `src/lib/import/**` — new. Registry + resolver + per-type descriptors (`types.ts`, `registry.ts`, `spell.ts`, `index.ts`).
- `src/pages/compendium/ImportMarkWindow.tsx` — new. The Mark & Build window.
- `src/components/import/**` — new, if any extracted widgets.

## Shared files (append-only)

- `src/App.tsx` — one new route for the window.
- `src/components/Sidebar.tsx` — one new nav link.

## Reused (imported, NOT modified)

- `src/lib/compendium.ts` (`upsertSpell`, `prepareSpellPayloadForWrite`, …) — owned by `compendium-editors` / `proposal-system` as append-only; this branch only **calls** existing exports, no edits.
- `src/lib/spellImport.ts` (`SCHOOL_LABELS`), `src/lib/utils.ts` (`slugify`), `src/lib/bbcode.ts` (`bbcodeToHtml`).

## Open requests to other branches

None.

## Notes

- **Doc-framing correction (landed this branch, one-off):** AGENTS.md + `docs/platform/{auth-firebase,runtime,d1-architecture,r2-storage,security-gates}.md` + `docs/architecture/routing.md` + `docs/operations/troubleshooting.md` + `docs/features/{admin-users,spell-favorites}.md` updated to reflect **native session-token auth** (Worker HS256, `/api/auth/login`) with Firebase as a migration-window fallback — the previous "Firebase JWT" framing was stale. Not an ongoing file claim; left `docs/_archive/**` and `docs/_drafts/**` (intentionally historical/migration).
- Verified save paths for every type captured in the design spec's fidelity table.
