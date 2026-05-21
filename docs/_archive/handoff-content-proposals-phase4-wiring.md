# Handoff — Content Proposals Phase 4 (parallel proposal-editor routes)

> **Status (updated 2026-05-19):** **Phase 4.1 through 4.5f are all
> shipped.** Every editor in the proposal allowlist has a
> `/proposals/edit/*` route and queues writes through the wrapper +
> accumulator. The block lifecycle (create / list / pick / submit /
> discard) is fully on the server with a unified BlockPanel that
> shows all open blocks; the New / Edit launchers gate behind a
> block picker so users always know which block their work goes
> into. Branch `claude/loving-banach-d76c40` (29 commits ahead of
> `origin/main`).
>
> **Shipped foundation (Phases 4.1–4.4):**
> - `ba1a334` Phase 4.1 — `proposal_bundles` table + name/description
>   endpoints + `<BlockMetadataDialog>` for create/rename.
> - `ae021d7` Phase 4.2 — `<ProposalEditorWrapper>`,
>   `useProposalAccumulator`, `<PickOrCreateBlockDialog>`.
> - `f30b30e` Phase 4.3 — `dropEntity` / `dropField` / `dropFields`
>   on the context + Drop UI primitives.
> - `cc5d673` Phase 4.4 — `<AdminOnly>` route guard,
>   `/proposals/edit/*` catch-all, sidebar split.
>
> **Editor wiring (Phase 4.5):**
> - `5482507` 4.5a — TagsExplorer (POC).
> - `cdd8daa` 4.5b+c — SpellRulesEditor + SpellListManager.
> - `ddff74a` / `4eebda6` / `57e4fab` / `5c1f4ff` / `39eb78f` /
>   `4c178c1` 4.5d — SpellsEditor + supporting infra (focus-mode
>   toggle, accumulator dedup-PATCH, focus-mode + Browse Base UI,
>   auto rule-recompute on approval).
> - `b71090f` 4.5e — UniqueOptionGroupEditor (hybrid group +
>   items).
> - `f5c2510` 4.5f — ClassEditor (single-work per-instance routes).
>
> **Post-Phase-4.5 UX polish:**
> - `ac9b8b1` Wrapper: unsaved-changes warning + pending-drafts
>   panel.
> - `4675204` Styled confirms, hidden bundle IDs, prefix-aware
>   Back links.
> - `1f1e286` Read-only lock mode-agnostic; cross-window block
>   resume (later superseded by the unified BlockPanel).
> - `e3951b7` SQLite UTC timestamps parsed correctly.
> - `37cb5c5` BlockPanel — unified list of all blocks; "Resume"
>   framing dropped.
> - `fb8613e` New / Edit launchers gate behind a block picker.
>
> **What's NOT done (deferred, not regressed):**
> - **Phase 4.6 — Block menu roll-up by entity_type.** The active
>   block's drafts still render as a flat list inside
>   `<ActiveBlockCard>`. The original design called for grouping by
>   entity_type with `[Withdraw] [Continue Editing]` per group; the
>   list-of-all-blocks rewrite shipped first and obviated some of
>   the need (each draft already shows its entity_type badge), but
>   the per-group withdraw + continue-editing affordances are still
>   a valid follow-up.
> - **Subclasses / features / activities / items / feats joining
>   the proposal allowlist.** Class editor's nested entity writes
>   stay admin-only inside the wrapped editor because those tables
>   aren't in ENTITY_CONFIGS. Each is its own design pass.
> - **"Approve bundle in one click" admin action.** Today admin
>   approve still fires per-row; the spell rule-recompute hook
>   fires after each approval. Bulk-approve is a Phase 5 ask.

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

### 4.5 · Editor wiring

The Phase-2c editors (Tags / Spell Rules / Spell Lists) are all
**shipped**. They use the established template:

1. Swap `useEntityWriter` → `useProposalAccumulator` (drop-in; passes
   through outside a wrapper, queues inside).
2. Add `/proposals/edit/<entity>` route in App.tsx wrapping the
   editor in `<ProposalEditorWrapper entityType="...">`.
3. Add a sidebar sub-item under the Proposals section.
4. Make any `navigate()` / cross-editor `<Link>` paths route-prefix
   aware (compute `basePath` / `editorPrefix` from `useLocation()`)
   so a content-creator clicking around inside `/proposals/edit/*`
   doesn't bounce into the AdminOnly-guarded admin route.

#### Shipped

- **4.5a · [TagsExplorer](../src/pages/compendium/TagsExplorer.tsx)** —
  shipped `5482507`. POC; this is the editor that gave the wrapper
  its first end-to-end test.
- **4.5b · [SpellRulesEditor](../src/pages/compendium/SpellRulesEditor.tsx)** —
  shipped `cdd8daa`. One-line writer swap (no `navigate()`, no
  cross-editor links to translate).
- **4.5c · [SpellListManager](../src/pages/compendium/SpellListManager.tsx)** —
  shipped `cdd8daa`. Writer swap plus prefix-aware
  `<Link to={`${editorPrefix}/spell-rules`}>` for the cross-editor
  "Manage Rules" link. The LinkedRulesPanel sub-component
  computes its own `editorPrefix` via `useLocation()` because
  it's defined at file scope.

#### Editor design pattern: multi-work vs single-work

Before wiring an editor, classify it. This drives both the URL
shape and how drafts are surfaced inside the editor.

- **Multi-work catalog editor** — one shared editor for all
  entities of a type. Examples: TagsExplorer (tags + tag_groups),
  SpellRulesEditor, SpellListManager, SpellsEditor, FeatsEditor,
  ItemsEditor. URL: `/proposals/edit/<plural>` with NO id segment.
  Create + edit happen in the same view. "Continue Editing" from
  the Block tab returns to this single URL; the editor's main list
  view merges live entries with the user's drafts. Drafts of type
  `create` appear as new entries; drafts of type `update` overlay
  the matching live row; drafts of type `delete` strike-through
  the live row.
- **Single-work entity editor** — one route per entity instance.
  Examples: ClassEditor (`/proposals/edit/classes/edit/:id`,
  `/proposals/edit/classes/new`), SubclassEditor. The entity *is*
  the editor's subject — each one gets its own page. Continue
  Editing from the Block tab routes to that specific entity's
  page, drafts overlay the form.

#### Focus mode + browse base (multi-work editors only)

Approved UX for high-volume multi-work editors (Spells, Feats,
Items, Option Items):

- **Default focus**: when the user lands on the editor, default to
  "My Drafts" — only entries that have queued changes or pending
  drafts in the active block. A creator making 2 new spells doesn't
  stare at 500 existing ones.
- **Toggle to Browse Base**: segmented control in the editor's
  header (`[ My Drafts | Browse Base ]`). Selecting Browse Base
  reveals live catalog entries **read-only**: all form fields
  disabled, no Save button, banner at the top of each entry —
  *"Base [entity] — viewing only. Click 'Edit Base [Name]' to
  propose changes."*
- **Edit Base [Name] button**: at the top of each base entry,
  alongside the banner. Click → that one entry flips to editable
  for the rest of the session; its form inputs wake up, the
  accumulator's `update` queues a draft on save. Other base entries
  stay read-only. The flipped entry stays flipped through Submit
  Changes (no manual re-lock).
- **High-volume vs low-volume**: high-volume editors load Browse
  Base on-demand (search → match → expand inline read-only).
  Low-volume (Tags, Spell Rules, Spell Lists today) can render the
  whole live catalog in the read-only mode when toggled — the
  catalog is small enough.

#### Remaining editor wiring (4.5d–f)

The three heavy editors are bigger lifts than 4.5a–c because they
don't use `useEntityWriter` today — they call `queryD1` /
`batchQueryD1` directly and gate writes on `isAdmin`. Each needs:

1. Loosen the gate: `const canManage = isAdmin || isContentCreator;`
   replacing `isAdmin`-only early returns. Keep multi-row paths
   (Backfill, Bulk Import, Rebuild) admin-only via `{isAdmin && ...}`.
2. Replace every direct write call with `useProposalAccumulator`'s
   `create` / `update` / `remove`. Payload keys must match the
   D1 column allowlist in `api/_lib/proposals.ts` (snake_case;
   `created_at` / `updated_at` are server-managed, don't include).
   **Do NOT pre-stringify JSON columns** — the writer's
   `sanitizePayload` stringifies them.
3. Add `/proposals/edit/<entity>` route in App.tsx (or
   `<entity>/edit/:id` + `<entity>/new` for single-work).
4. Add sidebar sub-item.
5. Audit cross-editor `<Link>` paths and `navigate()` calls — make
   them prefix-aware if any link to another editor.
6. Apply the right pattern from the design notes above (multi-work
   gets focus-mode toggle; single-work gets per-entity route).

Per-editor notes:

- **4.5d · [SpellsEditor](../src/pages/compendium/SpellsEditor.tsx)** —
  *multi-work*. ~1500 lines, single-spell form within a list view.
  Has multiple `isAdmin` gates (lines 238, 381, 490, 1016 at last
  grep). Doesn't use `upsertDocument` directly — writes go through
  internal helpers that ultimately hit `queryD1`. Find the save
  sites and route them through the writer. Skip Bulk Import /
  Backfill (admin-only). **Add focus-mode + Browse Base** per the
  design above — spells are a high-volume catalog, so Browse Base
  should be search-to-reveal.
- **4.5e · [UniqueOptionGroupEditor](../src/pages/compendium/UniqueOptionGroupEditor.tsx)** —
  *hybrid*. Each group (Maneuvers / Invocations / Infusions) is
  single-work — `/proposals/edit/option-groups/:groupId`. The
  items inside the group are multi-work + need focus-mode.
  Use TWO writers: `useProposalAccumulator('unique_option_group',
  userProfile)` for group saves and `useProposalAccumulator
  ('unique_option_item', userProfile)` for item saves. Each item
  save adds a separate queued change, so a single "save all items"
  click can end up with 10+ queued revisions — watch the
  50-revision-per-POST limit in `postQueuedChanges`.
- **4.5f · [ClassEditor](../src/pages/compendium/ClassEditor.tsx)** —
  *single-work*. ~1900 lines, 13 JSON columns. Routes:
  `/proposals/edit/classes/new` and `/proposals/edit/classes/edit/:id`.
  Drafts overlay the form, no list-merging needed. Subclasses,
  features, activities, items, feats remain **off** the proposal
  allowlist — the ENTITY_CONFIGS in `api/_lib/proposals.ts` accepts
  `class` but not those nested entities. Class-editor Drop Edits
  should suppress section affordances for tabs that mutate those
  tables (or disable with a tooltip). Multi-row paths (advancement
  generators, etc.) stay admin-only.

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
