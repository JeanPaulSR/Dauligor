# FYI (no action required) — class/subclass `castingMode` ↔ native `progression: 'pact'`

**From:** app team (`settings-pages`)
**To:** foundry-module (`dauligor-pairing`)
**Status:** informational — **no module code change required.** Recording the
contract per the cross-branch-handoff norm.

## What changed app-side
The class editor now has a first-class **Casting Mode** selector
(Standard Spellcasting vs **Pact Casting**), replacing the deprecated
`progressionId === 'custom'` + `altProgressionId` ("alternative spellcasting")
mechanism. A new field rides in the class/subclass `spellcasting` JSON:

```
spellcasting.castingMode: 'spellcasting' | 'pact'   // default 'spellcasting'
```

- **Standard** casters are unchanged: the Full/Half/Third progression maps to a
  native Foundry `progression` (`full`/`half`/`third`/`artificer`) as before.
- **Pact** casters: the same Full/Half/Third progression now scales the
  *pact-caster level*, which the app's own character builder looks up in a new
  **Pact Master Chart** (`multiclass_master_chart` row id `'pact'`). In Foundry
  this is just Warlock-style casting.

## The export/import contract (why you don't need to do anything)
- **App → Foundry (export):** a pact-mode class/subclass now always exports
  native **`system.spellcasting.progression: 'pact'`** (see
  `normalizeSpellcastingForExport` in `src/lib/classExport.ts` /
  `api/_lib/_classExport.ts`). `'pact'` is already in your import contract's
  native enum (`class-import-contract.md`), so Foundry computes Warlock slots
  natively. `castingMode` also rides along in the JSON as an app-internal hint;
  Foundry can ignore it.
- **Foundry → App (import):** the app's `importClassSemantic` derives
  `castingMode` from `progression === 'pact'` when a bundle doesn't carry it.
  So `export-service.js` does **not** need to emit `castingMode` — keep emitting
  the native `progression` exactly as you do today and the app fills in the rest.

## Retired
The deprecated `altProgressionId` pointer + the `alternativeSpellcastingScalings`
bundle section are no longer used for pact classes (cleared on save). The bundle
section remains in the export for back-compat but will be empty for pact-mode
classes going forward.

## Edge case (not actionable now)
Foundry's native `pact` progression = full Warlock. The app additionally supports
"half/third pact" homebrew by scaling the pact-caster level app-side via the Pact
Master Chart; those would still export as native `pact` (closest native value).
Flag it if you ever want a richer representation — otherwise no action.
