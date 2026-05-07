-- Migration: Phase 4b - Feats
-- Description: Table for general feats and features.

CREATE TABLE IF NOT EXISTS feats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    feat_type TEXT NOT NULL DEFAULT 'general',
    source_type TEXT NOT NULL DEFAULT 'feat',
    requirements TEXT,
    repeatable INTEGER DEFAULT 0, -- Boolean
    uses_max TEXT,
    uses_spent INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    activities TEXT DEFAULT '[]', -- JSON string
    effects TEXT DEFAULT '[]',    -- JSON string
    source_id TEXT REFERENCES sources(id),
    page TEXT,
    tags TEXT DEFAULT '[]',       -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feats_type ON feats(feat_type);
CREATE INDEX IF NOT EXISTS idx_feats_source_type ON feats(source_type);
CREATE INDEX IF NOT EXISTS idx_feats_source ON feats(source_id);
