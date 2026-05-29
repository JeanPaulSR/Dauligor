# Handoff → `compendium-editors`: proposal-system state + Part D is paused for you

> **From:** `proposal-system` · **To:** `compendium-editors` · **Date:** 2026-05-29
> **Status:** proposal-system side is **paused before Part D**. Finish your B/C, then **hand back**
> with the checklist in [§3](#3-what-i-need-back-from-you-to-finish-part-d) so I build the
> approve/batch side against what's *actually* wired — that's how we make sure guard #1 misses nothing.

Sequencing decision (user): you complete the editor side first; then I finish Part D (atomic
approve-whole-block + the guard #1 reference-walk). Deferring Part D until your overlays/saves are
final means guard #1 validates exactly the references that can actually be authored — no more, no less.

---

## 1. What proposal-system shipped (so you're building on a known base)

All on `main`. Pull/rebase and you have:

| Thing | Where | Notes |
|---|---|---|
| `scaling_column` proposable type | `api/_lib/proposals.ts`, `proposalAware.ts` | config writable cols = `id, name, parent_id, parent_type, values, type, identifier, distance_units` (R1 fix included), json = `values` |
| `feature` proposable type | same | writable = all non-timestamp `features` columns; json = `uses_recovery, prerequisites_items, properties, activities, effects, advancements, tags`. Row uses `tags` (not `tag_ids`). |
| `useProposalDraftOptions(type)` | `src/hooks/useProposalDraftOptions.ts` | `{id,name,__draft}[]` of active-block CREATE drafts; `[]` outside a wrapper |
| local migrations | `worker/migrations/20260528-1200` (scaling_column), `20260528-1400` (feature) | **local D1 only** — see [§4](#4-remote-migration-gate) |
| display labels/icons | `AdminProposals`, `MyProposals`, `ProposalEditorWrapper` | both types render in the admin queue + block list |

## 2. Two behavior changes that affect your editors — please account for them

- **Block-entry gate (R3).** `ProposalEditorWrapper` now renders a "pick or create a block" gate
  *instead of the editor body* whenever there's no active block (outside review mode). **Your editors
  only mount once a block is active.** So inside your editor code you can assume an active block exists
  (composite authoring — add an option to a just-created group — now works from the first save).
- **Toast wording (F1).** The in-wrapper writer now reports `mode: 'block'`, so `actionLabel` emits
  **"added to block"** (not "submitted for review") for in-block queues. If any of your code keyed off
  the old `'proposal'` string *exclusively*, note the change — but `isProposalMode` uses the
  `proposal || block` OR pattern, so it should be transparent.

## 3. What I need back from you to finish Part D

When B/C is done, drop a note in **this folder** (`handoffs/proposal-system/`) or ping, with:

1. **Final overlay coverage.** Which references in the
   [audit matrix](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html#guard1)
   actually got a Part C draft-overlay (i.e. a content-creator can now pick a *same-block draft* there).
   **Guard #1 must walk exactly that set** — if you overlaid it, I validate it; if you deferred an
   overlay, that ref only ever points at a live row and needs no walk. A checked-off copy of the gap
   table is ideal.
2. **Queued payload shapes — confirm no silent drops.** For `feature` and `scaling_column` (all six
   owners), confirm every field your Part B queues is in my `ENTITY_CONFIGS` writable set (R1 was
   exactly this class of bug — a column silently lost on approval). If you send a field I don't list,
   flag it and I'll add it.
3. **`parent_type` values actually in play.** Confirm which `scaling_column.parent_type` values get
   authored (all of `class|subclass|feat|race|background|item`?) and `feature.parent_type`
   (`class|subclass`), so guard #1's draft-parent resolution covers them.
4. **Any new draftable references** you found during implementation that aren't in the audit matrix.
5. **A sample block to validate against** (the "ensure we're not missing anything" check): ideally a
   built block like *"Druid class + Wild Shape feature + a scaling column + an option group with one
   option,"* all referencing each other as same-block drafts. I'll run guard #1 + the atomic approve
   against it and confirm the whole cluster lands (or fails cleanly) as one unit.
6. **F2 status** (own-type list overlays for option-group / `ScalingColumnsPanel`) — needed for the
   end-to-end author → submit → approve test to be exercisable.

## 4. Remote-migration gate

The two entity_type migrations (`20260528-1200`, `20260528-1400`) are applied to **local D1 only**.
Before your B/C reaches prod, they must run on **remote** D1 — I'll do that (with explicit go-ahead)
as part of finishing Part D. Until then, `scaling_column`/`feature` are inert in prod (nothing submits
them), so it's safe on `main`.

## 5. What Part D will be (so you know what's coming back)

Per the [design doc](2026-05-28-cross-referential-cluster-design.md) Part D, hardened after your audit:
atomic `env.DB.batch()` approve-whole-block + **guard #1** (reference-integrity over the full matrix
incl. the feature graph) + per-revision drift check + dependency ordering + block-level reject + the
block edit-lock. It's all server-side (`functions/api/admin/proposals/*`, `api/_lib/proposals.ts`,
`api/_lib/cascadeStrategies.ts`) — it won't touch your editor files.
