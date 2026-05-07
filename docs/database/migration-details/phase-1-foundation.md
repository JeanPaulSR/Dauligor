# Phase 1 Migration Details: Foundation & Taxonomy

## Table Definitions

### 1. Sources Registry
- **Table**: `sources`
- **Primary Key**: `id` (TEXT)
- **Columns**: `name`, `slug` (UNIQUE), `abbreviation`, `rules_version` (Enum: 2014, 2024, universal), `status` (Enum: ready, draft, retired), `description`, `image_url`, `external_url`, `tags` (JSON), `payload` (JSON), `created_at`, `updated_at`.

### 2. Taxonomy System
- **Table**: `tag_groups`
  - **Columns**: `id` (PK), `name`, `category`, `classifications` (JSON), `description`, `updated_at`.
- **Table**: `tags`
  - **Columns**: `id` (PK), `group_id` (FK: `tag_groups.id`), `name`, `slug`, `updated_at`.
  - **Constraint**: UNIQUE on `(group_id, slug)`.

### 3. Equipment & Proficiency Categories
- **Tables**: `armor_categories`, `weapon_categories`, `weapon_properties`, `tool_categories`, `language_categories`.
- **Shared Schema**: `id` (PK), `name`, `identifier` (UNIQUE), `"order"` (INTEGER), `description`, `updated_at`.
- **Table**: `languages`
  - **Columns**: `id` (PK), `category_id` (FK: `language_categories.id`), `name`, `identifier` (UNIQUE), `description`, `updated_at`.

### 4. Mechanical Tokens
- **Table**: `attributes`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE, 3-letter uppercase), `"order"` (INTEGER), `updated_at`.
- **Table**: `damage_types`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `"order"`, `description`, `updated_at`.
- **Table**: `condition_categories`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `"order"`, `description`, `updated_at`.

### 5. Status Conditions
- **Table**: `status_conditions`
  - **Columns**: `id` (PK), `identifier` (UNIQUE), `name`, `image_url`, `reference`, `description`, `"order"`, `implied_ids` (JSON), `changes` (JSON), `source` (TEXT), `created_at`, `updated_at`.

### 6. Specialized Proficiencies
- **Table**: `skills`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `foundry_alias`, `ability_id` (FK: `attributes.id`), `description`, `source`, `page`, `basic_rules` (BOOLEAN).
- **Table**: `tools`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `category_id` (FK: `tool_categories.id`), `foundry_alias`, `ability_id` (FK: `attributes.id`), `description`, `source`, `page`, `basic_rules` (BOOLEAN).
- **Table**: `weapons`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `category_id` (FK: `weapon_categories.id`), `weapon_type` (Enum: Melee, Ranged), `ability_id` (FK: `attributes.id`), `foundry_alias`, `description`, `property_ids` (JSON), `source`, `page`, `basic_rules` (BOOLEAN).
- **Table**: `armor`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `category_id` (FK: `armor_categories.id`), `ability_id` (FK: `attributes.id`), `foundry_alias`, `description`, `source`, `page`, `basic_rules` (BOOLEAN).

### 7. Spellcasting System Foundation
- **Table**: `spellcasting_types`
  - **Columns**: `id` (PK), `name`, `identifier` (UNIQUE), `foundry_name`, `formula`.
- **Table**: `spellcasting_progressions`
  - **Columns**: `id` (PK), `name`, `type` (Enum: standard, pact, known), `levels` (JSON).
- **Table**: `multiclass_master_chart`
  - **Columns**: `id` (PK), `levels` (JSON).

### 8. Modular Options
- **Table**: `unique_option_groups`
  - **Columns**: `id` (PK), `name`, `description`, `source_id` (FK: `sources.id`), `class_ids` (JSON).
- **Table**: `unique_option_items`
  - **Columns**: `id` (PK), `group_id` (FK: `unique_option_groups.id`), `name`, `description`, `icon_url`, `source_id` (FK: `sources.id`), `level_prerequisite` (INTEGER), `string_prerequisite`, `is_repeatable` (BOOLEAN), `page`, `class_ids` (JSON).

### 9. Image Metadata
- **Table**: `image_metadata`
  - **Columns**: `id` (PK), `url`, `storage_path` (UNIQUE), `filename`, `folder`, `creator`, `description`, `tags` (JSON), `license`, `source`, `uploaded_by`, `uploaded_by_name`, `uploaded_at`, `size`.
