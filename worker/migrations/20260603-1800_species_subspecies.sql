-- Subspecies — a parent/child relationship within the species table, so a
-- subspecies (High Elf, Wood Elf, Drow…) is a CHILD of a parent species (Elf).
-- See docs/_drafts/subspecies-design-2026-06-03.html.
--
-- Model (confirmed 2026-06-03): a subspecies IS a complete species that names a
-- parent — it reuses the entire species pipeline (editor, _raceExport, browser,
-- and the live /api/module/races/<id>.json route) unchanged, and exports as its
-- own stand-alone Foundry `race` item (dnd5e v5 has no subrace item type). The
-- only schema change is one self-referential column below.
--
--   parentSpeciesId NULL      → base species
--   parentSpeciesId non-NULL  → subspecies of that parent species
--
-- DELETE semantics: ON DELETE SET NULL — deleting a parent PROMOTES its
-- subspecies to base species (non-destructive, recoverable by re-parenting),
-- rather than cascading the children away. The UI enforces a single level
-- (a subspecies cannot itself have subspecies).
--
-- `parentSpeciesId` is a plain id (NOT a JSON column), so it round-trips through
-- the editor's `...row` spread automatically — no d1.ts jsonFields change and no
-- d1Tables.ts alias change is needed (it lives on the existing `species` table).
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically.
-- SQLite ALTER TABLE ADD COLUMN allows a REFERENCES clause as long as the new
-- column defaults to NULL (it does — no DEFAULT specified).

ALTER TABLE species ADD COLUMN parentSpeciesId TEXT
    REFERENCES species(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_species_parent ON species(parentSpeciesId);
