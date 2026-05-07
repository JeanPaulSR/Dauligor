-- Migration: 0010_characters.sql
-- Description: Detailed tables for characters and their related data.

-- Core character table
CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    campaign_id TEXT,
    name TEXT NOT NULL,
    image_url TEXT,
    race_id TEXT,
    background_id TEXT,
    level INTEGER DEFAULT 1,
    exhaustion INTEGER DEFAULT 0,
    has_inspiration INTEGER DEFAULT 0, -- 0 or 1
    current_hp INTEGER DEFAULT 10,
    temp_hp INTEGER DEFAULT 0,
    max_hp_override INTEGER,
    stats_json TEXT DEFAULT '{}',
    info_json TEXT DEFAULT '{}',
    senses_json TEXT DEFAULT '{}',
    metadata_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Level-by-level progression
CREATE TABLE IF NOT EXISTS character_progression (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    subclass_id TEXT,
    level_index INTEGER NOT NULL,
    hp_roll INTEGER DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Advancement choices
CREATE TABLE IF NOT EXISTS character_selections (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    advancement_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    selected_ids TEXT DEFAULT '[]', -- JSON array
    source_scope TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Inventory
CREATE TABLE IF NOT EXISTS character_inventory (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    is_equipped INTEGER DEFAULT 0,
    container_id TEXT,
    custom_data TEXT DEFAULT '{}',
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Spells
CREATE TABLE IF NOT EXISTS character_spells (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    spell_id TEXT NOT NULL,
    source_id TEXT,
    is_prepared INTEGER DEFAULT 0,
    is_always_prepared INTEGER DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Proficiencies
CREATE TABLE IF NOT EXISTS character_proficiencies (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    proficiency_level REAL DEFAULT 1,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_progression_char ON character_progression(character_id);
CREATE INDEX IF NOT EXISTS idx_selections_char ON character_selections(character_id);
CREATE INDEX IF NOT EXISTS idx_inventory_char ON character_inventory(character_id);
CREATE INDEX IF NOT EXISTS idx_spells_char ON character_spells(character_id);
CREATE INDEX IF NOT EXISTS idx_proficiencies_char ON character_proficiencies(character_id);
