# Phase 4 Migration Details: Core Compendium

## Table Definitions

### 1. Items
- **Table**: `items`
- **Columns**: `id` (PK), `name`, `identifier`, `item_type`, `rarity`, `quantity`, `weight`, `price_value`, `price_denomination`, `attunement` (BOOLEAN), `equipped` (BOOLEAN), `identified` (BOOLEAN), `magical` (BOOLEAN), `description`, `image_url`, `activities` (JSON), `effects` (JSON), `source_id` (FK), `page`, `tags` (JSON).

### 2. Feats
- **Table**: `feats`
- **Columns**: `id` (PK), `name`, `identifier`, `feat_type`, `source_type`, `requirements`, `repeatable` (BOOLEAN), `uses_max`, `uses_spent`, `description`, `image_url`, `activities` (JSON), `effects` (JSON), `source_id` (FK), `page`, `tags` (JSON).

### 3. Spells
- **Table**: `spells`
- **Columns**: `id` (PK), `name`, `identifier`, `level`, `school`, `preparation_mode`, `ritual` (BOOLEAN), `concentration` (BOOLEAN), `components_vocal` (BOOLEAN), `components_somatic` (BOOLEAN), `components_material` (BOOLEAN), `components_material_text`, `components_consumed` (BOOLEAN), `components_cost`, `description`, `image_url`, `activities` (JSON), `effects` (JSON), `foundry_data` (JSON), `source_id` (FK), `page`, `tags` (JSON).

### 4. Features
- **Table**: `features`
- **Columns**: `id` (PK), `name`, `identifier`, `parent_id` (TEXT), `parent_type` (TEXT), `level`, `feature_type`, `subtype`, `requirements`, `description`, `image_url`, `uses_max`, `uses_spent`, `uses_recovery` (JSON), `prerequisites_level`, `prerequisites_items` (JSON), `repeatable` (BOOLEAN), `properties` (JSON), `activities` (JSON), `effects` (JSON), `advancements` (JSON), `source_id` (FK), `page`, `tags` (JSON).

### 5. Classes & Subclasses
- **Table**: `classes`
  - **Columns**: `id` (PK), `name`, `source_id` (FK), `category`, `tag_ids` (JSON), `hit_die` (INTEGER), `description`, `lore`, `preview`, `image_url`, `card_image_url`, `preview_image_url`, `card_display` (JSON), `image_display` (JSON), `preview_display` (JSON), `saving_throws` (JSON), `proficiencies` (JSON), `starting_equipment`, `multiclassing`, `primary_ability` (JSON), `primary_ability_choice` (JSON), `spellcasting` (JSON), `advancements` (JSON), `subclass_title`, `subclass_feature_levels` (JSON).
- **Table**: `subclasses`
  - **Columns**: `id` (PK), `class_id` (FK), `name`, `source_id` (FK), `description`, `image_url`, `image_display` (JSON), `spellcasting` (JSON), `advancements` (JSON).

### 6. Scaling Columns
- **Table**: `scaling_columns`
  - **Columns**: `id` (PK), `name`, `parent_id` (TEXT), `parent_type` (TEXT), `values` (JSON).
