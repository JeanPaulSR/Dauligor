# Proposal-editor pattern

How an entity editor stays usable for both admins (direct write) and content-creators (propose for review) without forking into two codepaths.

> **When to read this doc:**
> - You're touching any editor under `src/pages/compendium/*` or `src/components/compendium/DevelopmentCompendiumManager.tsx` — anything that writes to a proposal-allowlisted table.
> - You're adding a new entity type to the proposal allowlist.
> - You hit a bug in the proposal flow and need to understand which layer owns what.

> **Companion docs:**
> - [docs/features/content-proposals.md](../features/content-proposals.md) — feature status, phase history, server-side schema.
> - [docs/architecture/compendium-editor-patterns.md](compendium-editor-patterns.md) — the four CRUD shapes editors use (this doc is about an orthogonal layer on top of those).

---

## The two-mode contract

Every wired editor renders for **both** routes:

| Route | Wrapper | Writer behavior |
|---|---|---|
| `/compendium/<thing>/manage` (admin direct) | none | `upsertDocument` fires immediately |
| `/proposals/edit/<thing>` (content-creator) | [`<ProposalEditorWrapper>`](../../src/components/proposals/ProposalEditorWrapper.tsx) | `writer.create/update/remove` queues locally; `Submit Changes` flushes to `pending_revisions` |

The editor doesn't branch on route. It branches on the **writer mode** that [`useProposalAccumulator`](../../src/lib/proposalAccumulator.ts) returns:

```ts
const writer = useProposalAccumulator('spell', userProfile);
const isProposalMode = writer.mode === 'proposal' || writer.mode === 'block';
```

Outside the wrapper, `writer` is the unmodified [`useEntityWriter`](../../src/lib/proposalAware.ts) — `direct` mode, fires immediately. Inside, it returns a queueing proxy.

---

## State layers

Three layers of state stack on top of the live D1 row. Each layer can hold a different version of "the current entity":

```
queue                — in-memory, current session, in <ProposalEditorWrapper> useState
  ↓ Submit Changes
drafts               — server-side pending_revisions rows with status='draft', per active block
  ↓ user submits block
pending revisions    — pending_revisions rows with status='pending', admin queue
  ↓ admin approves
live D1 row          — the actual table (spells, classes, tags, etc.)
```

Editors that want to show the user's work-in-progress need to OVERLAY all three layers onto the live row when rendering lists or forms. That's what [`getDraftedEntities`](../../src/lib/proposalAccumulator.ts) does.

### `getDraftedEntities(entityType, ctx, drafts, activeBundleId)` contract

Returns:

```ts
{
  byId: Map<string, payload>   // overlay: live row + drafted updates + queued updates
  createdIds: Set<string>      // ids created in this block (no live row yet)
  deletedIds: Set<string>      // ids the user has queued/drafted for deletion
}
```

Layered merge: drafts first (older), queue last (newer wins). Same-id collisions: UPDATE merges payload; DELETE wipes the entry from `byId` AND adds to `deletedIds`; CREATE replaces outright.

### The entity_id-null fallback

**Critical.** CREATE drafts have `entity_id: null` server-side (the proposal endpoint forcibly nulls it — no live row to point at yet). The actual client-minted UUID lives in `proposed_payload.id`. Any code that matches drafts must fall back to that:

```ts
const effectiveId =
  d.entity_id ??
  (d.proposed_payload && typeof d.proposed_payload.id === 'string'
    ? d.proposed_payload.id
    : null);
```

Three callsites all have this fallback (skipping any one will silently break the flow):

| File | Function | Symptom if missing |
|---|---|---|
| [proposalAccumulator.ts](../../src/lib/proposalAccumulator.ts) | `getDraftedEntities` | Freshly-submitted CREATE drafts vanish from editor lists |
| [proposalAccumulator.ts](../../src/lib/proposalAccumulator.ts) | `postQueuedChanges` (DELETE-of-CREATE-draft path AND UPDATE-patch path) | `Submit Changes` 404s with "Cannot propose delete/update on missing $entity" + queue gets stuck |
| [ProposalEditorWrapper.tsx](../../src/components/proposals/ProposalEditorWrapper.tsx) | `dropEntity` | Tombstone Undo doesn't clear server-side CREATE drafts |

---

## Catalog editors (multi-row): the display-merge pattern

Spells, Feats, Items, Tags, Tag Groups, Spell Lists. Each renders a list view that needs to show:
- Live rows from D1
- Plus drafted updates overlaid
- Plus drafted creates appended
- Plus tombstones for drafted deletes (red strikethrough + Undo)

The pattern (see [`SpellsEditor.tsx`](../../src/pages/compendium/SpellsEditor.tsx) ~700–740 for canonical example):

```ts
// Use the hook — collapses the useBlock + useMemo(getDraftedEntities) dance.
const draftedEntities = useProposalEntityDrafts('spell');

const displayEntries = useMemo(() => {
  if (draftedEntities.byId.size === 0 && draftedEntities.deletedIds.size === 0) {
    return entries;
  }
  const merged = entries.map((e) => {
    if (draftedEntities.deletedIds.has(String(e.id))) {
      return { ...e, __pendingDelete: true };
    }
    const overlay = draftedEntities.byId.get(String(e.id));
    return overlay ? { ...e, ...denormalize(overlay) } : e;
  });
  for (const [draftId, payload] of draftedEntities.byId.entries()) {
    if (merged.some((e) => String(e.id) === draftId)) continue;
    merged.push({ ...denormalize(payload), id: draftId });
  }
  return merged;
}, [entries, draftedEntities]);
```

Notes:
- `denormalize` is editor-specific: `mapSpellRow` for SpellsEditor (rebuilds filter-facet buckets), `denormalizeCompendiumData` for Feats/Items, `normalizeTagRow` for tags.
- **The `id` must stay stable through the merge.** For tags, the queued UPDATE payload doesn't carry `id` (only the changed columns); pass `{ ...payload, id: t.id }` to the normalize call, or the spread will clobber the id with empty string and the dedup check will append a phantom row. See [`TagsExplorer.tsx` displayedAllTags](../../src/pages/compendium/TagsExplorer.tsx) for the defensive form.

The row renderer then switches on `__pendingDelete` to render [`<TombstoneRow>`](../../src/components/proposals/TombstoneRow.tsx) instead of the normal row, with an Undo that calls `proposalContext.dropEntity(id)`.

### Catalog filter / unlock support hooks

| Hook | Purpose |
|---|---|
| [`useDraftedEntityIds(type)`](../../src/hooks/useDraftedEntityIds.ts) | Returns the union `Set<string>` of ids the user has touched (CREATE/UPDATE/DELETE) on `type` in the active block. Drives the My-Drafts filter, the row-list "queued" highlight, and the unlock gate (the user's own work is always editable). |
| [`useEditBaseUnlocks({...})`](../../src/hooks/useEditBaseUnlocks.ts) | The "Edit Base [Name]" unlock state for catalog editors with `enableFocusMode`. Returns `{unlockedBaseIds, unlock, isReadOnly}`. Unlocking flips focus mode to `'drafts'` so the just-unlocked entity surfaces in My Drafts. |
| [`useProposalPreFlushSave({...})`](../../src/hooks/useProposalPreFlushSave.ts) | Registers `handleSave` as a pre-flush callback on the wrapper. Catalog editors pass a `shouldRun` closure that reads `editingIdRef.current` + a dirty check against `lastLoadedFormRef`. Single-work editors gate on `effectiveId`. |

---

## Single-work editors: the `pendingCreateId` convention

ClassEditor, SubclassEditor, UniqueOptionGroupEditor. One entity per page. Route is `/proposals/edit/<thing>/new` or `/proposals/edit/<thing>/edit/:id`.

**Problem:** after a CREATE in proposal mode, you can't navigate to `/edit/<newId>` like the admin flow does — the route change unmounts the wrapper and destroys the in-memory queue, the user's work disappears.

**Solution:** stay on `/new` after Create, but track the locally-minted id in component state so subsequent saves UPDATE the same entry instead of minting a new CREATE every click. Use [`useProposalSingleWorkId(id)`](../../src/hooks/useProposalSingleWorkId.ts):

```ts
const { effectiveId, pendingCreateId, recordCreate } = useProposalSingleWorkId(id);

// In handleSave (via applyProposalWrite — see "Save helpers" below):
if (isProposalMode) {
  const isCreate = !effectiveId;
  const saveId = effectiveId || crypto.randomUUID();
  await applyProposalWrite(writer, payload, { id: saveId, isCreate, silent: opts.silent });
  if (isCreate) recordCreate(saveId);
}

// Skip the post-create navigate in proposal mode:
if (!id && !opts.silent && !isProposalMode) {
  navigate(`${basePath}/edit/${saveId}`);
}
```

Three places use `effectiveId` instead of `id`:
1. The CREATE-vs-UPDATE branch in `handleSave`
2. The "Save X" / "Create X" button render (`effectiveId ? 'Save' : 'Create'`)
3. The form header label (`effectiveId ? \`Edit ${name}\` : 'New X'`)

The hook resets `pendingCreateId` on route param change, so navigating from `/new` to `/edit/<id>` (or between two `/edit` pages) clears the prior session's state automatically.

When the editor loads with a route param `:id`, it should consult `getDraftedEntities(t).byId.get(id)` BEFORE `fetchDocument` — the live row may not exist yet if the user just created it and the draft hasn't been approved. See [`ClassEditor.tsx`](../../src/pages/compendium/ClassEditor.tsx) ~735 for the canonical load-effect.

---

## Visual chrome that diverges in proposal mode

The wrapper renders its own "PROPOSAL EDITOR | <entity>" header strip with the active block name + Submit Changes button. Editors must NOT also render a duplicate page-title chrome in proposal mode.

Use [`<ProposalAwareEditorHeader>`](../../src/components/proposals/ProposalAwareEditorHeader.tsx) to render the slim/h1 conditional header. The component locks the proposal-mode container className in one place — every editor needs the exact same `flex items-center justify-between gap-2 pb-2 border-b border-gold/10` and drift between them was a real source of bugs.

```tsx
<ProposalAwareEditorHeader
  isProposalMode={isProposalMode}
  backHref={isProposalRoute ? '/my-proposals' : '/compendium/<thing>'}
  proposalTitle={effectiveId ? (name || 'Untitled X') : 'New X'}
  adminContent={
    <h1 className="h1-title text-ink">
      {effectiveId ? `Edit ${name || 'X'}` : 'New X'}
    </h1>
  }
>
  {/* right-side action buttons (Save / Create / Delete / BakeNow / ...) */}
</ProposalAwareEditorHeader>
```

Editors with a richer slim-title (subclass's "for Wizard" pill) pass `proposalTitleNode` instead of `proposalTitle`. Editors with a non-`section-header` admin container (Subclass's two-column layout, DCM's vertical title+description+notice stack) pass `adminContainerClassName`. Right-side action buttons go in `children` — the wrapper component doesn't constrain the layout there.

Applied to: ClassEditor, SubclassEditor, UniqueOptionGroupEditor, DevelopmentCompendiumManager. TagsExplorer suppresses its page-header entirely in proposal mode (it has no useful Back button — the wrapper's strip is the page title).

---

## Body-class CSS overrides

Two body classes interact with `<main>`'s padding:

| Class | Set by | What it does |
|---|---|---|
| `proposal-editor-active` | `<ProposalEditorWrapper>` mount effect | Strips `<main>`'s `padding-top` so the wrapper strip sits flush against the navbar |
| `spell-list-fullscreen` | SpellsEditor / SpellRulesEditor / SpellListManager / SpellList mount effects | Strips `<main>`'s entire padding + max-width + locks `body { overflow: hidden }`. Used by editors that need full viewport for their grid. |

Rules live in [src/index.css](../../src/index.css). The wrapper strip itself uses `-mx-4 px-4` to bleed past `<main>`'s padding — when fullscreen strips that padding, the bleed instead spills LEFT over the sidebar. A targeted override under `body.spell-list-fullscreen .proposal-editor-strip` zeroes the negative margin to keep the strip contained.

If you add a new full-bleed editor, add `spell-list-fullscreen` to its mount effect AND verify the proposal strip still aligns with `<main>` (the existing CSS rule handles it; just confirm).

---

## Shared visual components

| Component | File | Purpose |
|---|---|---|
| `<ProposalEditorWrapper>` | [src/components/proposals/ProposalEditorWrapper.tsx](../../src/components/proposals/ProposalEditorWrapper.tsx) | Hosts the queue + provides accumulator context. Renders the header strip + Submit Changes. |
| `<TombstoneRow>` | [src/components/proposals/TombstoneRow.tsx](../../src/components/proposals/TombstoneRow.tsx) | Red strikethrough row decorator + Undo button for catalog editors |
| `<DeletedEntityBanner>` | same file | Full banner variant for single-work editors above the disabled form |
| `<ReviewBanner>` | [src/components/proposals/ReviewBanner.tsx](../../src/components/proposals/ReviewBanner.tsx) | Header shown when the URL has `?review=<id>`, with operation badge + rejection reason |
| `<ReviewFieldHighlight>` | [src/lib/proposalReview.tsx](../../src/lib/proposalReview.tsx) | Wrap a form field to apply a gold "Changed" badge when its column key is in `reviewMode.changedFields` |
| `<PickOrCreateBlockDialog>` | [src/components/proposals/PickOrCreateBlockDialog.tsx](../../src/components/proposals/PickOrCreateBlockDialog.tsx) | Block picker when the user tries to write with no active block |
| `<SubclassPickerDialog>` | [src/components/proposals/SubclassPickerDialog.tsx](../../src/components/proposals/SubclassPickerDialog.tsx) | Two-step class-then-subclass pick flow for the proposal launcher |
| `<DropEntityButton>` / `<DropFieldIcon>` | [src/components/proposals/](../../src/components/proposals/) | Drop Edits affordances (Phase 4.3) |

---

## Review mode (`?review=<proposalId>`)

Read-only replay of a past submission, mounted at the App level via [`<ProposalReviewProvider>`](../../src/lib/proposalReview.tsx). Editors consume it via `useProposalReview()`.

When the URL carries `?review=<id>`:
- The hook fetches the proposal and exposes `{ status, entityType, entityId, operation, proposedPayload, snapshotAtProposal, changedFields, isReadOnly, ... }`
- Editors call `resolveReviewPayload(reviewMode, entityType, entityId)` to get the snake_case D1 row shape they should hydrate from (instead of the live row)
- The wrapper renders `<ReviewBanner>` and wraps `children` in `<fieldset disabled>` unless the proposal is rejected (rejected stays editable so the user can fix + resubmit)
- Each editor's load effect short-circuits to `reviewMode.proposedPayload` when `isReviewingThis*` is true

Field-level change highlighting: wrap any field in `<ReviewFieldHighlight columnKey="X">` and it gets a gold accent + "Changed" badge when `reviewMode.changedFields.has('X')`. Apply liberally to the most-edited columns; the wrapper is a no-op outside review mode.

---

## Queue dedup at submit time

[`postQueuedChanges`](../../src/lib/proposalAccumulator.ts) collapses queue entries before POSTing to avoid no-op revisions and to make sure deletes don't 404 on missing rows.

Queue-internal (one block, one session):
- CREATE + UPDATE on the same id → one CREATE with merged payload
- UPDATE + UPDATE → one UPDATE with merged payload
- CREATE + DELETE → both dropped (the entity never existed live; deleting is a no-op)
- UPDATE + DELETE → DELETE wins, UPDATE dropped
- DELETE + CREATE/UPDATE → later write replaces the DELETE

Queue-vs-server-drafts (next):
- Queue CREATE/UPDATE matching an existing CREATE/UPDATE draft → PATCH the draft's `proposed_payload`
- Queue DELETE matching an existing CREATE draft → DELETE the draft (`DELETE /api/proposals/:id`), skip POSTing a new revision
- Queue DELETE matching an existing UPDATE draft → DELETE the draft AND POST a fresh DELETE revision

All matching uses the entity_id-null fallback. See [Critical: the entity_id-null fallback](#the-entity_id-null-fallback) above.

---

## Checklist: wiring a new entity type into proposal mode

When the proposal allowlist gains a new entity_type, do the following:

1. **Server side (already shipped — verify):**
   - Add the entity_type to the allowlist in `api/_lib/proposals.ts`
   - Add a per-entity config (writable columns, JSON columns, snapshot loader)
2. **Add the launcher entry** in [`src/pages/core/MyProposals.tsx`](../../src/pages/core/MyProposals.tsx) `CREATE_ENTRIES` and/or `EDIT_ENTRIES`. Use `picker: 'subclass-create'`-style hook if the entry needs a pre-pick dialog.
3. **Wire the editor:**
   - Import `useProposalAccumulator`, `useProposalContextOptional`, `useProposalEntityDrafts`, plus the relevant single-work or catalog hooks (see below).
   - Branch `handleSave` on `isProposalMode` and call `applyProposalWrite(writer, payload, { id: saveId, isCreate, silent })` to queue + emit the mode-aware toast in one go.
   - **Single-work:** use `useProposalSingleWorkId(id)` for `effectiveId` + `pendingCreateId` + `recordCreate`. Use `useProposalPreFlushSave({ enabled: isProposalMode, proposalContext, handleSave, shouldRun: () => !!effectiveId })`. Use `useTombstoneBanner(type, id)` for the deletion banner. Render `<DeletedEntityBanner>` when its `isPendingDelete` flag is set, wrap form in `<fieldset disabled={isPendingDelete}>`. Skip the post-create navigate in proposal mode.
   - **Catalog:** use `useDraftedEntityIds(type)` for the drafts id-set, `useEditBaseUnlocks({...})` for the unlock state + `isReadOnly`, and `useProposalPreFlushSave({...})` with a closure that reads `editingIdRef.current` + dirty-checks against `lastLoadedFormRef`. Tag deleted rows with `__pendingDelete: true` in `displayEntries`, render `<TombstoneRow>` for those.
   - **Header:** use `<ProposalAwareEditorHeader>` for the slim/h1 conditional render (see [Visual chrome](#visual-chrome-that-diverges-in-proposal-mode)).
   - **Cascade dependent (optional):** use `useCascadeDependent(type, id)` + `<CascadeDependentBanner>` + an entity-type-specific replacement picker (e.g. `<TagReplacementPicker>` with `arrayColumn='tag_ids'` for class/subclass, `'tags'` for spells/feats/items).
4. **Wire review mode:**
   - Call `useProposalReview()` + `resolveReviewPayload(reviewMode, '<type>', id)`.
   - Short-circuit the load effect to `reviewPayload` when matched.
   - Wrap the most-edited fields in `<ReviewFieldHighlight columnKey="X">`.
5. **Add the route** in [`src/App.tsx`](../../src/App.tsx) under `<ProposalEditorWrapper entityType="<type>">`. Add `enableFocusMode` for multi-work editors with a large catalog (Spells/Feats/Items pattern).
6. **Slim the editor's own header in proposal mode** — see [Visual chrome](#visual-chrome-that-diverges-in-proposal-mode) above.
7. **Hide the admin create button on the public route** if the editor is reachable from `/compendium/<thing>` for non-admins. Gate it like `canManage = isAdmin || (isContentCreator && isProposalRoute)`.

---

## Open work

Cascade Phases 2/3/4 + the tombstone-gap fix shipped in `62dfd60` / `3bdda92`. Strategy registry currently handles `tag` + `tag_group` + `unique_option_group` + `class` parents — see [`api/_lib/cascadeStrategies.ts`](../../api/_lib/cascadeStrategies.ts) to add more.

Out-of-scope items tracked at the feature level (not in this contract):

- **Self-serve world creation** + per-block world selection.
- **Per-world content gating** — owner picks allowed base content.
- **System page type** with referenceable modular components (audit + design).

Future cascade strategies to consider when those entity types start producing meaningful proposal traffic:
- `subclass`-as-parent (deleting a subclass — features cascade via FK, no proposal-side work needed today; if features become proposable, enroll them).
- `class_spell_list` cleanup on `class` parent — D1's FK handles it on approval, so no proposal revision is needed unless we want to surface the count in cascade-preview.
