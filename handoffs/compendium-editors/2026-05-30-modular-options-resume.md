# Handoff — `compendium-editors`: modular-options browser shipped; next is the Option **Editor** review

> **Date:** 2026-05-30 · **Branch:** `compendium-editors` · **Worktree:**
> `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d`
> **Read first**, then the prior resume [2026-05-29-rebase-perf-editor-cleanup-resume.md](2026-05-29-rebase-perf-editor-cleanup-resume.md).

## TL;DR — where we are

This session: shipped Foundry **background+race export** (Item-family clones), answered proposal-system's
**guard-#1 pool-fields** question (they implemented it — `d3c6585` on main), and rebuilt the **Unique
Option Groups** browse UI as a **3-pane browser** (groups | options | detail). All committed on
`compendium-editors`. **The immediate next task: review + improve the comprehensive Unique Option
*Editor*** (`UniqueOptionGroupEditor.tsx`) — the user said "we'll go over the actual unique option editor"
next, and wanted a fresh context for it.

## Git state (read with `git -C "<worktree>"` — Bash CWD resets each call)

- **HEAD = `83fb48f`** `feat(compendium): 3-pane modular-options browser`.
- **origin/main = `2ee76ee`**, **HEAD is 1 ahead / 7 behind**. The 7 behind are campaign-home +
  proposal-system commits — **none touch unique-option / requirements / references / compendium.ts**, so
  the eventual merge is clean for the editor work. Don't merge unless asked; if you do, it's low-risk.
- **Working tree clean** except `.claude/scheduled_tasks.lock` (harness-internal, never commit/stage it).
- **This session's commits NOT pushed** (local on `compendium-editors`). User pushes when ready, or
  bundle with the next batch. Earlier-session work (bg/race export `598162c`, pool answer `fa9a649`,
  deep-dive `c062374`, the merge `a96e6bd`) is also local-only on this branch beyond what reached main.

## What shipped this session (commit-by-commit, all on `compendium-editors`)

- `598162c` **bg/race Foundry export** — `_featExport.ts` refactored to a reusable
  `buildFeatLikeItem(rowId, fetchers, {foundryType, entityKind})`; new `api/_lib/_backgroundExport.ts`
  (`dauligor.background-item.v1`, + startingEquipment/wealth) + `_raceExport.ts`
  (`dauligor.race-item.v1`, + movement/senses/type). Wired seams: `ExportEntityKind` (client
  `moduleExport.ts` + server `module-export-queue.ts`), `VALID_KINDS` + GET route arms
  (`/api/module/backgrounds|races/<id>.json`) in `functions/api/module/[[path]].ts`, rebake dispatcher
  cases reuse the feat catalog-only path, `FeatsEditor` save fires `rebakeNow(scopeFeatType ?? 'feat', id)`.
  **Known gap (intentional):** the `feats` table has no bg/race-specific columns yet, so those export
  fields ship as schema-clean empties until dedicated tables land — advancements/description/source/tags
  are real. Creature/NPC export DEFERRED (it's an Actor, not an Item — needs a new `creatures` table).
- `c062374` **Foundry deep-dive doc** `docs/_drafts/foundry-backgrounds-races-creatures-deep-dive.html`
  (bg/race = Item; creature = NPC Actor; verified vs dnd5e master).
- `fa9a649` **pool-fields answer to proposal-system** — yes, guard #1 must walk
  `advancements[].configuration.{pool,optionalPool,excludedOptionIds}` (they carry block-draft ids).
  **They shipped it** (`d3c6585` on main).
- `3bcbf7b` **foundry-module handoff** — created `handoffs/foundry-module/` (manifest + bg/race export
  requests doc) soliciting their importer + creature-bundle-shape preferences. **We are WAITING on the
  foundry-module branch to send back the data shapes** before doing the bg/race *editors* / creature table.
- `83fb48f` **3-pane modular-options browser** (the headline UI work — see next section).

## The 3-pane browser (just shipped) — `src/pages/compendium/UniqueOptionGroupBrowser.tsx`

Browse-only surface that replaced the ugly card-grid list (`UniqueOptionGroupList`) AND the read view
(`UniqueOptionGroupView`). Mirrors `CompendiumBrowserShell`/`SpellList` idioms (fullscreen body lock,
`paneHeight` tracking, gold Cards, selected/hover rows, `<lg` single-pane drilldown w/ back-nav = mobile).

- **Panes:** groups (25%) | options-in-selected-group (25%) | detail (50%) — `lg:basis-1/4 ·1/4 ·1/2`,
  `lg:min-w-0`, wrapper `max-w-[1400px]` centered so it doesn't sprawl on ultrawide.
- **Options** render `icon_url` (exists on `unique_option_items`) + a level badge; placeholder glyph when
  no icon. Groups have NO icon column (so no group icons — confirmed schema).
- **Detail requirements** use the SAME chain feats use: `resolveDetailPrereq({freeText:
  string_prerequisite, tree}, lookup)` with a full `RequirementFormatLookup`
  (class/subclass/spellRule/optionItem + feature/spell + skill/tool/weapon/armor/language proficiency
  maps keyed by `identifier`). This was an explicit user requirement ("same functionality as feats").
- **URL-hash deep-link:** `#group-slug` selects a group; `#group-slug:option-slug` also selects the
  option. Slugs via `slugifyReferenceSegment` — identical convention to `@option-group[group:item]`
  cross-refs. Inbound one-shot on mount (item half resolves after that group's items load via
  `pendingItemSlug`); outbound `replaceState` on selection.
- **Routes** (`App.tsx`): `/compendium/unique-options` + `/:id` → browser; `/new` + `/edit/:id` → the
  comprehensive editor (unchanged). `UniqueOptionGroupList` still imported (used by the proposal route
  `/proposals/edit/option-groups`); `UniqueOptionGroupView` now ORPHANED (unrouted, left in place —
  deleting it is a separate cleanup, harmless for now).
- **Docs updated** (documentation-clarity, surgical): `docs/architecture/routing.md` +
  `docs/features/compendium-options.md` page tables — fixed pre-existing path drift (`/compendium/options`
  → `/compendium/unique-options`) + the new component. Nothing else disturbed.

## NEXT TASK — review the comprehensive Unique Option **Editor**

**File:** `src/pages/compendium/UniqueOptionGroupEditor.tsx` (**1153 lines**) — what `/compendium/
unique-options/new` + `/edit/:id` route to, and where the browser's Edit affordance links. User wants to
"go over" it; approach (per the last exchange) = **survey pass first, surface rough edges, prioritize
together** (user hasn't pre-named specific changes). Ask whether they have pain points before refactoring.

**Structure (anchors for the survey):**
- Two writers: `groupWriter = useProposalAccumulator('unique_option_group')` (line 56),
  `itemWriter = useProposalAccumulator('unique_option_item')` (57). Proposal-aware (block mode).
- `loadAll` (line 151): the 15-collection fetch — **already hardened** this session-family with
  `settleAll` (line 163, `Promise.all` + per-promise `.catch(→[])`) so one flaky lookup can't blank the
  Source dropdown. (That was the "source dropdown empty" fix.)
- **Group form** = left 2/3 of a `grid lg:grid-cols-3` (line 618): name/source/description/classes
  (`EntityPicker` line 667 for class assignment).
- **Item editing = a `<Dialog>` modal** (`handleSaveItem` line 392; `DialogContent` line 766,
  `max-w-[95vw] lg:max-w-6xl ... h-[90vh]`). Modal packs: ImageUpload (icon_url, line ~448),
  name/desc, `RequirementsEditor` (line 914 — the structured prereq tree builder),
  `AdvancementManager`, `ActivityEditor`, uses/recovery, tags. `editingItem` state (line 86).
- **Likely rough edges to evaluate (NOT yet confirmed — survey them):** (1) the item-edit **modal** is
  the heavy interaction — is a modal still right now that the browser exists, or should item-edit move
  inline / 3-pane like the browser? (2) the `DialogContent` is the mobile-oriented variant — earlier this
  session we swapped ScalingColumnsPanel's modal to `DialogContentLarge`; check if this one wants the same
  desktop treatment. (3) mobile usability of a `h-[90vh]` modal with many sub-editors. (4) general UX
  parity with the SpellsEditor/CompendiumEditorShell pattern. **Confirm with the user before big moves.**

## proposal-system / foundry-module status (context, not our action)

- **proposal-system:** Part D (block-atomic approve + guard #1) shipped + live e2e passed 19/19 at the
  data layer; R4 shipped; F3 (subclass.preview) shipped; **guard #1 now walks the pool arrays** (our
  recommendation, `d3c6585`); bg/race entity_type migrations **applied to remote** (`64df22a`). The
  authored-block e2e (Druid+WildShape+column+group through the editors) is the remaining joint test —
  unblocked, ours to run when the user wants.
- **foundry-module:** we sent the bg/race export spec + asked for importer/creature-shape preferences.
  **Waiting on their reply** before bg/race *editors* + the creatures table. User explicitly said: "We'll
  wait for the data shapes to come back from the foundry module" — so don't start creature/table work.

## Verification posture

- `npx tsc --noEmit` = **7-error baseline** all session (6× pre-existing `Button asChild` +
  `characterShared.ts:520`). Re-verified after every change; nothing new added. Run it after edits and
  compare to 7, not 0.
- All recent dev/preview was the user eyeballing on `:3000`. Visual changes (the browser) the user
  approved ("That works for now").

## Immediate next step

Open `UniqueOptionGroupEditor.tsx`, do a focused survey (group form + the item-edit modal + the
sub-editor stack), and present the rough-edge list to the user to prioritize — **before** any refactor.
Lead candidates above. Then iterate the same way we did the browser (small, tsc-checked, eyeball on
:3000, commit when approved). Keep the harness lock out of commits.
