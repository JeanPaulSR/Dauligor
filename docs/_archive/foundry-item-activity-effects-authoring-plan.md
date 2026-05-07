# Foundry Item, Activity, and Effects Authoring Plan

## Purpose

This document defines how Dauligor should approach:

- spell cards
- feature / feat cards
- item cards
- their `Description`, `Details`, `Activities`, and `Effects` sections

The goal is not to invent a separate Dauligor-only authoring model if Foundry `dnd5e` already provides:

- the window structure
- the tab structure
- the field groupings
- the activity type system
- the effects model

The preferred direction is to copy the Foundry structure closely, style it to match Dauligor, and preserve Foundry-compatible data whenever possible.

---

## Core Decision

### Source of truth for these editors

For spells, features, and items, Dauligor should treat Foundry `dnd5e` as the structural source of truth for:

- sheet layout
- tab names
- activity type names
- activity field grouping
- effect data shape

Dauligor can still:

- simplify user-facing display views
- convert description content into site-friendly BBCode for editing/display
- use its own styling
- hide advanced fields when not yet supported

But the underlying authoring contract should stay as close to Foundry as possible.

### Why

This saves effort in three places:

1. UI design
Because Foundry already solved how these windows are broken up.

2. Data compatibility
Because import/export becomes easier if Dauligor stores something close to what Foundry expects.

3. Future automation
Because activities and effects are the most rules-heavy part of the item system, and drifting from Foundry here would create expensive custom maintenance later.

---

## Real Foundry Template Locations

These are the local `dnd5e` template files already present in the runtime system:

### Item window shell

- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/header.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/shared/horizontal-tabs.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/activities.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/description.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/details.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/effects.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/shared/activities.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/shared/active-effects.hbs`

### Item-type-specific details partials

- `.../templates/items/details/details-spell.hbs`
- `.../templates/items/details/details-feat.hbs`
- `.../templates/items/details/details-weapon.hbs`
- `.../templates/items/details/details-equipment.hbs`
- `.../templates/items/details/details-tool.hbs`
- `.../templates/items/details/details-consumable.hbs`
- `.../templates/items/details/details-loot.hbs`
- `.../templates/items/details/details-class.hbs`
- `.../templates/items/details/details-subclass.hbs`

### Shared field partials

- `.../templates/shared/fields/field-activation.hbs`
- `.../templates/shared/fields/field-range.hbs`
- `.../templates/shared/fields/field-duration.hbs`
- `.../templates/shared/fields/field-targets.hbs`
- `.../templates/shared/fields/field-damage.hbs`
- `.../templates/shared/fields/field-uses.hbs`

### Activity creation shell

- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/apps/document-create.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/templates/generic/form-footer.hbs`

### Activity editor shells

- `.../templates/activity/identity.hbs`
- `.../templates/activity/activation.hbs`
- `.../templates/activity/effect.hbs`

### Activity-type templates

- `.../templates/activity/attack-identity.hbs`
- `.../templates/activity/attack-effect.hbs`
- `.../templates/activity/cast-effect.hbs`
- `.../templates/activity/check-effect.hbs`
- `.../templates/activity/damage-effect.hbs`
- `.../templates/activity/heal-effect.hbs`
- `.../templates/activity/save-effect.hbs`
- `.../templates/activity/utility-effect.hbs`
- `.../templates/activity/enchant-effect.hbs`
- `.../templates/activity/forward-effect.hbs`
- `.../templates/activity/summon-effect.hbs`
- `.../templates/activity/transform-effect.hbs`

### Activity partials

- `.../templates/activity/parts/activity-identity.hbs`
- `.../templates/activity/parts/activity-visibility.hbs`
- `.../templates/activity/parts/activity-time.hbs`
- `.../templates/activity/parts/activity-targeting.hbs`
- `.../templates/activity/parts/activity-consumption.hbs`
- `.../templates/activity/parts/activity-effects.hbs`
- `.../templates/activity/parts/activity-effect-level-limit.hbs`
- `.../templates/activity/parts/activity-effect-settings.hbs`
- `.../templates/activity/parts/attack-identity.hbs`
- `.../templates/activity/parts/attack-damage.hbs`
- `.../templates/activity/parts/attack-details.hbs`
- `.../templates/activity/parts/cast-details.hbs`
- `.../templates/activity/parts/cast-spell.hbs`
- `.../templates/activity/parts/check-details.hbs`
- `.../templates/activity/parts/damage-part.hbs`
- `.../templates/activity/parts/damage-parts.hbs`
- `.../templates/activity/parts/damage-damage.hbs`
- `.../templates/activity/parts/heal-healing.hbs`
- `.../templates/activity/parts/save-damage.hbs`
- `.../templates/activity/parts/save-details.hbs`
- `.../templates/activity/parts/save-effect-settings.hbs`
- `.../templates/activity/parts/enchant-enchantments.hbs`
- `.../templates/activity/parts/enchant-restrictions.hbs`
- `.../templates/activity/parts/summon-changes.hbs`
- `.../templates/activity/parts/summon-profiles.hbs`
- `.../templates/activity/parts/transform-profiles.hbs`
- `.../templates/activity/parts/transform-settings.hbs`

These paths are the blueprint for how we should break the Dauligor editors apart.

---

## Recommended Dauligor Editor Model

## 1. Use the same top-level tab model as Foundry

For spell, feat/feature, and item editors, Dauligor should use the same tab structure:

- `Description`
- `Details`
- `Activities`
- `Effects`

Common shell:

- header with image, name, identifier/source summary
- horizontal tab navigation
- tab body

This should be a shared editor shell used by:

- spells
- feats / class features / subclass features
- items

This avoids creating separate unrelated editor layouts for each entity type.

## 2. Use type-specific `Details` panels

We should not make one giant generic details form.

Instead:

- spell editor uses Foundry spell-style details
- feature / feat editor uses feat-style details
- weapon/tool/equipment editors use their corresponding detail surfaces

This maps directly to Foundry’s `details-*.hbs` split.

## 3. Treat activities as first-class documents inside the item editor

Dauligor should model the Activities tab around Foundry’s native activity list:

- show a list of current activities
- allow create activity
- allow edit activity
- allow delete activity
- allow reorder later if needed

Activity creation should mimic Foundry’s activity selector dialog:

- choose activity type first
- then open the correct activity editor window or panel

## 4. Treat effects as their own real section, not an afterthought

Effects should not stay as a raw JSON box long-term.

The short-term safe rule:

- preserve raw Foundry-compatible effect data
- show basic summary rows
- allow raw JSON fallback only for unsupported fields

The long-term target:

- Foundry-style effect list
- create/edit/delete effect rows
- effect editor with native field groupings

---

## Data Handling Rules

## 1. Preserve Foundry-native structures wherever possible

For authoring records, the safest long-term direction is to preserve structures close to Foundry for:

- `activities`
- `effects`
- item shell fields like activation/range/duration/target/uses
- spell shell fields like components, method, concentration, ritual, materials

This means Dauligor should prefer:

- preserving Foundry-shaped objects
- adding friendly derived fields for display

Instead of:

- flattening those objects into a custom Dauligor-only schema too early

## 2. Description can stay BBCode-authored, but must round-trip

Current spell behavior is good and should become the rule for item-like content generally:

- import Foundry HTML
- convert to site-native BBCode for editing and display
- preserve Foundry inline tokens in storage where useful
- flatten those tokens only in read-only display views
- convert BBCode back to Foundry-friendly HTML on export

This should apply to:

- spells
- features / feats
- item descriptions

## 3. Activities and effects should remain export-capable

Even if the first Dauligor editor pass is incomplete, we should not destroy fidelity.

If a field is not yet beautifully editable:

- preserve it
- surface it
- provide fallback JSON if necessary

but do not discard it.

---

## Recommended Build Order

## Phase 1: Documentation and structural alignment

Deliverables:

- this document
- shared understanding that Foundry `dnd5e` is the structural source of truth
- shared item-editor shell plan

## Phase 2: Shared item editor shell

Build one reusable shell with:

- header
- tabs
- left-to-right / top-level structure matching Foundry

Use it for:

- spells first
- then feats/features
- then items

## Phase 3: Spell details parity

Spells are the best first target because:

- import path already exists
- list/browser already exists
- Foundry shell fields are already partly preserved in `foundryShell`

Implement:

- Description tab
- Details tab matching spell fields
- Activities tab with list + editor entry
- Effects tab with list + preserved data

## Phase 4: Activity system

Implement activity creation and editing in the same order Foundry naturally suggests:

1. Attack
2. Damage
3. Save
4. Heal
5. Utility
6. Cast
7. Check
8. later: enchant / summon / transform / forward

Reason:

- attack/damage/save/heal/utility cover the highest-value core cases
- cast and check are next most broadly useful
- the rest are advanced and can come later without breaking the model

## Phase 5: Feature / feat card alignment

Once spell activities/details are stable, use the same shell for:

- class features
- subclass features
- feats

These should author like Foundry feat items with:

- description
- details
- activities
- effects

This is especially important because class features and option items are already being exported as feat-like items.

## Phase 6: Broader item editors

After spell/feat parity:

- weapon
- equipment
- tool
- consumable
- loot

These can share the same shell with type-specific `Details` implementations.

---

## What Not To Do

## 1. Do not invent a brand-new activity model

If Dauligor creates a custom “action/effect/damage” system that does not resemble Foundry activities, we will pay for it later in:

- import mapping
- export mapping
- automation bugs
- UI duplication

## 2. Do not flatten effects into prose-only notes

Effects need to remain structured.

Human-readable notes can be shown, but structured effect data must remain available.

## 3. Do not force all item types into one generic details form

Foundry already splits item types because they have different authoring needs. Dauligor should follow that pattern.

## 4. Do not discard unknown activity/effect fields

Unsupported fields should be preserved, not dropped.

---

## Immediate Next-Step Guidance

When this work starts for real, the recommended first implementation pass is:

1. build a shared `FoundryItemEditorShell` in the app
2. move the spell manual editor into that shell
3. split spell editing into:
   - `Description`
   - `Details`
   - `Activities`
   - `Effects`
4. replace the raw “activities attached to spell data” mental model with a real activity list/editor flow
5. leave advanced effects/activity fields in preserved JSON fallback form if necessary, but keep the tab structure and base field groupings Foundry-compatible

---

## Files To Revisit When Implementing

App:

- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/SpellsEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/compendium/SpellImportWorkbench.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/spellImport.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/bbcode.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/FeatsEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/ItemsEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/compendium/ActivityEditor.tsx`

Foundry references:

- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/*`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/activity/*`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/shared/*`

---

## Short Version

If we want the shortest possible rule set:

- copy Foundry’s item window structure
- copy Foundry’s tab structure
- copy Foundry’s activity type structure
- preserve Foundry-compatible activity/effect data
- use Dauligor styling, not Dauligor-invented schema drift

That is the path with the least wasted effort and the best future export compatibility.
