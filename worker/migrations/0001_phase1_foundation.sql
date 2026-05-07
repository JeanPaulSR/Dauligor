-- Phase 1: Foundation & Taxonomy
-- Canonical schema for all Phase 1 tables.
-- Run 9999_cleanup.sql first for a fresh start on an existing database.

-- ============================================================
-- 1. Sources Registry
-- ============================================================
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    abbreviation TEXT,
    rules_version TEXT DEFAULT '2014' CHECK (rules_version IN ('2014', '2024', 'universal')),
    status TEXT DEFAULT 'ready' CHECK (status IN ('ready', 'draft', 'retired')),
    description TEXT,
    image_url TEXT,
    external_url TEXT,
    tags JSON,
    payload JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. Taxonomy System
-- ============================================================
CREATE TABLE tag_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    classifications JSON,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES tag_groups(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (group_id, slug)
);

-- ============================================================
-- 3. Equipment & Proficiency Categories
-- ============================================================
CREATE TABLE armor_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE weapon_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE weapon_properties (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tool_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE language_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE languages (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES language_categories(id),
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 4. Mechanical Tokens
-- ============================================================
CREATE TABLE attributes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL, -- UPPERCASE 3-letter key (STR, DEX, etc.)
    "order" INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE damage_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE condition_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 5. Status Conditions
-- ============================================================
CREATE TABLE status_conditions (
    id TEXT PRIMARY KEY,
    identifier TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    image_url TEXT,
    reference TEXT,
    description TEXT,
    "order" INTEGER,
    implied_ids JSON,
    changes JSON,
    source TEXT DEFAULT 'custom',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 6. Specialized Proficiencies
-- ============================================================
CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    foundry_alias TEXT,
    ability_id TEXT REFERENCES attributes(id),
    description TEXT,
    source TEXT,
    page INTEGER,
    basic_rules BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    category_id TEXT REFERENCES tool_categories(id),
    foundry_alias TEXT,
    ability_id TEXT REFERENCES attributes(id),
    description TEXT,
    source TEXT,
    page INTEGER,
    basic_rules BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE weapons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    category_id TEXT REFERENCES weapon_categories(id),
    weapon_type TEXT NOT NULL CHECK (weapon_type IN ('Melee', 'Ranged')),
    ability_id TEXT REFERENCES attributes(id),
    foundry_alias TEXT,
    description TEXT,
    property_ids JSON,
    source TEXT,
    page INTEGER,
    basic_rules BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE armor (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    category_id TEXT REFERENCES armor_categories(id),
    ability_id TEXT REFERENCES attributes(id),
    foundry_alias TEXT,
    description TEXT,
    source TEXT,
    page INTEGER,
    basic_rules BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. Spellcasting System Foundation
-- ============================================================
CREATE TABLE spellcasting_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    foundry_name TEXT,
    formula TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE spellcasting_progressions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('standard', 'pact', 'known')),
    levels JSON NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE multiclass_master_chart (
    id TEXT PRIMARY KEY,
    levels JSON NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 8. Modular Options (Infusions, Eldritch Invocations, etc.)
-- ============================================================
CREATE TABLE unique_option_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_id TEXT REFERENCES sources(id),
    class_ids JSON,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE unique_option_items (
    id TEXT PRIMARY KEY,
    group_id TEXT REFERENCES unique_option_groups(id),
    name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    source_id TEXT REFERENCES sources(id),
    level_prerequisite INTEGER DEFAULT 0,
    string_prerequisite TEXT,
    is_repeatable BOOLEAN DEFAULT 0,
    page TEXT,
    class_ids JSON,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 9. Image Metadata (R2 Asset Registry)
-- ============================================================
CREATE TABLE image_metadata (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    storage_path TEXT UNIQUE NOT NULL,
    filename TEXT,
    folder TEXT,
    creator TEXT,
    description TEXT,
    tags JSON,
    license TEXT,
    source TEXT,
    uploaded_by TEXT,
    uploaded_by_name TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    size INTEGER
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_tags_group ON tags(group_id);
CREATE INDEX idx_languages_category ON languages(category_id);
CREATE INDEX idx_skills_ability ON skills(ability_id);
CREATE INDEX idx_tools_category ON tools(category_id);
CREATE INDEX idx_tools_ability ON tools(ability_id);
CREATE INDEX idx_weapons_category ON weapons(category_id);
CREATE INDEX idx_weapons_ability ON weapons(ability_id);
CREATE INDEX idx_armor_category ON armor(category_id);
CREATE INDEX idx_armor_ability ON armor(ability_id);
CREATE INDEX idx_unique_option_items_group ON unique_option_items(group_id);
CREATE INDEX idx_unique_option_groups_source ON unique_option_groups(source_id);
