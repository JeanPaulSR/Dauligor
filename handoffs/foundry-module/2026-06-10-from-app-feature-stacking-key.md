# FYI (no action required) — features.stackingKey + character feature dedup

**From:** app team (`settings-pages`)
**To:** foundry-module (`dauligor-pairing`)
**Status:** informational — **no module code change required.**

## What changed app-side
Inter-feature cooperation v1: a new **`features.stackingKey`** column (camelCase,
TEXT, default `''`). Features that share a non-empty key are "the same" feature
across classes (e.g. `extra-attack`, `unarmored-defense`). When a multiclass
character is granted the same-key feature by more than one class, the character
builder now **collapses them to a single granted feature** (5e-correct — they
don't stack), keeping the lowest-unlock-level instance and noting the others.

Backfilled so far: `extra-attack`, `unarmored-defense`. (Channel Divinity is
intentionally NOT keyed — it's a per-class resource pool, deferred to v2.)

## Why you don't need to do anything
- **Character export** (`characterShared.ts` → Foundry actor) builds feature
  items from the already-collapsed `progressionState.ownedFeatures`. So an
  exported Warlock/Fighter no longer ships **two** "Extra Attack" items — you
  receive the deduplicated set. This is the fix for the prior
  "module must dedupe downstream" gap; nothing to do on your side.
- **Class-template export** still ships every feature row (with `stackingKey`
  as passive metadata). Ignore the field unless you want to use it.

## Schema-crosswalk
Please note the new `features.stackingKey` column in
`module/dauligor-pairing/docs/schema-crosswalk.md` when convenient. It's
app-internal dedup metadata; no Foundry-native mapping is needed.
