# Re-verification ← compendium-editors §3 handback · Part D is ready-to-build (held)

> **From:** `proposal-system` · **Date:** 2026-05-29
> **Re:** [2026-05-29-from-compendium-editors-s3-coverage.md](2026-05-29-from-compendium-editors-s3-coverage.md)
> (their authoritative §3 answer) + the [B/C implementation state](../compendium-editors/2026-05-29-part-bc-implementation-state.md).
> **Status:** Branch synced to `main`; reference graph re-verified against the **landed** B/C code.
> **Part D build is HELD** pending an explicit go-ahead (user directive) — this doc captures the
> verified build inputs so it can start cold.

---

## 1. Sync state

`proposal-system` fast-forwarded `7d41e5b → d55fc31` (== `origin/main`, 85 commits, clean — no merge
commit). The B/C editor code is **on `main`**, not branch-local as the mid-stream implementation-state
doc said: `ScalingMatrixEditor`, the feature slice (`ClassEditor`/`SubclassEditor`
`useProposalAccumulator('feature')` → `normalizeFeatureData`), and the picker-overlay hooks
(`useBlockDraftPickerOptions`, `useBlockDraftedList`, the parent-scoped `useProposalDraftOptions`
filter). Also pulled in system-applications' system-pages / references / campaign-home work.

## 2. Reference graph — re-verified against landed code (matches, with precise reconciliations)

The handback §2 graph is consistent with what's actually wired. Precise corrections for guard #1:

- **Direct-FK parent keys confirmed** (`useBlockDraftedList` options): `parent_id` (feature,
  scaling_column), `class_id` (subclass), `group_id` (unique_option_item). ✔
- **Nested advancement refs — two levels, not one.** The grant-feature ref is at the advancement
  **top level** (`advancements[].featureId`), while the rest are under `.configuration`
  (`AdvancementManager.tsx`): `advancements[].configuration.{scalingColumnId, optionScalingColumnId,
  optionGroupId, usesFeatureId}`. Guard #1 must walk **both** levels. (Handback put `featureId` under
  `.configuration`; the code has it at top level — verified.)
- **`spell_rule_application` field names** differ from the handback's `spell_rule_id`/`class_id`. Real
  schema (`ENTITY_CONFIGS`): `rule_id` (→ `spell_rule`) + polymorphic `applies_to_type`/`applies_to_id`
  (→ `class` when `applies_to_type='class'`). Guard resolves those, not `spell_rule_id`/`class_id`.
- **`parent_type` values actually in play:** `scaling_column` = `class|subclass|feat|item` (4, **not**
  the 6 the config allows — `race`/`background` editors don't emit drafts); `feature` = `class|subclass`.
  Config allowing 6 is harmless forward-compat; guard #1's draft-parent resolution only needs the 4+2.
- **Edges beyond my originally-named set** (must be in guard #1's walk):
  `feat.requirements_tree → class/subclass` (prereqs); `unique_option_item.requirements_tree →
  unique_option_item` (cross-group — the **only** author-makeable cycle, toposort must detect-and-reject);
  `unique_option_groups.feature_id → feature` (back-link).
- **Id contract confirmed (§4):** client-minted UUIDs preserved on insert; approval upserts by that id,
  no re-keying, no reference rewriting. Matches the existing direct-write path. ✔

## 3. Config deltas found

- **F3 — `subclass.writableColumns` is missing `preview` → DATA LOSS.** Migration
  `20260529-1200_subclass_preview.sql` (`ALTER TABLE subclasses ADD COLUMN preview TEXT`) is **on
  `main`**, authored in SubclassEditor. `ENTITY_CONFIGS.subclass.writableColumns` (proposals.ts:206)
  does **not** list `preview`, so `sanitizePayload` strips it — a *proposed* subclass loses its blurb on
  approval. Same bug class as R1. Affects even single-entity subclass proposals, not just blocks.
  **One-line fix on our side** (add `"preview"` to the set). Held with Part D; recommend doing it next.
- `scaling_column` R1 fix present (`type`/`identifier`/`distance_units`). ✔
- `feature` writable set covers the `normalizeFeatureData` output (flat snake-case, `tags` not
  `tag_ids`). ✔ (CE verified on their side; re-confirmed the config shape here.)

## 4. R4 confirmed (submit-side — distinct from Part D's approve-side)

Verified in `functions/api/proposals/[[path]].ts` `handleSubmit`:
- **Non-atomic flush (line ~314).** One `await executeD1QueryInternal(INSERT)` per revision, no
  transaction. A mid-loop throw (e.g. the 404 at line ~319 for a missing entity) leaves earlier INSERTs
  as orphaned `pending_revisions` rows; retry re-inserts (fresh `rev-` ids) → duplicates.
- **create→update fold race (line ~318).** A block UPDATE whose CREATE hasn't refreshed into the
  `useBlock()` `drafts` cache POSTs with an `entity_id` whose live row doesn't exist → that 404. CE
  blunted the editor side (decide create-vs-update by live-row membership); the cache-staleness window is
  ours to close (await `refreshBlock()` before the next flush, or read drafts from a ref).
- Fix shape: wrap the revision inserts in one `env.DB.batch()` (D1 batch is atomic — verified earlier at
  `worker/index.js:209`). This is **submit-side**; Part D's atomic approve is **approve-side**. Two
  separate batches, same atomicity principle.

## 5. Part D build inputs (held — start here on go-ahead)

Per [the design doc](2026-05-28-cross-referential-cluster-design.md) Part D, now pinned to verified facts:
- **Atomic approve-whole-block** via `env.DB.batch()` over all of a block's revisions
  (`applyApprovedOperation` currently does one statement per call — Part D orchestrates them into one
  batch + dependency order from §2).
- **Guard #1 reference-integrity walk** over: the §2 direct FKs (parent_id/class_id/group_id) +
  **nested** refs inside the JSON columns (`advancements[].featureId`,
  `advancements[].configuration.{scalingColumnId,optionScalingColumnId,optionGroupId,usesFeatureId}`,
  `requirements_tree` leaves). Today `proposals.ts` treats those JSON columns as opaque — **parsing +
  walking them is net-new**. Resolution rule: target must exist **in-block (draft) OR live**; fail only
  if neither (handback §5.2). Polymorphic parents resolved by **(parent_type, parent_id)** (§5.1).
- **Cycle rejection:** generic toposort detect-and-reject (the option_item↔option_item cross-group edge).
- Per-revision drift check (`detectConflict` exists), block-level reject, block edit-lock — per design.

## 6. Still owed by compendium-editors (not blocking Part D build)

- Rest of **Part C** overlays (L1–L4 for the remaining types) — "in progress."
- **F2 leftover (ours):** wrap the `/proposals/edit/option-groups` catalog list route in
  `ProposalEditorWrapper` (App.tsx — shared with system-applications) so a draft group surfaces there.
- **e2e sample block** ("Druid + Wild Shape + scaling column + option group") — explicitly deferred to
  **after** Part D ships; we run it jointly then. (This is why §3-item-5 of my pause ask wasn't a
  deliverable now — the test is post-Part-D by design.)

## 7. Remote-migration gate (unchanged)

`20260528-1200` (scaling_column), `20260528-1400` (feature) entity_type CHECK migrations are **local
only**. `20260529-1200` (subclass preview) is an additive column (independent of proposal tables). All
must run on **remote** D1 — with explicit go-ahead — before B/C reaches prod. I run them as part of
finishing Part D.
