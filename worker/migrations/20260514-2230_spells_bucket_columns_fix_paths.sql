-- Corrective backfill for 20260514-2200_spells_bucket_columns.sql.
--
-- The original migration used JSON paths `$.system.activation.type`
-- etc. — but `spells.foundry_data` stores the Foundry `system` object
-- directly (no outer `system` wrapper), so every path returned NULL
-- and every spell fell to the default bucket ('special' / 'other' /
-- 'none'). Verified by probing: `json_extract(foundry_data,
-- '$.activation.type')` returns 'action' for Acid Splash, while the
-- `$.system.activation.type` path returns NULL.
--
-- This migration re-runs the four UPDATEs with the correct paths.
-- Idempotent — re-running it on already-correct rows just re-asserts
-- the same value.

UPDATE spells
SET activation_bucket = CASE
  WHEN json_extract(foundry_data, '$.activation.type') = 'action'   THEN 'action'
  WHEN json_extract(foundry_data, '$.activation.type') = 'bonus'    THEN 'bonus'
  WHEN json_extract(foundry_data, '$.activation.type') = 'reaction' THEN 'reaction'
  WHEN json_extract(foundry_data, '$.activation.type') = 'minute'   THEN 'minute'
  WHEN json_extract(foundry_data, '$.activation.type') = 'hour'     THEN 'hour'
  ELSE 'special'
END
WHERE foundry_data IS NOT NULL;

UPDATE spells
SET range_bucket = CASE
  WHEN json_extract(foundry_data, '$.range.units') = 'self'  THEN 'self'
  WHEN json_extract(foundry_data, '$.range.units') = 'touch' THEN 'touch'
  WHEN json_extract(foundry_data, '$.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.range.value') AS REAL) <=   5 THEN '5ft'
  WHEN json_extract(foundry_data, '$.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.range.value') AS REAL) <=  30 THEN '30ft'
  WHEN json_extract(foundry_data, '$.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.range.value') AS REAL) <=  60 THEN '60ft'
  WHEN json_extract(foundry_data, '$.range.units') = 'ft' AND CAST(json_extract(foundry_data, '$.range.value') AS REAL) <= 120 THEN '120ft'
  WHEN json_extract(foundry_data, '$.range.units') = 'ft' THEN 'long'
  WHEN json_extract(foundry_data, '$.range.units') IN ('mi','any','unlimited') THEN 'long'
  ELSE 'other'
END
WHERE foundry_data IS NOT NULL;

UPDATE spells
SET duration_bucket = CASE
  WHEN json_extract(foundry_data, '$.duration.units') = 'inst'   THEN 'inst'
  WHEN json_extract(foundry_data, '$.duration.units') = 'round'  THEN 'round'
  WHEN json_extract(foundry_data, '$.duration.units') = 'minute' THEN 'minute'
  WHEN json_extract(foundry_data, '$.duration.units') = 'hour'   THEN 'hour'
  WHEN json_extract(foundry_data, '$.duration.units') = 'day'    THEN 'day'
  WHEN json_extract(foundry_data, '$.duration.units') = 'perm'   THEN 'perm'
  ELSE 'special'
END
WHERE foundry_data IS NOT NULL;

UPDATE spells
SET shape_bucket = CASE
  WHEN json_extract(foundry_data, '$.target.template.type') = 'cone'     THEN 'cone'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'cube'     THEN 'cube'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'cylinder' THEN 'cylinder'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'line'     THEN 'line'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'radius'   THEN 'radius'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'sphere'   THEN 'sphere'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'square'   THEN 'square'
  WHEN json_extract(foundry_data, '$.target.template.type') = 'wall'     THEN 'wall'
  ELSE 'none'
END
WHERE foundry_data IS NOT NULL;
