# Handoff — `compendium-editors` Part B/C implementation state (2026-05-29)

> Resume context after a compaction. Read this first, then
> [manifest.md](manifest.md), the
> [proposal-cross-reference-audit](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html)
> (the authoritative ref/layer spec), and the proposal-system reply
> [2026-05-28-proposal-system-reply.md](2026-05-28-proposal-system-reply.md).

## TL;DR — where we are

Two arcs on this branch: (1) a **documentation reference set** for the compendium editors
(`docs/architecture/compendium-editors/**`, mostly done, on `main`), and (2) **implementing
proposal-mode support** for nested compendium entities so a content-creator can build a whole
class in one proposal "block." Arc 2 is the active work.

**Done:** the **scaling_column** slice of Part B (all write sites route through the proposal
accumulator) + the **ScalingMatrixEditor widget** refactor (resolved the route-boundary).
**Type-clean.** Committed to the branch (not yet on main — code stays branch-local per the
doc-sync convention).

**Next (in order):** (a) **L1 overlay for scaling_column**, (b) the **feature slice** of Part B,
(c) the **rest of Part C** (overlays for the other entity types), (d) **write the proposal-system
note** (the user explicitly asked for this — still pending).

## Branch / worktree mechanics (important)

- Branch **`compendium-editors`** is checked out in worktree
  `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d` — the folder name
  is a leftover label, NOT a mismatch. (Earlier the branch lived in its own worktree; it was
  consolidated into this one.)
- **Bash CWD resets to this worktree after every call.** Use `git -C "<worktree path>"` for git, or
  `cd "<path>" && …` chains. The preview MCP reads config from the *main repo's* `.claude/launch.json`
  but executes from this worktree (verified: the dev server serves this branch's files).
- Rebased onto `origin/main` (`8750f65`), which has **Part A** (proposal-system's): `scaling_column`
  + `feature` are proposable types, `useProposalDraftOptions` hook exists, migrations for the
  entity_type CHECK. So everything Part B/C needs is in the tree.
- **Branch commits above main:** `8d92e69` (local docs static-server launch config — branch-only,
  never push to main) → `ce3a1d6` (Part B scaling_column) → `149d0db` (ScalingMatrixEditor widget).
- **On main already** (pushed via cherry-pick earlier): the docs reference set + audit + open
  request (`ca8ed31`), plus proposal-system's Part A + reply.
- **Doc-sync convention:** doc/handoff commits get pushed to `main` (cherry-pick onto `origin/main`,
  keeping the launch.json + code commits branch-local); code commits stay on the branch until ready.

## The collaboration (Parts A–D)

Building "propose a whole class in a block" with `proposal-system`. A block = wrapper-scoped queue;
`submitNow` flushes to the active block; ids are client-minted UUIDs preserved through approval
(so a ref authored against a draft id resolves once both go live together).

- **proposal-system owns:** Part A (DONE, on main — `scaling_column` + `feature` proposable +
  `useProposalDraftOptions`) and **Part D** (block-atomic `env.DB.batch()` approve + guard #1
  reference-integrity walk + drift check + block-level reject + edit-lock) — their branch, runs in
  parallel, does NOT gate our work.
- **We own:** **Part B** (route nested-entity saves through `useProposalAccumulator` so
  content-creators queue instead of 403) + **Part C** (draft overlays so block-draft entities are
  selectable in cross-reference pickers).
- **Full-scope decisions** (their reply): (1) **features IN** — proposable; (2) **full coverage** —
  guard #1 walks every draftable ref, overlays at all four layers; (3) `scaling_column`
  `parent_type` = **all six owners** (`class|subclass|feat|race|background|item`).

## The four picker-injection layers (Part C model — from the audit)

A cross-reference picker's options are assembled in one of four places; a draft overlay
(`useProposalDraftOptions(type)` → `{id,name,__draft:true}[]`) must be merged at each:

- **L1 — `AdvancementManager`**: reads `availableScalingColumns` / `availableOptionGroups` /
  `availableOptionItems` / `availableFeats` / `availableFeatures` as **props from the parent**
  (ClassEditor/SubclassEditor/FeatsEditor/ItemsEditor fetch them via `fetchCollection`). Overlay =
  merge drafts into those arrays **at the parent** before passing down. AdvancementManager itself
  needs no change. Uses `SingleSelectSearch`/inline `<select>`, NOT `EntityPicker`.
- **L2 — `RequirementsEditor`**: reads a `lookups` prop (classes/subclasses/features/spells/
  spellRules/optionGroups/proficiencies) from the parent (FeatsEditor / UniqueOptionGroupEditor).
  Overlay = merge drafts into `lookups` at the parent. Uses `SingleSelectSearch`, NOT `EntityPicker`.
- **L3 — `SpellAdvancementEditors`** (GrantSpells/ExtendSpellList): **self-fetches** its own
  spells/rules/classes via `useSpellAdvancementFoundation()`. Overlay = add
  `useProposalDraftOptions` calls **inside** that component (for `spell`, `spell_rule`, `class`).
- **L4 — direct `EntityPicker` sites** (UniqueOptionGroupEditor class-restriction picker;
  SubclassEditor class picker): add a `draftEntries` prop to `EntityPicker` and merge at the call
  site. (Only layer the original handoff's Part C plan addressed.)

> The machinery already half-exists: every catalog editor imports
> `useProposalEntityDrafts(<own-type>)` for its OWN list. Part C points the same idea at the
> cross-reference pickers (other types).

## DONE — Part B scaling_column + the widget

Commits `ce3a1d6` + `149d0db`. **`tsc --noEmit` clean** — the only 7 errors are pre-existing
baseline (6× the `Button asChild` typing issue in CompendiumBrowserShell/CampaignEditor/SpellList/
LoreEditor; 1× `characterShared.ts:520` arg count). None in touched files.

- **`src/components/compendium/ScalingColumnsPanel.tsx`** — B1: owns
  `useProposalAccumulator('scaling_column', userProfile)`; writes auto-route (queue in block, direct
  for admins). Rename commits **on blur** (was per-keystroke → would flood the block queue) via a
  local `nameDrafts` buffer (also fixed a latent "input didn't reflect typing" bug). `queueRebake`
  skipped in block (`useProposalContextOptional()` check). Mode-aware delete toast. **Mounts the
  matrix widget in a `<Dialog>`** — Add / Edit / Open-Full-Matrix open the modal (no navigation).
- **`src/components/compendium/ScalingMatrixEditor.tsx`** (NEW) — the level-by-level matrix editor
  as a **prop-driven widget** (`columnId`/`parentId`/`parentType`/`userProfile`/`onSaved`/
  `onDeleted`). Extracted from the old route page. Proposal-aware. Mounting it in-place (in the
  panel, inside the parent's wrapper) is what **resolves the route-boundary** — a content-creator's
  save now queues into the active block instead of escaping to a standalone proposal.
- **`src/pages/compendium/scaling/ScalingEditor.tsx`** — now a **thin wrapper** around the widget
  (back-compat for the `/compendium/scaling/*` routes + direct links).
- **`src/components/compendium/ScalingColumnsPanel.tsx`** is also mounted by **FeatsEditor**,
  **ItemsEditor**, **ClassEditor** (all now pass `userProfile`), and **SubclassEditor** (its old
  inline scaling block was replaced with the shared panel; orphaned `getScalingBreakpoints` +
  `handleDeleteScaling` removed).
- `scalingImport.ts` (admin bulk import) intentionally left direct.

## LEFT — the remaining work

1. ~~**L1 overlay for scaling_column**~~ **DONE (2026-05-29).** All four parent editors
   (ClassEditor/SubclassEditor/FeatsEditor/ItemsEditor) now call
   `useProposalDraftOptions('scaling_column')` once at top level, bake an `(in this block)` suffix
   into the draft names, and spread the result into the picker arrays only — never the save payload
   (ClassEditor `classColumns:` ~`1452`) or the `ScalingColumnsPanel` list (~`4335`). ClassEditor uses
   a single `scalingColumnPickerOptions` const for its 2 `AdvancementManager` mounts + 2 inline
   `<select>`s; the others spread `scalingColumnDraftOptions` at their mount sites (FeatsEditor keeps
   the `scalingAllowed` gate; SubclassEditor appends after its own `(Subclass)`/`(Class)` suffixed
   arrays). Type-clean (7-error baseline unchanged). The baked-name affordance shows uniformly in
   native `<select>`s and shadcn dropdowns with zero `AdvancementManager` edits. **Remaining polish
   (deferred):** empty-dropdown empty-state ("don't render an empty dropdown as if broken") + a
   parent-scoping refinement (a draft column from a *different* draft owner in the same block surfaces
   unscoped, since `DraftOption` carries no `parent_id`; harmless in the one-entity-per-block common
   case).
2. **Feature slice (Part B feature)** — the headline "propose a class with Wild Shape" win. Features
   are authored INLINE in ClassEditor's feature modal (`handleSaveFeature` ~`1071-1161`, the
   `upsertFeature` calls ~`1140`/`1147`; `handleDeleteFeature` ~`1163`) and in SubclassEditor — all
   currently DIRECT `upsertFeature`/`deleteFeature`. Route through
   `useProposalAccumulator('feature', userProfile)` (`.create`/`.update`/`.remove`); skip
   `queueRebake('feature', …)` in block. Features are inside the parent's wrapper already → no
   route-boundary. NOTE: a feature is an interior node (its own activities/effects/advancements +
   `unique_option_groups.feature_id` back-link), so its advancement refs also feed L1/L3.
3. **Rest of Part C** — overlays for `unique_option_group`, `unique_option_item`, `class`,
   `subclass`, `spell`, `spell_rule`, `feat`, `feature` at the appropriate layers (see the layer
   table). Mechanically the same as scaling_column's L1, plus L2 (RequirementsEditor lookups), L3
   (SpellAdvancementEditors), L4 (`EntityPicker.draftEntries`).
4. **Write the proposal-system note** (USER ASKED — still pending): a dated handoff to
   `proposal-system` covering **Finding 1** (below) + "Finding 2 resolved on our side via the
   widget; please confirm your approval path handles in-block scaling-column creation." Put it in
   this folder + add an Open-request entry; push the doc to main.

## Findings for proposal-system

- **Finding 1 — `scaling_column` writableColumns gap (THEIR file, `api/_lib/proposals.ts` — do NOT
  edit).** `ENTITY_CONFIGS.scaling_column.writableColumns` = `{id,name,parent_id,parent_type,values}`
  but the table also has `type`/`identifier`/`distance_units` (migration `20260508-1158`). So a
  *proposed* column loses them on approval (type → defaults to `'number'`). One-line fix on their
  side: add those three to the set. We route the full payload anyway (forward-compatible). Flagged in
  a code comment in `ScalingMatrixEditor.tsx`.
- **Finding 2 — route-boundary: RESOLVED on our side** via the widget-ization (Option D). The matrix
  editor is now a modal inside the parent wrapper, so in-block saves queue correctly. proposal-system
  just needs to confirm their approval path handles an in-block `scaling_column` create (it should —
  it's a normal queued proposal now).

## Known issue — proposal-mode child-section unlock requires reload (DEFERRED, user-flagged 2026-05-29)

User spot-check finding: in the **normal (admin-direct)** editor, saving a class flips the editor into
"edit-existing" mode, which **auto-unlocks child sections** — the Class Features panel and the Class
Columns / `ScalingColumnsPanel` are gated on a truthy class `id` (e.g. `{id ? <ScalingColumnsPanel …/>
: null}` at ClassEditor ~`4321`), and the direct save sets/navigates that id. In **proposal-block**
mode the class CREATE is *queued* (client-minted id, no live row, editor state doesn't flip), so those
child sections stay locked and the user must **manually reload** the page to author features / columns
on the just-proposed class. "Who knows what else is auto-unlocked" — there may be other gated affordances.

Why it matters: this is a **soft prerequisite for the feature slice** — you can't add Wild Shape to a
proposed Druid if the Features panel is locked until reload. Likely fix: after a block-queue create,
flip the editor into edit-mode using the client-minted id (don't gate child sections on a *live* row;
gate on "id exists" which is true the moment the draft is queued). This is OUR editor-state concern
(Part B wiring), not proposal-system's. Tracked as a task. Deferred per user ("a note that we should
handle later").

## Spot-check findings (2026-05-29) — list/panel draft-overlay gaps + toast-wording trap

User spot-checked in a **block** (confirmed: the new feat appeared in its list via the wrapper-gated
`useProposalEntityDrafts('feat')` overlay — that only returns rows in a block). Three findings:

- **Toast-wording trap (correct a prior misread).** `useProposalAccumulator` returns **`mode:'proposal'`
  INSIDE a wrapper** (proposalAccumulator.ts ~214), so `actionLabel` shows **"…submitted for review"**
  even when queuing into a block. "added to block" (`mode==='block'`) comes only from `useEntityWriter`
  OUTSIDE the accumulator — a different path. So the toast does **not** distinguish block-queue from
  standalone; don't use it as the signal. The reliable in-block signal is `useProposalContextOptional()
  !== null` / the `/proposals/edit/*` route / the wrapper's Submit-Changes UI. (Recorded because it
  misled diagnosis once.)
- **List/panel overlays missing for own-type block-draft CREATEs (task #17).** Lists/panels that render
  only the live DB fetch hide just-queued drafts. Confirmed: (1) `ScalingColumnsPanel` list
  (`columns={scalingColumns}`) omits block-draft columns (they DO show in the advancement picker via L1);
  (2) the **option-group list** lacks the `useProposalEntityDrafts('unique_option_group')` overlay that
  FeatsEditor has (`draftedFeatEntities` ~603) → a queued new group is invisible and can't be reopened to
  add options. Fix = apply the feat-style list overlay to the option-group list + the scaling panel.
- **Block-entry gate (user directive, for the proposal-system note).** The real standalone hazard is
  reaching an editor via the non-proposal route as a content-creator (→ true `mode='proposal'` standalone,
  no block). User: *"set it so that you need to create a block before being able to enter into the proposal
  editors."* That's a routing/UX gate over `ProposalEditorWrapper` + `PickOrCreateBlockDialog` (proposal-
  system infra). Fold into the proposal-system note.

> User decision: these are a **later phase** — "continue in order instead." Next implementation slice is the
> **feature slice** (features + subclass saves), per the user's Issue-3 confirmation.

## Decisions / principles to honor

- **Nested entities are authored inside the parent editor's proposal wrapper (modal/inline), never a
  separate route.** This is the root fix for the route-boundary class of bug; the scaling widget
  embodies it. Apply the same when touching other nested-entity editors.
- The scaling matrix editor was promoted to a widget now; further polish lands in **roadmap step 3**
  (shared-widget cleanup). See [project_compendium_editor_roadmap memory].
- New editors/endpoints use **camelCase**; new compendium tables join `PERSISTENT_TABLES` in
  `src/lib/d1.ts` (earlier A1/A3 decisions).
- File-ownership protocol: `api/_lib/proposals.ts`, `functions/api/admin/proposals/*`,
  `worker/migrations/*` belong to `proposal-system` (Part D). `src/lib/d1.ts` hash hook +
  `src/lib/lore.ts`/`bbcode.ts` + `src/pages/wiki/**` belong to `system-applications`.

## Key APIs (so you don't re-derive)

- `useProposalAccumulator(entityType, userProfile)` (`src/lib/proposalAccumulator.ts`) → `WriterApi`
  `{ mode, create(payload), update(id,payload), remove(id) }`. Inside a `<ProposalEditorWrapper>` it
  queues (`mode==='proposal'`); outside it passes through to `useEntityWriter` (admin = direct
  upsert/delete; content-creator = standalone proposal; else readonly).
- `useProposalDraftOptions(entityType)` (`src/hooks/useProposalDraftOptions.ts`) → `{id,name,__draft:
  true}[]` of CREATE drafts in the **active block**; `[]` outside a wrapper. This is the overlay
  source for Part C.
- `useProposalContextOptional()` → null outside a wrapper (used for the `queueRebake`-skip check).
- `actionLabel(mode, pastTense)` (`src/lib/proposalAware.ts`) → mode-aware toast text.
- `ProposalEntityType` (`src/lib/proposalAware.ts`) includes `scaling_column` + `feature`.

## Verification

- Build-from-source + `npx tsc --noEmit` (run from worktree; `npm run lint` is the same). Baseline =
  7 pre-existing errors; anything beyond that in touched files is ours.
- User spot-checks the modal UI in the running app (admin-direct review).
- **Task #15 (proposal-mode e2e):** this worktree's local D1 is a copy of `system-applications`'
  local state and may LACK the `feature`/`scaling_column` `entity_type` CHECK migrations. Apply those
  to local D1 (`wrangler d1 execute dauligor-db --local --file=…`) before testing the content-creator
  block flow.

## Doc reference set (on main)

`docs/architecture/compendium-editors/`: `index.html`, `01-survey.html` (+ `01-survey-reference.html`),
`02-data-flow.html`, `03-tables.html`, `04-components.html` (framework + `components/
compendium-editor-shell.html`), `05-endpoints.html` (stub), `walkthroughs/` (empty),
`proposal-cross-reference-audit.html` (the authoritative reference/layer spec — read it for the full
entity-reference matrix + guard-#1 gap table). Served via `npx http-server docs/architecture/
compendium-editors -p 5500 -c-1`.

## Tasks (TaskList)

- #13 Part B — scaling_column DONE; **feature pending**.
- #14 Part C — overlays at all four layers (scaling_column L1 next, then the rest).
- #15 Verify proposal-mode cluster authoring (needs local-D1 migrations first).
- #5 reconcile `compendium-editor-patterns.md` vs code (drift items in the survey-reference).
- #6 HTML nav — survey/data-flow/tables done; 04-components partial, 05-endpoints stub, walkthroughs empty.

## Immediate next step

Do **L1 overlay for scaling_column** (quick, unblocked) OR the **feature slice** (headline) — the
user was choosing between continuing the scaling slice vs starting features. Then **write the
proposal-system note**. Confirm with the user which to start.
