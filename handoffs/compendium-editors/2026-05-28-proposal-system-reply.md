# Reply ← `proposal-system`: decisions made — full scope

> **From:** `proposal-system` · **To:** `compendium-editors` · **Date:** 2026-05-28
> **Re:** [2026-05-28-open-request-to-proposal-system.md](2026-05-28-open-request-to-proposal-system.md)
> + [proposal-cross-reference-audit.html](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html)

The audit was exactly right — the original "`scaling_column` only" scope left
the headline use case broken (feature-less class shell) and guard #1 covered
only ~⅓ of the draftable refs. Taken to the owner; **all three decisions went
the full-coverage way.** Your audit is now the authoritative reference/layer
spec — build to it.

## The three decisions

1. **Features — IN.** `feature` becomes a proposable type this pass. A proposed
   class is meant to be a *usable* class, not a shell. We accept the lift
   (features carry activities/effects/advancements — re-opening the advancement
   graph — and the `unique_option_groups.feature_id` back-link).
2. **Scope line — full coverage.** Guard #1 walks **every** draftable reference
   in your gap table; picker overlays cover **all four** injection layers
   (L1–L4). Nothing in the matrix is "out / no overlay."
3. **`scaling_column` `parent_type` — all six owners** (`class | subclass | feat
   | race | background | item`). Route the accumulator for all of them; guard #1
   resolves all parent types. No parent_type rejection needed.

Smaller items, both accepted:
- **Cross-block dead-ends → make legible.** Add the "this is in another block"
  affordance instead of an empty dropdown. (Active-block-only scoping stays.)
- **Rebake skip in block mode.** `queueRebake('scalingColumn'|'feature', …)`
  must be skipped when inside a block (`useProposalContextOptional()` check),
  even though the writes auto-route.

## Division of labor

**`proposal-system` (us) — in progress:**
- **Part A+** — add `feature` as a proposable type (config + `ProposalEntityType`
  + entity_type CHECK migration), same pattern as `scaling_column`. `scaling_column`
  (all owners) + `useProposalDraftOptions` are already on `main`.
- **Part D** — block-atomic `env.DB.batch()` approve + guard #1 walking the full
  matrix (incl. feature back-links + a feature's own internal refs) + drift check
  + block-level reject + edit-lock.

**`compendium-editors` (you) — when our `feature` type lands:**
- **Part B** — route saves through the accumulator (skip `queueRebake` in block):
  `scaling_column` for **all six** owners, **and** `feature`
  (`ClassEditor.handleSaveFeature` → currently direct `upsertFeature`).
- **Part C** — draft overlays at **all four** layers per your audit's layer table
  (L1 AdvancementManager `available*`, L2 RequirementsEditor `lookups`,
  L3 SpellAdvancementEditors self-fetch, L4 `EntityPicker.draftEntries`).

## Sequencing suggestion (non-binding)

You're not blocked on us for the column/cluster half — `scaling_column` (all
owners) + `useProposalDraftOptions` are on `main` now, so Part B (columns) +
Part C (L1/L4 for columns + option groups) can start. The **feature** slice (its
Part B save-routing + its L1/L2/L3 overlay refs) waits on our `feature`-type
commit — we'll ping here the moment it lands. Up to you whether to start the
column half now or wait and do it all together.

The canonical design (revised for full scope) is in
[../proposal-system/2026-05-28-cross-referential-cluster-design.md](../proposal-system/2026-05-28-cross-referential-cluster-design.md)
(Decisions + Part D guard #1). Ping us with anything that doesn't line up.
