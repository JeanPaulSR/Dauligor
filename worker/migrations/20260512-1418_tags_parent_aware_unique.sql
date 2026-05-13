-- Phase: Tag uniqueness becomes parent-aware
-- ============================================================
-- The original `tags` table from 0001 carried `UNIQUE (group_id, slug)`,
-- which was the right invariant when tags were flat. After the hierarchy
-- migration in 20260512-1200 added `parent_tag_id`, that constraint
-- became over-strict: two subtags with the same name under DIFFERENT
-- parents in the same group (e.g. "Fire" under "Damage Type" and
-- "Fire" under "Element") now share a slug and trip the UNIQUE.
--
-- Desired invariant: slugs are unique within their (group, parent)
-- bucket. Root tags (parent_tag_id IS NULL) still can't collide with
-- each other; subtags only need to be unique among siblings.
--
-- SQLite doesn't allow dropping a table-level UNIQUE constraint
-- in-place, so this is a full table rebuild. The new uniqueness lives
-- in a separate UNIQUE INDEX because table-level UNIQUE constraints
-- can't wrap a column in COALESCE — and we need COALESCE to keep NULL
-- parents collapsed into one bucket (otherwise SQLite treats every NULL
-- as distinct and duplicate roots would slip through).
--
-- ORDER MATTERS: we use the canonical SQLite 12-step rebuild order —
-- CREATE new → INSERT → DROP old → RENAME new TO old. Reversing the
-- order (RENAME old → CREATE new → INSERT → DROP) is silently broken
-- on modern SQLite (including D1): with PRAGMA legacy_alter_table=OFF
-- (the ≥ 3.26 default), ALTER TABLE RENAME auto-rewrites FK references
-- in OTHER tables to point at the new name. The single inbound FK to
-- `tags` is `lore_article_tags.tag_id REFERENCES tags(id) ON DELETE
-- CASCADE` from migration 0003. Renaming tags→tags_old first would
-- rewrite that FK to reference tags_old, and dropping tags_old would
-- leave it dangling at a non-existent table. The order below keeps the
-- inbound FK pointing at "tags" the whole time.
--
-- D1 SPECIFICS: Cloudflare D1 rejects user-supplied `BEGIN TRANSACTION`
-- / `COMMIT` and `PRAGMA` statements — transactions are managed by the
-- platform, and PRAGMA toggles aren't honored at the wrangler exec
-- layer. wrangler executes each statement individually; D1 wraps the
-- batch atomically on its side. Production has 0 rows in
-- lore_article_tags, so the brief window where the FK is dangling
-- (between DROP and RENAME) is risk-free — there are no rows whose
-- references would suddenly point at a non-existent table.

CREATE TABLE tags_new (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES tag_groups(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    -- Self-reference via the temp name. The RENAME below auto-rewrites
    -- this to `REFERENCES tags(id)` (still a self-reference) per
    -- SQLite's FK-rewrite-on-rename behavior.
    parent_tag_id TEXT REFERENCES tags_new(id),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tags_new (id, group_id, name, slug, parent_tag_id, updated_at)
SELECT id, group_id, name, slug, parent_tag_id, updated_at FROM tags;

DROP TABLE tags;

ALTER TABLE tags_new RENAME TO tags;

-- Recreate the indexes that lived on the old table.
CREATE INDEX IF NOT EXISTS idx_tags_group ON tags(group_id);
CREATE INDEX IF NOT EXISTS idx_tags_parent_tag ON tags(parent_tag_id);

-- The replacement uniqueness: same group + same parent bucket + same
-- slug is forbidden. COALESCE collapses NULL parents (root tags) into
-- the empty-string bucket so duplicate roots are still blocked.
CREATE UNIQUE INDEX IF NOT EXISTS tags_group_parent_slug_uniq
    ON tags(group_id, COALESCE(parent_tag_id, ''), slug);
