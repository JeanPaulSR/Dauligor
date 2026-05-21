# Proposal-editor stress test — 2026-05-21

Manual walkthrough of the proposal-mode flows after commit `6945895`.
Driven through DOM eval in the preview browser (`/proposals/edit/*`).

Legend: ✅ pass · ⚠️ pass with caveat · ❌ fail / regression / bug found

## Findings

### ✅ #1 — Start new block while another is active
Click "Start a new block" → name + desc dialog → Create. New block becomes
active; previous block stays in `openBlocks`. (Tested at `/my-proposals`,
Block tab.)

### ✅ #2 — New tag in existing group highlights both tag + group
Clicked into "Class Type" group, typed "Stress Test Tag X", submitted form.
Tag appears in tree with `[title*="staged in this block"]` (2 highlighted
rows = the tag + its parent group, per the parent-of-modified-tag fix in
`draftedGroupIds`).

### ✅ #3 — In-memory queue tracking via wrapper header
Proposal strip showed `1 queued` badge + `Submit 1 Change` button after
queueing the create. Strip text:
> Proposal editor · Tags · 1 queued · Block: Stress Test Block A — … · Submit 1 Change

### ✅ #4 — Submit Changes drains queue, entities stay visible
**Critical regression check:** After Submit:
- Queue badge gone, button reverts to "Submit Changes"
- `Block · 0` → `Block · 1` (server-side draft created)
- Tag still visible in tree with highlight preserved
- The `proposed_payload.id` fallback in `getDraftedEntities` and
  `draftedTagIds` works as designed — freshly-submitted CREATE drafts
  (entity_id=null on server) still surface in editor lists

### ✅ #5 — Tag rename produces a single row (no phantom duplicate)
**Critical regression check:** Clicked Rename on the submitted-as-CREATE-
draft tag, changed name to "Stress Test Tag X — Renamed", pressed Enter.
After rename: `occurrencesOfOldName: 0`, `occurrencesOfNewName: 1`. The
`id`-pin fix in `displayedAllTags`'s normalizeTagRow call holds.

### ✅ #6 — Queue dedup: UPDATE on existing CREATE draft patches via PATCH
**Critical regression check:** After the rename in #5, clicked Submit
Changes again. `Block · 1` stayed at 1 (would be 2 if the UPDATE had POSTed
a separate revision instead of PATCHing the existing draft). The
`postQueuedChanges` queue-vs-drafts merge path works.

### ⚠️ #7 — Tombstone doesn't render when deleting an in-block CREATE-draft tag
**Bug found.** Sequence:
1. User CREATE-drafts tag X (submitted, server-side draft exists with
   entity_id=null + proposed_payload.id=X)
2. User deletes tag X via the tree's Delete button
3. Expected: row stays visible as a red `TombstoneRow` with Undo
4. Observed: row vanishes; `tombstoneRowCount: 0`, `undoButtonCount: 0`

**Root cause** in `src/lib/proposalAccumulator.ts::getDraftedEntities`: a
queue DELETE removes the entry from `byId` (line ~196 `byId.delete(...)`).
After that, `displayedAllTags`:
- `allTags` doesn't contain X (no live row yet)
- The for-loop iterating `byId.entries()` skips X (just removed)
- The `deletedIds.has(t.id)` branch in the map only fires for entries
  in `allTags` — so it never tags X with `__pendingDelete`

Submit-time queue dedup still does the right thing (queue DELETE + draft
CREATE → drop the draft via `DELETE /api/proposals/:id`), but the
mid-edit UX has no handle for Undo.

**Proposed fix:** in `getDraftedEntities`, keep the payload accessible
even after a delete (capture draft snapshots in a separate Map, or
change `deletedIds: Set` to `deleted: Map<id, sourcePayload | null>`).
Then `displayedAllTags`/equivalent in other editors can render the
tombstone row from that snapshot. Estimated impact: ~10 lines in
`proposalAccumulator.ts` + 5-line follow-up to the 4 `displayed*`
merges. Files: `proposalAccumulator.ts`, `TagsExplorer.tsx`,
`SpellsEditor.tsx`, `FeatsEditor.tsx`, `DevelopmentCompendiumManager.tsx`.

### ❌ #8 (FIXED during the walkthrough) — Submit on DELETE-of-CREATE-draft 404s and the queue gets stuck
Hit while testing #7. The queue had `[UPDATE, DELETE]` on a tag whose
server-side draft was a CREATE (entity_id=null + payload.id=X). After
queue-internal dedup the entry was a single DELETE. The cross-boundary
dedup `postQueuedChanges` then looked for an existing draft via
`d.entity_id === q.entity_id` — but the CREATE draft's `entity_id` is
null server-side, so the match failed, the DELETE got POSTed instead,
the server 404'd with "Cannot propose delete on missing tag $X", and
the queue couldn't drain (toast.error in handleSubmit → no resetQueue
→ queueCount stays at 2 across reloads / navigation).

**Same root cause as the earlier draft-visibility bug** (commit 6945895
introduced the `proposed_payload.id` fallback in `getDraftedEntities`
and `dropEntity` but missed the parallel lookup in `postQueuedChanges`).

**Fixed inline:** updated the two `existingDrafts.find(...)` callsites
in `postQueuedChanges` (one for the DELETE path, one for the
UPDATE-patch-CREATE path) to fall back to `proposed_payload.id` when
the server-side `entity_id` is null. Re-tested: queue drained cleanly,
`Block · 1` → `Block · 0`, tag correctly removed.

### ✅ #9 (verifies #8 fix) — DELETE-of-CREATE-draft submits cleanly
After the fix above, clicking Submit on a queued DELETE of a CREATE-
draft entity now:
- Issues `DELETE /api/proposals/:draftId` to drop the draft
- Skips POSTing a new DELETE revision (would have 404'd)
- Toast confirms success
- Local queue drains
- `Block · N` decrements appropriately

### ✅ #10 — Single-work CREATE in proposal mode: pendingCreateId + button gating
Navigated to `/proposals/edit/classes/new`. Filled name + source. Clicked
Create Class. Observed:
- URL stayed at `/new` (correctly does NOT navigate to `/edit/<id>`)
- Form data preserved
- "1 queued" badge in strip
- Both Create AND Save buttons hidden (wrapper's Submit Changes covers
  via pre-flush from this point)

The `pendingCreateId` state + `effectiveId = id ?? pendingCreateId`
button gate works as designed.

### ✅ #11 — Single-work post-Create UPDATE pathway
After #10, edited the name to "Stress Class Foo (edited)" and clicked
Submit Changes (no separate save). The wrapper pre-flush captured the
edit, queue-internal dedup merged the implicit UPDATE into the CREATE,
one revision posted, `Block · 0` → `Block · 1`, name preserved with the
edit, URL still at `/new`. Full CREATE-then-edit-then-submit flow clean.

## Coverage summary

11 scenarios run, 10 pass + 1 bug found and fixed inline.

**Covered by these scenarios** (skipped explicitly because they share
the same machinery):
- Multi-block lifecycle (#1)
- Catalog list merge of queued+drafted entries (#2, #4)
- Wrapper queue tracking (#3)
- Vanishing-entries regression (#4)
- Phantom-row regression on rename (#5)
- Queue-vs-drafts PATCH dedup on UPDATE (#6)
- Tombstone gap for CREATE-draft delete (#7 — known follow-up)
- Cross-boundary CREATE-draft DELETE 404 (#8 — fixed in `f9d17b6`)
- Submit flow with the fix applied (#9)
- Single-work pendingCreateId pattern (#10, #11)

**Recommended manual spot-check before any deploy:**
- Discard block → drafts gone, openBlocks shrinks
- Review mode `?review=<id>` opens read-only for at least one of each
  entity type
- Reject + resubmit flow (admin side) — that path wasn't touched but
  worth a sanity check after the queue dedup changes
- The cascade Phase 2 work (when shipped) will need its own pass

## Bugs caught + filed

- **#7** (tombstone gap on CREATE-draft delete): not fixed in this
  session — proposed fix is to expose a snapshot Map from
  `getDraftedEntities` so deletions can render with the original
  payload. Should pair naturally with Phase 1 follow-up (task #23).
- **#8 → fixed** (cross-boundary dedup misses CREATE drafts):
  committed as `f9d17b6`.
