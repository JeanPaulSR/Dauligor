-- Migration: spell-scroll item-properties valid_types
-- Date: 2026-06-07
--
-- A spell scroll (consumable, subtype = scroll) carries the embedded
-- spell's components, so the consumable Details "Consumable Properties"
-- shows Concentration / Ritual / Somatic / Verbal (+ Magical via the
-- generic consumable set). Those rows already exist in item_properties
-- as spell properties; we add the `scroll` pseudo-type to their
-- valid_types so the per-type property filter includes them when the
-- consumable subtype is scroll.
--
-- Idempotent: re-running sets the same JSON.

UPDATE item_properties SET valid_types = '["spell","scroll"]' WHERE identifier = 'concentration';
UPDATE item_properties SET valid_types = '["spell","scroll"]' WHERE identifier = 'ritual';
UPDATE item_properties SET valid_types = '["spell","scroll"]' WHERE identifier = 'somatic';
UPDATE item_properties SET valid_types = '["spell","scroll"]' WHERE identifier = 'vocal';
