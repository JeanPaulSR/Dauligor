# Class Progression Architecture

## Purpose

This document defines the current shared class-progression contract for Dauligor authoring, storage, and Foundry export.

It exists for two reasons:

1. The class editor intentionally remains convenience-first for authors.
2. The backend and export pipeline need one consistent progression interpretation so they stop rebuilding the same base rows in different ways.

The goal is not to force authors to hand-build boilerplate advancements.

The goal is to make the system interpret author input through one canonical progression builder.

## Scope

This document covers:

- class root authoring fields that still exist in the editor
- base advancement generation
- custom advancement preservation
- implicit feature-grant generation for export
- how class save and class export now share progression logic
- what is still intentionally not unified yet

This document does not redesign:

- subclass editor authoring
- feature editor authoring
- character builder owned-state persistence
- spellcasting as a full advancement type

Those are adjacent follow-up areas.

## Current File Ownership

Primary shared logic:

- [classProgression.ts](E:/DnD/Professional/Dev/Dauligor/src/lib/classProgression.ts)

Primary consumers:

- [ClassEditor.tsx](E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/ClassEditor.tsx)
- [classExport.ts](E:/DnD/Professional/Dev/Dauligor/src/lib/classExport.ts)

Related systems:

- [AdvancementManager.tsx](E:/DnD/Professional/Dev/Dauligor/src/components/compendium/AdvancementManager.tsx)
- [CharacterBuilder.tsx](E:/DnD/Professional/Dev/Dauligor/src/pages/characters/CharacterBuilder.tsx)
- [class-import-service.js](E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/scripts/class-import-service.js)
- [SubclassEditor.tsx](E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/SubclassEditor.tsx)

## Authoring Model vs Canonical Model

There are now two intentionally different layers:

### Authoring Layer

This is what creators interact with in the class editor.

It still uses root fields such as:

- `hitDie`
- `savingThrows`
- `proficiencies`
- `startingEquipment`
- `subclassTitle`
- `subclassFeatureLevels`
- `asiLevels`
- `spellcasting`
- `advancements`

This layer remains convenient and redundant on purpose.

Authors do not need to manually build:

- HP advancements
- subclass unlock advancements
- ASI advancements

The editor can still drive those from root fields and `Initialize Base Advancements`.

### Canonical Progression Layer

This is what the system should trust when interpreting class progression.

It is produced by shared code in `classProgression.ts`.

That layer builds:

- base advancements
- custom advancements
- optional implicit feature grants
- a final combined advancement list

This is now the shared interpretation used by:

- class save synchronization in `ClassEditor.tsx`
- class export generation in `classExport.ts`
- subclass save normalization in `SubclassEditor.tsx`
- subclass export generation in `classExport.ts`

## Shared Builder API

`classProgression.ts` currently exports these helpers.

### `buildCanonicalBaseClassAdvancements(...)`

Purpose:

- derive the base class advancement rows from root class inputs
- merge those rows with any existing base rows already stored on the class
- preserve custom advancements

Inputs:

- `advancements`
- `hitDie`
- `proficiencies`
- `savingThrows`
- `subclassTitle`
- `subclassFeatureLevels`
- `asiLevels`

Output:

- one advancement list containing:
  - merged base advancements
  - preserved custom advancements

Behavior details:

- existing base rows are matched by `_id`
- existing config is merged forward into the canonical base row
- custom advancements are preserved if they are not considered base/system-generated rows
- final output is sorted by level, then type

### `isCustomClassAdvancement(...)`

Purpose:

- decide whether an advancement should be treated as user-authored custom progression instead of system-generated base progression

Current exclusion rules:

- `base-items`
- anything with `_id` starting with `base-`
- anything with `_id` starting with `implicit-class-features-`

This logic matters because both save and export need to separate:

- canonical base rows
- custom authored rows

### `collectExplicitGrantedFeatureRefs(...)`

Purpose:

- scan existing `ItemGrant` rows and collect already-granted feature identifiers so export does not generate duplicate implicit feature grants

It currently scans:

- `featureId`
- `featureSourceId`
- `configuration.pool`
- `configuration.optionalPool`
- `configuration.items[].sourceId`
- `configuration.items[].uuid`

### `buildInherentFeatureGrantAdvancements(...)`

Purpose:

- generate `ItemGrant` rows for features that exist on the class or subclass but are not already explicitly granted by advancement data

This is mainly an export-side compatibility bridge.

It allows the export payload to behave more like Foundry even when authoring has not explicitly declared every feature grant yet.

### `buildCanonicalClassProgression(...)`

Purpose:

- build the complete shared class progression interpretation

Inputs:

- `advancements`
- `hitDie`
- `proficiencies`
- `savingThrows`
- `subclassTitle`
- `subclassFeatureLevels`
- `asiLevels`
- optional `features`
- optional `implicitGrantPrefix`
- optional `includeImplicitFeatureGrants`

Outputs:

- `baseAdvancements`
- `customAdvancements`
- `implicitFeatureGrants`
- `combinedAdvancements`

Important detail:

- save currently uses the shared base-builder path
- export uses the full canonical progression path with implicit grants enabled

This is intentional.

The editor should not automatically clutter the stored authoring surface with every implicit grant row yet.

The export pipeline does need that richer combined interpretation.

### `isCustomSubclassAdvancement(...)`

Purpose:

- decide whether a subclass advancement row is user-authored or system-generated

Current exclusion rules:

- anything with `_id` starting with `inherent-subclass-feature-grant-`
- anything with `_id` starting with `implicit-subclass-features-`

This protects saved subclass docs from accidentally persisting export-only implicit grant rows if a subclass is ever round-tripped back into Firestore.

### `buildCanonicalSubclassProgression(...)`

Purpose:

- build the canonical progression contract for subclasses

Unlike classes, subclasses currently have no generated base rows.

So the subclass progression contract is:

- normalized custom advancements
- optional implicit feature-grant advancements
- final combined advancement list

Inputs:

- `advancements`
- optional `features`
- optional `implicitGrantPrefix`
- optional `includeImplicitFeatureGrants`

Outputs:

- `customAdvancements`
- `implicitFeatureGrants`
- `combinedAdvancements`

Current behavior:

- `SubclassEditor.tsx` uses this helper with `includeImplicitFeatureGrants = false`
- `classExport.ts` uses this helper with `includeImplicitFeatureGrants = true`

That mirrors the current class behavior:

- save remains author-data focused
- export remains integration-contract focused

## Canonical Base Advancement Rules

The current canonical base rows are:

- `base-hp`
- `base-saves`
- `base-armor`
- `base-weapons`
- `base-skills`
- `base-tools`
- `base-languages`
- `base-items`
- `base-subclass`
- `base-asi-*`

### `base-hp`

Type:

- `HitPoints`

Derived from:

- `hitDie`

Rules:

- always level 1
- defaults to 8 if no valid die exists

### `base-saves`

Type:

- `Trait`

Derived from:

- `proficiencies.savingThrows.fixedIds`
- falls back to legacy `savingThrows` if needed

Rules:

- always level 1
- trait `type = "saves"`
- `choiceCount` and option ids are preserved if present

### `base-armor`

Type:

- `Trait`

Derived from:

- `proficiencies.armor`

Rules:

- always level 1
- carries:
  - `fixed`
  - `options`
  - `choiceCount`
  - `categoryIds`
  - `mode = "default"`

### `base-weapons`

Type:

- `Trait`

Derived from:

- `proficiencies.weapons`

Rules are parallel to `base-armor`.

### `base-skills`

Type:

- `Trait`

Derived from:

- `proficiencies.skills`

Rules:

- always level 1
- no category ids

### `base-tools`

Type:

- `Trait`

Derived from:

- `proficiencies.tools`

Rules are parallel to `base-armor`.

### `base-languages`

Type:

- `Trait`

Derived from:

- `proficiencies.languages`

Rules are parallel to `base-armor`.

### `base-items`

Type:

- `ItemChoice`

Derived from:

- existing `base-items` row when present

Rules:

- always level 1
- defaults to title `Starting Equipment Choices`
- preserves existing base item config
- ensures fallback `choiceType = "item"`
- ensures `pool` is an array
- ensures `count` is numeric

Important note:

`startingEquipment` root text still exists separately.

That text is descriptive authoring content.

The `base-items` row is the actual progression-side starting-equipment contract.

### `base-subclass`

Type:

- `Subclass`

Derived from:

- `subclassFeatureLevels`
- `subclassTitle`
- existing base subclass config

Rules:

- uses first subclass feature level if provided
- falls back to existing base subclass level
- otherwise defaults to level 3
- title falls back to `Select Subclass`

### `base-asi-*`

Type:

- `AbilityScoreImprovement`

Derived from:

- `asiLevels`

Rules:

- one row per ASI level
- each row uses:
  - `points = 2`
  - `featAllowed = true`

## Save Flow After This Change

The class save flow in `ClassEditor.tsx` now does this:

1. Sanitize main proficiencies.
2. Sanitize multiclass proficiencies.
3. Generate grouped display names if the user did not override them manually.
4. Call `buildCanonicalBaseClassAdvancements(...)`.
5. Normalize the resulting advancement list for editor use.
6. Save the class document.

This means:

- editor save no longer owns its own private base-row assembly logic
- base-row generation is now shared with the broader progression contract

## Subclass Save Flow After This Change

The subclass save flow in `SubclassEditor.tsx` now does this:

1. Normalize the editor advancement list.
2. Pass that list through `buildCanonicalSubclassProgression(...)` with implicit grants disabled.
3. Save only `customAdvancements` back to the subclass document.

This has two important effects:

1. subclass docs keep author-facing advancement data, not export-only inferred rows
2. if an imported or hand-edited subclass doc ever contains `inherent-subclass-feature-grant-*` rows, save will strip them back out instead of perpetuating them

No base subclass rows are generated right now.

## Export Flow After This Change

The class export flow in `classExport.ts` now does this:

1. Normalize proficiencies into semantic/Foundry-facing ids.
2. Normalize features and feature-owned advancements.
3. Build canonical class progression by calling `buildCanonicalClassProgression(...)`.
4. Export:
  - base advancements
  - implicit feature grants
  - custom advancements
5. Normalize each advancement into export-ready Foundry shape.

This means:

- export no longer has its own separate base-row generator
- export no longer has its own separate implicit-grant collector logic
- those rules now live in one shared place

## Subclass Export Flow After This Change

The subclass export flow in `classExport.ts` now does this:

1. Normalize the raw subclass record.
2. Collect subclass-owned features from the normalized feature list.
3. Pass subclass advancements and subclass-owned features through `buildCanonicalSubclassProgression(...)` with implicit grants enabled.
4. Export:
   - implicit subclass feature grants
   - custom subclass advancements

This replaces the previous subclass-only export branch where implicit subclass feature grants were built directly inside `classExport.ts`.

That means subclass progression now follows the same architectural pattern as class progression:

- shared helper owns the structure
- save uses author-facing custom rows
- export uses the richer combined progression view

## Proficiency Overlap Rule

The class editor now supports a required case for category-backed proficiencies:

- a category can be selected as an option pool
- a specific item inside that category can also be granted as fixed
- the fixed grant should not destroy the category-based choice pool

Example:

- `Thieves' tools, tinker's tools, one type of artisan's tools of your choice`

Problem before:

- marking `Tinker's tools` as fixed removed it from the artisan-tools option pool
- that collapsed the category display into a flat list of remaining artisan tools

Current rule:

- category-backed option/fixed overlap is allowed for:
  - armor
  - weapons
  - tools
  - languages

UI behavior:

- fixed selection no longer strips the item out of the option pool for those categories
- option checkbox state is now based on actual option membership, not “option or fixed”
- grouped sync text omits duplicate individual item mentions when a fixed item is also present in options

This keeps the display and semantics aligned with real class phrasing.

## Why Save and Export Are Still Slightly Different

This is intentional and should be reviewed before changing.

### Save

Save currently writes:

- canonical base rows
- custom authored rows

It does not force implicit feature grants into the stored class advancement array.

Reason:

- implicit grants are still partly a compatibility bridge
- auto-inserting them into authoring data could create noise in the editor and make migration harder to reason about

### Export

Export currently writes:

- canonical base rows
- implicit feature grants
- custom authored rows

Reason:

- Foundry-side consumers need the richer combined progression interpretation
- export is the compatibility boundary where inferred grants are still useful

## Known Limitations

### Root fields still exist alongside progression rows

This is intentional for now.

But it means classes still have two visible representations:

- authoring inputs at the root
- resulting progression rows in `advancements`

The shared builder reduces drift, but it does not eliminate the dual-surface model yet.

### Spellcasting is still mostly root metadata

Spellcasting formulas and ids are normalized elsewhere.

They are not yet represented as a first-class progression type in this shared builder.

### Subclass and feature authoring are not fully unified yet

Class progression now has a shared contract.

Subclass progression now has a shared contract for custom advancements and implicit feature grants, but feature-level advancement behavior still needs its own deeper review against the same model.

### Character-builder ownership state is still a follow-up

The builder reads more progression-aware data than before, but it still needs a more explicit “owned progression state” model that behaves more like a Foundry actor.

## Risks to Watch

### Risk 1: base row drift caused by editor-only assumptions

If new class authoring fields are added in `ClassEditor.tsx` but not reflected in `classProgression.ts`, save and export can drift again.

Mitigation:

- any base progression rule change should happen in `classProgression.ts` first

### Risk 2: implicit grants becoming invisible logic

If too much behavior is deferred to implicit grant generation, authors may not realize what export is inventing for them.

Mitigation:

- keep this documented
- consider surfacing implicit grants in review/debug tooling later

### Risk 3: duplicate feature grants

If explicit `ItemGrant` rows and implicit feature-grant generation disagree, the same feature could be granted twice.

Mitigation:

- `collectExplicitGrantedFeatureRefs(...)` checks existing grant references before implicit grant creation
- this still deserves regression testing when feature linking changes

### Risk 4: subclass export divergence

Subclass export no longer owns its own inherent-grant builder path, but subclasses still differ from classes in one important way:

- they currently have no generated base progression rows

That may be correct, but it should stay explicit.

### Risk 5: parent-class dependency is only partially enforced

Subclass feature levels are still primarily constrained by the parent class progression UI and warnings.

Current issue:

- `SubclassEditor.tsx` warns about deprecated/invalid feature levels when parent subclass progression changes
- but the subclass progression helper itself does not validate whether subclass custom advancements reference levels that are valid for the parent class

This is a deliberate non-assumption for now.

If we want stronger enforcement later, that should be added intentionally instead of inferred.

## Subclass Discrepancies To Review

These are the main subclass-specific questions that remain unresolved after the current alignment pass.

### 1. Should subclasses ever have generated base rows?

Current answer in code:

- no

Current reasoning:

- unlike classes, subclasses do not currently have an obvious boilerplate progression set comparable to HP / saves / ASIs / subclass unlock

Uncertainty:

- if subclasses later gain standard generated advancement scaffolding, `buildCanonicalSubclassProgression(...)` will need a base-row concept similar to classes

### 2. Should implicit subclass feature grants remain export-only?

Current answer in code:

- yes

Current reasoning:

- save writes author-facing custom advancements only
- export writes inferred implicit grants when needed for the integration contract

Uncertainty:

- if authors need to see or edit the implicit grant layer directly, we may eventually want a debug/review surface or a persisted representation

### 3. Should subclass custom advancements be validated against parent subclass unlock levels?

Current answer in code:

- not yet

Current reasoning:

- the editor warns when the parent class progression changes
- no hard enforcement is applied in the shared progression helper

Uncertainty:

- this may be desirable later, but it is policy, not just plumbing

### 4. Should subclass spellcasting stay root metadata?

Current answer in code:

- yes, for now

Uncertainty:

- subclass spellcasting is still root-level metadata and export normalization, not progression-owned data
- if that changes, it should be designed intentionally rather than folded into this helper ad hoc

## Review Checklist

When reviewing this architecture, verify these questions:

1. Are the base advancement ids stable and complete?
2. Is `base-items` correctly treated as a base/system row rather than custom authoring?
3. Are there any class root fields that should still influence progression but are not passed into the shared builder?
4. Should save eventually include implicit feature grants, or should they remain export-only?
5. Are the explicit feature-grant detection rules broad enough to catch every meaningful `ItemGrant` shape we author?
6. Are subclass progression rules close enough to this model that they should share more of it next?
7. Should spellcasting remain root metadata, or should parts of it eventually join progression-derived state?

## Recommended Next Steps

1. Review the shared builder against a few real classes:
   - artificer
   - barbarian
   - cleric
   - sorcerer

2. Compare saved class documents before and after this refactor to confirm:
   - base rows remain stable
   - custom rows survive unchanged
   - no unexpected progression ids disappear

3. Push the same canonical-progression thinking into subclass handling where it makes sense.

4. Review the subclass discrepancy list above and decide which parts are intentional policy versus temporary gaps.

5. Move `CharacterBuilder.tsx` closer to an owned progression-state model so it stores:
   - granted features
   - granted items
   - selected advancement choices
   - subclass selections per class

6. Decide whether to add a debug/review surface that can show:
   - authoring input
   - canonical progression output
   - export progression output

That would make future migration errors much easier to catch.
