-- Phase: Spellbook Manager — Layer 1 v1
-- Per-class master spell list (snapshot). Hand-curated in v1; rule-driven population added in v1.1.

CREATE TABLE IF NOT EXISTS class_spell_lists (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    spell_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', -- 'manual' or 'rule:<rule_id>'
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (spell_id) REFERENCES spells(id) ON DELETE CASCADE,
    UNIQUE (class_id, spell_id)
);

CREATE INDEX IF NOT EXISTS idx_class_spell_lists_class ON class_spell_lists(class_id);
CREATE INDEX IF NOT EXISTS idx_class_spell_lists_spell ON class_spell_lists(spell_id);
