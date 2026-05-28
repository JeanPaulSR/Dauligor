# Handoff → `compendium-editors`: Parts B + C (proposing class clusters)

> **From:** `proposal-system` · **Status:** ready to pick up · **Date:** 2026-05-28
>
> Background + full design: [2026-05-28-cross-referential-cluster-design.md](2026-05-28-cross-referential-cluster-design.md)
> and the visual [cross-referential-cluster-design.html](cross-referential-cluster-design.html).
> **This doc is the actionable spec — start here.**

> ## ⚠ SCOPE EXPANDED (2026-05-28)
> Your [cross-reference audit](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html)
> was right and the owner chose **full scope**. See the reply
> [handoffs/compendium-editors/2026-05-28-proposal-system-reply.md](../compendium-editors/2026-05-28-proposal-system-reply.md).
> Net deltas to the spec below:
> - **Part B also covers `feature`** (not just `scaling_column`) and **all six**
>   column owners (`class|subclass|feat|race|background|item`), not class/subclass.
> - **Part C covers all four picker layers** (L1 AdvancementManager · L2
>   RequirementsEditor · L3 SpellAdvancementEditors · L4 EntityPicker) per your
>   audit's layer table — not just the L4 `EntityPicker` `draftEntries` prop
>   described below.
> - The Part B/C sketches below are still accurate *as far as they go* (the
>   `scaling_column` + `EntityPicker` mechanics); treat your audit's matrix +
>   layer table as the complete surface.
> - `feature` as a proposable type is being added by `proposal-system` — the
>   feature slice of B/C waits on that commit; the column/cluster slice doesn't.

---

## The simple version

A content-creator can't currently build a whole class in a block: saving a
**scaling column** errors out, and a column/option-group/class they just
created in the block doesn't show up in any dropdown. Two things fix that, and
they split cleanly between us:

**We (`proposal-system`) hand you two things — both already built on our branch:**
1. A new **`scaling_column` proposal type** — so columns *can* be queued for
   review like any other entity.
2. A helper, **`useProposalDraftOptions(type)`**, that answers one question for
   a dropdown: *"what did the user just create in this block?"*

**You (`compendium-editors`) make two changes with those:**

| | In plain words |
|---|---|
| **Part B** | When a content-creator saves a scaling column *inside a block*, send it to the proposal queue instead of writing it straight to the live DB (which they're not allowed to do → the error they hit). |
| **Part C** | Make the "pick a column / class / option group" dropdowns *also* show the things the user just created in this block, so they're selectable. |

That's the whole ask. Server, migration, approval logic, and the wrapper
plumbing are all ours (see [What you do NOT touch](#what-you-do-not-touch)).

---

## Prerequisite — get Part A (it's on `main`)

Part A is **on `main`** (commit `b5237e1`, `feat(proposals): Part A …`). Just
pull/rebase `main` and you have everything you need to build B + C:
- `scaling_column` proposable entity type + config (`api/_lib/proposals.ts`, `src/lib/proposalAware.ts`)
- `src/hooks/useProposalDraftOptions.ts` — the picker helper
- the entity_type CHECK migration `worker/migrations/20260528-1200_*.sql`

> **DB note (not your action):** that migration is applied to **local** D1 only.
> It lands on **remote** D1 — with explicit go-ahead — before B + C ship to
> prod. Until then Part A is inert in prod (nothing submits a `scaling_column`
> proposal yet), so it's safe on `main`. You don't need to run anything.

---

## Part B — route scaling-column saves through the queue

**Files:** `src/components/compendium/ScalingColumnsPanel.tsx`,
`src/pages/compendium/SubclassEditor.tsx` (~line 1414),
`src/pages/compendium/scaling/ScalingEditor.tsx` (~line 112).

Today these call `upsertDocument('scaling_columns', …)` / `deleteDocument(…)`
directly. That bypasses the proposal queue and hits the DB's staff-only gate —
a content-creator gets a 403.

**One wrinkle:** `ScalingColumnsPanel` currently receives no `userProfile` and
no writer (just `parentId / parentType / columns / onColumnsChanged`). So step
one is giving it a way to queue — pick whichever fits your code:
- **B1** — thread `userProfile` into the panel and call
  `useProposalAccumulator('scaling_column', userProfile)` inside it; or
- **B2** — have the parent (ClassEditor / SubclassEditor) pass down
  `onSaveColumn` / `onDeleteColumn` callbacks that already wrap the accumulator.

Then swap the writes. The accumulator **auto-routes** — it queues inside a
block and direct-writes on the admin route — so you can use it unconditionally:

```ts
const writer = useProposalAccumulator('scaling_column', userProfile);

// new column:        writer.create({ id: col.id, name, parent_id: parentId,
//                                    parent_type: parentType, values })
// existing column:   writer.update(col.id, { name, values, /* … */ })
// delete:            writer.remove(col.id)        // not deleteDocument(...)
```

Payload must use exactly these columns (the rest are server-managed):
**`id`, `name`, `parent_id`, `parent_type` (`'class'`|`'subclass'`), `values`**
(the JSON level→value map). `parent_id` may be a *draft* class/subclass id —
that's fine, it resolves on approval.

**Also:** skip `queueRebake('scalingColumn', …)` when in proposal/block mode —
the module rebake fires on *approval*, not on queueing.

---

## Part C — show block drafts in the cross-reference pickers

**Files:** `src/pages/compendium/{ClassEditor,SubclassEditor,UniqueOptionGroupEditor}.tsx`,
`src/components/ui/EntityPicker.tsx`.

1. **`EntityPicker` gains a `draftEntries?` prop** — an array appended to the
   live options and visually tagged ("in this block"):
   ```ts
   draftEntries?: { id: string; name: string; __draft: true }[]
   ```
2. **At each cross-ref picker, merge in the matching helper call:**
   ```ts
   const draftColumns = useProposalDraftOptions('scaling_column');
   const draftGroups  = useProposalDraftOptions('unique_option_group');
   const draftClasses = useProposalDraftOptions('class');

   <EntityPicker options={liveGroups} draftEntries={draftGroups} … />
   ```
   - column pickers → `'scaling_column'`
   - option-group picker (ClassEditor) → `'unique_option_group'`
   - class pickers (SubclassEditor, UniqueOptionGroupEditor `class_ids`) → `'class'`
3. **Inline `<select>` pickers** (e.g. ClassEditor's advancement column dropdowns
   that map over `scalingColumns` directly) aren't `EntityPicker` — just concat:
   ```ts
   {[...scalingColumns, ...draftColumns].map(c => <option … />)}
   ```
4. **No `if (proposalMode)` guard needed** — `useProposalDraftOptions` returns
   `[]` outside a block, so admin-direct pickers are unchanged.

### The helper contract

```ts
// src/hooks/useProposalDraftOptions.ts
useProposalDraftOptions(entityType: ProposalEntityType | null): {
  id: string;      // client-minted UUID — stable through approval
  name: string;    // from the draft payload's `name`, or "(unnamed draft)"
  __draft: true;   // so the picker can render the "in this block" affordance
}[]
```

Returns only **CREATE** drafts in the **current active block** (existing rows
already appear from the live fetch). Empty outside a `<ProposalEditorWrapper>`.

---

## What you do NOT touch

All `proposal-system`-owned — no action from you:
- **Server / migration / approval logic** (`api/_lib/proposals.ts`,
  `functions/api/admin/proposals/*`, `worker/migrations/*`).
- **The approval side** — "approve the whole block at once" (Part D) is ours and
  is *not* a dependency for your work.
- **The wrapper carrying `scaling_column`** — for the wrapper to dedupe column
  drafts on re-flush, the class/subclass wrapper needs `scaling_column` in its
  entity set. **We absorb that** in `ProposalEditorWrapper` so you don't take a
  dependency on a `system-applications` `App.tsx` edit.

---

## What "done" looks like

A content-creator opens a block, creates a class, adds a scaling column to it,
references that column in an advancement (the column shows in the dropdown),
adds a unique option group, picks the draft class inside it — saves all of it
into the block with no permission errors — and submits it as one reviewable
unit. (The atomic block-approval that lands it live is our Part D.)
