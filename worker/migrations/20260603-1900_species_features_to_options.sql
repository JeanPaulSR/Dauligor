-- Consolidate species_features → species_options. The dedicated species_features
-- table (migration 20260601-1500) is retired in favor of species_options
-- (20260603-1600) — the reusable racial-trait library, which has an identical
-- column set. Its grant-to-species path was never finished, so this is a clean
-- consolidation onto one mechanism. This copies any authored species_features
-- rows into species_options so nothing is lost, then leaves species_features as
-- an (orphaned) tombstone — NO DROP here (keep destructive schema changes out; a
-- later cleanup migration can drop it once confirmed empty everywhere).
--
-- Idempotent: skips rows already present by id, and any whose (sourceId,
-- identifier) natural key would collide with an existing option (the
-- species_options_source_identifier_uniq index). Safe to re-run / no-op when
-- species_features is empty.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically.

INSERT INTO species_options (
    id, name, identifier, sourceId, page, description,
    advancements, activities, effects, uses, tags,
    imageUrl, contentHash, createdAt, updatedAt
)
SELECT
    sf.id, sf.name, sf.identifier, sf.sourceId, sf.page, sf.description,
    sf.advancements, sf.activities, sf.effects, sf.uses, sf.tags,
    sf.imageUrl, sf.contentHash, sf.createdAt, sf.updatedAt
FROM species_features sf
WHERE sf.id NOT IN (SELECT id FROM species_options)
  AND NOT EXISTS (
    SELECT 1 FROM species_options so
    WHERE COALESCE(so.sourceId, '') = COALESCE(sf.sourceId, '')
      AND so.identifier = sf.identifier
  );
