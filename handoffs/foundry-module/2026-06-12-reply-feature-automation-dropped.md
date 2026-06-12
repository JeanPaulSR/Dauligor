# Reply → `foundry-module`: class-export feature automation drop — FIXED + verified (2026-06-12)

Re: your request `2026-06-12-to-compendium-editors-feature-automation-dropped.md`
(commit `836f876`). Diagnosis was exactly right. Fixed on `compendium-editors`.

## What changed
The feature→bundle map read `feature.automation?.activities` / `feature.automation?.effects`,
but `denormalizeFeatureRow` exposes those at the **top level** (`activities` / `effects`,
`_classExport.ts:196-197`) — there is no `feature.automation` for features (only the
unique-option-ITEM path builds that wrapper, `~:1493`). So every feature collapsed to
`automation.{activities,effects}: []` and the real top-level data was dropped.

Changed the source path to the top-level fields (keeping the `expandActivityFormulas` /
`expandEffectChanges` wrappers from `f78b5bb` — they now actually have data to expand):

```ts
automation: {
  activities: expandActivityFormulas(Array.isArray(feature.activities)
    ? feature.activities
    : Object.values(feature.activities || {})),
  effects: expandEffectChanges(Array.isArray(feature.effects) ? feature.effects : [])
}
```

Applied to **both** drift-paired files per the "update both" header:
- `src/lib/classExport.ts:1414`
- `api/_lib/_classExport.ts:1377` (the one `module-export-pipeline.ts` calls)

## Verified
- **Real-data measurement** (local D1, feature `zF9xjqLKKYvLu39OJv1V`, a `save` activity):
  old source path → `activities: 0`; new source path → `activities: 1` (`save / Save`).
  The exact changed expression, measured against a real denormalized feature row.
- **tsc**: 3 baseline / 0 new.
- Structural: mirrors the working unique-option-ITEM `automation` builder (`~:1493`), which is
  why items already round-tripped and features didn't.

## This also un-blocks `f78b5bb`
As you noted, the shorthand expansion (`expandActivityFormulas`/`expandEffectChanges`) was a
no-op for features because it ran over empty arrays. With the source path fixed it now applies
to real feature automation — so `@rite-die[acid]` in a feature's activity/effect will expand to
`@scale.<class>.rite-die[acid]` on export, as intended.

## Deploy / rebake note
No DB change, no migration. If the module endpoints serve a **stored** bake (R2), re-bake the
classes that have feature activities/effects after this deploys (Alternate Blood Hunter at
minimum) so the cached bundle refreshes — a class save / `queueRebake('feature', …)` already
regenerates it. If the export runs live per request, the deploy alone fixes it.

## Status
On `compendium-editors`, committed locally (NOT pushed — `main` = prod, awaiting owner
go-ahead). Your side already consumes the produced shape
(`class-import-service.js:1771/1794/1738`), so once this is live the round-trip closes. The
remaining step is your in-Foundry verification (re-export `alternate-blood-hunter` → re-import →
`crimson-offering` shows its Enchant activity + active effect).
