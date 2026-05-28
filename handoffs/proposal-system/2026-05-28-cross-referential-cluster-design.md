# Design — Proposing cross-referential class clusters

> **Status:** AGREED (2026-05-28) — design decisions locked, see
> [Decisions](#decisions). Owner: `proposal-system`. Implementation of the
> **editor-side** parts is handed to `compendium-editors`; the
> **proposal-plumbing** parts stay on `proposal-system`. See
> [Work split](#work-split).
>
> **Companion docs:** [proposal-editor-pattern.md](../../docs/architecture/proposal-editor-pattern.md)
> (the live editor contract), [content-proposals.md](../../docs/features/content-proposals.md)
> (feature status/history).

---

## The report

A content-creator building classes in a Submission Block hit two walls:

1. **Cross-references can't see block drafts.** A scaling column / unique
   option group / class created as a draft in the block does not appear in
   any other editor's picker. Examples: a created column can't be selected
   in the class's advancements; a unique option group isn't findable in the
   class; a class isn't selectable in the option group's "used by" picker.
2. **No permission to save nested entities in a block.** Saving scaling
   columns (and other nested entities) inside the class/subclass editor
   fails with a permission error.

---

## Root cause

Both symptoms are the same underlying gap: **the proposal system models
independent, top-level, whole-row entities, but a class is a
cross-referential cluster.** It was built for "one spell, one tag" — not
for "a class plus its columns plus its option groups plus its subclasses,
all referencing each other."

### Bug #2 — nested writes bypass the accumulator → 403

The accumulator (`useProposalAccumulator`) only intercepts writes for the
**one entity type its wrapper is bound to** (`<ProposalEditorWrapper
entityType="class">`). Nested entities created *inside* the editor are
persisted with **direct `upsertDocument()` calls** that never reach the
accumulator:

| Call site | Code |
|---|---|
| `src/components/compendium/ScalingColumnsPanel.tsx:148` | `upsertDocument('scaling_columns', col.id, …)` |
| `src/pages/compendium/SubclassEditor.tsx:1414` | `upsertDocument('scaling_columns', …)` |
| `src/pages/compendium/scaling/ScalingEditor.tsx:112` | `upsertDocument('scaling_columns', …)` |

Those land at the generic `/api/d1/query` proxy. `scaling_columns` is **not**
in `PROTECTED_WRITE_TABLES` (`api/_lib/d1-proxy.ts:179`), so it falls to the
catch-all `isMutation → requireStaffAccess` gate (`d1-proxy.ts:285-287`). A
content-creator's base role is `user`/`trusted-player` — **not staff → 403**.
And `scaling_column` is not in `PROPOSABLE_ENTITY_TYPES`
(`api/_lib/proposals.ts:43`), so there is no proposal path for columns at all.

> The subclass **row** and option-group **row** themselves DO route through
> `applyProposalWrite` correctly (they're proposable types). What fails on
> those editors is their **nested scaling columns** — same 403.

### Bug #1 — pickers read live tables only

Drafts live in `pending_revisions`, never in the live tables. Every picker
reads live tables via `fetchCollection`:

| Picker | Code |
|---|---|
| ClassEditor option-group + column pickers | `fetchCollection('uniqueOptionGroups')` / `fetchCollection('scaling_columns')` (`ClassEditor.tsx:742,1028`) |
| UniqueOptionGroupEditor class picker | `fetchCollection('classes')` → shared `EntityPicker` (`UniqueOptionGroupEditor.tsx:156`) |

So a draft-created entity is invisible to every cross-reference dropdown
until an admin approves it.

---

## The cluster

```
class ──┬─ scaling_columns        (parent_id = class.id, parent_type='class')
        │     ▲ referenced by class.advancements
        │       (quantity_column_id / scaling_column_id / optionScalingColumnId)
        ├─ subclasses             (subclass.class_id = class.id)
        │     └─ scaling_columns  (parent_id = subclass.id, parent_type='subclass')
        │     └─ subclass.unique_option_group_ids → unique_option_groups
        └─ unique_option_groups   (group.class_ids ∋ class.id ; class.unique_option_mappings → group.id)
              └─ unique_option_items (item.group_id = group.id)
                    └─ item.scaling_column_id / quantity_column_id → scaling_columns
```

`scaling_columns` schema (`worker/migrations/0009_scalings.sql`):
`id, name, parent_id, parent_type ('class'|'subclass'), "values" (JSON level→value)`.

### The key insight that makes this tractable

**Every id in this cluster is a client-minted UUID, and the proposal system
preserves ids through approval unchanged.** A CREATE draft stores its id in
`proposed_payload.id`; approval INSERTs that exact id. So a reference authored
against a draft id (e.g. `class.advancements[…].scaling_column_id =
"<draft-column-uuid>"`) is **already correct** — it will resolve the moment
both the column and the class are live.

That means we do **not** need id-rewriting or a placeholder-resolution pass.
We need exactly three things:

1. Let nested entities be **saved** as drafts (close the 403).
2. Let pickers **see** the block's drafts (so the user can author the
   references in the first place).
3. Ensure the cluster **approves as a unit** (so a reference never goes live
   pointing at a draft that got rejected).

---

## Proposed architecture

### Part A — `scaling_column` becomes a proposable entity type *(proposal-system)*

- Add `scaling_column` to `PROPOSABLE_ENTITY_TYPES` + `ENTITY_CONFIGS` in
  `api/_lib/proposals.ts`:
  ```ts
  scaling_column: {
    tableName: 'scaling_columns',
    pkColumn: 'id',
    writableColumns: new Set(['id', 'name', 'parent_id', 'parent_type', 'values']),
    jsonColumns: new Set(['values']),
  }
  ```
- Migration (timestamp-named, `worker/migrations/`) extending the
  `pending_revisions.entity_type` CHECK constraint to include
  `scaling_column`. **Apply local-first; remote only on explicit go-ahead.**
- `ProposalEntityType` union in `src/lib/proposalAware.ts` gains
  `'scaling_column'`.

> **Features deferred.** Class features (`features` table) are the other
> nested type, but the report didn't mention them and they carry the full
> activities/effects JSON surface. Out of scope for this pass; note for a
> follow-up if content-creators need to author features.

### Part B — Nested writes route through the accumulator *(compendium-editors)*

When `isProposalMode`, `ScalingColumnsPanel` (and the column save/delete
sites in `SubclassEditor` / `ScalingEditor`) must call the accumulator
(`writer.create/update/remove` / `applyProposalWrite`) instead of
`upsertDocument('scaling_columns', …)`. The wrapper is bound to the parent's
entity type (`class`/`subclass`), so the panel needs access to a
`scaling_column` writer — either:
- **B1:** the panel gets its own `useProposalAccumulator('scaling_column')`
  (it can queue into the *same* block — the wrapper's queue is per-context,
  but `submitNow`/draft flush is per-block), or
- **B2:** the parent editor passes a column-writer callback down.

This is the main editor-side lift and needs the column panel refactored to
be proposal-aware like the catalog editors already are.

### Part C — Pickers overlay block drafts *(compendium-editors, using a proposal-system helper)*

- `proposal-system` exposes a picker-friendly overlay. `useProposalEntityDrafts(type)`
  already returns `{ byId, createdIds, … }` for the active block (it's
  gated to the wrapper, applies the entity_id-null fallback). We add a thin
  convenience that flattens draft creates into `{ id, name, __draft: true }[]`
  for a given type so pickers can concat them onto their live options.
- Editors merge those entries into their option lists, visually tagged
  (e.g. a small "in this block" chip), and only from the **current user's
  active block** (never other users' drafts).
- The shared `src/components/ui/EntityPicker.tsx` gains an optional
  `extraEntries` (or `draftEntries`) prop so every picker can opt in uniformly.

### Part D — Block-atomic approval + reference integrity *(proposal-system)*

The correctness constraint: cross-references resolve only if the cluster
approves together. Today the admin queue approves **per-row**; rejecting one
piece of a referenced cluster would leave a dangling reference live.

**DECIDED: D1 — approve-whole-block.** Admin approves the block; the server
applies every revision in dependency order (parents before children,
referents after referenced) and returns a partial-failure report. D1 has no
multi-statement transaction, so application is best-effort-ordered: a failure
mid-cluster is reported with which rows landed and which didn't, and the
block stays open for the admin to retry/resolve. This matches the "block is
the unit of work" mental model the proposer already has.

> **Rejected alternative — D2 (per-row ref-integrity gate):** keep per-row
> approval but refuse to approve a revision referencing a not-yet-live draft
> id. Smaller change, but pushes manual approval-ordering onto the admin.
> Rejected in favor of D1's better proposer/admin experience.

The cascade engine (`api/_lib/cascadeStrategies.ts`) is the natural place to
express "this revision depends on that one" — it already models
`cascade_parent_revision_id`. Dependency ordering for D1's apply pass is
derived from the intra-cluster id references (parent_id, class_id, group_id,
and the column/group id refs inside advancements + mappings).

### Admin-side surface for D1

- `functions/api/admin/proposals/[[path]].ts` gains an "approve block"
  action that loads every `pending` revision in the bundle, topologically
  orders them by intra-cluster reference, and applies in sequence via
  `applyApprovedOperation`.
- Partial-failure report shape: `{ applied: [...ids], failed: [{id, error}], remaining: [...ids] }`.
  The block stays `submitted` (not fully approved) until all land.
- The existing per-row approve stays for non-cluster proposals (a lone tag,
  a lone spell) — block-approve is additive, not a replacement.

---

## Work split

| Piece | Files | Owner |
|---|---|---|
| `scaling_column` entity type + config | `api/_lib/proposals.ts`, `src/lib/proposalAware.ts` | **proposal-system** |
| entity_type CHECK migration | `worker/migrations/<ts>_*.sql` (shared, append-only) | **proposal-system** |
| Picker-overlay helper (flatten drafts) | `src/hooks/useProposalEntityDrafts.ts` (or a new sibling) | **proposal-system** |
| Block-atomic approval / ref-integrity | `functions/api/admin/proposals/[[path]].ts`, `api/_lib/proposals.ts`, `api/_lib/cascadeStrategies.ts` | **proposal-system** |
| Route column save/delete through accumulator | `src/components/compendium/ScalingColumnsPanel.tsx`, `src/pages/compendium/{SubclassEditor,scaling/ScalingEditor}.tsx` | **compendium-editors** |
| Overlay drafts in pickers | `src/pages/compendium/{ClassEditor,SubclassEditor,UniqueOptionGroupEditor}.tsx`, `src/components/ui/EntityPicker.tsx` | **compendium-editors** |

Coordination per [handoffs/README.md § shared-files protocol]: proposal-system
ships Parts A + the helper + D, then files Open Requests to compendium-editors
for Parts B + C (which consume the new entity type + helper).

---

## Decisions

Locked 2026-05-28 (user sign-off):

1. **Approval model: D1 — approve-whole-block.** (See [Part D](#part-d--block-atomic-approval--reference-integrity-proposal-system).)
2. **Scope: `scaling_column` only this pass.** Class **features** are
   deferred to a follow-up (bigger surface, not in the report).
3. **Picker draft visibility: current active block only.** Never other
   open blocks, never other users' drafts — matches how drafts scope
   everywhere else in the system.
4. **Draft-nested-delete: warn, don't cascade.** Dropping a draft column
   that a draft advancement references surfaces a warning; auto-scrub /
   cascade is a later enhancement.

Confirmed (no work beyond Part C):

5. **Subclass-of-a-draft-class** — the subclass *row* proposal stores
   `class_id = <draft class uuid>` fine; the subclass editor's class picker
   just needs the Part C overlay so the draft class is selectable. No extra
   server work.

---

## Implementation checklist (once design is agreed)

**proposal-system (this branch):**
- [ ] `scaling_column` in `PROPOSABLE_ENTITY_TYPES` + `ENTITY_CONFIGS` + `ProposalEntityType`
- [ ] migration: extend `pending_revisions.entity_type` CHECK (local-first)
- [ ] picker-overlay helper (flatten active-block draft creates per type)
- [ ] approval model (D1 or D2) + reference-integrity validation
- [ ] update `proposal-editor-pattern.md` + `content-proposals.md` (note the
      block-mode auto-promotion removal from `9cdf1c6` while here)

**compendium-editors (handed off via Open Request):**
- [ ] `ScalingColumnsPanel` + subclass/scaling column saves → accumulator when `isProposalMode`
- [ ] `EntityPicker` gains `draftEntries` prop
- [ ] ClassEditor / SubclassEditor / UniqueOptionGroupEditor pickers overlay active-block drafts
- [ ] visual "in this block" treatment for draft entries
