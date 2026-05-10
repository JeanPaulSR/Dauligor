-- Phase: Spellbook Manager — Layer 1 v1.1
-- Saved tag-query rules that auto-populate class_spell_lists. Authors save filter
-- configurations as named rules; "Rebuild from rules" re-applies them against the
-- current spell catalogue. Manual class_spell_lists rows (source = 'manual') are
-- preserved across rebuilds; rule-driven rows (source LIKE 'rule:%') are replaced.

CREATE TABLE IF NOT EXISTS class_spell_list_rules (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '{}', -- JSON: filter shape mirroring SpellListManager state
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_class_spell_list_rules_class ON class_spell_list_rules(class_id);
