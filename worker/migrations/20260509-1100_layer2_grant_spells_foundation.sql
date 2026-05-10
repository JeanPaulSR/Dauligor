-- Phase: Spellbook Manager — Layer 2 foundation
-- Schema for `GrantSpells` and `ExtendSpellList` advancement types. Editor +
-- builder logic land in subsequent phases (1b / 1c). See
-- docs/features/spellbook-manager.md → Layer 2.

-- character_spells gets full source attribution for backward resolution.
-- granted_by_type / granted_by_id pinpoint the source entity (class, subclass,
-- feat, feature, item, option_item, background) so removing the source can sweep
-- its granted spells in one query. granted_by_advancement_id points at the
-- specific advancement row inside that source — required for partial reversals
-- (e.g., dropping a class level only sweeps that level's grants).
-- counts_as_class_id is which class's slot/ability the spell uses; null = any
-- spellcasting class on the character can cast it (typical for feat/item grants).
-- doesnt_count_against_* flags express the "always prepared / no slot used"
-- behaviour seen on Cleric domain spells, Magic Initiate, Chronomancy Initiate.
ALTER TABLE character_spells ADD COLUMN granted_by_type TEXT;
ALTER TABLE character_spells ADD COLUMN granted_by_id TEXT;
ALTER TABLE character_spells ADD COLUMN granted_by_advancement_id TEXT;
ALTER TABLE character_spells ADD COLUMN counts_as_class_id TEXT;
ALTER TABLE character_spells ADD COLUMN doesnt_count_against_prepared INTEGER DEFAULT 0;
ALTER TABLE character_spells ADD COLUMN doesnt_count_against_known INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_character_spells_granted_by
  ON character_spells(granted_by_type, granted_by_id);

-- Per-character spell-list extensions (Divine Soul Sorcerer / Chronomancy
-- Initiate pattern). Adds spells to a class's available pool FOR THIS CHARACTER
-- ONLY — the character still has to learn them via the class's normal
-- progression. Distinct from character_spells (which holds spells the character
-- actually knows / has prepared / was granted).
CREATE TABLE IF NOT EXISTS character_spell_list_extensions (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    spell_id TEXT NOT NULL,
    granted_by_type TEXT,
    granted_by_id TEXT,
    granted_by_advancement_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (spell_id) REFERENCES spells(id) ON DELETE CASCADE,
    UNIQUE (character_id, class_id, spell_id)
);

CREATE INDEX IF NOT EXISTS idx_character_spell_list_extensions_character
  ON character_spell_list_extensions(character_id, class_id);
CREATE INDEX IF NOT EXISTS idx_character_spell_list_extensions_granted_by
  ON character_spell_list_extensions(granted_by_type, granted_by_id);
