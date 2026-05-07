-- Phase 4e: Classes & Subclasses

CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    source_id TEXT,
    category TEXT,
    tag_ids TEXT, -- JSON array
    hit_die INTEGER DEFAULT 8,
    description TEXT,
    lore TEXT,
    preview TEXT,
    image_url TEXT,
    card_image_url TEXT,
    preview_image_url TEXT,
    card_display TEXT, -- JSON object
    image_display TEXT, -- JSON object
    preview_display TEXT, -- JSON object
    saving_throws TEXT, -- JSON array
    proficiencies TEXT, -- JSON object (armor, weapons, tools, skills)
    starting_equipment TEXT,
    multiclassing TEXT,
    primary_ability TEXT, -- JSON array
    primary_ability_choice TEXT, -- JSON array
    spellcasting TEXT, -- JSON object (config)
    advancements TEXT, -- JSON array
    subclass_title TEXT DEFAULT 'Subclass',
    subclass_feature_levels TEXT, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subclasses (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_id TEXT,
    description TEXT,
    image_url TEXT,
    image_display TEXT, -- JSON object
    spellcasting TEXT, -- JSON object (overrides)
    advancements TEXT, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_classes_source ON classes(source_id);
CREATE INDEX IF NOT EXISTS idx_classes_identifier ON classes(identifier);
CREATE INDEX IF NOT EXISTS idx_subclasses_class ON subclasses(class_id);
