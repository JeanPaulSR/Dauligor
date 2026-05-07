# Character & User Management System

## 1. Profile Components

Path: `src/pages/core/`

- **`Profile.tsx`**: Renders User Document data from the `users` collection.
    - **Logic**: Implements a conditional check on `isPrivate`. If true, the component returns an access denied state unless `uid === auth.currentUser.uid` or `role === 'admin'`.
- **`Settings.tsx`**: Interface for updating `users` document fields.
    - **Functionality**: Updates `theme`, `accentColor`, `hideUsername`, and `avatarUrl`.

## 2. Bookmarks Logic

Path: `src/pages/core/Bookmarks.tsx`

- **Data Store**: Firestore collection `bookmarks`.
- **Document Structure**: `{ userId (string), type (string), targetId (string), title (string) }`.
- **Sync**: Components use `onSnapshot` to maintain high-consistency views between the dashboard and individual articles.

## 3. Character Construction

Path: `src/pages/characters/`

- **`CharacterBuilder.tsx`**: Multi-step workspace for the `characters` collection.
- **Design Intent**: Integrated character sheet view with real-time editing of stats and metadata.
- **Primary Data Points**:
    - **Identity**: `name`, `imageUrl`, `info` (physical traits, traits/ideals/bonds/flaws).
    - **Race & Background**: `raceId`, `backgroundId`, `raceData` (size, type).
    - **Vitals**: `hp`, `hitDie`, `spellPoints`, `ac`, `speed`, `initiative`.
    - **Development**: `level`, `stats` (base scores), `proficiencyBonus`.
    - **Proficiencies**: `savingThrows`, `halfProficientSavingThrows`, `proficientSkills`, `expertiseSkills`, `halfProficientSkills`, `overriddenSkillAbilities`, `armorProficiencies`, `weaponProficiencies`, `toolProficiencies`, `languages`.
    - **Sensory**: `senses` (passive stats).
    - **Associations**: `classId`, `subclassId`, `campaignId`.

## 4. Advancement System

The `CharacterBuilder.tsx` integrates a dynamic advancement system that handles level-by-level progression for classes and subclasses.

- **Feature Grants**: Automatically assigns features defined at specific levels.
- **Item Choices**: Supports selection of features or options from predefined pools (Advancements).
- **Subclass Selection**: Automatically triggers the subclass selection workflow when a character reaches the level defined by a `Subclass` advancement in their primary class.
- **Advancement Persistence**: Choices are stored in the `characters` document under `advancements` and `selectedOptions`.

### 5. Character Sheet UI Layout

The character sheet in `CharacterBuilder.tsx` follows a modern, high-density architecture inspired by Foundry VTT:

- **Ability Score Rail**: Bold, technical cards at the top of the workspace providing instant access to modifiers and base scores.
- **Vital Hub**: Central section for Portrait, Hit Points (Resource Meters), Defense (AC), Initiative, Speed, and Proficiency.
- **Saving Throws**: Dedicated section with proficiency-toggled modifiers (None -> Prof -> Exp -> Half).
- **Three-Column Detail (Bottom)**: 
    - **Column 1: Skills & Knowledge**: Vertical list of proficiency-toggled skills. Supports 4-state cycling (None, Proficiency, Expertise, Half-Proficiency) and dynamic ability score mapping (e.g., using Strength for Intimidation).
    - **Column 2: Sensory Traits & Defenses**: Condensed passive trait blocks (Perception, Investigation, Insight), languages, and resistances.
    - **Column 3: Identity & Proficiency Stack**: Integrated vertical stack for Biological Type, Race, Background, and Professional Training (Armor and Weapon proficiencies).

**Styling Note**: The sheet uses the `bg-card/50` and `border-gold/20` combination along with Gold-themed navigation to maintain consistency with the DM toolset.
