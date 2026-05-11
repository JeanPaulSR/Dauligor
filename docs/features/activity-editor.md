# Activity Editor

The shared `<ActivityEditor>` is used wherever the app authors dnd5e 5.x activities — class features, subclass features, modular option items (Maneuvers / Invocations / Infusions), feats, items, and spells. One component, eleven activity kinds, one round-trip into the Foundry module.

This doc is a developer tour: where the editor lives, what each sub-component owns, what UX patterns are reused from elsewhere in the compendium, and what's deliberately kept inline.

## Where it's used

| Editor | Tab |
|---|---|
| Class features ([`ClassEditor.tsx`](../../src/pages/compendium/ClassEditor.tsx)) | Feature modal → Activities |
| Subclass features ([`SubclassEditor.tsx`](../../src/pages/compendium/SubclassEditor.tsx)) | Feature modal → Activities |
| Modular option items ([`UniqueOptionGroupEditor.tsx`](../../src/pages/compendium/UniqueOptionGroupEditor.tsx)) | Option modal → Activities |
| Feats / items / spells | Editor's Activities tab |

Each call site passes `activities` (array or map) and an `onChange` callback. The editor handles add/edit/remove + per-activity dialog state internally.

## Activity types

All 11 canonical dnd5e 5.x activity kinds are supported and schema-complete (audited against Foundry's reference `ActivityConfig` JSON dumps in `E:\DnD\Professional\Foundry-JSON\windows`):

| Kind | Purpose |
|---|---|
| `attack` | Roll to hit a target, then deal damage |
| `cast` | Cast a linked spell from a spellbook |
| `check` | Request an ability check from a creature |
| `damage` | Deal damage without an attack roll |
| `enchant` | Apply magical properties to a held item |
| `forward` | Delegate execution to another activity |
| `heal` | Restore hit points |
| `save` | Force a saving throw, with optional damage |
| `summon` | Conjure creatures into the encounter |
| `transform` | Shift the user into an alternate form |
| `utility` | Perform a custom roll or passive effect |

`KIND_DESCRIPTIONS` and the per-kind defaults live in `ActivityEditor.tsx` (look for `handleAddActivity`).

## Layout

The editor's modal is **fixed `h-[720px] max-h-[90vh]`** so it doesn't resize when authors flip between tabs — same stable-shell pattern `ActiveEffectEditor` uses. The dialog content is a centered `max-w-4xl` (Foundry's reference width is 560px; we run wider to fit our tab structure).

Three top-level tabs:

- **Identity** — Name, image, kind-aware sections (attack type + classification, save abilities + DC, check ability + associated, etc.), Visibility (level range + Class Identifier picker).
- **Activation** — sub-tabs for Time, Consumption, Targeting. Carries `activation`, `duration`, `consumption`, `uses`, `range`, `target` sub-objects.
- **Effect** — kind-specific output: damage/healing parts, save's on-save handler, check's DC + abilities, applied effects.

Section visuals use a shared [`<ActivitySection>`](../../src/components/compendium/activity/primitives.tsx) — a gold-tinted header bar with a left-edge accent stripe and a real container box around the row group. Replaced the earlier "tiny label between dashed lines" pattern that was easy to miss while scrolling.

## File layout

Originally `ActivityEditor.tsx` was a single 2,379-line file. Refactored across `0e770d6` and `2c7a03a` into a smaller shell + colocated sibling files under `src/components/compendium/activity/`. Behaviour identical — pure separation.

| File | LOC | Responsibility |
|---|---|---|
| [`ActivityEditor.tsx`](../../src/components/compendium/ActivityEditor.tsx) | ~1,560 | Main dialog shell, kind picker, Identity-tab kind-specific sections, Effect-tab assembly, sanitize+save pipeline |
| [`activity/constants.ts`](../../src/components/compendium/activity/constants.ts) | 157 | All option catalogs (recovery period / target type / damage type / creature size / etc.) + CSV/int parse helpers. Single source of truth so sub-editors don't prop-drill or duplicate arrays |
| [`activity/primitives.tsx`](../../src/components/compendium/activity/primitives.tsx) | 50 | `<ActivitySection>` + `<FieldRow>` shared form scaffolding |
| [`activity/DamagePartEditor.tsx`](../../src/components/compendium/activity/DamagePartEditor.tsx) | ~260 | Damage / healing `parts[]` array (used by attack / save / damage / heal). `singlePart` prop for the fixed-length healing case |
| [`activity/ActivationDurationEditor.tsx`](../../src/components/compendium/activity/ActivationDurationEditor.tsx) | 160 | Activation time + Duration sections of the Activation tab |
| [`activity/RangeTargetingEditor.tsx`](../../src/components/compendium/activity/RangeTargetingEditor.tsx) | 258 | Range + Targets + Area sections of the Targeting tab. Each section gated by parent-supplied visibility flags (`showsRange`, `showsTargeting`) |
| [`activity/ConsumptionTabEditor.tsx`](../../src/components/compendium/activity/ConsumptionTabEditor.tsx) | 275 | Scaling + Uses + Recovery + Consumption Targets sections of the Consumption tab. Owns the recovery rules + consumption targets arrays |

**Why split this way:** each sub-editor maps one-to-one to a Foundry document section (`activity.activation`, `activity.duration`, etc.). The split makes per-section UX polish surface across every editor that hosts an activity in a single edit, rather than copy-paste across attack / save / damage / heal branches.

**What stays inline in `ActivityEditor.tsx`:** the Identity tab's kind-specific sections (Attack, Save, Check, etc. each mix multiple activity-kind branches heavily; extracting cleanly would require restructuring those branches), the Effect tab's per-kind output assembly (Save abilities, Check fields, on-save dropdown — all interleaved), and the Applied Effects checkbox list (each row has per-effect min/max level constraints that the standard pickers can't accommodate without a layout regression).

## Shared patterns from elsewhere in the compendium

The editor leans on three reusable components built for the unique-option / requirements stack:

- **[`<SingleSelectSearch>`](../../src/components/ui/SingleSelectSearch.tsx)** for searchable single-pick dropdowns — recovery period (with category hint badges: Rests / Combat / Mechanical), recovery type, consumption target type, summon/transform mode, scaling mode, Visibility Class Identifier picker. Portal'd combobox that escapes the modal's overflow.
- **[`<EntityPicker>`](../../src/components/ui/EntityPicker.tsx)** for multi-select chip pickers — damage types (15 options, was a button-toggle grid), summon's Creature Sizes + Creature Types (were CSV free-text inputs).
- **[`<ActiveEffectKeyInput>`](../../src/components/compendium/ActiveEffectKeyInput.tsx)** for autocomplete-backed path inputs — consumption target's `target` path field, where authors used to have to remember Foundry data-model paths.

## CSS notes

- `.custom-scrollbar` — applied to every overflow region in the editor (dialog body, dropdowns, scrollable lists). See [active-effects.md](active-effects.md) for the definition.
- `.no-number-spin` — applied to every numeric input across the activity surface. Hides browser default spinner arrows while keeping arrow-key increment. The original `<select value="">` bug that left dropdown clicks inert — see DamagePartEditor's "Scaling Mode" comment — is now patched everywhere via the `__none` translation idiom.

## Foundry-consistent display labels

Slug-based dropdowns (target type, template shape, scaling mode, summon/transform mode, movement type, creature size, creature type) all render display labels matching Foundry's official `ActivityConfig` windows ("Tiny" / "Small" / "Medium" / "Large" / "Huge" / "Gargantuan" instead of `tiny / sm / med / lg / huge / grg`). Slug values still write on export, so the round-trip stays canonical.

## Export round-trip

The module-side normalizer ([`module/dauligor-pairing/scripts/class-import-service.js`](../../module/dauligor-pairing/scripts/class-import-service.js)) consumes the authored activities verbatim — they're stored as JSON on whichever entity hosts them (feature, option item, feat, item, spell) and round-trip into Foundry's `system.activities` collection on import.

## Related docs

- [active-effects.md](active-effects.md) — shared Active Effect editor (same authoring surfaces, same icon picker, same `.no-number-spin` / `.custom-scrollbar` conventions)
- [compendium-options.md](compendium-options.md) — option-item editor that hosts this component
- [compendium-classes.md](compendium-classes.md) — class feature editor that hosts this component
- [foundry-export.md](foundry-export.md) — export bundle shape
