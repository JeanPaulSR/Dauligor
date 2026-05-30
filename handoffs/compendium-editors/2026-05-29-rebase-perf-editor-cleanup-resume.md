# Handoff — `compendium-editors`: post-rebase + editor-cleanup state (resume after compaction)

> Read this first, then the earlier resume doc
> [2026-05-29-block-composition-resume.md](2026-05-29-block-composition-resume.md) (Part B+C framing,
> headline 404 fix, F2 lists), the proposal-system reply
> [2026-05-29-proposal-system-reply.md](2026-05-29-proposal-system-reply.md) (R1/R3/F1 shipped on main,
> R2 confirmed in design, Part D NOT built — paused awaiting our §3 hand-back), and our followup
> [2026-05-29-followup-to-proposal-system.md](2026-05-29-followup-to-proposal-system.md) (R1-R4 + F1-F3
> asks, of which R1/R3/F1 are now done).

## TL;DR — where we are

This session: rebased onto current `origin/main`, conclusively root-caused a **dev-mode-only**
ClassEditor typing lag (it's eager-construction × `jsxDEV`, not our branch — same code is 2 ms in
prod), shipped a **tab-gating perf fix** (291 ms → 64 ms in dev), and started a **post-rebase
editor-cleanup pass** the user noticed while focusing on Part B/C functionality. We're 3 fixes
deep into a 7-item queue. **All 5 of this session's code changes are uncommitted on top of the
rebased branch.**

The headline open question is **task #4's "second half"**: my fix for the spell-editor infinite
loop stopped the crash but introduced a new symptom — the SpellDetailPanel doesn't refresh after
save because my `useRef<Set>` permanently blocks re-fetch. Investigation just started; see §4
below for the exact pickup point.

## Branch / worktree / git state

- Branch **`compendium-editors`** in worktree
  `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d` (Bash CWD resets every
  call — use `cd "<path>" && …` or `git -C`).
- **Rebased this session onto `origin/main` = `5722a40`** ("Merge origin/main into system-applications
  (proposal-system + compendium-editors)"). Pre-rebase HEAD was `cc70d23`; new HEAD tip is
  `6d88674` (= the rebased `docs(handoffs): block-composition session resume state`). Two duplicate
  doc commits were auto-skipped (`7478c34`, `d67614b` — already cherry-picked onto main).
- **Safety branches** (do NOT delete until the work is committed):
  - `backup/pre-rebase-cc70d23` → pre-rebase HEAD.
  - `backup/perf-fix-stash` → dangling stash commit `828155a` `On compendium-editors: lag-fix-wip
    (tab gating + MDE memo)` — recovered ClassEditor gating from this once already.
- **Conflict surface was tiny.** Only `src/pages/compendium/SubclassEditor.tsx` + the followup doc;
  git auto-merged both, no markers, no conflicts to resolve. **`main` did NOT touch
  `ClassEditor.tsx`** since the merge-base (`7d41e5b`), so our heavy proposal work there replayed
  identically.
- **Uncommitted working-tree changes** (all from this session, all type-clean against the 7-error
  baseline):
  - `src/pages/compendium/ClassEditor.tsx` — controlled `<Tabs value={activeTab}>` + `activeTab` state
    + gating on `{activeTab === 'proficiencies' && (...)}` and `{activeTab === 'multiclass-
    proficiencies' && (...)}`. Recovered from the dangling stash mid-session.
  - `src/components/MarkdownEditor.tsx` — `React.memo(MarkdownEditor)` at end of file; auto-merged
    cleanly with main's added `ReferenceAutocomplete` import.
  - `src/App.tsx` — `/proposals/edit/option-groups` list route now wrapped in
    `<ProposalEditorWrapper entityType={['unique_option_group','unique_option_item']}>`.
  - `src/pages/compendium/UniqueOptionGroupList.tsx` — imports + calls
    `useBlockDraftedList<any>('unique_option_group', groups)`; renders an "in this block" badge on
    `g.__draft` entries.
  - `src/components/compendium/SpellDetailPanel.tsx` — infinite-loop fix: deps reduced to
    `[spellId]`, `useRef<Set<string>> attemptedSpellIds` tracker, `.catch` deletes from set to allow
    retry. **This is what introduced the new "details don't refresh after save" symptom (task #4
    second half).**

## Dev server state

- Express dev server on `:3000` (`npm run dev` background, pid 16600 last we saw — task id
  `bgcpycxmd`).
- Worker on `:8787` (`wrangler dev` background, task id `bhh41j7ts` — long-running, but D1 path
  verified end-to-end this session).
- **`:3001` / `:8788` are the `system-applications` sibling stack — DO NOT TOUCH** during cleanups.
  Earlier in the session there were 3 overlapping dev stacks (24 node procs, 2 GB workerd, hit
  WSAENOBUFS); we cleaned them up and preserved that sibling stack throughout.
- The dev log shows intermittent `[D1 Internal] role lookup failed for uid=...: Error: D1 Worker
  request failed: 503` — a real worker-side flake. Relevant for task #1's "source empty" half.
- **Local D1 migrations**: the two `entity_type` migrations are applied (per the prior handoff).
  `main` added one new migration since merge-base: `20260529-1200_subclass_preview.sql`
  (additive `ALTER subclasses ADD COLUMN preview TEXT`). **Hasn't been applied locally yet** — if
  the SubclassEditor tries to read/write `preview`, it'll fail. Apply with
  `cd worker && npx wrangler d1 execute dauligor-db --local --file=migrations/20260529-1200_…`.

## Active editor-cleanup queue (live)

User reported these "while focusing on Part B/C functionality" and prefers them in order, but flagged
task #4 as severe (it was actively spamming D1). State as of compaction:

- **#1 [in_progress] Option group editor: source field broken + post-save inaccessible.**
  - ✅ "can't re-access after save" **DONE** (committed-style — uncommitted in WT). User confirmed:
    "the unique option group does appear to save correctly now." Fix: wrap list route in
    `ProposalEditorWrapper`, add `useBlockDraftedList` + "in this block" badge to
    `UniqueOptionGroupList`. Outside the wrapper the admin catalog is unaffected.
  - ⏳ "source dropdown empty" — diagnosis: `UniqueOptionGroupEditor.loadAll` (~lines 150-188) has
    ONE `Promise.all` over 15 collections; any single rejection tanks every `setState`. Migration
    diff isn't the culprit (only `subclass_preview` is new). Most likely the intermittent worker
    503 hits one of the 15 fetches. **Awaiting from user**: the console error string
    `Error loading unique options data: …` (which fetch it names) — they haven't paste it yet.
    Plausible fix once we know: convert to `Promise.allSettled` so partial success works.

- **#2 [pending] Switch ScalingMatrixEditor modal to the new desktop "large window" component.**
  Cosmetic / UX. User mentioned the project has a new desktop-oriented modal variant; currently
  ScalingMatrixEditor uses a mobile-oriented Dialog. Need to identify the new component name
  (`LargeWindow`? something similar) and swap.

- **#3 [pending] Fix back-from-class nav to `/my-proposals` in proposal mode (not ClassView).**
  Single conditional in ClassEditor's "Back" link — gate the target on `isProposalMode`.

- **#4 [in_progress] Spell editor save: infinite `[SpellDetailPanel] failed to load spell` loop.**
  - ✅ **Loop killed.** Bug was `SpellDetailPanel.tsx`'s effect at line 139 with deps
    `[spellId, spellsById, membershipsBySpellId]`: when `fetchDocument` returned `null` (spell not
    on disk), `setSpellsById` was skipped but `setMembershipsBySpellId` always ran, so
    `membershipsBySpellId` mutated → deps changed → effect re-ran → guard at line 141 still failed
    because `spellsById[spellId]` was undefined → fetched again → loop. Fix: deps reduced to
    `[spellId]` + a `useRef<Set<string>> attemptedSpellIds` tracker (deleted on `.catch` so retries
    survive). User confirms loop is gone.
  - ⚠️ **NEW symptom from the fix: details don't show in the editor.** User: "we aren't able to
    see the spell details, compared to the full catalog working right." The catalog
    (`SpellList.tsx`) uses `<SpellDetailPanel spellId={selectedSpellId} />` and works. `SpellsEditor`
    uses it at **two call sites**: line 1778 `spellId={editingId}` and 2039-2040
    `spellId={id}`. **Hypothesis**: after the editor saves a spell, the `attemptedSpellIds.current`
    ref permanently blocks the re-fetch, so the panel either shows stale data or never populates.
    **Pickup**: either (a) replace the Set tracker with one that's invalidated on save (e.g. a
    refresh prop / version key from the editor), or (b) change the .then to always
    `setSpellsById(prev => ({...prev, [spellId]: mapped ?? null}))` so the original cache-check
    guard works in the null case (requires loosening the `SpellRecord` type to allow `null`). Lean
    toward (b) — it preserves the prior interface and makes the panel render a "spell not found"
    UI instead of stalling. Read SpellsEditor 1770-1790 and 2030-2050 to design.

- **#5 [pending] Base UI FieldControl controlled→uncontrolled warning on advancement / class save.**
  User pasted the warning text + a huge React commit-phase stack trace. A field's value flips
  `defined ↔ undefined` during the commit. The handoff long ago flagged "likely an
  AdvancementManager numeric input." Likely the same culprit. Easiest path: grep AdvancementManager
  for `value={…}` where the source is `?? …` only when truthy (i.e. some prop reads a number that
  becomes undefined on save). Defensive `?? ''` sweep on the suspect input(s) usually closes it.

- **#6 [pending] Subclass features tab doesn't update after a NEW subclass is created.**
  User: "Subclass don't update their features tab after being created, normal subclasses do." Smells
  like the same family of `effectiveId` gates we did for ClassEditor (commit `a474f35`) — the new
  subclass has `pendingCreateId` but the Features tab is keyed on raw `id`. Re-grep
  SubclassEditor's Features tab gates / `displayFeatures` for `id` that should be `effectiveId`.

- **#7 [pending] Advancement feature picker in class shows subclass features (no parent filter).**
  User: "the advancement feature in class is now showing the advancement features of the subclass."
  The `useBlockDraftPickerOptions('feature')` overlay surfaces every draft feature in the block
  regardless of `parent_type`. Two paths: (a) filter in the hook (add an optional
  `parentType`/`parentId` parameter); (b) filter at the consumer in ClassEditor's
  `featurePickerOptions` useMemo. Path (a) is more reusable; path (b) is fewer files.

## proposal-system side (from their fresh 2026-05-29 reply, all on `main` now via our rebase)

- **R1 ✅ shipped** — `scaling_column.writableColumns` now includes `type` / `identifier` /
  `distance_units`.
- **R3 ✅ shipped** — block-entry gate. `ProposalEditorWrapper` refuses to render an editor without
  an active block (auto-opens the pick/create dialog). **Changes how our editors mount: they only
  mount with an active block**, which is why our F2 list-overlay fix for option-groups had to wrap
  the list route too.
- **F1 ✅ shipped** — toast now says "added to block" vs "submitted for review";
  `useProposalAccumulator` reports `mode:'block'` inside a wrapper.
- **R2 ✅ confirmed in design** (the feature graph for guard #1) — implemented in Part D.
- **R4 (atomic flush + drafts-cache staleness) — outstanding ask.** Not in their reply.
- **Part D (guard #1 + atomic approve-whole-block) is NOT built** — explicitly **paused awaiting
  our §3 hand-back**. See `handoffs/proposal-system/2026-05-29-partD-paused-awaiting-bc.md` for what
  they need from us. Until Part D ships, you can author + submit a block but **approving it to
  land the cluster doesn't work**. So the e2e verification task (the earlier #15) remains blocked
  on Part D.

## The "no production regression" finding (compressed — full proof in the chat memory)

After deep investigation, the dev-mode ClassEditor typing lag was **conclusively isolated to the
dev build mode**, NOT our branch, NOT the machine, NOT a shippable bug.

| Build | Machine | ClassEditor render |
|---|---|---|
| Local prod build, ungated | this box | **2 ms** |
| Local dev, our branch (ungated) | this box | 291 ms |
| Local dev, `main` (ungated) | this box | 331 ms |
| Local dev, our branch + tab gating fix | this box | 64 ms |

Same ungated code, same machine: **dev 291 ms vs prod 2 ms ≈ ~145× from `jsxDEV` per-element
validation + StrictMode 2× + (React DevTools serializing if open)**. The editor's underlying
inefficiency — building all 11 tab panels' JSX every keystroke (Base UI's `Tabs.Panel` unmounts
inactive panels but their *children* are still constructed before being handed over) — is on
production's code too, harmless in the prod build. The tab gating cuts it back even in dev to
~64 ms. **The fix is kept because it makes dev comfortable, not because it's a shipping bug.**
Saved a memory `feedback_empirical_verification.md` so future sessions don't repeat the mistake of
asserting unmeasured perf claims.

## What's LEFT

**Ours (compendium-editors, in priority order):**
1. **Finish task #4** — restore SpellDetailPanel's ability to refresh after save (see §4 pickup
   above; lean toward the "always set spellsById, allow `null`" variant).
2. Drain tasks #5-7 then #2-3 (their numerical order tracks roughly user-reported severity).
3. **§3 hand-back to `proposal-system`** — coverage table (which references actually got Part C
   overlays), payload-shape confirmation, `parent_type` values, sample block (Druid + Wild Shape
   + scaling column + option group), F2 status. **This unblocks their Part D** — highest external
   leverage item.
4. **Apply main's `20260529-1200_subclass_preview` migration locally** before exercising SubclassEditor
   under task #6.
5. **Commit everything.** This session's 5 uncommitted files (and the rebase itself) need to land
   as proper commits. Sensible split: one commit for the tab-gating perf fix, one for the
   MarkdownEditor memo, one for the option-group list overlay (App.tsx + List), one for the
   SpellDetailPanel infinite-loop fix.

**proposal-system's (still awaiting them):**
- R4 (flush atomicity + create→update fold staleness).
- Part D (atomic approve + guard #1) — blocks our e2e verification.
- F3 (subclass.preview to subclass writableColumns) — `main` now has the migration; their config
  likely needs the column.

## Tasks (TaskList)

In-session live state — re-read with `TaskList` after compaction:

- #1 [in_progress] Option group editor source + re-access (re-access half ✅, source half ⏳ awaiting
  console error).
- #2 [pending] ScalingMatrixEditor modal → desktop large-window.
- #3 [pending] Back-from-class → `/my-proposals` in proposal mode.
- #4 [in_progress] Spell editor save loop (loop ✅, details-don't-refresh ⏳ — needs immediate
  follow-up).
- #5 [pending] Controlled→uncontrolled warning on advancement/class save.
- #6 [pending] Subclass features tab not updating on new.
- #7 [pending] Advancement feature picker shows subclass features.

## Verification

- `npx tsc --noEmit` = **7-error baseline** end of session (6× pre-existing `Button asChild` +
  `characterShared.ts:520`). Re-verified after each of the 5 working-tree changes; **none of our
  edits added new errors**.
- Dev server up, worker + sysapp untouched throughout.
- User confirmations during the session: tab gating made typing smooth (64 ms felt good), option
  group save now works ("the unique option group does appear to save correctly now"), spell save
  no longer triggers infinite errors.

## Immediate next step

**Finish task #4's second half.** Read `SpellsEditor.tsx` lines 1770-1790 + 2030-2050 to see how it
wires `<SpellDetailPanel spellId={editingId} />` (line 1778) and `<SpellDetailPanel spellId={id} />`
(line 2039) and whether either flows through a save→refresh signal we can hook. Then change the
SpellDetailPanel fix to always populate `spellsById[spellId]` (allowing `null`) instead of using the
`attemptedSpellIds` ref, so the original cache-check guard works in the null case AND a fresh save
can invalidate the cache. The user's pickup expectation: "details show after save, like the catalog
does." Confirm with them, then drain #5-7/#2-3 per their order.
