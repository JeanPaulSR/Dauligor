-- Phase: composite identifier uniqueness for spells, classes, subclasses
--
-- Mirrors the source-scoped uniqueness pattern that landed for feats
-- and items in `20260526-2300_feats_items_composite_identifier_uniq.sql`:
-- identifiers must be unique WITHIN a source, but the same identifier
-- can recur across different sources (e.g. homebrew "fireball" vs PHB
-- "fireball"). COALESCE(source_id, '') collapses orphan rows
-- (source_id IS NULL) into a single bucket so two orphans with the
-- same identifier are still forbidden.
--
-- Three tables get the composite UNIQUE constraint:
--   - spells       : currently single-col UNIQUE on identifier
--   - classes      : currently single-col UNIQUE on identifier
--   - subclasses   : currently NO uniqueness on identifier (added
--                    by `0013_classes_subclasses_extended_fields.sql`
--                    as a non-unique column with an index)
--
-- Verified before authoring this migration: zero existing duplicates
-- across all three tables under the new (source_id, identifier)
-- scope — the constraint applies cleanly to existing data.
--
-- Live-content bridge dependency: deterministic Foundry `_id`
-- derivation (Phase 3 drag-construct) hashes the Dauligor sourceId.
-- For that hash to be stable across re-imports, the (source_id,
-- identifier) pair has to be the canonical identity — which this
-- migration enforces.

CREATE UNIQUE INDEX IF NOT EXISTS spells_source_identifier_uniq
    ON spells(COALESCE(source_id, ''), identifier);

CREATE UNIQUE INDEX IF NOT EXISTS classes_source_identifier_uniq
    ON classes(COALESCE(source_id, ''), identifier);

CREATE UNIQUE INDEX IF NOT EXISTS subclasses_source_identifier_uniq
    ON subclasses(COALESCE(source_id, ''), identifier);
