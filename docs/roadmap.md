# Roadmap

Open ideas + larger pieces of work that aren't blocking but should
land eventually. Linked from the README so notes don't get lost in
chat. Add entries below as they come up — most-recently-added at the
top so the tail of the file accrues the long-tenured stuff.

Conventions:
- Each idea is its own `## Heading` so other docs can deep-link
  (`docs/roadmap.md#systems-overview-page`).
- Cross-reference design docs under `docs/features/` rather than
  duplicating the spec here. Roadmap is just the pointer.
- Once an item ships, move it under the "Shipped" section at the
  bottom with the commit / PR / branch hash.

---

## Scaling columns for non-class owners — follow-ups

The first slices of the "advancements outside classes" track shipped on `feat/scaling-non-class-owners` (commits `f1e4f6b` … `10fa13c`). What's still open:

### Phase B.2 — Item Foundry round-trip
**Status**: blocked on canonical-contract decision · **Priority**: low

Races + backgrounds were always covered by the feat-export path (commit `10fa13c`) since they're stored as feats with `feat_type='race'`/`'background'`. The feat exporter maps that to `parent_type` correctly. ✅

What's left is **items**. Items have two structural blocks:

1. **No app → Foundry server endpoint**: `/api/module/spells/<id>.json`, `/api/module/feats/<id>.json`, and `/api/module/<source>/classes/<class>.json` all exist; `/api/module/items/<id>.json` doesn't. Items are Foundry-authored and flow Foundry → app via `buildItemFolderExport()` (the reverse direction).

2. **Canonical contract intentionally omits item advancements**: `module/dauligor-pairing/docs/item-folder-export-contract.md` lines 275–278 explicitly state advancements are "intentionally not in the entry." That's a deliberate design call — owner-gated to change per the `dauligor-guardian` skill protocol.

If we want app-authored items to ship to Foundry with their `scaling_columns` baked into `system.advancement`, the work is:
- New server-built `_itemExport.ts` paralleling `_featExport.ts` (loads columns via `(parent_id, parent_type='item')`, runs them through `normalizeScaleValueAdvancement`).
- New `/api/module/items/<dbId>.json` route in `functions/api/module/[[path]].ts`.
- Module-side fetcher to consume the new endpoint when the user picks an item from the importer.
- Canonical contract update (item-folder-export-contract.md, schema-crosswalk.md) to acknowledge advancements as a valid field.

Items already work app-side (scaling columns author, persist, are visible in the editor). The Foundry path is the gap.

### Phase B.3 — Importer side: ScaleValue → `scaling_columns` rows
**Status**: shipped for feats (covers races + backgrounds) on `<commit>` · **Priority**: medium for items

Foundry → app reverse direction. When a feat (or race / background, since they share the feats table) lands in the import workbench with `ScaleValue` advancements, the importer now extracts each one into a `scaling_columns` row owned by the imported entity and patches the advancement's `configuration.scalingColumnId` to link to that row. Means the FeatsEditor's "Feat Columns" / "Race Columns" / "Background Columns" panel shows the imported scaling immediately, and re-exports through `normalizeScaleValueAdvancement` rebuild the same scale map. Touches: [src/lib/scalingImport.ts](../src/lib/scalingImport.ts) (new shared helper) + [src/components/compendium/FeatImportWorkbench.tsx](../src/components/compendium/FeatImportWorkbench.tsx).

Items are still open here — but per the contract, items don't carry advancements through `buildItemFolderExport()`, so there's no data to extract until B.2's contract decision lands. The shared `extractAndPersistScalingColumns` helper in `scalingImport.ts` is already parameterized on `parentType`, so wiring the item importer is a one-line call once items start carrying advancements.

### Phase B.4 — Module canonical contract updates
**Status**: open · **Priority**: low · **Owner-gated**: requires explicit per-doc permission per the `dauligor-guardian` skill protocol

The following module canonical docs treat scaling as class-only; they need a pass to acknowledge non-class owners once Phase B.2/B.3 ship:
- [module/dauligor-pairing/docs/class-import-contract.md](../module/dauligor-pairing/docs/class-import-contract.md) — mentions `scalingColumns` only for classes
- [module/dauligor-pairing/docs/advancement-construction-guide.md](../module/dauligor-pairing/docs/advancement-construction-guide.md) — ScaleValue section is class-only
- [module/dauligor-pairing/docs/schema-crosswalk.md](../module/dauligor-pairing/docs/schema-crosswalk.md) — extensive ScaleValue coverage all in class context
- [module/dauligor-pairing/docs/class-feature-activity-contract.md](../module/dauligor-pairing/docs/class-feature-activity-contract.md) — line 1013 references Sorcerer-owned ScaleValue specifically

### Phase C — `ItemBumpUses` advancement type
**Status**: open · **Priority**: high (the actual new mechanic the user asked for; Phase A/B was scaffolding)

A separate advancement type that lets a feat or item upgrade an existing feature on a character — bumping its `uses.max` is the first mode. Design call: separate type (not a flag on `ItemGrant`), per [the design call in this conversation](handoff-scaling-non-class-owners.md#phase-c-design-decisions). Implementation scope:

1. New `'ItemBumpUses'` entry in [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)'s `AdvancementType` union.
2. New default-configuration in [src/lib/advancementState.ts](../src/lib/advancementState.ts).
3. Editor UI block in AdvancementManager: target picker reusing the requirements-tree `feature` / `feat` leaf shape, plus a formula input for the bump amount (e.g. `+1`, `@prof`, `@scale.feat-id.col`).
4. Character builder integration in [src/pages/characters/CharacterBuilder.tsx](../src/pages/characters/CharacterBuilder.tsx): walk advancements, find target on character, add bump to its `uses.max`. Warn the user when the target isn't present so they can pass info to the DM (per the design call).
5. Foundry export integration: bake-time application (find the target item in the exported actor data and patch its `uses.max` statically). Avoids needing a runtime Active Effect.
6. Future modes: `'addToChoice'` (extend a target ItemChoice's pool) and `'replace'` (full feature overwrite). Out of scope for Phase C v1.

Created 2026-05-27.

---

## Systems overview page

A first-class "Systems" page in the app (probably `/docs` or
`/systems`) that surfaces a curated, modular list of the major
systems the app exposes: Worlds, Permissions / Content Proposals,
Tags + Filters, Spell Rules, Sources, Class Spell Lists, Modular
Options, Compendium, Lore Wiki, Foundry Export, etc.

Each entry is a **modular section** — independently authored,
independently linkable — that:

- States what the system does in one paragraph.
- Lists the entry-point pages + their roles (browse, edit, admin).
- Calls out the permission model (who can read, who can write, who
  can propose).
- Links to the canonical spec under `docs/features/` and to the
  rendered editor / browser pages.

Why this matters:
- New contributors should be able to scan one page and see what the
  app contains, instead of stitching it together from `docs/` and
  the sidebar.
- The README + per-feature docs can deep-link into specific
  sections (e.g. README's quick-start could link to "Permissions /
  Content Proposals" without copying the whole explanation).
- It's also the natural home for an embedded "what's coming"
  callout per system, so this roadmap stays the index and the
  Systems page does the rendered tour.

Status: not started. Owner: TBD. Created 2026-05-19.

---

## Shipped

_Move shipped items here with a one-line link to the commit / PR
once the bullet above is no longer relevant._
