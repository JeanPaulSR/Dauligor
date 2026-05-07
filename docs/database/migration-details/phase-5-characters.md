# Phase 5 Migration Details: Character Builder & Sheets

## Table Definitions

### 1. Core Character
- **Table**: `characters`
- **Columns**: `id` (PK), `user_id` (TEXT), `campaign_id` (FK), `name`, `image_url`, `race_id` (TEXT), `background_id` (TEXT), `level` (INTEGER), `exhaustion` (INTEGER), `has_inspiration` (BOOLEAN), `current_hp` (INTEGER), `temp_hp` (INTEGER), `max_hp_override` (INTEGER), `stats_json` (JSON), `info_json` (JSON), `senses_json` (JSON), `metadata_json` (JSON).
- **Indices**: `idx_characters_user`, `idx_characters_campaign`.

### 2. Character Progression
- **Table**: `character_progression`
- **Columns**: `id` (PK), `character_id` (FK), `class_id` (TEXT), `subclass_id` (TEXT), `level_index` (INTEGER), `hp_roll` (INTEGER).
- **Constraint**: FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE.
- **Indices**: `idx_progression_char`.

### 3. Character Selections
- **Table**: `character_selections`
- **Columns**: `id` (PK), `character_id` (FK), `advancement_id` (TEXT), `level` (INTEGER), `selected_ids` (JSON), `source_scope` (TEXT).
- **Constraint**: FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE.
- **Indices**: `idx_selections_char`.

### 4. Character Inventory
- **Table**: `character_inventory`
- **Columns**: `id` (PK), `character_id` (FK), `item_id` (TEXT), `quantity` (INTEGER), `is_equipped` (BOOLEAN), `container_id` (TEXT), `custom_data` (JSON).
- **Constraint**: FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE.
- **Indices**: `idx_inventory_char`.

### 5. Character Spells
- **Table**: `character_spells`
- **Columns**: `id` (PK), `character_id` (FK), `spell_id` (TEXT), `source_id` (TEXT), `is_prepared` (BOOLEAN), `is_always_prepared` (BOOLEAN).
- **Constraint**: FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE.
- **Indices**: `idx_spells_char`.

### 6. Character Proficiencies
- **Table**: `character_proficiencies`
- **Columns**: `id` (PK), `character_id` (FK), `entity_id` (TEXT), `entity_type` (TEXT), `proficiency_level` (REAL).
- **Constraint**: FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE.
- **Indices**: `idx_proficiencies_char`.

## Migration Logic
- **Base Character**: Root fields and nested JSON objects (`stats.base`, `info`, `senses`) are mapped to `characters`.
- **Progression**: The `progression` array is destructured into individual rows in `character_progression`.
- **Selections**: `selectedOptions` (both legacy and scoped formats) are destructured into `character_selections`.
- **Inventory/Spells**: Extracted from `progressionState.ownedItems` and `progressionState.ownedSpells` respectively.
- **Proficiencies**: Flattened from root-level arrays (`proficientSkills`, `expertiseSkills`, `savingThrows`, `armorProficiencies`, etc.) into `character_proficiencies`.
