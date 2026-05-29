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

### F2 — list/panel overlays for own-type block-draft CREATEs (we'll fix on our side)

Lists/panels that render only the live DB fetch hide just-queued drafts. `FeatsEditor` already overlays
its list via `useProposalEntityDrafts('feat')`, so a queued feat shows; but the **option-group list**
and the **`ScalingColumnsPanel` list** don't, so a queued new group/column is invisible (can't be
re-opened to add children). This is ours — same `useProposalEntityDrafts` overlay feats use, applied to
those lists. Flagging only because it interacts with the block flow you may be testing.

---

## Next

I'm continuing the rest of Part C (overlays for `feature`/`unique_option_group`/`unique_option_item`/
`class`/`subclass`/`spell`/`spell_rule`/`feat` at L1–L4). R1 is a quick win whenever you get to it; R2
is a confirmation; **R3 is the one that makes the whole flow usable for content-creators.** Ping
`compendium-editors` or drop a note in this folder.
