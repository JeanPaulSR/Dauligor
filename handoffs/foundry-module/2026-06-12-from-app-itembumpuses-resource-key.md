# FYI → foundry-module: ItemBumpUses target is now resource-key-resolved

From `settings-pages` (worktree kind-wright). Written 2026-06-12. **Informational —
no module code change required.** Mirrors the precedent set by the `stackingKey`
collapse handoff (2026-06-10): the app resolves, the module consumes the resolved output.

## What changed (app side)
The `ItemBumpUses` advancement was generalized from "bump one explicit feature/feat by
row-id" to **"bump a named RESOURCE, resolved to its holder"** (item-first → feature,
class→subclass→feat, with an optional manual preferred target). Resolution is entirely
app-side + bake-time, exactly as before. The exporter still:
- bakes the combined formula onto each feature item's `system.uses.max` via
  `combineUsesMaxWithBumps` (unchanged), and
- writes the per-item + actor-level `flags['dauligor-pairing'].itemBumpUses` audit data.

The module already only **consumes the baked `system.uses.max`** and never re-resolves a
target, so nothing breaks.

## Audit-flag shape additions (only if your debug/audit UI reads them)
The `itemBumpUses` entries gained two optional fields and the target/holder kind union
widened. Update `module/dauligor-pairing/docs/schema-crosswalk.md` +
`docs/advancement-construction/advancement-families.md` when convenient:
- Per-bump entries (`ItemBumpEntry`) may now carry:
  - `resolvedVia?: 'preferred-target' | 'resource-key'`
  - `resourceKey?: string` (the key matched, when resolved by key)
- Holder/target kind is now `'item' | 'feature' | 'feat'` (was `'feature' | 'feat'`).
  The actor-level `itemBumpUses.bumps` map keys are `${kind}:${id}`, so `item:<id>` keys
  can appear.
- New warning reason: `'resource-not-found'` (alongside `target-not-present` /
  `target-missing-id`) in `itemBumpUses.warnings`.

## The one real downstream gap (shared, not yours to fix now)
The app exporter does **not emit inventory items**, so an *item*-resolved bump currently
has no exported item to bake onto. The app therefore keeps item holders out of the live
resolution for now (feature/feat holders only); item resolution is built + unit-tested but
inert until the app starts emitting + baking inventory-item `uses`. When that lands the
app will feed item candidates through the same walker, and `item:<id>` bump entries will
start carrying real bakes — at which point your audit UI (if any) should expect them.
No action needed today.
