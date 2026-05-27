-- Phase: features get parent-scoped identifier uniqueness
--
-- Features live under multiple owner kinds: classes, subclasses, and
-- (as of Phase B) feats / races / backgrounds. The canonical uniqueness
-- scope is therefore `(parent_type, parent_id, identifier)` — the same
-- identifier can recur across different owners (every class with a
-- "spellcasting" feature, for example) but must be unique WITHIN one
-- owner.
--
-- Why not `(source_id, identifier)` like the entity-table family:
-- features inherit their source from their owner indirectly. A class
-- can have features authored under it with mixed sources (a homebrew
-- subclass adding to a PHB class). Source-scoped uniqueness would
-- forbid that legitimate case.
--
-- Pre-existing duplicate fix:
-- `parent_id = d40c118b-0023-4922-835e-1629c73e4832` (an Arcane Archer
-- subclass) currently has two features with identifier
-- `arcane-archer-spells`:
--   - `495950d4-ec1c-41ef-8c84-d5278d27465b` — "Arcane Archer Spells"
--     (the genuine spells feature)
--   - `620855c5-37d2-4bb5-a9a0-4efaf0a95cdc` — "Arcane Quiver"
--     (a different feature that got the wrong identifier slug at
--     import time, 13 seconds after the first row landed)
-- Renaming the buggy row to `arcane-quiver` (matching its name) before
-- the unique constraint goes in.
UPDATE features
SET identifier = 'arcane-quiver'
WHERE id = '620855c5-37d2-4bb5-a9a0-4efaf0a95cdc'
  AND identifier = 'arcane-archer-spells';

CREATE UNIQUE INDEX IF NOT EXISTS features_parent_identifier_uniq
    ON features(
        COALESCE(parent_type, ''),
        COALESCE(parent_id, ''),
        identifier
    );
