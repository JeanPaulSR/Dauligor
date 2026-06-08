-- Migration: ammunition item-properties valid_types
-- Date: 2026-06-07
--
-- Surface the ammunition properties (Adamantine / Returning / Silvered)
-- on a consumable's Details tab when its type = Ammunition. These rows
-- already exist in `item_properties` as weapon properties; we add the
-- `ammo` pseudo-type to their `valid_types` so the per-type property
-- filter (the same one the Enchant activity uses) includes them when the
-- consumable subtype is ammo. `mgc` (Magical) already carries
-- `consumable`, so it shows for every consumable incl. ammo — no change.
--
-- Idempotent: re-running sets the same JSON.

UPDATE item_properties SET valid_types = '["weapon","equipment","ammo"]' WHERE identifier = 'ada';
UPDATE item_properties SET valid_types = '["weapon","ammo"]' WHERE identifier = 'ret';
UPDATE item_properties SET valid_types = '["weapon","ammo"]' WHERE identifier = 'sil';
