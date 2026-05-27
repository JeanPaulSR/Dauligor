# Handoff — Scaling columns for non-class owners

Captures design calls + current state of the "advancements outside classes" track
so a future agent / contributor can pick it up cold.

**Branch**: `feat/scaling-non-class-owners` (4 commits ahead of `main` as of `10fa13c`).

**Status**: Phase A shipped (editor + URL state). Phase B v1 shipped (feat export
round-trip). Phase B.2 / B.3 / B.4 / C — open. See
[roadmap § Scaling columns for non-class owners](roadmap.md#scaling-columns-for-non-class-owners--follow-ups).

---

## The problem

`scaling_columns` rows backed class scaling (Sneak Attack dice, Cantrip Damage,
Ki Points, etc.). Feats had advancement support (mid-2026) but couldn't own
their own scaling columns — anything that scaled had to be expressed via the
parent class's columns. Items had no scaling concept at all, so magic items
like Amulet of the Devout (+1 Channel Divinity charge) had no clean home for
their per-level data.

The fix: generalize `scaling_columns` ownership to feats / races / backgrounds /
items, with full Foundry round-trip. Class features (feats with `feat_type='class'`
or `'subclass'`) intentionally stay excluded — they inherit columns from the
parent class.

---

## Design decisions made in this conversation

The user answered four key forks before implementation began:

### Owner scope: feats + races + backgrounds + items
Class features specifically excluded — they already inherit from parent classes.
Unique option groups excluded — they're dependent on the advancement that grants
them. Items are first-class owners (Amulet of the Devout case).

### Storage: one generalized table
The existing `scaling_columns` table was **already polymorphic** via
`(parent_id, parent_type)` — `parent_type` is a TEXT column with no CHECK
constraint, so widening it to accept new values needed **zero schema migration**.
We did NOT create per-owner tables; one shared table with the composite key wins
on:
- One read path, one editor, one Foundry-export normalizer to maintain
- Single index already in place (`idx_scaling_columns_parent`)
- Future ownership extensions are free (just a new `parent_type` value)

### Foundry round-trip: must work in Foundry play
The export side bakes scaling into the item's `system.advancement` map at
export time. Foundry's dnd5e system resolves `@scale.<owner>.<column>` natively
from the item's `system.identifier`, so no module-side runtime hook is needed
once the advancements are in the JSON. Same mechanism classes already use.

### Phase C design decisions

**ItemBumpUses as a separate advancement type, NOT a flag on ItemGrant.**
Rationale per the user: "advancement types stay parallel, not modes."
Implementation will add `'ItemBumpUses'` to the `AdvancementType` union
alongside `'ItemGrant'` / `'ItemChoice'` / etc.

**Target resolution via the requirements-tree leaf shape.** The user wants the
target picker to reuse the existing `feature` / `feat` leaf — same picker UX
authors already know.

**Target-not-found → warn, don't fail.** Per the user: "Part of the feat is
usually to have a requirement that already fits a class that would have the
target. However, writing a notification would be useful and would let the user
to pass along the information to the dm." So when a feat with ItemBumpUses
applies to a character that doesn't have the target feature, we log a warning
the user can surface to the DM; we don't reject the feat.

**Bake-time application (not runtime).** When the feat is added to a character,
the builder finds the target item and statically patches its `uses.max`. The
exported actor data has the bumped value baked in. No runtime Active Effect.
Trade-off: a feat added to a character in Foundry directly (skipping our
builder) won't apply the bump — accepted as a fair limitation given how the
user actually authors content.

---

## What shipped

### Phase A.1 — `f1e4f6b`: shared panel + FeatsEditor wiring
- New `src/components/compendium/ScalingColumnsPanel.tsx`. Parametrized on
  `(parentId, parentType)`. Same UX class editors had inlined, extracted so
  every owner uses one component.
- ClassEditor migrated to use it (zero behavior change).
- FeatsEditor's Advancement sub-tab grows a right-side panel at xl+, gated on
  `feat_type` (class features excluded).
- `AdvancementManager`'s `availableScalingColumns` prop is now fed per-owner.

### Phase A.1 follow-up — `590e3a0`: unsaved-draft placeholder
Without it, the panel was invisible until first save (since columns FK against
`parent_id`), which made the entire feature undiscoverable. Now an inert card
nudges authors to save first.

### Phase A.2 — `adab7c6` + `afcbf1a`: URL-backed editingId + ItemsEditor
- FeatsEditor + ItemsEditor read/write `?editingId=<uuid>` so navigating to
  `/compendium/scaling/<id>` and back via `navigate(-1)` preserves selection.
  Pattern: useState initializer reads URL, outgoing effect mirrors state→URL
  with `replace: true`, inbound effect handles back/forward.
- ItemsEditor grows a new "Scaling" sub-tab between Activities and Effects.
  Same panel, `parentType='item'`.

### Phase B v1 — `10fa13c`: feat Foundry round-trip (export side)
- Extracted `normalizeScaleValueAdvancement(advancement, scalingById)` from
  `api/_lib/_classExport.ts` as an exported helper. Class export delegates to
  it — zero behavior change.
- Exported `denormalizeScalingColumnRow` so other export paths can read
  `scaling_columns` rows in the same camelCase shape.
- `_featExport.ts` loads scaling columns scoped to the feat (parent_type
  derived from feat_type), normalizes each ScaleValue advancement, ships the
  filled-in `system.advancement` map to Foundry. Foundry's dnd5e resolves
  `@scale.<feat>.<column>` automatically.
- **Covers races + backgrounds**: those are stored as feats with
  `feat_type='race'/'background'`, so the same export path handles them.

### Phase B.3 (feat path): importer side
- New `src/lib/scalingImport.ts` exposes
  `extractAndPersistScalingColumns({ parentId, parentType, advancements })`
  and `scalingOwnerTypeForFeatType(featType)`. Reverses
  `normalizeScaleValueAdvancement`: walks `ScaleValue` entries in incoming
  advancements, persists `scaling_columns` rows owned by the parent (matched
  on identifier for idempotent re-imports), patches
  `configuration.scalingColumnId` so the editor + future re-exports see the
  linkage.
- `FeatImportWorkbench.tsx` wires both the single-import and batch-import
  commit paths through the helper. UUIDs are minted upfront for new feats so
  scaling rows can FK against them.
- Failures during scaling extraction are logged but don't block the feat
  upsert — the row lands; the author can re-author columns manually if
  needed.

---

## What's open

See [roadmap entry](roadmap.md#scaling-columns-for-non-class-owners--follow-ups)
for the canonical list. Briefly:

- **B.2** (items only) — blocked on canonical-contract decision. The
  `item-folder-export-contract.md` intentionally omits advancements, and no
  `/api/module/items/<dbId>.json` server endpoint exists. Wiring items
  through requires a contract update + new server-built export + module-side
  fetcher. Races + backgrounds were always covered by the feat path.
- **B.3** (items only) — items don't carry advancements per the same
  contract, so there's no data to extract. The `extractAndPersistScalingColumns`
  helper is already parametric on `parentType`, so wiring is one line once
  B.2's contract decision lands.
- **B.4** — module canonical contract doc updates. Owner-gated per
  `dauligor-guardian` protocol — flagged in roadmap, not edited.
- **C** — `ItemBumpUses` advancement type. The actual new mechanic; everything
  prior was scaffolding. Full implementation outline lives in the roadmap entry.

---

## Pointers

- Schema reference: [features/compendium-scaling.md § Schema](features/compendium-scaling.md#schema)
- Shared panel: `src/components/compendium/ScalingColumnsPanel.tsx`
- Editor surfaces: ClassEditor sidebar, FeatsEditor Advancement tab, ItemsEditor Scaling tab
- Foundry normalizer: `normalizeScaleValueAdvancement` in `api/_lib/_classExport.ts`
- Branch: `feat/scaling-non-class-owners`
