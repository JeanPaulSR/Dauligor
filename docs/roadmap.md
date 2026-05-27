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

### Phase B.2 — Item / race / background Foundry round-trip
**Status**: open · **Priority**: medium

Feats now export with their `scaling_columns` baked into `system.advancement` (see [features/compendium-scaling.md § Foundry export round-trip](features/compendium-scaling.md#foundry-export-round-trip)). Items, races, and backgrounds don't yet — each has its own export path situation:

- **Items**: no server-built export endpoint exists today. Items ship through the module's `buildItemFolderExport()` folder-export, which currently doesn't inject ScaleValue advancements. Options: add a server-built `_itemExport.ts` per the feat / spell pattern, OR have the module-side folder export consult the app's `scaling_columns` endpoint at export time. (Latter is messier — the module would need to hit the API to read columns for each item it's exporting.)
- **Races / backgrounds**: no server export at all yet. The module's `buildBackgroundFolderExport()` and `buildSpeciesFolderExport()` (shipped May 2026) only handle Foundry → app direction.

The shared `normalizeScaleValueAdvancement` helper in [api/_lib/_classExport.ts](../api/_lib/_classExport.ts) is the building block — it's already parametric on `scalingById`, so each new export consumer just loads its owner's columns and runs the helper.

### Phase B.3 — Importer side: ScaleValue → `scaling_columns` rows
**Status**: open · **Priority**: medium

Foundry → app round-trip. When the importer reads a feat (or item / race / background) with `ScaleValue` advancements in its `system.advancement` map, it should extract those into `scaling_columns` rows owned by the imported entity. Today the advancements ship as opaque JSON on the feats row and the per-level scale data is buried in the configuration blob — there's no column row to author against in the editor.

Touches: [src/lib/featImport.ts](../src/lib/featImport.ts) (and parallel item / race / background importers as they're built).

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
