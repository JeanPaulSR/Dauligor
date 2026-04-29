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
  - the character builder sheet now shows a live reference panel with Dauligor syntax, Foundry-native paths, and current values

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
  - it does not yet replace the deprecated advancement-authoring model
  - it does not yet add reference helpers to every formula-bearing editor surface such as all activity formulas

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
- `E:/DnD/Professional/Dev/Dauligor/src/components/compendium/AdvancementManager.tsx`

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
