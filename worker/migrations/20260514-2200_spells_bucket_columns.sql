-- Materialise the four filter-bucket facets that today live inside
-- the `foundry_data` JSON blob. The summary projection in
-- src/lib/spellSummary.ts only includes foundry_data because the
-- buckets are computed from it on the client; with these columns
-- present, the summary can drop foundry_data entirely and the
-- per-spell payload shrinks from ~3-5 KB down to ~200-400 bytes.
-- Critical for sessionStorage caching at the planned 5000-spell
-- scale (the current 540-spell payload already overflowed the
-- ~5 MB per-origin browser quota).
--
-- The four buckets and the JSON paths they materialise:
--   activation_bucket  ← system.activation.type
--   range_bucket       ← system.range.units + system.range.value (banded)
--   duration_bucket    ← system.duration.units
--   shape_bucket       ← system.target.template.type
--
-- Bucket values match exactly what `bucketActivation`, `bucketRange`,
-- `bucketDuration`, and `bucketShape` in src/lib/spellFilters.ts
-- return — anything off-canonical falls through to a default
-- ('special' / 'other' / 'none') so the column always has a value.
--
-- The write path (upsertSpell / upsertSpellBatch in
-- src/lib/compendium.ts) re-computes these on every save so the
-- columns stay in sync with foundry_data.

ALTER TABLE spells ADD COLUMN activation_bucket TEXT;
ALTER TABLE spells ADD COLUMN range_bucket      TEXT;
ALTER TABLE spells ADD COLUMN duration_bucket   TEXT;
ALTER TABLE spells ADD COLUMN shape_bucket      TEXT;

-- Backfill all existing rows. CASE expressions mirror the client-
-- side bucketers verbatim. WHERE foundry_data IS NOT NULL keeps
-- placeholder rows (no Foundry payload yet) at the column default
-- of NULL, which `deriveSpellFilterFacets` reads as "fall back to
-- parsing foundry_data" — graceful for legacy rows.

UPDATE spells
SET activation_bucket = CASE
  WHEN json_extract(foundry_data, '$.system.activation.type') = 'action'   THEN 'action'
  WHEN json_extract(foundry_data, '$.system.activation.type') = 'bonus'    THEN 'bonus'
  WHEN json_extract(foundry_data, '$.system.activation.type') = 'reaction' THEN 'reaction'
  WHEN json_extract(foundry_data, '$.system.activation.type') = 'minute'   THEN 'minute'
  WHEN json_extract(foundry_data, '$.system.activation.type') = 'hour'     THEN 'hour'
  ELSE 'special'
END
WHERE foundry_data IS NOT NULL;

UPDATE spells
SET range_bucket = CASE
  WHEN json_extract(foundry_data, '$.system.range.units') = 'self'  THEN 'self'
  WHEN json_extract(foundry_data, '$.system.range.units') = 'touch' THEN 'touch'
  WHEN json_extract(foundry_data, '$.system.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.system.range.value') AS REAL) <=   5 THEN '5ft'
  WHEN json_extract(foundry_data, '$.system.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.system.range.value') AS REAL) <=  30 THEN '30ft'
  WHEN json_extract(foundry_data, '$.system.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.system.range.value') AS REAL) <=  60 THEN '60ft'
  WHEN json_extract(foundry_data, '$.system.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.system.range.value') AS REAL) <= 120 THEN '120ft'
  WHEN json_extract(foundry_data, '$.system.range.units') = 'ft' THEN 'long'
  WHEN json_extract(foundry_data, '$.system.range.units') IN ('mi','any','unlimited') THEN 'long'
  ELSE 'other'
END
WHERE foundry_data IS NOT NULL;

UPDATE spells
SET duration_bucket = CASE
  WHEN json_extract(foundry_data, '$.system.duration.units') = 'inst'   THEN 'inst'
  WHEN json_extract(foundry_data, '$.system.duration.units') = 'round'  THEN 'round'
  WHEN json_extract(foundry_data, '$.system.duration.units') = 'minute' THEN 'minute'
  WHEN json_extract(foundry_data, '$.system.duration.units') = 'hour'   THEN 'hour'
  WHEN json_extract(foundry_data, '$.system.duration.units') = 'day'    THEN 'day'
  WHEN json_extract(foundry_data, '$.system.duration.units') = 'perm'   THEN 'perm'
  ELSE 'special'
END
WHERE foundry_data IS NOT NULL;

UPDATE spells
SET shape_bucket = CASE
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'cone'     THEN 'cone'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'cube'     THEN 'cube'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'cylinder' THEN 'cylinder'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'line'     THEN 'line'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'radius'   THEN 'radius'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'sphere'   THEN 'sphere'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'square'   THEN 'square'
  WHEN json_extract(foundry_data, '$.system.target.template.type') = 'wall'     THEN 'wall'
  ELSE 'none'
END
WHERE foundry_data IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spells_activation_bucket ON spells(activation_bucket);
CREATE INDEX IF NOT EXISTS idx_spells_range_bucket      ON spells(range_bucket);
CREATE INDEX IF NOT EXISTS idx_spells_duration_bucket   ON spells(duration_bucket);
CREATE INDEX IF NOT EXISTS idx_spells_shape_bucket      ON spells(shape_bucket);
