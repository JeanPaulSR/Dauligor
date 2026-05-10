-- Phase: Spellbook Manager — rules become first-class
-- Drop the per-class rule structure (no live data to migrate) and replace with
-- standalone `spell_rules` + a junction table `spell_rule_applications` that lets
-- a single rule attach to many consumers (classes, subclasses, feats, features,
-- backgrounds, items, unique_option_items). See docs/features/spellbook-manager.md.

DROP TABLE IF EXISTS class_spell_list_rules;

CREATE TABLE IF NOT EXISTS spell_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    query TEXT NOT NULL DEFAULT '{}',          -- JSON: filter shape (RuleQuery)
    manual_spells TEXT NOT NULL DEFAULT '[]',  -- JSON: spell IDs that always match
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spell_rules_name ON spell_rules(name COLLATE NOCASE);

-- Junction: which consumer entities have this rule applied to them.
-- `applies_to_type` is one of: class | subclass | feat | feature | background | item | unique_option_item.
-- We don't FK applies_to_id because it points at different tables per type; orphan
-- rows after the consumer is deleted should be cleaned up by the deletion path.
CREATE TABLE IF NOT EXISTS spell_rule_applications (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    applies_to_type TEXT NOT NULL,
    applies_to_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rule_id) REFERENCES spell_rules(id) ON DELETE CASCADE,
    UNIQUE (rule_id, applies_to_type, applies_to_id)
);

CREATE INDEX IF NOT EXISTS idx_spell_rule_applications_rule ON spell_rule_applications(rule_id);
CREATE INDEX IF NOT EXISTS idx_spell_rule_applications_target ON spell_rule_applications(applies_to_type, applies_to_id);
