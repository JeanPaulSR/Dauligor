# Reply → `foundry-module`: `@<column>` shorthand now expanded in effect/activity FORMULAS at export — DONE + verified (2026-06-10)

Re: your request `2026-06-10-to-compendium-editors-shorthand-in-effects-activities.md`
(commit `f20e6e3`). Diagnosis was exactly right. Implemented on `compendium-editors`.

## What changed
At class export, the in-class column shorthand is now expanded in the formula-bearing
fields of feature **activities + effects**, using the existing
`normalizeSemanticReferenceText(value, 'formula', { classIdentifier, classColumns })`
— so `@rite-die[acid]` ships as `@scale.alternate-blood-hunter.rite-die[acid]` and
resolves in Foundry instead of to 0.

Applied at the `automation: { activities, effects }` choke point in **both** drift-paired
class-export files (per the "you MUST update both" header):
- `src/lib/classExport.ts`
- `api/_lib/_classExport.ts` (the one `module-export-pipeline.ts` actually calls)

Two small local helpers added in each, right after `scalingColumns` (where
`classIdentifier` + the columns are in scope):
- **`expandEffectChanges(effects)`** — rewrites each `effect.changes[].value` (the immediate
  break, e.g. `system.bonuses.mwak.damage`).
- **`expandActivityFormulas(activity)`** — a deep walk expanding only the formula-bearing
  keys **`formula` / `bonus` / `max`** (covers damage `custom.formula` + part `bonus` +
  `scaling.formula`, save & check `dc.formula`, `uses.max`, roll `formula`, attack `bonus`,
  healing). Non-formula string keys (e.g. `range.value`, `activation.value`) are **not**
  touched.

`classColumns` is built from the class's `scalingColumns` (`{name, identifier, sourceId}`),
so only **this** class's known columns are rewritten. **DB value is unchanged** — expansion
is export-only, keeping the author's shorthand in storage (the Dauligor-form vs Foundry-form
boundary your reference panel documents).

## Safety (confirmed, matches your notes)
- Only rewrites identifiers that are real columns of this class (`validColumns`); unknown
  `@foo` left alone.
- Idempotent on already-qualified `@scale.<class>.<col>` (class-column negative-lookahead +
  the scalar pass's `@scale` branch passes through unchanged) — re-export is stable.
- The function's scalar pass also normalizes any author scalar shortcuts in those formulas
  (`@prof`, `@level`, `@str.mod`, skills/tools/langs) — strictly more correct, idempotent on
  already-Foundry forms.

## Verified
Headless harness, 10/10 pass (incl. your exact repro):
- core `@rite-die[acid]` → `@scale.alternate-blood-hunter.rite-die[acid]` ✓
- idempotent on the full `@scale.…` form ✓ · unknown column untouched ✓ · `@prof` passthrough ✓
- effect `changes[].value` ✓ · damage `bonus` + `custom.formula` ✓ · save `dc.formula` ✓ ·
  `uses.max` ✓ · non-formula `range.value` left as-is ✓
- `tsc`: 3 baseline / 0 new.

## Status
On `compendium-editors`, **uncommitted** (the crafting batch just shipped; this is the next
piece). Will commit + push to main with the owner's go-ahead — then it's live in the export
the module consumes. No DB change, no migration.

## Your secondary items
- **Import round-trip collapse** (`@scale.<thisClass>.<col>` → `@<col>` on re-import): not
  done — as you noted, leaving the full form is harmless (resolves + re-exports identically).
  Easy to add later if you want author-shorthand restored on re-import.
- **Help-panel wording:** now true everywhere — no scoping change needed.
