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

### Phase B.2 — Item Foundry export endpoint (app → Foundry)
**Status**: open · **Priority**: low

Races + backgrounds were always covered by the feat-export path (commit `10fa13c`) since they're stored as feats with `feat_type='race'`/`'background'`. The feat exporter maps that to `parent_type` correctly. ✅

What's left is **items moving app → Foundry**. The structural gap: no `/api/module/items/<id>.json` server endpoint exists (parallel to `/api/module/feats/<id>.json`, `/api/module/spells/<id>.json`, `/api/module/<source>/classes/<class>.json`). Today items are Foundry-authored and flow Foundry → app only.

To complete the round-trip:
- New server-built `_itemExport.ts` paralleling `_featExport.ts`. Needs to cover the full Foundry item shape across all item_types (weapon / equipment / armor / consumable / tool / loot / container) — substantial mapping work because the items table is unified but Foundry expects type-specific `system.*` blocks.
- Synthesize `ScaleValue` advancements from owner-scoped `scaling_columns` rows (`parent_type='item'`) and embed them in the exported `system.advancement`. The synthesis pattern is already established for classes; the helper just needs to mint stable `_id`s for items the same way.
- New `/api/module/items/<dbId>.json` route in `functions/api/module/[[path]].ts`.
- Module-side fetcher to consume the new endpoint when the user picks an item from the importer (requires module-side companion work).
- Canonical contract clarification in `item-import-contract.md` to acknowledge advancements as a valid field. (Note: the canonical doc *already* supports `system.activities` / `effects`; advancements would be an extension following the same pattern.)

Items already work app-side (scaling columns author, persist, surface in the editor). The forward Foundry path is the only remaining gap.

### Phase B.3 — Importer side: ScaleValue → `scaling_columns` rows
**Status**: shipped for feats + items on `<commit>` and `<followup-commit>` · **Priority**: complete for in-scope owners

Foundry → app reverse direction.

- **Feats** (covers races + backgrounds, since they share the feats table): when a feat lands in `FeatImportWorkbench` with `ScaleValue` advancements, the importer extracts each one into a `scaling_columns` row owned by the imported entity and patches the advancement's `configuration.scalingColumnId` to link to that row. FeatsEditor's "Feat Columns" / "Race Columns" / "Background Columns" panel shows the imported scaling immediately, and re-exports through `normalizeScaleValueAdvancement` rebuild the same scale map.

- **Items**: same flow in `ItemImportWorkbench`. `sourceDocument.system.advancement` is preserved by the canonical folder-export contract (the "intentionally omitted" line in `item-folder-export-contract.md` § "What's intentionally not in the entry" applies only to the slim `itemSummary` projection — the full doc round-trips). The importer pulls advancements off `sourceDocument`, walks ScaleValue entries, persists them as `scaling_columns` rows with `parent_type='item'`. The items table itself doesn't grow an `advancements` column — advancements aren't authored on items app-side; scaling columns are the canonical surface.

Touches: [src/lib/scalingImport.ts](../src/lib/scalingImport.ts) (shared helper) + [src/components/compendium/FeatImportWorkbench.tsx](../src/components/compendium/FeatImportWorkbench.tsx) + [src/components/compendium/ItemImportWorkbench.tsx](../src/components/compendium/ItemImportWorkbench.tsx).

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
