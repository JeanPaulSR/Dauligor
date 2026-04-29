# Agent Memory

This file is the running project memory for long Codex sessions and future follow-up work.

## Purpose

Use this file to preserve:

- current source-of-truth paths
- integration decisions
- known constraints
- active bugs or follow-up items
- recent completed work

Prefer updating this file when a decision changes or a significant implementation milestone is reached.

## Repositories And Runtime Paths

- App repo:
  - `E:/DnD/Professional/Dev/Dauligor`
- Foundry module dev source:
  - `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing`
- Foundry live runtime module:
  - `C:/Users/Jean/AppData/Local/FoundryVTT/Data/modules/dauligor-pairing`
- Foundry system reference:
  - `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e`

## Source Of Truth Rules

- The dev module copy is the code source of truth.
- The live Foundry module copy is the runtime copy.
- `data/` is intentionally allowed to drift for now because source payload delivery will eventually move toward app endpoints.
- For module code and docs, dev changes should be manually copied to the live Foundry module copy after meaningful updates.

Recommended sync command when needed:

```powershell
robocopy "E:\DnD\Professional\Dev\Dauligor\module\dauligor-pairing" "C:\Users\Jean\AppData\Local\FoundryVTT\Data\modules\dauligor-pairing" /MIR /XD data
```

## Current Image Architecture

- Images are hosted from Cloudflare R2.
- Public production image base:
  - `https://images.dauligor.com`
- The app uses Vercel.
- Production-safe image management now goes through Vercel API routes instead of exposing the Cloudflare Worker secret to the browser.
- Remote image URLs should stay absolute `https://...` URLs during Foundry import.

## Current Class Import Contract

- Root class and subclass `advancements` are authoritative.
- Ordinary class and subclass features are exported as inherent root `ItemGrant` rows.
- The module reads root advancement rows directly.
- Actor import applies resulting `Trait` advancements back onto actor-root data so saves and proficiencies actually show on the sheet.

## Current Class Import Behavior

Actor import now distinguishes three modes:

1. Fresh primary class import
   - normal class proficiencies
   - all features up to selected level

2. Same-class level-up
   - only newly gained class and subclass features are embedded
   - lower-level desired features are still tracked for pruning and consistency

3. Multiclass first import
   - use `class.multiclassProficiencies`
   - do not apply base-class saving throw proficiencies
   - persist `flags.dauligor-pairing.proficiencyMode = "multiclass"` on the embedded class item

Latest implemented details:

- same-class level-up now only embeds newly gained class and subclass features instead of re-importing earlier-level features
- multiclass proficiency mode is sticky on the embedded class item, so later reimports and level-ups do not accidentally switch that class back to primary-class proficiencies
- live Foundry save-data verification confirmed a real Artificer 6 / Sorcerer 3 actor keeps the Sorcerer embedded class flagged as `proficiencyMode = "multiclass"` and does not add Sorcerer saving throw proficiencies onto the actor root
- actor-side advancement sync now persists the selected subclass back onto the class `Subclass` advancement row and selected class-option items back onto `ItemChoice.value.added`

## Current Description Handling

The importer accepts:

- HTML as-is
- BBCode and converts it to Foundry-friendly HTML
- simple markdown-like prose and converts it to HTML

App-side note:

- BBCode is the preferred rich-text transport if the app is not already exporting HTML

Latest implemented details:

- the module now converts BBCode directly into Foundry-friendly HTML during import
- the module also supports simple markdown-like prose for headings, lists, horizontal rules, and inline emphasis

## Current Feature Typing

- Ordinary class and subclass features import as `feat` items with:
  - `system.type.value = "class"`
  - `system.type.subtype = ""`
- Class option items also import as `feat` items with:
  - `system.type.value = "class"`
  - subtype derived from the option-group name
- Native subtype example:
  - `artificerInfusion`
- The module also stores:
  - `flags.dauligor-pairing.featureTypeValue`
  - `flags.dauligor-pairing.featureTypeSubtype`
  - `flags.dauligor-pairing.featureTypeLabel`

Latest implemented details:

- the module registers custom option-group-derived feat subtype labels at runtime so Foundry can display them on sheets
- this is currently important for class option items like Artificer Infusions

## Current ASI Handling

- `AbilityScoreImprovement` rows are preserved as native advancement entries.
- After actor import, if gained class levels cross unresolved ASI rows, the module now opens a Dauligor-managed ASI prompt instead of handing control to native `dnd5e` advancement flow state.
- The Dauligor ASI prompt now supports:
  - direct ability-score assignment back onto the actor
- Dauligor feat selection from the source feat catalog when available
- persistence of the choice back onto the class `AbilityScoreImprovement.value` data using native `asi` / `feat` value shapes
- The current beta prompt now uses a dedicated Dauligor application window styled inside the module instead of a plain `DialogV2` form.
- Constitution increases chosen through that prompt now also apply the expected actor HP current-value adjustment across total class levels.
- The current ASI window is acceptable for beta, but it should be revisited later for cleaner UX and closer parity with the stronger Plutonium-style split between ASI and Feat flows.

## Current HP Handling

- Class HP gains are still stored on native `HitPoints` advancements.
- Actor HP current value is incremented after import from the resolved class HP gain.
- The module should only write `system.attributes.hp.max` when the actor already has a hard-coded source max override.
- This avoids rebasing multiclass HP math from current HP and lets `dnd5e` continue deriving class-based max HP from class advancements.
- Before applying actor HP current-value changes, the module now forces an actor `reset()` so `dnd5e` recalculates the new derived effective max first and the HP update does not get clamped to the old multiclass max.
- User follow-up after the latest beta test:
  - max HP is no longer being overwritten on multiclass imports
  - there is still a minor remaining issue with multiclass current HP not always updating as expected

## Current Spellcasting Notes

- Class and subclass spellcasting should use native Foundry fields:
  - `progression`
  - `ability`
  - `preparation.formula`
- Deprecated class-level preparation mode should not be written.
- Prepared-caster formula examples:
  - preferred native: `@abilities.wis.mod + @classes.druid.levels`
  - accepted shorthand in the app/editor: `WIS + Level`

## Current Unique Option Group Editor

- Managed in `src/pages/compendium/UniqueOptionGroupEditor.tsx`.
- Class restrictions (`classIds`) are stored at the **group level** (on `uniqueOptionGroups` documents) — not on individual items. This controls which classes see the whole group in the advancement editor.
- The item list uses a compact `divide-y divide-gold/10` row pattern matching the ClassEditor feature list (hover-reveal edit/delete buttons).
- Inline item editing is replaced with a Dialog modal (`max-w-[95vw] lg:max-w-4xl`), consistent with the ClassEditor feature modal pattern.
- Group Details has a searchable multi-select for class restrictions: chip display + search input + scrollable filtered list with gold checkboxes.
- Item prerequisites display as plain "Prerequisites:" text (no icons) and only appear when `levelPrerequisite > 0` or `stringPrerequisite` is populated.

## Current AdvancementManager State

- Accepts a `classId?: string` prop passed from ClassEditor (`id`) and SubclassEditor (`classId || parentClass?.id`).
- Option group selector filters to groups where `classIds` is empty or includes the current `classId`.
- An inline "Search all option groups" panel (no absolute positioning — uses `max-h-40` inline list to avoid overflow clipping in modal containers) allows cross-class group discovery.
- Feature pool search fetches all features from Firestore once on modal open, cached in `allFeatures`. This allows cross-class feature selection (e.g., a Wizard subclass granting access to Warlock invocations).
- `selectedPoolFeatures` resolves IDs from both `availableFeatures` (class-local) and `allFeatures` (global).
- States cleared on modal close: `featureSearch`, `optionGroupSearch`, `showAllOptionGroups`.

## MarkdownEditor Async Sync Fix

- `MarkdownEditor.tsx` had a bug where TipTap (WYSIWYG mode) never received async-loaded values.
- Root cause: `useEditor` initializes with `content: bbcodeToHtml(value)` at mount time. The sync `useEffect` was gated on `!isWYSIWYG`, so WYSIWYG mode (default `isWYSIWYG = true`) never received async-loaded values.
- Fix: removed the `!isWYSIWYG` guard. `{ emitUpdate: false }` on `setContent` prevents feedback loops.
- This affects any editor field that loads async data (e.g., Firestore group description).

## Current App / Foundry Integration Areas

Implemented or substantially working:

- secure Vercel-to-Cloudflare image management proxy
- class source export with image URL support
- root advancement import
- actor trait application
- option-group scaling from scaling columns
- remote image handling for class/subclass sheet rendering
- class import modes for primary vs multiclass vs same-class level-up
- BBCode and markdown-like description normalization in the Foundry module
- runtime registration of custom class option feat subtype labels
- Dauligor-managed ASI resolution after class import, including Dauligor feat selection and advancement-value persistence
- safer actor HP application that no longer derives multiclass max HP from current HP when no raw max override exists
- first app-side reference surface for authoring and character-sheet visibility
  - shared semantic-to-Foundry preview helpers now exist in the app
  - class and subclass spellcasting formula fields now show a reference helper
  - class and subclass feature limited-use formula fields now show a reference helper
  - the character builder sheet now uses a compact reference launcher that opens the draggable reference window
- first deprecated-advancement cleanup pass in the app editor
  - `AdvancementManager.tsx` now normalizes modal state into one canonical advancement shape instead of relying on save-time repair
  - touched advancements now save `allowReplacements`, `sizes`, trait choice source, and item-choice count source in the canonical editor shape
  - legacy editor-only fallbacks like `allowReplacement` and inline `size` handling were removed from the authoring UI
  - `classExport.ts` now derives a compatibility `size` field from canonical `sizes` data during export so the Foundry payload stays stable
- second deprecated-advancement cleanup pass across the app shell
  - shared normalization now lives in `src/lib/advancementState.ts`
  - `ClassEditor.tsx` and `SubclassEditor.tsx` now normalize root advancement arrays and feature advancement arrays when loading, editing, and saving
  - `CharacterBuilder.tsx` now normalizes class, subclass, and feature advancements as they enter cache state
  - creator-side trait choices now derive from canonical trait `options` / `choiceCount` data instead of only the older `configuration.choices` shape
  - creator-side trait option loading now supports canonical trait types like armor, weapons, languages, conditions, and damage traits, not just skills/tools/saves
- third creator-alignment pass in `CharacterBuilder.tsx`
  - class onboarding now distinguishes primary-class level 1 from multiclass level 1 when interpreting base class advancements
  - multiclass class entries now skip base starting-equipment `ItemChoice` rows in the builder, which is closer to the module’s actor-import behavior
  - class profile trait grants and trait selections now re-apply onto live character state through a preserved `classGrantedTraits` layer so class saves, skills, armor, weapons, tools, and languages appear on the sheet instead of only living in export-style selection data
  - canonical trait choice handling now preserves `categoryIds`, and the builder can open trait-choice dialogs from explicit pools or category-backed collections
  - new progression entries now preserve `classId` alongside `className` so creator-side progression logic can move toward stable identifier matching instead of relying only on display names
- class-step advancement presentation cleanup
  - the builder no longer fuzzy-attaches advancement cards to nearby feature text by matching names or identifiers
  - level advancements now render as their own standalone sections beneath the feature list, which is closer to the module’s “feature plus separate advancement step” flow
  - this fixes repeated-looking root advancement cards like starting equipment or skill selections appearing under unrelated features
- sheet-side advancement visibility pass
  - the `Character Sheet` tab now derives a class progression summary from the same cached class/subclass features and scaling columns used by the class step
  - the sheet now shows per-class granted features, current scale values, and selected advancement options so the builder sheet reflects more of the same advancement state Foundry would surface on an actor
  - the sheet progression card includes a quick jump back into the class step for editing

Still active or likely follow-up areas:

- multiclassing verification with more class examples beyond the verified Artificer/Sorcerer case
- verify the new Dauligor ASI prompt in live Foundry, especially multi-level imports that cross an ASI level and feat selection from a real Dauligor feat catalog
- verify multiclass HP behavior in live Foundry after the max-override fix, especially second-class imports and damaged actors
- revisit and polish the Dauligor ASI window UX after beta-critical behavior is stable
- spell lists
- activities follow-up verification
- items / feats / spells broader Foundry import coverage
- sheet sorting behavior based on option-group type labels

## Next Major Workstream

The next large integration area is Dauligor character creation and sheet authoring alignment with Foundry terminology and advancement behavior.

Primary goals:

1. Build a creator-facing reference model around native Foundry / `dnd5e` terminology
   - authors should have a simple reference sheet for correct formula and display paths
   - examples should include:
     - ability modifier
     - class level
     - total character level
     - spell attack / spell DC
     - skill totals / passive skills
   - this should use the real `dnd5e` references already compiled instead of app-specific guesses

2. Update the Dauligor class sheet and character sheet so those references are understandable while authoring
   - creators should be able to see and use Foundry-style references directly
   - example:
     - if an ability should have `INT mod` uses, the UI should make it obvious that the correct reference is `@abilities.int.mod`
   - the app should display those references in a way that resembles how Foundry data is actually structured on sheets

3. Bring character-sheet advancement authoring back in line with the current Foundry-ready advancement model
   - there is already a base system in place
   - however, that base still contains deprecated code
   - after the reference-system work is in a better place, phasing out deprecated advancement authoring paths should be treated as the highest-priority follow-up so app-side advancement data matches the Foundry import shape cleanly

Recommended starting points for that work:

- `E:/DnD/Professional/Dev/Dauligor/docs/foundry-dnd5e-character-reference-sheet.md`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/characters/CharacterBuilder.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/characterExport.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/referenceSyntax.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/components/reference/ReferenceSyntaxHelp.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/reference/CharacterReferencePanel.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/compendium/AdvancementManager.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/admin/SpellcastingAdvancementManager.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/ClassEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/SubclassEditor.tsx`
- any deprecated advancement code paths currently used by the Dauligor character creator base

Concrete notes from the quick app sweep before compaction:

- `CharacterBuilder.tsx` is the obvious entry point for creator-facing character-sheet behavior.
- `characterExport.ts` is likely where any Foundry-oriented reference serialization or formula normalization will need to converge.
- `AdvancementManager.tsx` remains the main app-side advancement editor and is the first place to compare against the current Foundry-ready advancement shape.
- `SpellcastingAdvancementManager.tsx` may matter for formula/reference UX because spellcasting formulas already expose native examples like `@abilities.int.dc`.
- `SubclassEditor.tsx` already contains explicit deprecated-feature handling, which is a useful signal that the advancement-authoring cleanup should include deprecated class/subclass editing paths rather than treating them as purely Foundry-module problems.

Latest app-side reference implementation notes:

- `src/lib/referenceSyntax.ts` now mirrors the first-wave scalar reference surface from the module docs for preview and helper purposes.
- `ReferenceSyntaxHelp.tsx` now uses a compact side popout instead of a large inline block so formula help can be opened where needed without consuming the whole sheet.
- `ReferenceSheetDialog.tsx` now provides a dedicated draggable utility window styled to match the app guide so it can stay open beside feature or advancement editing work.
- `CharacterReferencePanel.tsx` is now a compact launcher card that opens the full reference sheet instead of permanently rendering the large table inline on the character sheet.
- class and subclass editors now expose an `Open Reference Sheet` action near their save buttons.
- class feature modals and advancement configuration dialogs can now also open the reference sheet directly from their headers.
- spellcasting formula editing in class and subclass editors now uses a wider dedicated formula section instead of cramming the helper inside the same narrow column.
- spellcasting formula authoring now has contextual Dauligor shortcuts:
  - `@level` for class level
  - `@totalLevel` for total character level
  - `@prof` for proficiency bonus
  - `@mod` for the chosen spellcasting ability modifier
  - `@value` for the chosen spellcasting ability score
  - math helpers like `min()`, `floor()`, and `ceil()`
- class export normalization now resolves those spellcasting shortcuts into their concrete Foundry-native formula paths during export.
- This is the first pass only:
  - it improves discoverability and validation guidance
  - it now pairs with a first deprecated-advancement cleanup pass in `AdvancementManager.tsx`
  - it does not yet finish deprecated advancement cleanup across every app-side authoring surface
  - it does not yet add reference helpers to every formula-bearing editor surface such as all activity formulas

Latest deprecated-advancement cleanup notes:

- `AdvancementManager.tsx` now canonicalizes editor state on every modal update instead of only on save.
- Canonical editor targets now include:
  - trait `allowReplacements` instead of legacy `allowReplacement`
  - `sizes` as the authoring source of truth instead of the inline legacy `size` UI path
  - normalized `choiceSource` / `countSource` handling with deduped pools and exclusions
- Type switching in the advancement modal now seeds canonical defaults instead of mixed legacy config shapes.
- Saving an advancement row now also normalizes the rest of the current advancement list, so touched authoring sessions gradually migrate old rows forward.
- `classExport.ts` still preserves compatibility for `Size` advancements by deriving a primary `size` from canonical `sizes` at export time.
- Remaining highest-priority cleanup after this pass:
  - compare `CharacterBuilder.tsx` and any remaining deprecated class/subclass authoring branches against the same canonical advancement model
  - extend the same cleanup to any remaining formula-bearing or advancement-bearing editors that still assume older shapes
  - keep checking the character creator for any remaining behavior that still depends on legacy advancement sub-shapes after cache normalization

Latest reference UX direction from user feedback:

- The inline usage formula reference panel is useful, but it takes up too much space in the feature editor.
- Implemented direction:
  - field-level formula help now uses a compact popout trigger
  - class and subclass authoring screens now have an `Open Reference Sheet` action near Save
  - a fuller dedicated draggable reference window now exists for the broader sheet
- The spellcasting section currently feels too cramped, especially where the spellcasting controls compete with the spells-known formula area.
- Implemented direction:
  - the spellcasting formula area now has its own wider section and no longer permanently hosts the large helper inline
- Remaining follow-up:
  - continue refining the reference-sheet contents and extend the same popout approach into more formula-bearing editor surfaces

Desired dedicated reference sheet sections:

- Core Information
  - proficiency bonus
  - total level
  - class level
  - current HP
  - max HP
  - hit dice
- Attributes
- Skills
- Class Features
- Class Columns
  - this needs to explain how a class-column value is resolved
- Later, effects references and authoring conventions should also be covered

Important implementation answers to preserve:

- If two classes share the same display name on a Foundry sheet, reference resolution should still key by stable identifier rather than display label.
  - use semantic/source identifiers that normalize to Foundry item identifiers
  - do not rely on human-readable class names as the primary reference key
- Class-column values should resolve from the linked scaling / `ScaleValue` identifier, not from the visual column label alone.
  - the reference sheet should explain both the displayed column and the underlying identifier that formulas actually target

Future research notes for the reference/effects pass:

- use the Foundry wiki / official docs for how effects are declared
- review Midi-QOL effect conventions because some of those effect patterns may be useful later

Latest character-builder / sheet alignment notes:

- `CharacterBuilder.tsx` now treats the sheet more like a condensed D&D Beyond-style surface:
  - the `Character Sheet` tab now uses `Character Info`, `Features`, and `Spells` sub-tabs instead of always showing progression openly
  - the old always-open reference panel is no longer shown on the `Character Sheet` tab
  - level continues to live under the character name, and class-derived HP auto-sync remains the source for getting away from the default 10 HP state once class progression exists
- The builder now has a shared per-class progression summary that both the sheet and class-step timeline can read from.
  - this summary resolves class and subclass granted features from `ItemGrant`-style advancement data first
  - it falls back to raw class/subclass feature lists only when no grant-driven feature records exist for that source
  - it also resolves non-feature granted items from class, subclass, and feature-owned `ItemGrant` advancements
- The `Features` sub-tab on the sheet now shows:
  - class level and subclass summary
  - granted features
  - granted items
  - scale values
  - selected advancement options
- The class-step progression timeline now also reads the shared progression summary:
  - features at each level come from the shared grant-aware summary instead of raw level filtering alone
  - standalone granted items now render as their own section on the level timeline, keeping advancement state separate from feature description cards
  - `ItemGrant` info badges now resolve names through the shared grant lookup instead of assuming they are only feature ids

Current highest-value follow-up inside `CharacterBuilder.tsx`:

- continue moving creator state toward the module contract by making selected advancement options and granted ownership even more explicit
- especially keep pushing starting items, option-item ownership, and future spell/action state to read from the same progression-derived model the sheet and class step now use

Latest class-migration planning notes:

- Keep the class editor UX largely as it is for authors.
  - Authors should not be required to manually create HP, subclass, or ASI rows just to migrate or build a class.
  - `Initialize Base Advancements` remains the intended author-facing tool for generating/syncing those base rows from editor fields.
- The migration target is backend/source-of-truth convergence, not forcing a harsher authoring flow.
  - Root class editor fields can continue to exist as author inputs for now.
  - The saved/exported/backend class contract should increasingly treat the canonical base advancements plus custom advancements as the progression truth.
- Important class-editor bug to fix during the migration:
  - multiclass proficiency category headers currently do not work because the shared `toggleGroup()` helper only updates `proficiencies`, while the multiclass sections call it from `multiclassProficiencies`
- Important display-sync behavior to change during the migration:
  - syncing proficiency display text should prefer category labels when a whole category is selected, rather than expanding into every individual item name
  - for choice rows, preferred phrasing is along the lines of:
    - `{Choice Number} {Category} of your choice`
    - `; and {Choice Number} {Category} of your choice` when appended after fixed display text
- Clarified migration direction:
  - the earlier “stop treating root proficiencies and advancement proficiencies as dual sources” note means we should eventually avoid having root saved data and saved advancement data disagree
  - editor inputs may stay root-field driven for author convenience
  - but save/export/builder consumption should converge on one canonical progression interpretation
- Spellcasting may eventually move toward a more progression-linked model, but first compare local Foundry/dnd5e and Plutonium expectations before changing the class contract there.
- Update after class-editor migration pass:
  - multiclass proficiency category headers now use their own multiclass state updater instead of routing through the main-class `proficiencies` state
  - grouped proficiency display sync now prefers whole-category labels and grouped choice phrasing instead of expanding everything into individual item names
  - save-time fallback display generation in `handleSave` now uses the same grouped helper as the visible `Sync` buttons
  - category-backed proficiency overlap is now allowed for armor, weapons, tools, and languages, so a fixed item can coexist with a category choice pool without collapsing that category into a flat individual-item list
  - the shared canonical class-progression builder now lives in `src/lib/classProgression.ts`
  - `ClassEditor.tsx` save flow now uses the shared base advancement builder
  - `classExport.ts` now uses the shared canonical class progression builder for base rows, custom rows, and implicit class feature grants
  - detailed review document created at `docs/class-progression-architecture.md`
  - export review against generated class JSON shows the shared progression builder is emitting base rows plus implicit `ItemGrant` rows as intended
  - `classExport.ts` now also preserves `armorDisplayName`, `weaponsDisplayName`, and `toolsDisplayName` inside exported proficiency blocks
  - `ClassList.tsx` class preview tools display now prefers the synced `toolsDisplayName` string before rebuilding from raw category/item data
  - subclass progression now has its own shared canonical helper in `src/lib/classProgression.ts`
  - `SubclassEditor.tsx` save now writes canonical subclass custom advancements through the shared helper instead of persisting any implicit subclass grant rows
  - `classExport.ts` subclass export now uses the shared helper for implicit subclass feature grants instead of its own direct branch
  - subclass progression review/discrepancy notes were added to `docs/class-progression-architecture.md`
  - unresolved subclass questions intentionally left explicit instead of assumed:
    - resolved: subclasses should not gain generated base rows beyond keeping their reference to the parent class; the parent class already defines the subclass feature schedule
    - resolved: subclass features should always be granted at their authored levels once a subclass is selected, just like main-class features are granted at their levels
    - resolved: subclass custom advancements must be allowed at non-subclass levels such as 5, 11, and 17; only the primary subclass-feature track is locked to the parent class schedule
    - resolved direction: subclass spellcasting should behave through the same overall spellcasting system as main-class spellcasting so martial subclasses with casting can coexist with regular casters
    - resolved: subclass spellcasting should contribute to multiclass slot progression exactly the same way Foundry/dnd5e does, using the admin multiclass master chart plus formula-mapped casting contribution
    - example to preserve: Wizard 3 contributes 3 casting levels, Fighter 3 (Eldritch Knight) contributes `ceil(3 / 3) = 1`, so Wizard 3 / Fighter 3 (Eldritch Knight) has total spellcasting level 4
  - builder progression alignment pass:
    - `CharacterBuilder.tsx` now treats `progression` entries as the source of truth for per-class `subclassId` ownership instead of relying only on one global `subclassId`
    - builder save now persists derived `classes` summaries from grouped progression entries, while still mirroring top-level `classId` / `subclassId` for compatibility
    - subclass selection in the class step now writes the chosen subclass onto all matching progression entries for that class
    - builder trait-grant and progression-summary logic now resolves subclass docs per class-group instead of only through the global subclass field
    - character-sheet spellcasting now computes multiclass slot progression from all active class and subclass spellcasting contributors using `spellcastingTypes` formulas plus the `standardMulticlassProgression/master` chart
    - `generatePairingJson()` now derives class/subclass items from grouped progression data instead of the stale `character.classes` field and now includes subclass spellcasting blocks on exported subclass items
    - selected advancement options in `CharacterBuilder.tsx` now use parent-scoped keys instead of plain `_id-level` keys, with scope built from parent type plus stable class/subclass/feature identifiers
    - builder writes now delete matching legacy `_id-level` keys when an advancement choice is edited
    - the builder no longer reads legacy `_id-level` advancement-selection keys; instead it shows a blocking warning instructing the user to go back to class progression and reselect those choices before export or JSON preview
  - builder discrepancy to revisit:
    - existing saved characters can still carry legacy `_id-level` advancement-selection keys until those choices are manually reselected or a future explicit migration rewrites them eagerly
  - new builder architecture reference:
    - the detailed target state for direct Foundry actor export now lives in `docs/character-builder-progression-owned-state-outline.md`
    - it defines:
      - root character facts versus progression-owned truth
      - `progressionState.classPackages`
      - per-class `advancementSelections`
      - explicit `ownedFeatures`
      - explicit `ownedItems`
      - reserved `ownedSpells`
      - per-class `hitPointHistory` and `scaleState`
      - derived sync output for sheet-facing values
      - direct mapping into a Foundry actor root plus embedded class, subclass, feature, spell, and inventory items

## Important Files

App:

- `E:/DnD/Professional/Dev/Dauligor/src/lib/classExport.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/characterExport.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/referenceSyntax.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/bbcode.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/lib/r2.ts`
- `E:/DnD/Professional/Dev/Dauligor/src/components/reference/ReferenceSyntaxHelp.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/reference/ReferenceSheetDialog.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/reference/CharacterReferencePanel.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/characters/CharacterBuilder.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/admin/SpellcastingAdvancementManager.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/ClassEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/SubclassEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/UniqueOptionGroupEditor.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/compendium/AdvancementManager.tsx`
- `E:/DnD/Professional/Dev/Dauligor/src/components/MarkdownEditor.tsx`

Module:

- `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/scripts/class-import-service.js`
- `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/scripts/main.js`
- `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/scripts/importer-app.js`

Module docs:

- `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/class-import-and-advancement-guide.md`
- `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/class-import-contract.md`
- `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/class-semantic-export-notes.md`

App / integration notes:

- `E:/DnD/Professional/Dev/Dauligor/docs/foundry-dnd5e-character-reference-sheet.md`

## Session Update Rule

When a meaningful decision or milestone happens, update:

- this markdown file for the human-readable summary
- `docs/agent-memory.json` for structured machine-friendly state

## Recommended Fresh-Chat Handoff

If starting a new chat, tell the next agent to read these first:

1. `E:/DnD/Professional/Dev/Dauligor/docs/agent-memory.md`
2. `E:/DnD/Professional/Dev/Dauligor/docs/agent-memory.json`
3. `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/scripts/class-import-service.js`
4. `E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/class-import-and-advancement-guide.md`

Then continue from the follow-up list instead of re-discovering the existing integration decisions.
