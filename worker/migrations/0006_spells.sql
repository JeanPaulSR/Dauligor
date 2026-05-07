-- Migration: Phase 4c - Spells
-- Description: Table for spell compendium.

CREATE TABLE IF NOT EXISTS spells (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    level INTEGER NOT NULL DEFAULT 0,
    school TEXT,
    preparation_mode TEXT DEFAULT 'spell',
    ritual INTEGER DEFAULT 0,
    concentration INTEGER DEFAULT 0,
    components_vocal INTEGER DEFAULT 0,
    components_somatic INTEGER DEFAULT 0,
    components_material INTEGER DEFAULT 0,
    components_material_text TEXT,
    components_consumed INTEGER DEFAULT 0,
    components_cost TEXT,
    description TEXT,
    image_url TEXT,
    activities TEXT DEFAULT '[]', -- JSON
    effects TEXT DEFAULT '[]',    -- JSON
    foundry_data TEXT DEFAULT '{}', -- JSON for extra system metadata (range, duration, etc)
    source_id TEXT REFERENCES sources(id),
    page TEXT,
    tags TEXT DEFAULT '[]',       -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spells_level ON spells(level);
CREATE INDEX IF NOT EXISTS idx_spells_school ON spells(school);
CREATE INDEX IF NOT EXISTS idx_spells_source ON spells(source_id);
