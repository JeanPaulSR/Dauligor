# Spell Picker by Spellcasting Type

The importer's `runSpellSelectionStep` (in
`module/dauligor-pairing/scripts/importer-app.js`) needs to behave
differently depending on what kind of spellcaster the class is.
Dauligor's ClassEditor exposes three values for `class.spellcasting.type`:

| Type | Real-world examples | Behavior in dnd5e |
|---|---|---|
| **`prepared`** | Cleric, Druid, Paladin | Each long rest, the player picks N spells to prepare from the class's full spell list. No "spells known" pool — the whole list is always available to prepare from. |
| **`known`** | Bard, Sorcerer, Warlock, Ranger | The player learns a fixed number of spells per the class table. Known spells are always available to cast without a preparation step. |
| **`spellbook`** | Wizard | The player maintains a *spellbook* that can hold any number of spells they've added over time (initial pool at L1, +2/level, plus found scrolls). Each long rest they prepare a subset from the spellbook using a formula (`INT mod + class level` in vanilla 5e). |

This doc describes what the picker is supposed to do for each type,
what data each type needs in the export bundle, and where the current
import path still has gaps.

## Source-of-truth fields

Every spellcasting class ships a `class.spellcasting` block from the
app-side export (`api/_lib/_classExport.ts:normalizeSpellcastingForExport`):

```jsonc
{
  "hasSpellcasting": true,
  "type": "known" | "prepared" | "spellbook",
  "level": 1,                                   // first class level that gets spellcasting
  "ability": "CHA",                             // CHA / INT / WIS
  "progression": "full" | "half" | "third" | "pact" | "artificer",
  "progressionTypeSourceId": "spellcasting-type-full-caster",
  "progressionTypeIdentifier": "full-caster",
  "progressionTypeLabel": "Full Caster",
  "progressionFormula": "1 * level",
  "spellsKnownSourceId": "spells-known-scaling-bard",   // OPTIONAL — see below
  "spellsKnownFormula": "@abilities.int.mod + @level",  // OPTIONAL — see below
  "isRitualCaster": false,
  "description": "<markdown>",
}
```

Plus a top-level `spellsKnownScalings` map keyed by the spell-known
source id (when one is set on the class), and a top-level
`classSpellItems` array — the curated spell pool baked from
`class_spell_lists` joined to `spells`.

## Per-type contract

### `known` — pick-on-level-up

- **What the importer should do**: at every level, compute the delta
  `cantripsKnown(targetLevel) − cantripsKnown(existingLevel)` and the
  same for `spellsKnown`. If either delta > 0, the picker fires. The
  player picks exactly that many cantrips + leveled spells from
  `classSpellItems`.
- **Required bundle data**:
  - `spellsKnownSourceId` set on the class
  - `spellsKnownScalings[<sourceId>].levels[<level>]` has both
    `cantrips` and `spellsKnown` fields per level
- **`spellsKnownFormula` should be empty / unused** — known casters
  don't prepare.
- **dnd5e `preparation.mode`** for individual known spells: `"always"`.

This is the "happy path" the current `runSpellSelectionStep` was
built for.

### `prepared` — pick cantrips only

- **What the importer should do**: same level-up delta for cantrips
  (these are picked-once and permanent), but NOT for spells —
  prepared casters never make level-up spell picks; they prepare daily
  from the full class spell list. The picker should fire for cantrip
  deltas only (or skip entirely when `cantripsToPick === 0`).
- **Required bundle data**:
  - `spellsKnownSourceId` set IF the class grants cantrips (Cleric,
    Druid). The scaling row's `levels[<level>].cantrips` drives the
    cantrip delta. `spellsKnown` should be 0 or unset for this row,
    because the picker should NOT prompt for leveled spells.
  - `spellsKnownFormula` set to the per-day prepared-count formula
    (`@abilities.wis.mod + @classes.cleric.levels` etc.). This ships
    through as `class.system.spellcasting.preparation.formula` so
    dnd5e shows the right max-prepared count on the sheet.
- **dnd5e `preparation.mode`** for individual prepared spells:
  `"prepared"`. The user toggles prep day-to-day.

> Open issue (May 2026): `computeSpellSelectionDelta` reads BOTH
> `cantrips` and `spellsKnown` from the same scaling row. A prepared
> class authored with `spellsKnown > 0` would trigger a spell-pick
> step it shouldn't. Authors should leave `spellsKnown` at 0 for
> prepared rows until the picker grows a type-aware split.

### `spellbook` — spellbook is open-ended, formula gates prep

- **What the importer should do**: cantrip pick on level-up (same as
  prepared). Spellbook spells are NOT a forced level-up pick — the
  spellbook can hold any number, and players add to it through play
  (level-up grant, scrolls, downtime). The class item ships
  `preparation.formula` so dnd5e tracks the per-day max-prepared
  count.
- **Required bundle data**:
  - `spellsKnownSourceId` set IF the class grants cantrips (Wizard
    gets 3 at L1, scaling to 4/5 later). The scaling row's
    `levels[<level>].cantrips` drives the cantrip delta. Leave
    `spellsKnown` at 0 or unset — the spellbook isn't picker-driven.
  - `spellsKnownFormula` set to the prepared-count formula
    (`@abilities.int.mod + @classes.wizard.levels`).
- **dnd5e `preparation.mode`** for individual spellbook spells:
  `"prepared"` (same as Cleric/Druid — they need daily prep). The
  spellbook spells without prep just sit in the spellbook as
  reference; the prepared subset is castable.

> Open issue (May 2026): the spellbook **initial population** (6
> spells at L1, +2/level) currently has no picker support. Players
> add spells manually post-import via the sheet. If we want to add a
> spellbook level-up picker later, it'd need either a separate
> "spellbook scaling" field on the class (parallel to the cantrip
> scaling) or a hardcoded formula like `6 + 2*(level-1)`. Decision
> deferred.

### Type → preparation mode mapping (in code)

`class-import-service.js:normalizeSpellPreparationMode` is the single
source of truth that translates `class.spellcasting.type` to the
dnd5e `preparation.mode` for the class item's
`system.spellcasting.preparation`:

```
"prepared"  → "prepared"
"spellbook" → "prepared"   (Wizard preps from spellbook)
"known"     → "always"     (Bard's known spells are always available)
```

Used to gate `normalizePreparedSpellFormula`, which only ships the
`preparation.formula` for the two formula-driven types (prepared and
spellbook).

## What the current `runSpellSelectionStep` does

```
buildClassImportWorkflow:
  workflow.hasSpellcasting = classItem.system.spellcasting.progression !== "none"
  workflow.spellcastingRows = buildCurrentSpellcastingProgressionRows(...)
    └─ reads payload.spellsKnownScalings[spellsKnownSourceId].levels

buildImportSequenceSteps:
  if (workflow.hasSpellcasting) {
    const delta = computeSpellSelectionDelta(workflow, actor);
    if (delta.cantripsToPick > 0 || delta.spellsToPick > 0) {
      push step "spells"
    }
  }

runDauligorClassImportSequence:
  if (workflow.hasSpellcasting) {
    const spellDelta = computeSpellSelectionDelta(workflow, actor);
    if (spellDelta.cantripsToPick > 0 || spellDelta.spellsToPick > 0) {
      await runSpellSelectionStep(...);  // 3-column picker
    }
  }
```

Notes:

1. **The picker is gated on `progression !== "none"`**, not on
   `type`. So all three types fire the picker if `progression` is set
   correctly (`full` / `half` / `third` / `pact` / `artificer`). The
   gate on whether to PICK SPELLS is the delta — and that's where
   per-type behavior currently leaks through the spreadsheet (authors
   must leave `spellsKnown: 0` for prepared/spellbook rows to skip the
   spell-pick column).

2. **The picker doesn't read `class.spellcasting.type`.** It just
   reads the scaling rows. So authoring discipline drives behavior —
   the type field is mostly metadata. The downstream consumer is
   dnd5e via `preparation.mode` and `preparation.formula`.

3. **Cantrip-only flows are valid** — the picker handles
   `cantripsToPick > 0, spellsToPick === 0` correctly (renders just
   the Cantrips section).

## Common gotchas

- **`progression` missing from the bundle** → class lands on the
  actor with `system.spellcasting.progression = "none"`, dnd5e
  excludes it from `actor.spellcastingClasses`, picker is skipped,
  Spell Preparation manager renders empty. Root cause has historically
  been the snake_case `foundry_name` read in
  `_classExport.ts:normalizeSpellcastingForExport` — see
  `docs/platform/d1-architecture.md` ("Row shape — snake_case is the
  wire shape") for the read convention.

- **Empty `classSpellItems`** → picker shows "No class spell list
  curated yet — skipping spell picks" and silently skips. Curate the
  per-class list at `/compendium/spell-lists?class={classId}` in the
  app.

- **Picker confirm fails with "Still need to pick N cantrips"** →
  the class's curated spell list has no level-0 (cantrip) entries.
  Authoring fix: add cantrips to the spell list, re-bake.

- **Class shows on the sheet but no spell slots** → check
  `system.spellcasting.progression` on the embedded class item. If
  `"none"` instead of `"full"`/`"half"`/etc., the class isn't a real
  caster on Foundry's side. Re-import after fixing the export.

## Related docs

- `module/dauligor-pairing/docs/foundry-spell-manager-inputs.md` —
  what the per-actor Spell Preparation manager reads from each spell
  item.
- `module/dauligor-pairing/docs/spell-preparation-manager-guide.md` —
  the standalone Prepare Spells window.
- `module/dauligor-pairing/docs/class-import-and-advancement-guide.md`
  — broader class-import contract; `system.spellcasting` is one
  section there.
- `docs/features/compendium-classes.md` (app side) — where authors
  set `type` / `progression` / formula / scaling on a class record.
