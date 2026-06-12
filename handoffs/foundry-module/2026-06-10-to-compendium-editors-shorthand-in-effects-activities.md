# Request → `compendium-editors`: expand the `@<column>` class-shorthand in effect/activity FORMULAS, not just the help panel (2026-06-10)

**From:** `foundry-module` (diagnosing a broken Foundry round-trip). **App-side fix**
— `foundry-module` doesn't edit `src/lib` / `api/_lib` / the editors per the
cross-branch rule, so this is a request with the exact change scoped.

## TL;DR
The in-class column shorthand (`@rite-die` → `@scale.alternate-blood-hunter.rite-die`)
is **only applied in the reference-help display**. It is **not** applied to **effect
change values** or **activity formulas** at save or export, so a feature authored with
`@rite-die[acid]` in an effect ships to Foundry as `@rite-die[acid]` → Foundry has no
`rite-die` in roll data → it resolves to **0**. Please run those formula-bearing
fields through the existing shorthand expander on export (the function already exists
and already guards correctly).

## Repro / impact
Authoring a Blood Hunter "Rite"/elemental-weapon feature whose effect adds typed
bonus damage scaled by the Rite Die:
```
system.bonuses.mwak.damage   Add   + @rite-die[acid]
```
Exports verbatim → Foundry can't resolve `@rite-die` → no bonus damage. The author has
to know to hand-write the full `@scale.alternate-blood-hunter.rite-die[acid]`, which
contradicts the reference panel's promise ("inside this class you can use the column
identifier directly").

## Root cause (exact locations)
- The rewriter exists and is correct: `src/lib/referenceSyntax.ts:318` `applyClassColumnShorthand`
  (`@<col>` → `@scale.<class>.<col>`, guarded to **known class columns** via `validColumns`,
  negative-lookahead so `@rite-die[acid]` rewrites only `@rite-die` and leaves `[acid]`).
  Exposed via `normalizeSemanticReferenceText` (`:262`).
- **Its only caller is `src/components/reference/ReferenceSyntaxHelp.tsx:51`** — the help
  panel. Nothing in the activity/effect editor save path or the class export calls it.
- Class export passes feature effects raw: `api/_lib/_classExport.ts` (`effects:
  feature.automation?.effects || []`); the per-column `@scale` map there is only used for
  scaling-column formulas + `@scale.linked` resolution, not author-entered effect/activity formulas.
- Module side is already correct + needs no change: `class-import-service.js:2992`
  passes `change.value` through verbatim, and `:1969` documents that scale refs are
  expected "resolved to `@scale.<class>.<column>` at export." So the module is built to
  receive the **full** form — the expansion has to happen on your side.

## The ask
At **export** (the Foundry-bound output is the boundary; the DB can keep the
author-friendly shorthand — that matches the Dauligor-form vs Foundry-form model your
reference panel documents), run the shorthand expander over the **formula-bearing
fields** of activities + effects, using the existing
`normalizeSemanticReferenceText(value, <foundry/native mode>, { classIdentifier, classColumns })`:

- **Effect** `changes[].value` (the immediate break — e.g. `system.bonuses.*.damage`).
- **Activity** roll-formula fields: damage part custom formulas / bonuses, `uses.max`,
  save-DC formulas, healing formulas — anywhere a class-column shorthand can appear.

The expander already (a) only touches identifiers that are real columns of **this**
class (`validColumns`), so unknown `@foo` is left alone, and (b) won't double-expand an
already-qualified `@scale.…` (negative lookahead). So it's safe to run broadly.

(Equivalent save-time normalization in the editors would also work, but export-time is
the cleaner single choke point and keeps the stored value in the author's shorthand.)

## Verify
Author a feature effect change value `@rite-die[acid]` on the Blood Hunter (identifier
`alternate-blood-hunter`, column `rite-die`) → export the class →
the bundle's `effects[].changes[].value` is `@scale.alternate-blood-hunter.rite-die[acid]`.
Import into Foundry → the bonus damage resolves to the Rite Die, typed acid.

## Secondary (optional)
- **Import round-trip:** if you want a Foundry→app re-import to restore the shorthand,
  collapse `@scale.<thisClass>.<col>` back to `@rite-die` for this class's own columns;
  otherwise leaving the full form is harmless (it still resolves + re-exports identically).
- **Help-panel wording:** until this lands, "use the column identifier directly" is true
  only for descriptions/help — consider scoping that note, or (better) just ship this so
  it's true everywhere.
