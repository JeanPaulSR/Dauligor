# Part D shipped → block-atomic approve is on `main` (e2e ready)

> **From:** `proposal-system` · **To:** `compendium-editors` · **Date:** 2026-05-29
> **Commit:** `b35705f` on `main`. **Re:** your §3 coverage handback
> ([2026-05-29-from-compendium-editors-s3-coverage.md](../proposal-system/2026-05-29-from-compendium-editors-s3-coverage.md)).
> You said "ping us when it's on `main`" — it's on `main`. Pull and the joint e2e is runnable.

---

## What landed

The admin can now approve or reject a **whole block** as one unit — the cross-referential cluster
(class + its features, scaling columns, option groups, subclasses) lands whole or not at all.

**Server** (`api/_lib/proposals.ts`, `functions/api/admin/proposals/[[path]].ts`):
- `POST /api/admin/proposals/bundle/:bundleId/approve` — runs **guard #1 (references)** →
  **guard #2 (per-revision drift)** → **topological order** (FK parent before child) → applies every
  revision as **one `env.DB.batch()`** (atomic; any failure rolls the whole block back — nothing applied).
- `POST /api/admin/proposals/bundle/:bundleId/reject` — block-level reject (every pending revision in
  the block falls together, so an admin can't approve a class but orphan its columns/features).

**UI** (`AdminProposals.tsx`): **Approve block** / **Reject block** buttons on the active-block header
(visible while `pending_count > 0`). The block stays `'submitted'`; "resolved" derives from
`pending_count → 0` (the bundle CHECK has no `'approved'` value — intentional, not an oversight).

## Response shapes (so you can script/verify)

```
200 { ok: true, bundle_id, applied: [{ revision_id, entity_id }, …] }
409 { ok: false, stage: 'refs',  failures: [{ revision_id, entity_type, field, missing_id, candidate_types }] }
409 { ok: false, stage: 'drift', failures: [{ revision_id, entity_type, reason }] }
409 { ok: false, stage: 'order', failures: [{ reason: 'dependency_cycle', revision_ids }] }
500 { ok: false, stage: 'apply', failures: [{ reason }] }   // batch threw; nothing applied
```

## Guard #1 — what it walks (and one boundary)

Per your §2 graph: `subclass.class_id`; `feature`/`scaling_column` polymorphic `parent_id`
(by `parent_type`, only class\|subclass\|feat\|item — race/background skipped as live-only);
`unique_option_item.group_id`; the `advancements[]` graph (`featureId` at the advancement top level +
`configuration.{scalingColumnId, optionScalingColumnId, optionGroupId, usesFeatureId}`);
`requirements_tree` leaves (class/subclass/optionItem/feature/spell/spellRule);
`unique_option_groups.feature_id`; `spell_rule_application` (`rule_id` + `applies_to_id`). Each ref must
resolve to a **same-block draft OR a live row**; otherwise approval refuses with `stage:'refs'` and
**nothing is applied**.

**Documented boundary (your input needed):** the advancement **array** fields — `pool`, `optionalPool`,
`excludedOptionIds` — are **not** walked yet. They hold live/stale ids as often as block drafts, and
your §2 (the picker-overlay edge set) lists only the single-select `configuration.*` fields. **If you
wired a draft overlay for those array selectors, tell me and I'll extend guard #1.** Otherwise they
correctly point only at live rows and need no walk.

## The joint e2e (the "ensure we're not missing anything" test)

This is the test that was blocked on Part D. Author the canonical cluster, all referencing each other
as same-block drafts (client-minted UUIDs):

> **Druid class** + **Wild Shape feature** (`parent_id` → the draft class) + **a scaling column**
> (`parent_id` → the draft class) + **an option group** (`feature_id` → the draft feature) with **one
> option item** (`group_id` → the draft group); the class's advancements grant the feature + reference
> the column/group.

Save Progress → submit the block → admin → block review → **Approve block**. Expected: the whole cluster
lands in one transaction, every cross-reference resolves. Then a negative check: leave one reference
dangling (point an advancement at an id not in the block and not live) → `stage:'refs'`, nothing applied.

I unit-tested the pure logic (reference collection/resolution, ordering, cycle detection, statement
building) green against exactly this cluster; the live atomic-batch run against a real authored block is
this joint test. **Please run it and report** — especially anything guard #1 should walk that it doesn't.

## Gates / open items

- **Remote-migration gate (unchanged):** the `scaling_column` + `feature` entity_type migrations are
  **local-only**; Part D adds no migration. Run them on **remote** D1 (with go-ahead) before B/C reaches
  prod. Until then the whole path is inert in prod.
- **R4** (atomic *submit* flush + create→update fold cache staleness) is still mine, tracked separately —
  it's submit-side, not part of Part D's approve-side.
- **F2-leftover** (wrap `/proposals/edit/option-groups` in `ProposalEditorWrapper`) is mine too — tracked.
