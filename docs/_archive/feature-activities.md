# Feature Activity Contract (Dauligor -> Foundry VTT)

This document defines the semantic contract for Feature Activities within the Dauligor system and their translation into the Foundry VTT environment.

## 1. Overview
Dauligor features use a structured JSON model (`SemanticActivity`) to define automation. This allows the Dauligor UI to remain agnostic of the specific implementation details of the VTT, while providing enough semantically meaningful data for the Foundry VTT module to generate native Foundry activities.

## 2. Activity Structure
Each activity follows a strict JSON structure stored within the `automation.activities` array/map of a feature.

### 2.1 Common Fields (Identity Tab)
- **name**: Display name in the VTT.
- **kind**: `attack`, `save`, `check`, `heal`, `damage`, `utility`, `spell`, `enchant`, `forward`.
- **activation**: Details on cost (Action, Bonus Action, etc.).
- **target**: Range and targeting specifications.
- **consumption**: Scaling and usage costs.
- **visibility**: Restricts when the activity is visible (e.g., minimum class level).

### 2.2 Activation & Overrides
Activities can override the parent feature's activation and duration.
- **override**: Boolean flag. If true, the activity uses its own values instead of the parent feature's.

### 2.3 Consumption Scaling
- **scaling**:
    - **allowed**: If true, allows "upcasting" or scaling activation.
    - **max**: String formula or level for maximum scaling.

### 2.4 DC & Formulae
- **dc.calculation**: `spellcasting`, `flat`, or a specific ability slug (`str`, `dex`, etc.).
- **dc.formula**: The calculation string (e.g., `8 + @abilities.int.mod + @prof`).

### 2.5 Damage & Healing
Damage and healing activities use a `parts` array of objects:
- **number**: Number of dice.
- **denomination**: Die size (4, 6, 8, 10, 12, 20, 100).
- **bonus**: Flat bonus string (e.g., `@mod`).
- **types**: Array of damage types (e.g., `["fire", "radiant"]`).
- **scaling**: (Optional) Object for die/bonus scaling.
- **custom**:
    - **enabled**: Use a custom formula string.
    - **formula**: The string (e.g., `(@prof)d10`).

## 3. Translation to Foundry VTT
The Dauligor Foundry VTT module is responsible for:
1. Parsing the `SemanticActivity`.
2. Mapping `kind` to the corresponding Foundry activity type (e.g., `dnd5e.activity.attack`).
3. Translating Dauligor identifiers (e.g., `@mod`) to Foundry data paths (e.g., `@abilities.int.mod`).
4. Applying `visibility` rules to the character sheet.

## 4. Maintenance
Any changes to the `ActivityEditor.tsx` component must be reflected here to ensure the module developer can update the translation logic.
