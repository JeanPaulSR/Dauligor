# Request → `compendium-editors`: activity CONSUMPTION exports a bad attribute-target format + unexpanded `@<col>` shorthand (2026-06-12)

**From:** `foundry-module` (live verification — Blood Hunter "Crimson Offering / Vital
Sacrifice"). The module passes activity `consumption` through faithfully; the bundle itself
carries two problems, both in the export. App-side.

## What Foundry shows
The Crimson Offering enchant activity errors on use:
> "Attribute **Maximum Override** configured to be consumed … could not be found."
> "Decrease Maximum Override **by 0** (currently **NaN**)."

## The bundle (prod, `ll/classes/alternate-blood-hunter.json` → `crimson-offering` →
activity `Crimson Offering (Fire)`)
```jsonc
"consumption": {
  "targets": [{
    "type": "attribute",
    "target": "system.attributes.hp.max",   // ← (1) bad target
    "value": "@rite-die",                    // ← (2) unexpanded shorthand
    "scaling": { "mode": "", "formula": "" }
  }]
}
```

## Problem 1 — attribute target format is wrong
dnd5e 5.x `ConsumptionTargetData.validAttributeTargets()` (dnd5e.mjs:4397) builds targets from
`TokenDocument.getConsumedAttributes(actor.type)`, which returns **prefix-less** keys
(`attributes.hp.value`, `abilities.str.value`, `currency.gp`, … — the code branches on
`attr.startsWith("abilities.")`, never `system.`). So:
- The **`system.` prefix is invalid** — the target must be `attributes.hp.value`, not
  `system.attributes.hp.value`. With the prefix, dnd5e can't match a valid target → "could not be found".
- **`hp.max` is the derived "Maximum Override"** (null/NaN on a normal actor) — not a consumable
  resource. The canonical Blood Hunter "pay HP" cost is **current HP** = `attributes.hp.value`.

**Ask:** the activity editor / export should emit attribute consumption targets **without the
`system.` prefix**, matching `getConsumedAttributes` (the editor's dropdown should store those
exact keys). If this is editor-authored, the dropdown is likely producing `system.…` — strip it.
(The user will also re-pick the field to **Hit Points** instead of "Maximum Override"; that's
authoring, but the prefix is a format bug that breaks *every* attribute consumption.)

## Problem 2 — `@<col>` shorthand not expanded in `consumption.targets[].value`
`@rite-die` shipped verbatim → Foundry can't resolve it → the consumed amount is NaN/0. The
`f78b5bb` shorthand fix expands `@rite-die` → `@scale.alternate-blood-hunter.rite-die` in
damage / dc / uses.max / roll / attack / healing formulas, **but not in
`consumption.targets[].value`** (a formula-bearing field — the consumed quantity). The effect
change values on the SAME feature ARE expanded correctly (`@scale.alternate-blood-hunter.rite-die[fire]`),
which is why the damage refs look right but the consumption value doesn't.

**Ask:** add `consumption.targets[].value` (and `consumption.targets[].scaling.formula`) to the
set of formula-bearing fields run through `normalizeSemanticReferenceText` at export, alongside
the existing damage/dc/uses keys.

## Verify
Re-export → the Fire activity's `consumption.targets[0]` reads
`{ target: "attributes.hp.value", value: "@scale.alternate-blood-hunter.rite-die" }`. Re-import
→ the activity consumes current HP equal to the Rite Die, no "could not be found" error.

## Deploy / rebake note
No DB change. Per the stored-R2-bake behavior, **re-bake** the affected classes after the deploy
(a class save / `queueRebake`) so the cached bundle refreshes — same as the prior class-export fixes.

## Verified under Midi-QOL (we run midi-qol 13.0.58 + dae 13.0.26)
Held this handoff until Midi's involvement was checked — confirmed against the installed Midi
13.0.58 source: **Midi delegates consumption entirely to dnd5e** (`MidiActivityMixin.use` →
`super.use` → dnd5e `Activity#use` → `consume()` → `ConsumptionTargetData.consumeAttribute`,
which prepends `"system."` itself — more proof the stored target must be prefix-less). Midi's
only touchpoints are observational (an `dnd5e.activityConsumption` listener that never modifies
updates) and dialog control (`checkAutoConsume` pre-flights dnd5e's own usage updates only to
decide whether to show the config dialog). A malformed target surfaces the same ConsumptionError
under Midi as vanilla. **So the two fixes above apply unchanged on our stack** — no
Midi-specific accommodation needed. Bonus data point: Midi's `skipConcentrationCheck` reads
`consumption.targets.some(t => t.target === "attributes.hp.value")` — the prefix-less canonical
form, from Midi's own source.

## Module side
No change — `normalizeSemanticActivityCollection` carries `consumption` through unmodified (the
imported activity matches the bundle exactly). Refs are expected resolved at export, and the
target format is the export's to emit correctly.
