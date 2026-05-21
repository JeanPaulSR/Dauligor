# Handoff — Content Proposals: Cascade System + Phase 1-3 UX Sweep

> **Status (2026-05-21):** Proposal-mode editor system is **functionally
> complete end-to-end** + the full DRY audit has been actioned. Branch
> `claude/loving-banach-d76c40` is 7 commits ahead of `origin/main` on
> top of the pre-existing Phase 4.5f work (see
> `docs/handoff-content-proposals-phase4-wiring.md` for the foundation
> that preceded this).
>
> **Rollback safety tag**: `pre-dry-pass-2026-05-21` (commit `6945895`).
> Restore with `git reset --hard pre-dry-pass-2026-05-21`.
>
> **Canonical doc** for the live contract:
> [`docs/architecture/proposal-editor-pattern.md`](architecture/proposal-editor-pattern.md).
> Read that first if you're touching any editor that writes to a
> proposal-allowlisted table.

---

## What shipped this session

Seven commits chained on top of `c030662` (the Phase 1 ClassEditor
review wiring):

| Commit | What |
|---|---|
| **`6945895`** *(tagged `pre-dry-pass-2026-05-21`)* | The wrap-up sweep: review mode Phases 2-3 across all editors, in-list queued-entity merge, slim header chrome in proposal mode, queue-internal dedup, single-work `pendingCreateId`, SubclassPickerDialog launcher entries, EditBase auto-focus-mode flip, In Block / Full Catalog labels with empty-state teaching copy. 1500+ net lines. |
| **`f9d17b6`** | Cross-boundary dedup fix — `postQueuedChanges` matches CREATE drafts via `proposed_payload.id` (server stores `entity_id: null` for those). Catches a "queue stuck at N queued" hang found in the stress test. |
| **`464832e`** | Architecture doc + components README + comment uplift on the foundation files (`proposalAccumulator.ts`, `ProposalEditorWrapper.tsx`, `proposalReview.tsx`). |
| **`3bdda92`** | DRY audit picks #1 (`useProposalEntityDrafts`) + #10 (`useTombstoneBanner`); tombstone-gap data fix (`deletedSources` map); Phase 1 follow-up tombstone rows in catalog editors + DeletedEntityBanner in remaining single-work editors. |
| **`62dfd60`** | Cascade dependency system — Phases 2/3/4. Server-side strategy registry + `/api/proposals/cascade-preview` endpoint + two-phase POST flow + admin approval cascade + admin-side `+N cascade deps` badges. Tag strategy is the canonical proof; other strategies are slot-additive. |
| **`74f9d84`** | Five DRY hooks (#2 `useDraftedEntityIds`, #3 `useProposalPreFlushSave`, #4 `useProposalSingleWorkId`, #6 `useEditBaseUnlocks`, #7 `applyProposalWrite`) + `<ProposalAwareEditorHeader>` (#5) + cascade banner wired in ClassEditor/SubclassEditor (#31) + DialogContentLarge sweep on AdminProposals' drift/conflict/detail dialogs + Class/Subclass option-group dialogs. Net delta: ~250 lines removed across 7 editor files; locks DRY contracts in shared layers. |
| **`2a8fe1c`** | Cascade strategy expansion — `tag_group` (recursive: deletes tags + runs tag-cascade per tag), `unique_option_group` (cascade-delete items), `class` (cascade-delete subclasses). Slot-additive on the existing registry. |

---

## Subsystem map

| Concept | File | What it owns |
|---|---|---|
| Queue + drafts merge | `src/lib/proposalAccumulator.ts` | `getDraftedEntities`, queue-internal dedup, queue↔drafts dedup, two-phase cascade POST, `useProposalAccumulator` writer hook |
| Block lifecycle | `src/lib/proposalBlock.tsx` | `useBlock()` — active block, drafts (now including `cascade_parent_revision_id`), submit/discard/refresh |
| Wrapper | `src/components/proposals/ProposalEditorWrapper.tsx` | Hosts queue, mounts `body.proposal-editor-active`, renders sticky strip + Submit Changes, pre-flush registry, Drop Edits affordances |
| Review mode | `src/lib/proposalReview.tsx` | `ProposalReviewProvider`, `useProposalReview`, `resolveReviewPayload`, `<ReviewFieldHighlight>` |
| Tombstone UX | `src/components/proposals/TombstoneRow.tsx` | `<TombstoneRow>` (catalog row) + `<DeletedEntityBanner>` (single-work) |
| Tombstone hook | `src/hooks/useTombstoneBanner.ts` | `useTombstoneBanner(type, id)` — `{isPendingDelete, undoDelete}` |
| Drafted-entities hook | `src/hooks/useProposalEntityDrafts.ts` | Collapses the `useBlock + useMemo(getDraftedEntities)` boilerplate to one call |
| Cascade detection (server) | `api/_lib/cascadeStrategies.ts` | Strategy registry; `detectCascadeDependents(type, id)` |
| Cascade preview endpoint | `functions/api/proposals/[[path]].ts` `handleCascadePreview` | POST `/api/proposals/cascade-preview` |
| Cascade dependent UI | `src/components/proposals/CascadeDependentBanner.tsx` | Amber alert + Accept/Replace |
| Cascade dependent hook | `src/hooks/useCascadeDependent.ts` | Accept (`__cascade_resolved` marker) + Replace (rewrite array column) |
| Tag replacement picker | `src/components/proposals/TagReplacementPicker.tsx` | Same-group default + cross-group escape hatch |
| Admin approval cascade | `functions/api/admin/proposals/[[path]].ts` `handleApprove` | Children apply first (UPDATEs strip refs, then DELETEs), parent last |

---

## Three gotchas that almost broke things — DO NOT regress

### 1. The entity_id-null fallback

CREATE drafts have `entity_id: NULL` server-side (the proposal endpoint
forcibly nulls it — there's no live row to point at yet). The actual
client-minted UUID lives in `proposed_payload.id`.

**Three callsites all need the fallback:**

- `getDraftedEntities` (`proposalAccumulator.ts`)
- `postQueuedChanges` — **two** `existingDrafts.find(...)` lookups (one for DELETE-of-CREATE-draft, one for UPDATE-patch)
- `dropEntity` (`ProposalEditorWrapper.tsx`)

Plus the `draftedTagIds`-style id-set scans in `TagsExplorer` and the
catalog editors. Skipping the fallback silently breaks the flow with
"queue stuck at N queued" + 404s on the next submit.

### 2. CREATE-draft + queue DELETE collapses correctly

When the user CREATE-drafts an entity and then DELETEs it in the same
block, the queue dedup in `postQueuedChanges` does:

- Queue-internal: CREATE+DELETE → nothing (drop both)
- Queue-vs-draft: queue DELETE finds existing CREATE draft → `DELETE /api/proposals/:draftId` to drop the draft, skip POSTing a new DELETE

Both paths use the entity_id-null fallback. If either is broken, the
submit 404s.

`deletedSources` Map in `getDraftedEntities` captures the prior payload
before the queue DELETE wipes it from `byId`, so the tombstone row
shows the entity's name even when the entity was never live.

### 3. The `-mx-4 px-4` strip bleed needs zeroing under fullscreen

`<ProposalEditorWrapper>`'s sticky header uses `-mx-4 px-4` to bleed
its background over `<main>`'s `px-4` padding. The full-bleed editors
(SpellsEditor / SpellRulesEditor / SpellListManager) set
`body.spell-list-fullscreen` which strips `<main>`'s padding entirely;
the bleed then spills LEFT over the sidebar.

The CSS override under `body.spell-list-fullscreen .proposal-editor-strip`
in `src/index.css` zeroes the negative margin. Don't remove that rule.

---

## Single-work editor convention: `pendingCreateId`

Class / Subclass / UniqueOptionGroupEditor stay on `/new` after a
CREATE in proposal mode. Navigating to `/edit/<id>` remounts the
wrapper and destroys the in-memory queue.

```ts
const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);
const effectiveId = id ?? pendingCreateId;
```

Three places use `effectiveId` instead of `id`:
1. The CREATE-vs-UPDATE branch in `handleSave`
2. The "Save X" / "Create X" button render
3. The form-header label

The pre-flush registration's dep array also needs `pendingCreateId`
or post-Create edits stop being re-staged at Submit time.

---

## Pending work

The entire DRY audit + the in-scope cascade strategies + the dialog
sweep are now shipped. All "highly recommended next" items from the
previous version of this doc have landed. What's left is feature-level
design work that needs user input on scope before implementation:

| Task | Effort |
|---|---|
| **#24** Self-serve world creation + per-block world selection | M |
| **#25** Per-world content gating (owner picks allowed base content) | M-L |
| **#26** System pages with referenceable modular components (audit + design) | L |

Future cascade strategies to consider when those entity types start
producing meaningful proposal traffic:
- `subclass`-as-parent (deleting a subclass — features cascade via FK,
  no proposal-side work needed today; if features become proposable,
  enroll them).
- `class_spell_list` cleanup on `class` parent — D1's FK handles it on
  approval, so no proposal revision is needed unless we want to
  surface the count in cascade-preview.

The working drafts under `docs/_drafts/` have been fully actioned and
deleted:
- `dry-audit-2026-05-21.md` — all 7 picks shipped (#1+#10 in `3bdda92`,
  #2-#7 in `74f9d84`).
- `stress-test-2026-05-21.md` — both bugs fixed (`f9d17b6` + `3bdda92`).

---

## What NOT to redo

A future session that doesn't read this file might recreate the
following — flag if you see anyone trying to:

- **Re-introduce `getDraftedEntities + useMemo + useBlock` boilerplate in any editor.** Use `useProposalEntityDrafts(entityType)`.
- **Re-introduce `useState<Set<string>>(new Set()) + useMemo` for staged-id rollups.** Use `useDraftedEntityIds(entityType)`. The hand-rolled scans miss CREATE drafts (whose `entity_id` is null server-side); the hook applies the fallback transparently.
- **Re-introduce `[pendingCreateId, setPendingCreateId] = useState` + `effectiveId = id ?? pendingCreateId`.** Use `useProposalSingleWorkId(id)` — `recordCreate(saveId)` replaces `setPendingCreateId(saveId)`.
- **Re-introduce `useRef(handleSave) + useEffect + registerPreFlush` ceremony.** Use `useProposalPreFlushSave({...})`.
- **Re-introduce the inline `if (isCreate) writer.create else writer.update + toast.success(actionLabel(...))` block.** Use `applyProposalWrite(writer, payload, { id, isCreate, silent })`.
- **Re-introduce the inline conditional `<div className={isProposalMode ? slim : section-header}>` header.** Use `<ProposalAwareEditorHeader>`.
- **Re-introduce inline `unlockedBaseIds` + `setFocusMode('drafts')` + isReadOnly derivation.** Use `useEditBaseUnlocks({...})`.
- **Wire a tombstone banner inline in a single-work editor.** Use `useTombstoneBanner(entityType, id)`.
- **Re-add the 50-revision cap to `postQueuedChanges`.** Cascade bundles use `is_cascade: true` + a 1000-revision ceiling. The `cap = isCascade ? 1000 : 50;` switch in the server handler depends on this flag.
- **"Fix" the `-mx-4` bleed by removing the negative margin globally.** That margin IS the bleed effect — only needs to be neutralized under `body.spell-list-fullscreen` (already done in CSS).
- **Refactor `editingId` references to `id` in ClassEditor/SubclassEditor/UniqueOptionGroupEditor.** They use `effectiveId` deliberately — see the convention section above.
- **Remove the entity_id-null fallback from any draft lookup.** See "Three gotchas" above. The fallback is in 4 places and removing any one of them breaks the flow with subtle symptoms (queues stuck, drafts disappearing, tombstones missing, etc).

---

## How to verify state

```bash
# What's the rollback point?
git tag -l "pre-*" -n

# What's been committed since?
git log --oneline pre-dry-pass-2026-05-21..HEAD

# Type-check (should be clean):
npx tsc --noEmit -p .

# Run the dev servers:
# (.claude/launch.json defines two entries)
#   Express + Vite (dev)       on port 3000
#   Cloudflare Worker (wrangler dev) on port 8787
# Both must be up — the worker hosts /api/* and authenticates via Firebase tokens.
```

The architecture doc, components README, and updated module-header
comments are all linked from `docs/architecture/proposal-editor-pattern.md`
and `src/components/proposals/README.md`. A fresh agent landing on
this codebase should read those two first, this handoff doc second,
and `docs/features/content-proposals.md` only for feature-status
history (it doesn't cover the live editor contract).
