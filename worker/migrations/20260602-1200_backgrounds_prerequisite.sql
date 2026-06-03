-- Add a `prerequisite` column to `backgrounds`.
--
-- Most backgrounds have no prerequisite, but some do (e.g. Ravnica guild
-- backgrounds note "Membership in the … guild", and homebrew may gate a
-- background). Feats already capture a prerequisite via requirements; this
-- gives backgrounds an equivalent author-entered, free-text field that the
-- editor writes and the detail/view surfaces render (italic, under the name —
-- the same treatment feats get).
--
-- Plain TEXT (NOT JSON): a short human-readable phrase, not the structured
-- requirement tree feats use. NULL/empty means "no prerequisite" and the
-- detail panel simply omits the line. No backfill — the 5etools-sourced prose
-- "Prerequisite:" notes in the current corpus are FEATURE-scoped (e.g. a guild
-- background's "Guild Spells" sub-feature), not background-level gates, so
-- lifting them automatically would be wrong; this stays author-entered.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically.

ALTER TABLE backgrounds ADD COLUMN prerequisite TEXT;
