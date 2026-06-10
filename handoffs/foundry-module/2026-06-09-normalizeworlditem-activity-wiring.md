# Request-handoff → `foundry-module` branch: wire the semantic-activity converter into `normalizeWorldItem`

**From:** `compendium-editors` (app side) · **Date:** 2026-06-09
**Owner to action:** whoever holds `module/dauligor-pairing` (the `foundry-module` branch is its steward).
**Type:** cross-branch request (app side won't edit module files per the "Cross-Branch = Handoff, Not Self-Modify" rule).

## TL;DR
The app now stores **standalone item AND feat activities in the SEMANTIC shape** (`kind`/`id`, flat `attack.type`) — the same shape class features already use. The module already has a complete semantic→Foundry-native converter, but it's **only wired for class features/options**, not for the standalone-item path (`normalizeWorldItem`). So a re-imported weapon/feat with activities reaches Foundry with `kind`/flat-attack instead of `type`/nested-attack, which dnd5e's activity schema won't accept. **Please run `system.activities` through the existing `normalizeSemanticActivityCollection` inside `normalizeWorldItem`, guarded so it only touches semantic-shaped activities.**

## Why this is needed now (app-side change that triggered it)
On `compendium-editors` (shipping under prod `e3f70b7` + the follow-up below), the Foundry importers were unified onto one converter, `foundryActivityToSemantic` (now in `src/lib/foundryActivities.ts`, shared by `itemImport.ts` / `featImport.ts` / `spellImport.ts`). It maps a raw Foundry activity → our `SemanticActivity`:
- `type` → `kind`, `_id` → `id`
- `attack.type:{value,classification}` → flat `attack.type` + `attack.classification`
- `save.ability` → `save.abilities`, `damage.critical:{bonus}` → `{allow,bonus}`, `description.chatFlavor` → `chatFlavor`

This was required so the app's **kind-based `ActivityEditor`** can render imported activities (previously they came in raw and showed blank). The canonical app model is now: **everything is `SemanticActivity`** (features were already; items + feats now are; spells' editable copy is too).

## Current module state (already correct, just under-wired)
- `class-import-service.js:2781 normalizeSemanticActivityCollection(activities, idMaps)` and `:2798 normalizeSemanticActivity(...)` are a **complete** semantic→Foundry converter. `:3081 normalizeSemanticAttack` rebuilds the nested `attack.type:{value,classification}` — the exact inverse of the app flatten. It reads `kind ?? type` and `id ?? _id`, and accepts an array **or** a keyed object.
- It's invoked for **features** (`:1771` `feature.automation.activities`) and **option items** (`:2000`). ✅ those round-trip.
- `normalizeWorldItem` (`:3936`) — the standalone path used by `dauligor.item.v1`, feats, and spell embeds (callers at `:66/:124/:371/:5509`) — **does not** touch `system.activities`; it passes them through verbatim. ❌ this is the gap.

Export side for confirmation: the app emits `system.activities` straight from the stored semantic array (`_itemExport.ts:448` / `_featExport.ts:284` → `arrayToFoundryMap`), so the bundle's `system.activities` is `{ <key>: <SemanticActivity> }`.

## Requested change
In `normalizeWorldItem` (after the existing flag/source setup, before `return clone`), convert `clone.system.activities` through the existing collection normalizer — **guarded** so it fires only on semantic-shaped activities:

```js
// Standalone items/feats now ship SEMANTIC activities (kind/id, flat attack)
// — the same shape features use. Run them through the same converter the
// feature path uses (line ~1771). Guard on "looks semantic" so we never
// double-convert a raw-Foundry activity (e.g. a spell whose activities came
// straight off its preserved foundry_data, which is already native).
if (clone.system?.activities && hasSemanticActivities(clone.system.activities)) {
  const idMaps = buildItemIdRemap({
    activities: clone.system.activities,
    effects: clone.effects,
  });
  const converted = normalizeSemanticActivityCollection(clone.system.activities, idMaps);
  if (converted) clone.system.activities = converted;
}
```

with a small guard helper:

```js
function hasSemanticActivities(activities) {
  const list = Array.isArray(activities) ? activities : Object.values(activities || {});
  // Semantic activities carry `kind`; raw-Foundry ones carry a string `type`
  // and a nested attack.type. Only the former should be re-normalized.
  return list.some((a) => a && typeof a === "object" && typeof a.kind === "string");
}
```

Notes for whoever applies it:
- `buildItemIdRemap` is already used by the feature path (`:1770`); mirror that call shape. If `clone.effects` isn't the right effects location for a world item, adjust — the goal is just that activity-level `effects[]._id` / `forward.activity.id` cross-refs rekey consistently (same as features).
- The guard matters because the converter reads `kind ?? type`; handing it a raw-Foundry activity would make `normalizeSemanticAttack` read the **nested** `attack.type` object as if flat and corrupt it. The `hasSemanticActivities` check keeps raw-Foundry passthroughs (notably spells) untouched.

## What NOT to change
- **Spells.** Their round-trip source of truth is the preserved `foundry_data` (raw Foundry system block), not the semantic `activities` column. If a spell embed's `system.activities` is already native, the guard skips it. Don't force-convert spells here.
- The feature/option wiring (`:1771`/`:2000`) is correct as-is — leave it.

## Verification
1. From the app, export a **weapon with an activity** (e.g. Blackrazor: an `attack` + a `cast`) and a **feat with a save activity** (e.g. a Breath-Weapon trait).
2. Import each into Foundry via the module.
3. Confirm the item's Activities tab shows the native activity (Attack/Cast/Save) with the right damage/attack config — not an empty/invalid activity. Check `item.system.activities[<id>].type` is the Foundry slug and `attack.type` is the nested `{value,classification}`.
4. Regression: import a **spell** and confirm its activities still come through (via the foundry_data path) — the guard should have skipped re-conversion.

## Pointers
- App converter: `src/lib/foundryActivities.ts` (`foundryActivityToSemantic`) — the inverse of `normalizeSemanticActivity`. Keep the two in sync if Foundry's activity schema shifts.
- App audit of who stores semantic vs raw: items ✅, feats ✅, spells ✅ (editable copy; foundry_data stays raw for round-trip), features ✅ (authored), species/backgrounds n/a (advancement-driven, no activities).
- Module contract index: `module/dauligor-pairing/docs/import-contract-index.md`.
