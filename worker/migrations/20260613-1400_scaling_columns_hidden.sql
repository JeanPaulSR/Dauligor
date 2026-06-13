-- Migration: scaling_columns.hidden column
-- Date: 2026-06-13
--
-- Lets an author hide a custom scaling column from the class progression
-- TABLE without deleting it — the column's per-level values still exist in
-- data (and still export to Foundry for @scale references), it just isn't
-- drawn in the rendered class table.
--
-- INTEGER 0/1, default 0 (visible). Toggled per-column in ScalingColumnsPanel;
-- the ClassView + ClassPreviewPane tables filter out hidden columns at render.

ALTER TABLE scaling_columns ADD COLUMN hidden INTEGER DEFAULT 0;
