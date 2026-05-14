-- Phase 2 of the 5000-spell scaling pass: materialise the display-
-- scalar fields out of `foundry_data` so the slim summary can drop
-- the heavy JSON blob entirely.
--
-- Without these columns, dropping foundry_data would regress the
-- public SpellList browser's Range and Casting Time columns from
-- "60 ft" / "1 action" back to "Special" / "Special" — because
-- those labels are rendered by formatRangeLabel /
-- formatActivationLabel reading the raw `activation` / `range` /
-- `duration` objects.
--
-- Adding eight tiny scalar columns lets the summary carry just what
-- the display path needs. Per-spell payload drops from ~3-5 KB
-- (with foundry_data) down to ~300-500 bytes (scalar fields only).
-- 5000 spells stay well within sessionStorage's ~5 MB quota.

ALTER TABLE spells ADD COLUMN activation_type      TEXT;
ALTER TABLE spells ADD COLUMN activation_value     TEXT;
ALTER TABLE spells ADD COLUMN activation_condition TEXT;
ALTER TABLE spells ADD COLUMN range_units          TEXT;
ALTER TABLE spells ADD COLUMN range_value          REAL;
ALTER TABLE spells ADD COLUMN range_special        TEXT;
ALTER TABLE spells ADD COLUMN duration_units       TEXT;
ALTER TABLE spells ADD COLUMN duration_value       TEXT;

-- Backfill using SQLite's json_extract. As established by the bucket
-- migrations (20260514-2200 / 20260514-2230), `foundry_data` stores
-- the Foundry `system` object directly — no `.system.` wrapper —
-- so paths are `$.activation.type` etc.
UPDATE spells
SET activation_type      = json_extract(foundry_data, '$.activation.type'),
    activation_value     = json_extract(foundry_data, '$.activation.value'),
    activation_condition = json_extract(foundry_data, '$.activation.condition'),
    range_units          = json_extract(foundry_data, '$.range.units'),
    range_value          = json_extract(foundry_data, '$.range.value'),
    range_special        = json_extract(foundry_data, '$.range.special'),
    duration_units       = json_extract(foundry_data, '$.duration.units'),
    duration_value       = json_extract(foundry_data, '$.duration.value')
WHERE foundry_data IS NOT NULL;
