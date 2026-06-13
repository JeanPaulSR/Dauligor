-- Migration: classes.starting_equipment_data column
-- Date: 2026-06-13
--
-- Adds structured storage for a class's starting equipment — the dnd5e
-- `system.startingEquipment` EquipmentEntryData tree (AND/OR choice groups
-- whose leaves are a specific item, a category like "any martial weapon", a
-- spellcasting focus, or currency).
--
-- This is DISTINCT from the existing `starting_equipment` column, which keeps
-- the freeform prose description (still shown read-only in the Foundry
-- importer and on the public class page). The new column powers the
-- StartingEquipmentEditor and exports as `startingEquipmentData` in the baked
-- class bundle so the equipment round-trips to Foundry's native equipment
-- prompt once the module wires the import step.
--
-- TEXT, nullable. Holds the JSON-serialized authoring tree (EquipmentNode[]).
-- Empty/NULL = no structured starting equipment.

ALTER TABLE classes ADD COLUMN starting_equipment_data TEXT;
