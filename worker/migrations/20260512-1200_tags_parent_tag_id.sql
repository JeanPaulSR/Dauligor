-- Phase: Tag hierarchy — 2-level nesting (root tag → subtag)
-- ============================================================
-- Adds an optional self-reference on `tags` so a tag can be nested
-- under another tag within the same group. NULL = root tag, non-NULL =
-- subtag whose direct parent is the referenced tag.
--
-- The UI enforces a single nesting level (no sub-sub-tags) — the
-- schema doesn't enforce it because that would require a CHECK
-- subquery, and SQLite's CHECK constraints can't run subqueries.
-- Application code keeps subtag-of-subtag out via the add-form UX.
--
-- Existing `UNIQUE (group_id, slug)` covers both levels — every slug
-- in a group is unique regardless of where it sits in the hierarchy.
-- No new constraint needed.
--
-- ON DELETE behavior: leaving it unspecified (SQLite default is NO
-- ACTION). The app-side delete handler prompts the user, cascades to
-- children explicitly, and removes everything in one batch — that
-- gives the user a count and a chance to back out, which an FK
-- cascade can't.

ALTER TABLE tags ADD COLUMN parent_tag_id TEXT REFERENCES tags(id);

-- Index for fast "give me all children of this tag" lookups, used by
-- the editor when building the per-group tree.
CREATE INDEX IF NOT EXISTS idx_tags_parent_tag ON tags(parent_tag_id);
