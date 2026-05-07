-- Migration: Phase 4d - Features
-- Description: Table for class and subclass features.

CREATE TABLE IF NOT EXISTS features (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    parent_id TEXT, -- ID of the class or subclass it belongs to
    parent_type TEXT, -- 'class' or 'subclass'
    level INTEGER NOT NULL DEFAULT 1,
    feature_type TEXT DEFAULT 'class', -- 'class', 'subclass', 'monster', etc
    subtype TEXT, -- 'eldritchInvocation', 'fightingStyle', etc
    requirements TEXT,
    description TEXT,
    image_url TEXT,
    uses_max TEXT,
    uses_spent INTEGER DEFAULT 0,
    uses_recovery TEXT DEFAULT '[]', -- JSON
    prerequisites_level INTEGER,
    prerequisites_items TEXT DEFAULT '[]', -- JSON array of IDs
    repeatable INTEGER DEFAULT 0,
    properties TEXT DEFAULT '[]', -- JSON array
    activities TEXT DEFAULT '[]', -- JSON
    effects TEXT DEFAULT '[]',    -- JSON
    advancements TEXT DEFAULT '[]', -- JSON (Features can have their own advancements)
    source_id TEXT,
    page TEXT,
    tags TEXT DEFAULT '[]', -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_features_parent ON features(parent_id, parent_type);
CREATE INDEX IF NOT EXISTS idx_features_level ON features(level);
CREATE INDEX IF NOT EXISTS idx_features_identifier ON features(identifier);
