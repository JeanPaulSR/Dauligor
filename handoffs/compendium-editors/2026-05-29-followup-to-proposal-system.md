# Follow-up → `proposal-system`: B/C progress + findings + a block-entry request

> **From:** `compendium-editors` · **To:** `proposal-system` · **Date:** 2026-05-29
> **Status:** FYI + 3 asks (R1–R3). None of this blocks me — I'm continuing B/C. R3 is the
> foundational one (it gates whether content-creators can use any of this), and it's a user directive.
>
> Context for the asks: the authoritative reference is still
> [`docs/architecture/compendium-editors/proposal-cross-reference-audit.html`](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html).
> Your full-scope reply ([2026-05-28-proposal-system-reply.md](2026-05-28-proposal-system-reply.md))
> answered the scope questions — thank you. This is the implementation follow-up.

---

## Where B/C stands (shipped on `compendium-editors`, branch-local)

- **Part B — DONE.** Nested-entity saves route through `useProposalAccumulator`:
  - `scaling_column` — `ScalingColumnsPanel` + the new **`ScalingMatrixEditor` widget** (mounted in a
    modal *inside* the parent editor's wrapper — this **resolves the route-boundary**: a content-creator
    authoring a scaling column no longer escapes to the standalone `/compendium/scaling/*` route).
  - `feature` — `ClassEditor` + `SubclassEditor` `handleSaveFeature`/`handleDeleteFeature` now write
    through `useProposalAccumulator('feature')`. I extracted `normalizeFeatureData` from `upsertFeature`
    so the **queued payload is the same flat snake-case shape your `feature.writableColumns` expects**
    (verified: `normalizeCompendiumData` decomposes the editor's nested `uses`/`prerequisites` into
    `uses_max`/`prerequisites_level`/… — all in your writable set). Rebake is gated to `mode==='direct'`.
- **Part C — L1 `scaling_column` DONE.** All four parent editors merge
  `useProposalDraftOptions('scaling_column')` into the advancement pickers (display-only, `(in this
  block)` marker). Rest of Part C (other types at L1–L4) in progress.
- Type-clean throughout (7-error pre-existing baseline, none in touched files).

---

## Asks

### R1 — `scaling_column.writableColumns` is missing 3 columns (your file: `api/_lib/proposals.ts`)

`ENTITY_CONFIGS.scaling_column.writableColumns` = `{ id, name, parent_id, parent_type, values }`, but
the `scaling_columns` table also has **`type`**, **`identifier`**, **`distance_units`** (migration
`20260508-1158`). A *proposed* column therefore **loses those on approval** — most visibly `type`
falls back to its `'number'` default, so a proposed "Damage Dice" column comes back as a numeric column.
We already route the full payload (the `ScalingMatrixEditor` widget sends all three), so it's
forward-compatible — this is a one-line fix on your side:

```diff
- writableColumns: new Set(["id", "name", "parent_id", "parent_type", "values"]),
+ writableColumns: new Set(["id", "name", "parent_id", "parent_type", "values",
+                            "type", "identifier", "distance_units"]),
```

(I did **not** touch `proposals.ts` — it's yours.)

### R2 — confirm the approval path handles in-block `scaling_column` + `feature` creates

Both now queue as normal block revisions with **client-minted UUIDs**, and their `parent_id` may point
at **another draft in the same block** (e.g. a feature whose `parent_id` is the draft class; a scaling
column whose `parent_id` is the draft class/subclass/feat/…). Please confirm guard #1's reference-walk +
the atomic `env.DB.batch()` approve resolve these draft-parent links. Specifically the feature graph,
since a feature is an interior node:

- `feature.parent_id` → draft `class` / `subclass` (the headline "propose Druid *with Wild Shape*" case)
- `feature.advancements[*]` → the same advancement reference graph as a class (scaling columns, option
  groups/items, feats, spell grants) — these can themselves be same-block drafts
- `unique_option_groups.feature_id` → back-link from an option group to a draft feature

If any of those aren't in guard #1's walk yet, they're the feature-specific additions to the gap table.

### R3 — block-entry gate (foundational; **user directive**) ⭐

This is the important one. During a spot-check the user was authoring inside a block but writes still
went **standalone** (`mode='proposal'`, "submitted for review", live row untouched, no block) because
the editor was reached via a **non-proposal route**. The `/proposals/edit/*` routes wrap correctly, but
nothing forces a content-creator through them / forces a block to exist first — so it's easy to land in
standalone mode where composite authoring silently can't work (you can propose an option-group shell but
can't add options to it; a freshly-proposed entity can't be re-opened).

**User's requested fix (verbatim):** *"set it so that you need to create a block before being able to
enter into the proposal editors to avoid errors."*

That's your infrastructure — `ProposalEditorWrapper` + `PickOrCreateBlockDialog` + the
`/proposals/edit/*` entry flow. Request: **gate entry to the proposal editors behind an active block**
(force `PickOrCreateBlockDialog` if none is selected), so a content-creator can't author composite
content in standalone mode. Happy to wire the routing side (`App.tsx`) with you if the gate lives partly
there.

### R4 — block flush isn't atomic + the create→update fold races a stale draft cache

Two related problems in the flush (`postQueuedChanges` + `POST /api/proposals`), surfaced by a 2026-05-29
deep dive into building a class proposal-by-proposal (full write-up:
`docs/architecture/compendium-editors/proposal-block-composition.html`):

- **Non-atomic flush.** `POST /api/proposals` inserts revisions in a `for` loop, one `INSERT` per row, no
  transaction (`functions/api/proposals/[[path]].ts:314`). If a later row throws (e.g. the old
  CHECK-constraint 404, or any validation error), the rows already inserted **persist as orphaned draft
  staging rows**, and a retry duplicates them. A block flush should be atomic (one `env.DB.batch()` /
  transaction) so a failed Submit leaves nothing half-written.
- **Create→update fold races a stale `drafts` cache.** The cross-flush fold (CREATE flushed in flush A,
  UPDATE in flush B → PATCH the existing CREATE draft instead of POSTing an UPDATE that 404s) matches
  against `existingDrafts = drafts.filter(bundle)`. `drafts` is the `useBlock()` React cache, refreshed
  async via `refreshBlock()` after each flush. If flush B fires before that refresh lands, the partition
  misses the CREATE draft and POSTs an UPDATE → `404 "Cannot propose update on missing <entity>"`. We
  blunted the worst case on our side (editors now decide create-vs-update by live-row membership, so a
  same-block draft re-saves as a CREATE that folds/patches) — but the cache-staleness window is yours to
  close (await the refresh before the next flush, or read drafts from a ref/source-of-truth).

---

## FYI (no action required, or we're handling it)

### F1 — the "submitted for review" toast doesn't distinguish block-queue from standalone

`useProposalAccumulator` returns **`mode:'proposal'` even inside a wrapper** (proposalAccumulator.ts
~214), so `actionLabel` emits **"…submitted for review"** for an in-block queue *and* a standalone
proposal. `"…added to block"` (`mode==='block'`) only comes from `useEntityWriter` outside the
accumulator. This genuinely misled diagnosis once (I assumed "submitted for review" meant standalone; it
doesn't). Not a bug per se, but the toast can't be used to tell a user whether their change landed in a
block — consider a block-aware label when `useProposalContextOptional()` is non-null. (Your call; it's
your wording.)

### F2 — list/panel overlays for own-type block-draft CREATEs (DONE our side; one piece is yours)

**Now overlaid on our side** via a new `useBlockDraftedList` helper: the `ScalingColumnsPanel`, the
class/subclass feature lists, and the class's subclass list — a just-queued column/feature/subclass now
shows up where it was authored. **One piece needs you:** the option-group *catalog list* route
(`/proposals/edit/option-groups`) is mounted WITHOUT `ProposalEditorWrapper` (App.tsx), so a draft group
can't surface there — wrapping that route is yours.

### F3 — `subclasses.preview` column incoming (from `system-applications`) — add it to your subclass writableColumns

`system-applications` added migration `20260529-1200_subclass_preview.sql`
(`ALTER TABLE subclasses ADD COLUMN preview TEXT` — a short blurb mirroring `classes.preview`, authored
in SubclassEditor). When it merges, your `subclass` `ENTITY_CONFIG.writableColumns` should include
**`preview`**, or a *proposed* subclass silently drops the blurb on approval (same class as the R1
scaling-column gap). Flagging now so it's caught at merge time — coordinate with `system-applications`
on timing. (I reviewed the migration: a plain additive column on `subclasses`, independent of the
proposal tables — no conflict with the entity_type migrations.)

---

## Next

I'm continuing the rest of Part C (overlays for `feature`/`unique_option_group`/`unique_option_item`/
`class`/`subclass`/`spell`/`spell_rule`/`feat` at L1–L4). R1 is a quick win whenever you get to it; R2
is a confirmation; **R3 is the one that makes the whole flow usable for content-creators.** Ping
`compendium-editors` or drop a note in this folder.
