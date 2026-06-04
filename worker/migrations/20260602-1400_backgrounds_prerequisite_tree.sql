-- Add a structured `prerequisiteTree` column to `backgrounds`.
--
-- Backgrounds reuse the feats RequirementsEditor for prerequisites: a free-text
-- line (the existing `prerequisite` column) PLUS an optional structured
-- condition tree (this column), exactly like feats' `requirements` +
-- `requirementsTree`. Rendered via the shared `resolveDetailPrereq`.
--
-- JSON (a Requirement tree; see src/lib/requirements.ts) or NULL. Must be added
-- to queryD1's jsonFields list so reads come back parsed.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically.

ALTER TABLE backgrounds ADD COLUMN prerequisiteTree TEXT;
