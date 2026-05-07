-- Migration: Phase 4a - Items
-- Description: Unified items table for loot, consumables, tools, and equipment.

CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    item_type TEXT NOT NULL DEFAULT 'loot',
    rarity TEXT DEFAULT 'none',
    quantity INTEGER DEFAULT 1,
    weight REAL DEFAULT 0,
    price_value REAL DEFAULT 0,
    price_denomination TEXT DEFAULT 'gp',
    attunement INTEGER DEFAULT 0, -- Boolean
    equipped INTEGER DEFAULT 0,   -- Boolean
    identified INTEGER DEFAULT 1, -- Boolean
    magical INTEGER DEFAULT 0,    -- Boolean
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

CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_rarity ON items(rarity);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
