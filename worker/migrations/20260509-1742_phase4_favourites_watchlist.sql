-- Phase: Spellbook Manager — Layer 3 Phase 4 (favourites + watchlist)
-- Adds player-level annotation columns to character_spells. None of these
-- affect game-mechanics resolution; they're UX state only.
--   is_favourite     — player starred the spell
--   is_watchlist     — "I want this later" marker
--   watchlist_note   — free-text, optional ("at level 5", "after taking War Caster")
-- See docs/features/spellbook-manager.md → Layer 4 for the per-spell row shape.

ALTER TABLE character_spells ADD COLUMN is_favourite INTEGER DEFAULT 0;
ALTER TABLE character_spells ADD COLUMN is_watchlist INTEGER DEFAULT 0;
ALTER TABLE character_spells ADD COLUMN watchlist_note TEXT;
