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
**Status**: app-side shipped on `<commit>` · module-side companion open

Races + backgrounds were always covered by the feat-export path (commit `10fa13c`) since they're stored as feats with `feat_type='race'`/`'background'`. The feat exporter maps that to `parent_type` correctly. ✅

**What shipped**:
- New `api/_lib/_itemExport.ts` paralleling `_featExport.ts`. Builds the full Foundry-ready item document with per-`item_type` system blocks (weapon / equipment / consumable / tool / container / loot). Common fields (description, weight, price, properties, rarity, attunement, equipped, identified, uses, activities, effects, source) emit for every type; type-specific extras (damage / armor / tool / capacity / etc.) layer on top via `buildTypeSpecificSystem()`.
- Synthesizes one `ScaleValue` advancement per `scaling_columns` row owned by the item (`parent_type='item'`). Stub advancements run through the shared `normalizeScaleValueAdvancement` helper from `_classExport.ts` to fill in `scale` / `identifier` / `type` / `distance`. Advancement `_id` derived from the column's UUID (hyphens stripped, 16-char) for round-trip stability.
- New `/api/module/items/<dbId>.json` route in `functions/api/module/[[path]].ts`, mirroring the spell / feat detail endpoints.
- Items flow round-trip with scaling: author column in app → server endpoint emits ScaleValue → Foundry's dnd5e resolves `@scale.<item.identifier>.<column.identifier>` natively at play time.

**What's still open**:
- Module-side companion: an item importer in Foundry that consumes `/api/module/items/<dbId>.json` and embeds the document. Pattern is established by the feat importer in `module/dauligor-pairing/scripts/`. Until a module-side consumer ships, the app-side endpoint is verifiable only by URL inspection (see [verification doc § F'](verification-scaling-non-class-owners.md#f-item-server-export-endpoint-phase-b2-items--forward-direction)).
- Canonical contract clarification in `item-import-contract.md` to acknowledge advancements as a valid field. Owner-gated per `dauligor-guardian`.

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
**Status**: v1 end-to-end shipped on `feat/itembumpuses-advancement` (authoring + CharacterBuilder runtime + Foundry actor export) · feat-authored bumps on server export + items as authors still open · **Pick-up doc**: [handoff-phase-c-itembumpuses.md](handoff-phase-c-itembumpuses.md)

A separate advancement type that lets a feat or item upgrade an existing feature on a character — bumping its `uses.max` is the first mode. Design call: separate type (not a flag on `ItemGrant`), per [the design call in this conversation](handoff-scaling-non-class-owners.md#phase-c-design-decisions).

**What shipped (Phase C v1 — end-to-end)**:
- New `'ItemBumpUses'` entry in [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)'s `AdvancementType` union, plus a `Plus`-iconed teal entry in `ADVANCEMENT_INFO` and a compact list-row subtitle string.
- New default-configuration + normalizer branch in [src/lib/advancementState.ts](../src/lib/advancementState.ts): `{ target: { kind: 'feature'|'feat', id } | null, amount: string }`. Kind is restricted to `feature` / `feat`; everything else is coerced to `null`.
- Editor UI block in AdvancementManager: kind picker (Class Feature / Feat) + `SingleSelectSearch` bound to `availableFeatures` / `availableFeats`, plus a formula input for the bump amount. Includes a help card explaining bake-time resolution + the target-not-found warning behavior.
- Shared resolver `collectItemBumpUses` in [src/lib/characterLogic.ts](../src/lib/characterLogic.ts) — walks class / subclass / feature / feat advancements, gates by effective level, produces `{ bumps: Record<key, ItemBumpEntry[]>, warnings: ItemBumpWarning[] }`. `combineUsesMaxWithBumps` stitches multiple bumps onto a base `uses.max` formula with normalized signs.
- Character builder runtime: a new effect in [CharacterBuilder.tsx](../src/pages/characters/CharacterBuilder.tsx) derives `character.derivedItemBumpUses` from the walker. New warnings toast (deduped via a ref-tracked seen set) so authors can pass orphan info to their DM.
- Foundry actor export: [characterShared.ts](../src/lib/characterShared.ts) fetches feature rows, calls the same walker, and bakes the bumps into each feature item's `system.uses.max`. Per-item `flags['dauligor-pairing'].itemBumpUses` and a top-level `actor.flags['dauligor-pairing'].itemBumpUses` audit trail let the module side surface "where did this bump come from" without re-walking.
- Verification covered in [§ J of verification-scaling-non-class-owners.md](verification-scaling-non-class-owners.md#j-itembumpuses-end-to-end-phase-c-v1).

**What's still open**:
- **Feat-authored bumps in server export**. The export pipeline reconstructs the character from D1 via `rebuildCharacterFromSql`, which doesn't synthesize `character.feats` (the client-side synthesis walker owns that). Feat-authored bumps work app-side (runtime + warnings) but are silently dropped from the exported actor data. Unblocks once a server-side feat synthesizer ports the relevant slice of the client walker.
- **Items as bump authors**: items don't have an `advancements` column today, so ItemBumpUses can only be authored on classes / subclasses / feats in v1. Schema migration + ItemsEditor wiring is needed before items (Amulet of the Devout, etc.) can author bumps app-side.
- **Future modes**: `'addToChoice'` (extend a target ItemChoice's pool) and `'replace'` (full feature overwrite). Out of scope; treat as Phase D / E.

Created 2026-05-27. v1 end-to-end shipped on `feat/itembumpuses-advancement` (commits `fe71fdd` authoring + `656d96c` walker + `e709888` builder runtime + `960a99d` export).

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
