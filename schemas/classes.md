# Compendium: Classes & Relations Schema (Refined)

This document outlines the data structure for D&D-style classes, subclasses, and their associated features and scaling mechanics.

## 1. Class (`classes`)
The core definition of a character class.
- `name`: (string) e.g., "Fighter".
- `identifier`: (string) Unique slug e.g., "fighter".
- `primaryAbility`: (array of strings) e.g., ["CHA"]. Used for multiclassing and scaling.
- `wealth`: (string) Starting wealth formula e.g., "5d4 * 10".
- `imageUrl`: (string, optional) URL for the class icon or artwork.
- `description`: (string) BBCode overview.
- `lore`: (string) BBCode setting/flavor text.
- `sourceId`: (string) Firestore Document ID of the source.
- `hitDie`: (number) e.g., 10 for d10.
- `savingThrows`: (array of strings) e.g., ["STR", "CON"].
- `proficiencies`: (object)
  - `armor`: (array) Static list of identifiers + "Choose X from Set Y" objects.
  - `weapons`: (array) Static list of identifiers + "Choose X from Set Y" objects.
  - `tools`: (array) Static list of identifiers + "Choose X from Set Y" objects.
  - `skills`: (array) Static list of identifiers + "Choose X from Set Y" objects.
  - `languages`: (array) Static list of identifiers + "Choose X from Set Y" objects.
  - `savingThrows`: (array) List of proficient ability scores.
- `startingEquipment`: (object)
  - `text`: (string) BBCode display text.
  - `defaultData`: (array of objects) Structured item/category IDs for automation.
- `multiclassing`: (object)
  - `requirements`: (map) e.g., `{"int": 13}`.
  - `proficienciesGained`: (object) Same structure as main proficiencies.
- `subclassTitle`: (string) e.g., "Primal Path".
- `subclassFeatureLevels`: (array of numbers) e.g., [3, 6, 10, 14].
- `asiLevels`: (array of numbers) e.g., [4, 8, 12, 16, 19].
- `optionalfeatureProgression`: (array of objects)
  - `name`: (string) e.g., "Invocations".
  - `featureType`: (string) ID for filtering choices.
  - `progression`: (array of numbers) Count of choices available at each level (1-20).
- `spellcasting`: (object, optional)
  - `hasSpellcasting`: (boolean) Whether the class has spellcasting features.
  - `description`: (string) BBCode overview of the spellcasting feature.
  - `level`: (number) Level at which spellcasting is obtained.
  - `ability`: (string) e.g., "INT", "WIS", "CHA".
  - `type`: (enum) `prepared` | `known` | `spellbook`.
  - `progressionId`: (string) Reference to `spellcastingScalings` (1st-9th slots).
  - `altProgressionId`: (string) Reference to `pactMagicScalings` (Pact slots).
  - `spellsKnownId`: (string) Reference to `spellsKnownScalings` (Cantrips/Spells Known).
  - `spellsKnownFormula`: (string) e.g., "Wisdom modifier + Druid level".
- `uniqueOptionGroupIds`: (array of strings) References to `uniqueOptionGroups` (deprecated).
- `uniqueOptionMappings`: (array of objects)
  - `groupId`: (string) ID of the unique option group.
  - `featureId`: (string) ID of the class feature it belongs to.
  - `scalingColumnId`: (string, optional) ID of the scaling column.
- `excludedOptionIds`: (map) Keyed by `groupId`, value is an array of `itemId` strings that are excluded for this class.
- `tagIds`: (array of strings) References to the `tags` collection for filtering.
- `advancements`: (array of objects) Structured progression steps.
  - `_id`: (string) Unique identifier.
  - `type`: (enum) `AbilityScoreImprovement`, `HitPoints`, `ItemChoice`, `ItemGrant`, `ScaleValue`, `Size`, `Trait`, `Subclass`.
  - `level`: (number) 1-20.
  - `title`: (string, optional) Custom label.
  - `configuration`: (object) Settings for the advancement.
    - **AbilityScoreImprovement**:
      - `points`: (number) Total points to distribute.
      - `cap`: (number) Maximum increase for a single stat.
      - `fixed`: (map) Keyed by stat slug (e.g., `str`), value is points.
      - `locked`: (array) List of stat slugs that are locked/immutable.
    - **HitPoints**:
      - `hitDie`: (number) e.g., 8 for d8.
    - **ItemChoice**:
      - `choiceCount`: (number) Number of items to pick.
      - `choiceSource`: (enum) `fixed` | `scaling`.
      - `scalingColumnId`: (string, optional) If source is `scaling`.
      - `itemType`: (enum) `anything`, `feature`, `unique-option-group`, `spell`, `item`.
      - `pool`: (array[string]) List of applicable IDs if `itemType` is selective.
      - `optionGroupId`: (string, optional) Target group if `itemType` is `unique-option-group`.
    - **ItemGrant**:
      - `optional`: (boolean) Whether the entire grant package is an opt-in choice.
      - `itemType`: (enum) same as ItemChoice.
      - `items`: (array[object]) Items to grant: `{ id: string, optional: boolean }`.
    - **ScaleValue**:
      - `scalingColumnId`: (string) Reference to `scalingColumns`.
    - **Size**:
      - `size`: (enum) `tiny`, `sm`, `med`, `lg`, `huge`, `grg`.
    - **Trait**:
      - `type`: (enum) `skills`, `saves`, `armor`, `weapons`, `tools`, `languages`, `di`, `dr`, `dv`, `ci`, `attributes`.
      - `mode`: (enum) `default`, `expertise`, `forcedExpertise`, `upgrade`.
      - `allowReplacement`: (boolean).
      - `fixed`: (array[string]) Guaranteed proficiencies.
      - `choiceCount`: (number) Number of choices from pool.
      - `choiceSource`: (enum) `fixed` | `scaling`.
      - `scalingColumnId`: (string, optional).
      - `options`: (array[string]) Pool of available proficient choices.
  - `value`: (object) Choices made by the character.
  - `flags`: (object) Internal metadata.

## 2. Subclass (`subclasses`)
Specializations for a specific class.
- `name`: (string) e.g., "Eldritch Knight".
- `identifier`: (string) Unique slug e.g., "eldritch-knight".
- `imageUrl`: (string, optional) URL for the subclass artwork.
- `classId`: (string) Reference to `classes`.
- `sourceId`: (string) Firestore Document ID of the source.
- `description`: (string) BBCode overview.
- `spellcastingId`: (string, optional) For subclasses that grant magic (e.g., Eldritch Knight).
- `advancements`: (array of objects) Same structure as in Classes.

## 3. Feature (`features`)
Individual abilities gained at specific levels.
- `name`: (string) e.g., "Action Surge".
- `identifier`: (string) Unique slug e.g., "action-surge".
- `description`: (string) BBCode text OR complex structured object for recursive formatting.
- `level`: (number) 1-20.
- `parentId`: (string) ID of the Class or Subclass it belongs to.
- `parentType`: (enum) `class` | `subclass`.
- `sourceId`: (string, generated during export) Semantic identifier used for external linking (e.g. `class-feature-action-surge`). Generated from `name` or `identifier`. For subclass placeholders, the level is appended (e.g. `class-feature-sorcerous-origin-feature-6`).
- `isSubclassFeature`: (boolean) If true, this feature is a placeholder in the main class table that gets filled by the active subclass.
- `type`: (string) Foundry feature type: `background`, `class`, `monster`, `species`, `enchantment`, `feat`, `gift`, `vehicle`.
- `configuration`: (object)
  - `requiredLevel`: (number, optional) Level required to select this feature.
  - `requiredIds`: (array of strings) Identifiers for items/features required.
  - `repeatable`: (boolean) Whether it can be chosen multiple times.
- `properties`: (array of strings) List of property keys: `magical`, `passive`.
- `usage`: (object)
  - `spent`: (number) Current usage count.
  - `max`: (string) Maximum usage formula or value.
- `quantityScalingId`: (string, optional) ID of a `scalingColumns` doc providing the number of uses/targets.
- `valueScalingId`: (string, optional) ID of a `scalingColumns` doc providing the potency (e.g., 1d6, 1d8).
- `automation`: (object, optional) Foundry VTT compatible data for `activities` and `effects`.
  - `activities`: (array of objects) Semantic definitions of feature actions.
    - `kind`: (string) Type of activity: `attack`, `save`, `check`, `heal`, `damage`, `utility`, `spell`, `enchant`, `forward`.
    - `activation`: (object) `type`, `value`, `condition`, `override`.
    - `range`: (object) `units`, `special`, `value`, `override`.
    - `target`: (object) `affects` (count, type, choice), `template` (count, size, type, units), `prompt`, `override`.
    - `consumption`: (object) `scaling` (allowed, max), `targets` (array of costs), `uses` (spent, max).
    - `visibility`: (object) `identifier`, `level` (min, max).
    - `save`/`check`: (object, optional) `abilities` (array), `dc` (calculation, formula).
    - `damage`/`healing`: (object, optional) `parts` (array of dice/bonus/scaling/custom objects), `onSave`.
  - `effects`: (array of objects) Foundry Active Effect definitions.
- `advancements`: (array of objects) Structured progression steps. Inherits level from parent feature.
  - Same structure as in Classes/Subclasses.

## 4. Scaling Column (`scalingColumns`)
Manually defined columns for the class table (Invocations, Sorcery Points, Martial Arts Die).
- `name`: (string) e.g., "Sorcery Points".
- `parentId`: (string) ID of Class or Subclass.
- `parentType`: (enum) `class` | `subclass`.
- `values`: (map) Keyed by level string "1"-"20", containing the display string (e.g., "2", "1d6", "—").
- `updatedAt`: (string) ISO timestamp.
- `createdAt`: (string) ISO timestamp.

## 5. Spellcasting Scaling (`spellcastingScalings`)
Standard 1st-9th level slot progression.
- `name`: (string) e.g., "Full Caster".
- `levels`: (map) Keyed by level string "1"-"20".
  - `slots`: (array of numbers) 1st through 9th level slots.
- `updatedAt`: (string) ISO timestamp.
- `createdAt`: (string) ISO timestamp.

## 6. Alternative Spellcasting Scaling (`pactMagicScalings`)
Pact Magic style progression.
- `name`: (string) e.g., "Warlock".
- `levels`: (map) Keyed by level string "1"-"20".
  - `slotCount`: (number) Number of slots.
  - `slotLevel`: (number) Maximum level of the slots.
- `updatedAt`: (string) ISO timestamp.
- `createdAt`: (string) ISO timestamp.

## 7. Spells Known Scaling (`spellsKnownScalings`)
Cantrips and Spells Known progression.
- `name`: (string)
- `levels`: (map) Keyed by level string "1"-"20".
  - `cantrips`: (number)
  - `spells`: (number)
- `updatedAt`: (string) ISO timestamp.
- `createdAt`: (string) ISO timestamp.

## 8. Spell (`spells`)
Individual magic spells.
- `name`: (string)
- `level`: (number) 0-9.
- `school`: (string)
- `sourceId`: (string) Firestore Document ID of the source.
- `description`: (string) BBCode text.
- `classIds`: (array of strings) IDs of classes that have this spell.
- `subclassIds`: (array of strings) IDs of subclasses that have this spell.
- `automation`: (object, optional) Foundry VTT compatible data for `activities` and `effects`.
