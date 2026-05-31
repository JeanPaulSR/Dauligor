# Handoff — Reference Enhancements + Class Preview Pane (2026-05-29)

Pickup context for branch `system-applications`, written before a compaction. Builds on
[2026-05-28-reference-authoring.md](2026-05-28-reference-authoring.md) (archival — do NOT delete).

## Update — 2026-05-29 (pane integration shipped)

The in-flight item below is **resolved**. `ClassPreviewPane` is integrated, browser-verified by the
user, and committed. The large uncommitted set is now committed in dependency order:

- `ffacedd` feat(compendium): subclass preview field + local migration
- `57607d8` feat(references): prereq resolution, option-group drill-down, class card data
- `a611b2d` feat(compendium): class preview pane + class-ref click-to-pane overlay

How it landed: `RefResolved` gained a `docId` (the real primary key — distinct from the semantic
`id`/slug) so a `@class[…]` click can open the self-fetching pane via `fetchDocument('classes', pk)`.
ClassList now consumes `<ClassPreviewPane>` (passing its already-loaded foundation so it doesn't
re-fetch); the ~660-line inline dialog + duplicate data-loading effect were removed — which also
fixed a latent missing-import for `calculateEffectiveCastingLevel`. The class-ref overlay is
read-only (**View Page → class view; no Edit**, per the user). `tsc` clean apart from the 7
pre-existing `asChild`/`characterShared` errors. The subclass `preview` migration is still
**LOCAL-only** — remote needs an explicit per-migration go-ahead. **Not pushed.**

Still open: Foundry inline-roll formulas in the reader (task #7); subclass image-led hover treatment
(deferred follow-up).

The snapshot below is the pre-compaction state, kept for history.

---

## TL;DR

The reference system (P1–P4 + extras) is **built and working** on the branch but **uncommitted**.
We were mid-way through the **class preview-pane** feature when paused for compaction. A big
`ClassPreviewPane.tsx` (1070 lines) **already exists untracked — it was created OUTSIDE this
session (by the user), I did NOT create or verify it.** It is **not yet integrated** (ClassList
still renders its own inline preview `<Dialog>`, and the class-ref hover click still navigates to
the full class view). **Do not clobber that file** — read it and coordinate with the user.

## Branch / git state

- Branch `system-applications`, ahead of `origin/main`. Last commit: `5c888a7`. **Not pushed.**
- **Committed this session** (`ae49935`): hover card 4a/4b/4c + autocomplete no-match fix + scroll/portal +
  ref-link round-trip + condition-route deferral. Plus `c3fd25a` (branch dev server) + `5c888a7` (dev-ports doc).
- **Uncommitted — modified** (all MY changes, typecheck-clean, data-verified):
  - `src/lib/references.ts` — prereq resolution rework (short→composite→free line / free→composite→short hover +
    skill-name lookup); `option-group` reference kind (derive slug from name, no column) + drill-down
    `searchOptionGroupItems` + composite `group:item` resolve; subclass summaryExpr → preview; class `imageExpr`
    + `sourceExpr` (image-led card data).
  - `src/lib/bbcode.ts` — `RefKind` += `'option-group'`.
  - `src/components/ReferenceAutocomplete.tsx` — option-group **drill-down** (pick group → list its options +
    "whole group" entry; typed filter captured into the dropdown; Esc backs out).
  - `src/components/reference/ReferenceHoverCard.tsx` — class refs render `ClassPreviewCard` (image+name+source+preview),
    click → full class view via route; (image-banner that briefly lived in HoverCardView was removed).
  - `src/pages/compendium/ClassList.tsx` — rewired its grid to use the new `ClassPreviewCard`. **NOTE: also
    modified by the user/linter (per a system reminder) — intentional, don't revert.** Still contains the inline
    preview `<Dialog open={!!selectedClass}>` at ~line 922 (NOT yet using ClassPreviewPane).
  - `src/components/reference/HoverCardView.tsx` — (already committed in ae49935? no — re-check; it carries
    prereqFull + the data-hc-prereq wiring. If `git status` shows it modified, it's part of this uncommitted set.)
  - `src/pages/compendium/SubclassEditor.tsx` — added a "Subclass Preview" field (state/load/save/UI); relabeled
    the old "Description (Short Preview)" → "Description".
- **Uncommitted — untracked (MINE, confirmed):**
  - `src/components/compendium/ClassPreviewCard.tsx` — the class GRID card extracted into a reusable component
    (image + gold-outlined title + source + preview + optional admin delete). Used by ClassList grid + the class hover.
  - `worker/migrations/20260529-1200_subclass_preview.sql` — `ALTER TABLE subclasses ADD COLUMN preview TEXT;`
    **Applied to LOCAL D1 only. Remote D1 NOT applied — needs explicit per-migration go-ahead (AGENTS.md #7).**
- **Uncommitted — untracked (NOT mine — leave / coordinate):**
  - `src/components/compendium/ClassPreviewPane.tsx` (1070 lines) — **user-created, unverified by me, not integrated.**
    Imports look right (fetchCollection/fetchDocument, calculateEffectiveCastingLevel/getSpellSlotsForLevel,
    FeaturesView, BBCodeRenderer, Dialog, ClassImageStyle…). **Read it first** to learn its prop signature before
    integrating.
  - Pre-existing untracked (leave alone): `cleanup-branches.bat`, `docs/_drafts/feat-hover-card-concepts.html`,
    `docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html`, `docs/_drafts/reference-system-spec.html`
    (the reference spec/status — local draft, kept untracked per convention), `docs/handoff-foundry-alignment-2026-05-25.md`.

## What's the user's plan for the class pane

User explicitly chose the **full** extraction: clicking a `@class[…]` ref should **bring up the preview pane as an
in-place overlay** (NOT navigate to the class list page). The pane = ClassList's full preview Dialog (image header,
level-progression table, spellcasting, features, proficiencies, multiclassing, tags) + a ~147-line data-fetching
effect + ~12 foundation lookups (`allTags/allAttributes/allSkills/allTools/allArmorCategories/allWeaponCategories/
allToolCategories/allArmor/allWeapons/sources/spellcastingTypes/masterMulticlassChart`). I was about to delegate the
extraction to a sub-agent when the user paused me — **because they had already created `ClassPreviewPane.tsx`
themselves.** So the remaining work is likely: (1) finish/verify `ClassPreviewPane`, (2) rewire ClassList to use it
(replace the inline Dialog at ~line 922), (3) open it as an overlay from the class-ref click in `ReferenceHoverCard`
(its View Page button → the full class view). **Coordinate with the user — they may be driving the pane file.**

## Reference system — current behavior (shipped this session)

Kinds (in `references.ts` KIND_CONFIG / `bbcode.ts` RefKind):
`spell, class, subclass, feat, item, condition (=&), article, option-group`.
- **Autocomplete** (`ReferenceAutocomplete.tsx`): `@`=entity family, `&`=rule(condition). Batched per-kind search
  (D1 caps a compound SELECT at 5 terms — see [[d1-compound-select-limit]] memory). Option groups **drill down**:
  pick a group → its options (`@option-group[metamagic:twinned-spell]{Twinned Spell}`) + a "whole group" entry.
- **Hover card** (`ReferenceHoverCard.tsx` controller + `HoverCardView.tsx` presentational): 4a ephemeral, 4b
  pin-to-pop-out (drag, session-persist, "Go to"), 4c nested stack (child never closes parent; delayed reap reads
  live `:hover`). **Class refs** render `ClassPreviewCard` instead of the generic card; click currently → full
  class view (route) — TO CHANGE to open the pane overlay.
- **Prereq** (feats): LINE order short→composite→free; HOVER popup free→composite→short; composite = formatted
  requirement tree via `resolveDetailPrereq` + lazy skill-name lookup (`ath`→Athletics). Hover popup shows on hover
  (not gated on truncation). Data facts: only `athlete` has a requirement tree; 59/130 feats use free-text
  `requirements`; 0 have `requirements_short_text`.
- **`&condition`** + `subclass` + `option-group` have no route → render non-clickable (`ref-dangling`) but still
  hover-resolve. `&condition` deliberately does NOT link to `/admin/statuses` (awaits the system-page article type).
- **Round-trip**: `htmlToBbcode` rebuilds `.ref-link` anchors → `@/&kind[id]{display}` (was corrupting to `[url]`).
- **option-group / unique_option_items**: keyed by `slugify(name)` (no stored identifier — names unique; matched in
  JS over the small tables). Composite item id `group-slug:item-slug`.

## Conventions / gotchas (carried)

- **Dev stack runs on branch ports**: app **:3001**, worker **:8788**, inspector :9230, via
  `node scripts/dev-sysapp.mjs` (coexists with other agents on 3000/8787). server.ts `PORT` is env-driven.
  Currently UP (app 200, worker 401). Local D1 is the main checkout's `worker/.wrangler/` (isolated from worktrees).
- **Query local D1 directly** (works while wrangler dev runs): worker HTTP `POST localhost:8788/query` with
  `Authorization: Bearer q9nHN9H3Ny2ilWXWFlViQD5LBI63sc1KirhrwTyc` (from worker/.dev.vars), or
  `cd worker && npx wrangler d1 execute dauligor-db --local --command "…"`.
- **Verify pattern**: throwaway `scratch/_*.mts` importing the real lib (pure fns like resolveReference/slugify) run
  via `npx tsx`, then `rm`. Used all session. (resolveReference/searchReferenceFamily need the browser fetch/auth, so
  test their SQL against :8788 directly + the pure helpers via tsx.)
- **Typecheck**: `npx tsc --noEmit` — pre-existing unrelated errors exist (`asChild` on Button in
  CompendiumBrowserShell/CampaignEditor/SpellList/LoreEditor + one in characterShared.ts). Filter to your files.
- **Drift pairs**: `src/lib/bbcode.ts` ↔ `api/_lib/_bbcode.ts` — reference rendering INTENTIONALLY diverges
  (server leaves refs as text for Foundry enrichers; `_bbcode.ts` has no `htmlToBbcode`). Don't mirror ref changes.
- **AGENTS.md**: no `INSERT OR REPLACE`; migrations local-first (remote only with explicit per-migration go-ahead);
  no push to origin without an explicit green-light; `queryD1` JSON-column passthrough.
- **react-markdown** is used for the class card/pane preview text (not BBCodeRenderer) — preserve when extracting.

## Pending / next (priority order, per user)

1. **Class preview pane** (IN FLIGHT): integrate `ClassPreviewPane.tsx` — rewire ClassList's inline Dialog to use
   it; open it as an overlay from the `@class[…]` hover-card click (replace the navigate). Pane's "View Page" → full
   class view. **Then "fix any issues" → COMMIT → then subclasses.** (User said commit before starting subclass.)
2. **Subclass** image-led hover treatment (same as classes) — deferred follow-up.
3. **Foundry inline-roll formulas** in the reader — task #7, still pending: `[[/r …]]`/`[[/damage …]]` → readable
   chips in `bbcode.ts` reader ONLY (NOT mirrored to `_bbcode.ts`). Add `.inline-roll` to index.css.
4. **option-group ITEMS** are already searchable (drill-down shipped). The class-ref **click→pane** is the active gap.
5. Deferred bigger arc: live-content bridge (Phase 1.5 hash-on-upsert → article unification → Foundry viewer).

## Commit guidance

The user wanted to **commit after the class card, before subclasses**. There's a large confirmed-working uncommitted
set (P-fixes already committed in ae49935; the NEW uncommitted = prereq rework, option-group groups+items, subclass
preview + migration, ClassPreviewCard + ClassList grid rewire, class hover card). Suggested grouping when greenlit:
(a) references/autocomplete/bbcode enhancements (prereq + option-group + round-trip already in ae49935? re-check),
(b) subclass preview (+ the local migration), (c) ClassPreviewCard extraction + class hover. **`ClassPreviewPane.tsx`
+ its integration is a separate commit once it's working.** Do NOT push. Migration stays LOCAL until user oks remote.

## How to resume

1. `git branch --show-current` → `system-applications`. `git status` to re-confirm the uncommitted set above.
2. Ensure dev stack up: `curl localhost:3001` (200) + `curl localhost:8788` (401). If down: `node scripts/dev-sysapp.mjs`.
3. **READ `src/components/compendium/ClassPreviewPane.tsx`** (user-created, 1070 lines) — learn its prop signature /
   whether it self-fetches. **Ask the user** whether they finished it / how they want it integrated before editing it.
4. Then: rewire ClassList (replace inline Dialog ~line 922 with `<ClassPreviewPane>`) + open the pane from the
   `@class[…]` click in `ReferenceHoverCard.tsx` (the class branch currently renders `ClassPreviewCard` with
   `onClick → navigate(route)`; change to open the pane overlay; keep "View Page" → full view).
5. Verify (tsc clean for touched files; the pane fetches by class id — test the queries against :8788; user
   browser-tests BOTH ClassList preview AND the new overlay). Then commit per guidance, then subclasses.
6. Memory: `project_system_applications_architecture.md` has the phase status (update as this lands). New memory
   this session: `project_d1_compound_select_limit.md`.
