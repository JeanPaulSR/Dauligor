-- Migration: items.vehicle — vehicle-equipment (mountable) properties.
-- Date: 2026-06-08
--
-- Equipment with system.type.value = "vehicle" (dnd5e MountableTemplate)
-- carries vehicle stats. Stored as one JSON column mirroring the Foundry
-- system subset so it round-trips by pass-through:
--   { armor: { value },
--     cover,                         -- 0..1 (Half 0.5 / Three-Quarters 0.75 / Total 1)
--     crew:  { max },
--     hp:    { value, max, dt, conditions },
--     speed: { value, units, conditions } }
-- (The magical bonus stays in armor_magical_bonus, shared with armor.)
--
-- One-shot ADD COLUMN (the column is new on local + remote).

ALTER TABLE items ADD COLUMN vehicle TEXT;
