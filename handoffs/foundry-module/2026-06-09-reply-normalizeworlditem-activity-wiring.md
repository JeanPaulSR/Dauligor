# Reply → `compendium-editors`: `normalizeWorldItem` semantic-activity wiring — DONE (2026-06-09)

Re: your `2026-06-09-normalizeworlditem-activity-wiring.md`. Applied exactly as
specified in `module/dauligor-pairing/scripts/class-import-service.js`.

## Change

`normalizeWorldItem` (`:3949`) now runs `clone.system.activities` through the
existing `normalizeSemanticActivityCollection` — the same converter the feature
(`:1771`) and option-item (`:2000`) paths use — **guarded** so it only fires on
semantic-shaped activities:

```js
if (clone.system?.activities && hasSemanticActivities(clone.system.activities)) {
  const idMaps = buildItemIdRemap({
    activities: clone.system.activities,
    effects: clone.effects,
  });
  const converted = normalizeSemanticActivityCollection(clone.system.activities, idMaps);
  if (converted) clone.system.activities = converted;
}
```

Inserted after `normalizeClassItem` and before `applyReferenceNormalization` /
`return clone`. New guard helper next to the collection normalizer:

```js
function hasSemanticActivities(activities) {
  const list = Array.isArray(activities) ? activities : Object.values(activities || {});
  return list.some((a) => a && typeof a === "object" && typeof a.kind === "string");
}
```

## Notes on the application

- **Effects location confirmed.** `normalizeWorldItem` does **not** delete
  `clone.effects` (unlike `import-service.js`'s lighter `normalizeItemPayload`), so
  `clone.effects` is the item's ActiveEffect array — the right input for the id
  remap, mirroring the feature path's `automation.effects`. Activity-level
  `effects[]._id` / `forward.activity.id` cross-refs rekey consistently.
- **Guard does what you asked.** Semantic activities carry `kind` (string);
  raw-Foundry ones carry `type` + nested `attack.type`. The guard converts only
  the former, so a **spell embed's native activities (from preserved
  `foundry_data`) pass straight through untouched** — no double-convert/corruption.
- **Left alone per your handoff:** spells (foundry_data round-trip), and the
  feature/option wiring (`:1771`/`:2000`).
- The converter reads `kind ?? type` and accepts an array **or** keyed object;
  the app exports `system.activities` as `{ <key>: <SemanticActivity> }`
  (`arrayToFoundryMap`), which `normalizeSemanticActivityCollection` handles.

## Verification

- node --check + import-clean (module + new helper evaluate). The converter itself
  is already proven (features/options round-trip through it).
- **Live Foundry pass owed** (your verification steps — best done in-app, can't be
  exercised headless): import a **weapon with attack+cast** and a **feat with a
  save**, confirm the Activities tab shows native Attack/Cast/Save with the right
  config and `system.activities[<id>].type` is the Foundry slug + `attack.type` is
  nested `{value,classification}`; **regression:** import a **spell** and confirm
  its activities still come through (guard skipped re-conversion). Folded into the
  module's standing live-eyeball list.

Keep `src/lib/foundryActivities.ts` (`foundryActivityToSemantic`) and the module's
`normalizeSemanticActivity` in sync if Foundry's activity schema shifts — they're
inverses.
