-- Migration: 0020 — Add `requires_option_ids` to unique_option_items
--
-- Some option-group items (Sorcerer Origin sub-features, Battle Master
-- Maneuvers that build on a previous Maneuver pick, Cleric Domain
-- chained features, etc.) are only valid once another option in the
-- same import was already chosen. Today the prompt UI shows every
-- option indiscriminately, which lets players pick the dependent
-- option without its prerequisite — the resulting feature then
-- references something the actor never granted.
--
-- This column carries an array of `unique_option_items.source_id`
-- values that must all appear in `state.optionSelections` before the
-- module enables this option in the picker. The module enforces it at
-- prompt time (greyed-out + tooltip listing the missing prereqs).
--
-- JSON-encoded array of source-ids; '[]' means "no prerequisites"
-- (the legacy / default state for every existing row).

ALTER TABLE unique_option_items
  ADD COLUMN requires_option_ids TEXT NOT NULL DEFAULT '[]';
