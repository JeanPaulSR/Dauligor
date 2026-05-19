# Handoff — Content Proposals Phase 4 (parallel proposal-editor routes)

> **Status:** Phase 4 foundation (entity-type allowlist + per-entity
> configs) is in. The editor wiring approach has been **redesigned**
> since the previous handoff — the in-place wiring plan
> (`useEntityWriter` baked into each editor with mode-aware dispatch)
> is **superseded** by a parallel-route design.
> Branch `claude/loving-banach-d76c40`.
>
> Resume by building the proposal-editor wrapper + a dedicated
> route prefix `/proposals/edit/*` that wraps the existing editor
> components in proposal mode. Content-creators only ever see the
> proposal routes; the admin `/compendium/*` routes stay
> direct-write and are unreachable to creators.

## What changed since the previous handoff

The previous handoff (in-place wiring) ran into a UX problem the
moment Submission Blocks shipped (Phase 2e): every Save in a wired
editor fires a network call, so building up a 50-spell block means
clicking Save 50 times and the user has no way to "freely edit, then
submit at the end." Worse, the same UI behaves three different ways
depending on role and block state (direct write / proposal /
block-draft), which is hard for the user to reason about.

The redesign (May 2026):

- **Two parallel route prefixes.**
  - `/compendium/*/manage` — admin-only, direct-write, existing
    Save / auto-update UX **stays exactly as it is today**.
  - `/proposals/edit/*` — content-creator or admin (admin opts in).
    Wraps the same editor components with a `mode='proposal'` flag
    that swaps Save for **Submit Changes**, accumulates edits
    locally, and exposes **Drop Edits** affordances.
- **Content-creators have zero access to the admin routes.** Hidden
  from sidebar, route-guarded, hit-the-URL-directly returns the
  standard blocked-page treatment (same as any other gated route).
- **Submit Changes only fires when the user clicks it.** No
  per-field autosave, no auto-update on toggle. Edits accumulate
  in local component state until Submit Changes drains them as
  draft revisions into the active block.
- **Shared base editors — the existing pages are not rewritten.**
  The proposal route wraps the existing editor (`SpellsEditor`,
  `TagsExplorer`, etc.) with a higher-order wrapper. Future
  updates to the base editor propagate automatically — the
  wrapper only adds Submit Changes + Drop Edits.

## Architecture in one screen

```
/compendium/<thing>/manage              /proposals/edit/<thing>
────────────────────────────            ─────────────────────────────
ADMIN ONLY                              CONTENT-CREATOR or ADMIN
direct write                            always feeds a block
────────────────────────────            ─────────────────────────────
<XEditor mode="direct">                 <ProposalEditorWrapper
  Save button                             entityType="x">
  auto-update on toggle / blur            <XEditor mode="proposal" />
                                         </ProposalEditorWrapper>

                                          - Submit Changes button
                                            (replaces Save + auto-update)
                                          - Drop Edits at:
                                            * entity
                                            * section / tab
                                            * field
                                          - No-block-active prompt
                                            ("pick or create" dialog)
```

Both routes render the **same base editor component**. The `mode`
prop flips behavior in a small number of touch points (Save button
visible vs. hidden, fire-immediately vs. delegate-to-wrapper).

## Start here when resuming

The dependency order is the build order. Pick up at 4.1; don't
skip ahead — the wrapper needs the bundles endpoint, the editors
need the wrapper.

1. **4.1 first.** Without `proposal_bundles` (name + description),
   the "pick or create" prompt has no schema to attach to.
2. **4.2 next.** Build the wrapper + accumulator skeleton with an
   empty placeholder editor inside; verify the Submit Changes
   drain works against a hand-crafted child.
3. **4.5a — TagsExplorer — as the POC.** Highest mutation rate
   today (toggle fires per click); the biggest UX delta when
   converted to accumulate-and-submit. If the wrapper survives
   this editor, it survives the rest.

## Phase 4 sequence (new)

### 4.1 · Block metadata + `proposal_bundles` table

- **Migration:** create `proposal_bundles(id PK, name TEXT NOT
  NULL, description TEXT, created_by_user_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT CHECK
  (status IN ('open', 'submitted', 'discarded')))`. The existing
  `bundle_id` column on `pending_revisions` becomes a soft FK
  (no DB-level constraint — keeps SQLite happy with the existing
  rows; enforce in code).
- **Endpoints** (extend [`functions/api/proposals/[[path]].ts`](../functions/api/proposals/%5B%5Bpath%5D%5D.ts)):
  - `POST /api/proposals/bundles` — create a new block with name +
    description. Returns the bundle id.
  - `GET /api/proposals/bundles?status=open` — list the user's open
    blocks (for the picker).
  - `PATCH /api/proposals/bundles/:id` — rename / re-describe.
  - The existing `submit` + `DELETE` (discard) endpoints flip
    status accordingly.
- **`proposalBlock.tsx` update** ([src/lib/proposalBlock.tsx](../src/lib/proposalBlock.tsx)):
  - `startBlock(name, description)` → POST to create the bundle
    server-side (replace the client-only UUID).
  - Expose `myOpenBlocks` list + `setActiveBlock(id)` so the picker
    can switch the active block.
  - Keep localStorage persistence (active id only).

### 4.2 · `<ProposalEditorWrapper>` + queued-writer plumbing

- **New component** `src/components/proposals/ProposalEditorWrapper.tsx`.
  - Provides a `ProposalContext` exposing:
    `queueChange`, `dropEntity`, `dropSection`, `dropField`,
    `dirtyEntities`, `flush`.
  - Renders the active block's name + description as a header.
  - Renders a **Submit Changes** button that drains the queue.
  - If the user has no active block when Submit Changes is clicked,
    opens **`PickOrCreateBlockDialog`** → on select, sets
    `activeBundleId`; on create, POSTs new bundle then sets it.
  - Warns on navigation if there are queued (unsubmitted) changes:
    "You have unsubmitted edits — leave anyway?" Standard
    `beforeunload` + react-router blocker pattern.
- **New hook** `src/lib/proposalAccumulator.ts`:
  - `useProposalAccumulator(entityType)` — returns a wrapped writer
    whose `create` / `update` / `remove` queue locally when inside
    a `<ProposalEditorWrapper>`. Submit Changes flushes the queue
    as one POST per queued change (with `is_draft: true` +
    `bundle_id`).
  - When **not** under the wrapper (admin direct route), the hook
    passes through to the underlying `useEntityWriter` unchanged
    — admin Save still fires immediately.
- **New dialog** `src/components/proposals/PickOrCreateBlockDialog.tsx`.
  - Lists `myOpenBlocks` with name + description + draft count.
  - "+ Create new block" form (name required, description optional).
  - Opened by the wrapper when Submit Changes is clicked with no
    active block.

### 4.3 · Drop Edits affordances

All three granularities ship from day one:

- **Entity-level.** Top-of-editor "Drop edits to this <thing>"
  button. Removes the entity's draft revision from the block;
  clears any local queued changes for this entity. Confirmation:
  "Discard your changes to <name>? This removes them from the
  block."
- **Section-level.** "Drop section edits" button at the top of
  each section / tab inside the editor. Reverts that section's
  fields to the pre-edit state in local state and drops the
  corresponding keys from any already-staged draft (server-side
  PATCH on the draft).
- **Field-level.** Small undo icon next to each modified field.
  Reverts that one field; same draft cleanup.

The wrapper tracks which fields / sections / entities are dirty
so the affordances can show / hide appropriately.

### 4.4 · Route guards + sidebar wiring

- **New routes** under `/proposals/edit/*` in
  [`src/App.tsx`](../src/App.tsx). Guard: signed-in AND (admin OR
  has `content-creator` permission).
- **Content-creator route guard on `/compendium/*/manage`.**
  Treat as a blocked page (standard treatment used elsewhere for
  admin-only routes — there's no special redirect to the proposal
  equivalent; creators reach the proposal route via the sidebar
  and `/my-proposals` launchers).
- **Sidebar** ([src/components/Sidebar.tsx](../src/components/Sidebar.tsx)):
  - Admin: existing Compendium section unchanged + new
    **Proposals** section listing the `/proposals/edit/*` links.
  - Content-creator: only the **Proposals** section. Compendium
    section entirely hidden.

### 4.5 · Editor wiring (order: smallest UX delta last)

Each editor gets:

1. A `mode: 'direct' | 'proposal'` prop on the base component.
2. In `mode='proposal'`: Save button hidden, auto-update writes
   delegated to the accumulator hook, Drop Edits surface points
   exposed to the wrapper.
3. A route entry at `/proposals/edit/<thing>` wrapping the editor
   in `<ProposalEditorWrapper>`.

Order (progressively more complex):

- **4.5a · [TagsExplorer](../src/pages/compendium/TagsExplorer.tsx)** —
  POC. Today every toggle fires a write. In proposal mode toggles
  update local state; Submit Changes drains. Biggest UX delta;
  best stress test of the wrapper.
- **4.5b · [SpellRulesEditor](../src/pages/compendium/SpellRulesEditor.tsx)** —
  single-page editor with mostly a Save button today. Add Drop
  Edits surface for individual rules.
- **4.5c · [SpellListManager](../src/pages/compendium/SpellListManager.tsx)** —
  list of class spell lists; site of the original block-mode 403
  bug. Apply Changes button goes from "fires immediately" to
  "queues."
- **4.5d · [SpellsEditor](../src/pages/compendium/SpellsEditor.tsx)** —
  first heavy editor. Single-spell form, JSON columns. The base
  editor mostly already Save-batches per-spell, so the work is
  largely route + wrapper + Drop Edits.
- **4.5e · [UniqueOptionGroupEditor](../src/pages/compendium/UniqueOptionGroupEditor.tsx)** —
  group + items: two entity types feed one editor. The accumulator
  must handle multi-entity submits per Submit Changes.
- **4.5f · [ClassEditor](../src/pages/compendium/ClassEditor.tsx)** —
  heaviest. 13 JSON columns, tabbed sub-editors. Subclasses /
  features / activities are still **not** in the allowlist —
  document the gap in the class editor's Drop Edits header
  ("Some sections can't be proposed yet — see admin").

### 4.6 · Block menu rolled-up view

Today, the Block tab on `/my-proposals` lists one row per draft.
New design: roll up by `entity_type` to one row per editor that
contributed.

```
Block: "Spring spell taxonomy pass"
"Re-tagging fire-school spells for the new energy-type schema."
─────────────────────────────────
Tags (4 changes)             [Withdraw] [Continue Editing]
Spell Rules (1 change)       [Withdraw] [Continue Editing]
Spells (47 changes)          [Withdraw] [Continue Editing]
─────────────────────────────────
[ Submit Block ]    [ Discard Block ]    [ Rename / Describe ]
```

- **Withdraw** drops every draft of that entity_type in the block
  (server: bulk DELETE filtered by `bundle_id` + `entity_type`).
- **Continue Editing** navigates to `/proposals/edit/<thing>` with
  a query param to filter the editor to only the staged entities
  (e.g. `?staged=true` opens the spells list filtered to the 47
  drafts).
- **Drill-down (optional, can ship later).** Click a row to expand
  a per-entity list with per-entity withdraw.

## Contract the base editor exposes to the wrapper

Each base editor in `mode='proposal'`:

1. Calls `useProposalAccumulator(entityType)` instead of (or as a
   wrapper around) `useEntityWriter`.
2. Surfaces section identifiers — each tab / collapsible block has
   a stable id the wrapper can target for section-level Drop Edits.
   The simplest pattern: each section reads `{ dropSection }` from
   `ProposalContext` and renders its own "Drop section edits"
   button keyed to its id.
3. Surfaces field identifiers — every dirty field renders its own
   undo icon (component lives in the wrapper / context).
4. Hides its Save button and skips its own debounced-write logic.

What the wrapper provides:

- `queueChange(entityId, patch)` — buffer for the eventual POST.
- `dropEntity(entityId)`, `dropSection(entityId, sectionId)`,
  `dropField(entityId, fieldName)` — clear queued + draft state.
- `dirtyEntities`, `dirtySections`, `dirtyFields` — for "show
  the undo icon" / "show the section drop button" checks.
- `submitChanges()` — the button handler.

## Don't-forget gotchas

- **Don't break existing wired editors.** TagsExplorer /
  SpellRulesEditor / SpellListManager are wired to
  [`useEntityWriter`](../src/lib/proposalAware.ts) today
  (Phase 2c) — that wiring stays. The accumulator wraps the same
  writer; in admin direct mode the accumulator passes through
  unchanged. We're adding a layer, not replacing one.
- **`isProposalMode` is already `proposal || block`** (commit
  `d6a485f`). The accumulator must respect this: in either mode,
  the underlying writer routes to `/api/proposals` — the
  accumulator just controls **when** that POST fires.
- **Server-side draft writes haven't gone away.** Submit Changes
  in the wrapper fires one POST per queued change with
  `is_draft: true` + `bundle_id`. The Submit Block step
  (`POST /api/proposals/bundle/<id>/submit`) flips drafts to
  pending. We're moving **when** the POSTs fire, not whether.
- **Don't preserve dual save paths in the base editors.** Per the
  no-back-compat guidance in CLAUDE memory, when an editor gains a
  `mode` prop, the proposal branch should fully replace the Save /
  auto-update path in that mode — no dual writes, no fallback to
  direct on failure.
- **`SubclassEditor` + features / activities / items / feats** are
  still not in the allowlist. Class editor Drop Edits should not
  show section-level affordances for those areas (or should
  disable them with a tooltip).
- **Navigation guard.** Local queued changes are lost on navigate.
  Wrapper installs a `beforeunload` + react-router block when the
  queue is non-empty: "You have unsubmitted edits — leave anyway?"

## Test plan after each editor lands

1. Admin on `/compendium/<thing>/manage`: Save fires immediately,
   direct write, no block involvement. Unchanged behavior.
2. Content-creator opening the admin route directly via URL: hits
   the blocked-page treatment.
3. Content-creator on `/proposals/edit/<thing>` with no active
   block: edits accumulate (no network), Submit Changes opens
   the PickOrCreateBlockDialog. Creating a block sets it active
   and drains the queue into the new bundle.
4. Content-creator on `/proposals/edit/<thing>` with an open
   block: edits accumulate, Submit Changes drains into the active
   block, block menu shows the rolled-up row.
5. Drop Edits at all three levels (entity / section / field): each
   reverts local state and drops the corresponding draft fields
   server-side.
6. Approve → live row matches the payload. Revert → drift refuses
   as expected.

## Files most likely to need touching

```
worker/migrations/<new>_proposal_bundles.sql                    (4.1)
api/_lib/proposals.ts                                            (4.1)
functions/api/proposals/[[path]].ts                              (4.1)
src/lib/proposalBlock.tsx                                        (4.1)
src/components/proposals/ProposalEditorWrapper.tsx               (4.2 — new)
src/components/proposals/PickOrCreateBlockDialog.tsx             (4.2 — new)
src/lib/proposalAccumulator.ts                                   (4.2 — new)
src/App.tsx                                                      (4.4)
src/components/Sidebar.tsx                                       (4.4)
src/pages/compendium/TagsExplorer.tsx                            (4.5a)
src/pages/compendium/SpellRulesEditor.tsx                        (4.5b)
src/pages/compendium/SpellListManager.tsx                        (4.5c)
src/pages/compendium/SpellsEditor.tsx                            (4.5d)
src/pages/compendium/UniqueOptionGroupEditor.tsx                 (4.5e)
src/pages/compendium/ClassEditor.tsx                             (4.5f)
src/pages/core/MyProposals.tsx                                   (4.6)
docs/features/content-proposals.md                               (after each sub-phase)
```

## Out of scope (track separately)

- Subclasses / features / activities / items / feats joining the
  allowlist. Each is its own design pass.
- "Approve bundle in one click" admin action. Today, approve fires
  per-row; bundles can be inspected via `bundle_id` but there's
  no bulk-approve UI.
- Admin-side proposal-edit affordance on `/proposals/edit/*` —
  this handoff focuses on creator UX. Admin self-routing through
  the proposal flow (to coordinate their own batch) is supported
  but not surfaced in the sidebar; the admin opens the route
  manually if they want it.

## Commit boundaries

One sub-phase per commit so each diff stays reviewable. Suggested
template:

- `feat(content-proposals): Phase 4.1 — proposal_bundles table + endpoints`
- `feat(content-proposals): Phase 4.2 — ProposalEditorWrapper + accumulator`
- `feat(content-proposals): Phase 4.3 — Drop Edits affordances`
- `feat(content-proposals): Phase 4.4 — route guards + sidebar split`
- `feat(content-proposals): Phase 4.5a — TagsExplorer proposal route (POC)`
- `feat(content-proposals): Phase 4.5b — SpellRulesEditor proposal route`
- `…` etc.

## Don't forget

- Run `npx tsc --noEmit` after each sub-phase to catch type drift.
  Baseline is **13 pre-existing errors** (asChild + characterShared);
  anything beyond that is a regression.
- Update [docs/features/content-proposals.md](features/content-proposals.md)
  status block when each sub-phase lands. Pattern: copy the
  Phase 2c-1 / 2c-2 / 2c-3 entries.
