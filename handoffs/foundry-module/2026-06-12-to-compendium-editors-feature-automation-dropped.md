# Request → `compendium-editors`: class export drops EVERY feature's activities + effects (wrong source path) (2026-06-12)

**From:** `foundry-module` (live import verification). **App-side fix** — `foundry-module`
doesn't edit `src/lib` / `api/_lib`, so this is a scoped request with the exact diff.

## TL;DR
The class-export bundle builds each feature's `automation: { activities, effects }` by
reading **`feature.automation?.activities` / `feature.automation?.effects`** — but the
denormalized feature object has those at **top level** (`feature.activities` /
`feature.effects`); there is no `feature.automation`. So the optional-chain is always
`undefined` and **every feature ships with `automation.activities: []` and
`automation.effects: []`**, even when the DB row has real data. The top-level fields are
then omitted, so the data is dropped entirely. One-line source-path fix in both
drift-paired files.

## Repro (empirical, prod)
`GET https://www.dauligor.com/api/module/ll/classes/alternate-blood-hunter.json` →
feature **Crimson Offering** (`crimson-offering`) → `automation.activities: 0`,
`automation.effects: 0`.

But the DB row HAS the data:
```
features.id = 25a74dee-f5a4-4c28-a634-08f2547a4477  (crimson-offering, parent_type=class)
  activities  LENGTH 4206  →  [{"id":"q2VSfyQKR9oRIf6r","kind":"enchant","name":"Crimson Offering (Acid)", …}]
  effects     LENGTH 2750  →  [{"_id":"deMcQoNj1pYVpoXU","name":"Crimson Offering (Acid)","changes":[…]}]
```
So the bake reads the row, denormalizes `activities`/`effects` to top level, then the
`automation` wrapper looks in the wrong place → empties them. (Sibling "Improved Crimson
Offering" is genuinely `[]` in the DB — correctly empty. Not part of this bug.)

This is **not new** — it means class feature activities/effects have **never** exported.
It also means the `f78b5bb` shorthand expansion is currently a no-op for features (it runs
`expandActivityFormulas`/`expandEffectChanges` over the empty arrays). This fix makes that
fix actually do its job.

## Root cause (exact locations — BOTH drift-paired files, identical)
`denormalizeFeatureRow` exposes the columns at top level:
```ts
// api/_lib/_classExport.ts  (denormalizeFeatureRow)
activities: parseJsonField(row.activities, []),
effects:    parseJsonField(row.effects, []),
```
…but the feature→bundle map reads `feature.automation?.…`:
```ts
// api/_lib/_classExport.ts : ~1377   AND   src/lib/classExport.ts : ~1414   (identical)
automation: {
  activities: expandActivityFormulas(Array.isArray(feature.automation?.activities)
    ? feature.automation.activities
    : Object.values(feature.automation?.activities || {})),
  effects: expandEffectChanges(feature.automation?.effects || [])
}
```
`feature.automation` is undefined for features (only the unique-option-ITEM path builds an
`automation` wrapper — the feature path copied that assumption without the wrap). So both
collapse to `[]`, and the omit list (`'activities', 'effects'`) drops the real top-level data.

## The fix (both files — change the source path to the top-level fields)
```ts
automation: {
  activities: expandActivityFormulas(Array.isArray(feature.activities)
    ? feature.activities
    : Object.values(feature.activities || {})),
  effects: expandEffectChanges(Array.isArray(feature.effects) ? feature.effects : [])
}
```
i.e. `feature.automation?.activities` → `feature.activities` (both branches) and
`feature.automation?.effects` → `feature.effects`. **Keep** the `expandActivityFormulas` /
`expandEffectChanges` wrappers (f78b5bb) — they'll now have data to expand, which is the
point. The omit list stays as-is (top-level fields still dropped, now that they're read
into `automation` first). Apply to **both** `api/_lib/_classExport.ts` and
`src/lib/classExport.ts` per the "update both" header.

## Module side is already correct — this closes the round-trip
The importer consumes exactly the produced shape, no module change needed:
- `class-import-service.js:1771` `normalizeSemanticActivityCollection(feature?.automation?.activities, idMaps)`
- `class-import-service.js:1794` `effects: normalizeSemanticItemEffects(feature?.automation?.effects, idMaps)`
- `class-import-service.js:1738` stashes `feature.automation` → `flags.semanticAutomation`

So once the bundle carries `automation.{activities,effects}`, Foundry import populates the
feature's `system.activities` + effects. (The same `automation` shape is read for unique
option ITEMS, which DO work today — further confirming the shape is right and only the
feature source path is wrong.)

## Verify
1. Re-export `alternate-blood-hunter` → bundle `features[]` for `crimson-offering` has
   `automation.activities.length > 0` (the `enchant` activity) and
   `automation.effects.length > 0` (the AE with `changes`).
2. Re-import the class in Foundry → Crimson Offering shows its Enchant activity + active
   effect (and, per f78b5bb, any `@rite-die[acid]` in those resolves to
   `@scale.alternate-blood-hunter.rite-die[acid]`).

## Deploy note
If the module endpoints serve a STORED bake, re-bake classes that have feature
activities/effects after the fix deploys (Alternate Blood Hunter at minimum). If the export
runs live per request, the deploy alone fixes it. No DB change, no migration.
