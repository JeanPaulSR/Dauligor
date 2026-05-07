# Compendium & Mechanics System

## 1. Directory Structure

Path: `src/pages/compendium/`

| EntryType | Associated Filenames |
| :--- | :--- |
| Classes | `ClassList.tsx`, `ClassView.tsx`, `ClassEditor.tsx` |
| Subclasses | `SubclassEditor.tsx` |
| Tags | `TagManager.tsx` |
| Options | `UniqueOptionGroupList.tsx`, `UniqueOptionGroupEditor.tsx` |
| Utilities | `SkillsEditor.tsx`, `ToolsEditor.tsx` |

## 2. Filtering Logic (`ClassList.tsx`)

Implementation of a three-state filter for the `tags` array.

- **States**: `0` (Ingore), `1` (Include), `2` (Exclude).
- **Operators**: Boolean logic supported for `AND`, `OR`, `XOR`.
- **Optimization**: `useMemo` blocks handle the filtering of the classes array from Firestore.

## 3. Table Generation (`ClassView.tsx`)

- **Slots**: If `spellcasting` object exists in document, a 20-row table generates columns for spell slots.
- **Scaling Columns**: Joins `scalingColumns` collection data where `parentId` matches the active class/subclass.
- **Features**: Queries the `features` collection for documents where `parentDocumentId` matches, sorted by `level`.

## 4. Scaling Editors
...
[No changes here, just adding after section 4]

## 5. Advancement System

Path: `src/components/compendium/AdvancementManager.tsx`

The advancement system defines the structured progression steps a character takes as they level up. Advancements can be attached to the class itself, a subclass, or a specific feature.

- **Types**:
  - **Ability Score Improvement**: Configure points to distribute, point caps, and lock individual stats.
  - **Hit Points**: Define the hit die for automated HP calculation.
  - **Item Grant**: Automatically grant features or option items. Supports optional opt-out mechanics.
  - **Item Choice**: Choose X features or options from a specific pool or unique option group.
  - **Scale Value**: Link a scaling value (dice or numbers) to a class scaling column.
  - **Size**: Explicitly set the creature's size category.
  - **Trait**: Grant proficiencies in skills, saving throws, weapons, armor, tools, languages, damage immunities/resistances, or condition immunities. Supports modes like Expertise and Upgrade.

- **Configuration**:
  - **Choice Source**: Choices can be fixed values or dynamically linked to scaling columns (e.g., number of skill choices grows with level).
  - **Human-Readable Identifiers**: The UI dynamically resolves IDs for features and unique option groups to display their common names.

## 6. Subclass Inheritance

- **Rendering**: Subclass data is merged into the `ClassView.tsx` component state via the `activeSubclassId` selection.
- **Data Overlay**: Subclass features and scaling columns are appended to the class base table.
 
 ## 6. Export System
 
 The compendium supports a multi-layer export system to facilitate integration with external tools like Foundry VTT.
 
 - **Layer 1 (Canonical)**: The raw data as stored in Firestore.
 - **Layer 2 (Semantic)**: A transformed JSON produced by `src/lib/exportUtils.ts` that replaces internal Firestore IDs with semantic `sourceId` strings (e.g., `class-feature-action-surge`).
   - **Semantic Logic**: `sourceId` is derived from the item's name or explicit `identifier` field.
   - **Collision Prevention**: For any placeholder feature (marked as `isSubclassFeature`), the level is appended to the `sourceId` to prevent upsert collisions in parsers.
   - **Option Groups**: Modular choice groups (like Metamagic or Invocations) are mapped to their respective features using `uniqueOptionMappings`.
 - **Layer 3 (Foundry VTT)**: A deeply transformed JSON structure that maps canonical data to Foundry's `system` schema, including `activities`, `effects`, and item advancements.
- **Dynamic Integration**: If a unique option group is mapped to a scaling column, the export automatically derives choice progression counts from that column's values.

## 7. Feature Automation (Activities)

Features in the compendium support **Foundry VTT Automation** through a visual Activity Editor.

- **Activity Types**: Standard Foundry activities (Attack, Cast, Save, Heal, etc.) are supported.
- **Configuration Tabs**:
  - **Identity**: Manage the activity name, icon, and chat flavor.
  - **Activation**: Configure action costs (Action, Bonus Action, etc.), duration, and targeting range.
  - **Effect**: (In Development) Mapping of damage dice, saving throw DCs, and associated status effects.
- **Storage**: Activities are stored as a structured object under `automation.activities` within the `features` collection, optimized for direct export into Foundry's data system.

## 8. Import System

The compendium allows importing semantic bundles exported from the application to facilitate cross-environment data synchronization.

- **Entry Point**: `ClassList.tsx` provides an "Import Class" button for administrative users.
- **Idempotency**: The import uses provided IDs to upsert data, allowing for updating existing entities (Classes, Subclasses, Features, etc.) safely.
- **Dependency Resolution**:
  - Automatically creates missing **Sources** referenced in the bundle.
  - Upserts associated **Scaling Columns**, **Unique Option Groups**, and **Unique Option Items**.
  - Synchronizes **Spellcasting Scalings** and associated progression metadata.
- **Data Sanitization**:
  - Metadata and internal Firestore fields (like `id` within the data object) are stripped.
  - JSON-serialized timestamps are replaced with valid Firestore `serverTimestamp()`.

## 9. Editor Ergonomics

- **Keyboard Shortcuts**: Editors (e.g. `ClassEditor.tsx`, `SubclassEditor.tsx`, `CharacterBuilder.tsx`) support `Ctrl + S` and `Cmd + S` to save progress without clicking the Save button.
- **Unsaved Changes**: The `useUnsavedChangesWarning` hook ensures users are warned if they attempt to navigate away via internal links or closing the tab while they have unsaved changes.
