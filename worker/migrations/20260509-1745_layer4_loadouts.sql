-- Phase: Spellbook Manager — Layer 4 (Spell Loadouts)
-- Sized, named, multi-active prepared-spell sets per character. A spell may be
-- a member of multiple loadouts (loadout_membership JSON on character_spells).
-- Effective prepared = (any active loadout member) ∪ (is_always_prepared = 1)
-- ∪ (is_prepared = 1 — legacy manual toggle, preserved for incremental adoption).
--
-- See docs/features/spellbook-manager.md → Layer 4 for the full design.

CREATE TABLE IF NOT EXISTS character_spell_loadouts (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_spell_loadouts_character
  ON character_spell_loadouts(character_id);

-- JSON array of loadout IDs the spell is currently a member of. One spell can
-- live in many loadouts. Stored as a JSON column rather than a junction table
-- because the cardinality is tiny (a typical character has 1-5 loadouts) and
-- the read path always wants the full membership for a spell row.
ALTER TABLE character_spells ADD COLUMN loadout_membership TEXT DEFAULT '[]';
