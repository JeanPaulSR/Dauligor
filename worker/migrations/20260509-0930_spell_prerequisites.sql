-- Phase: Spellbook Manager — spell prerequisites
-- Spells can carry prerequisites that gate per-character availability later.
-- `required_tags` lists tag IDs the character must have on their effective tag set.
-- `prerequisite_text` is a free-text fallback for prereqs that don't fit cleanly
-- as a tag check (e.g., "must have cast Detect Magic in the past hour").
-- The tag check is enforced at the character/Layer-2 level, not at the rule/class
-- level — see docs/features/spellbook-manager.md for the layered model.

ALTER TABLE spells ADD COLUMN required_tags TEXT DEFAULT '[]';
ALTER TABLE spells ADD COLUMN prerequisite_text TEXT;
