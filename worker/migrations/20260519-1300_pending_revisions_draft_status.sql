-- Phase 2e — add `draft` to pending_revisions.status
-- ============================================================
-- Block-style submissions need a way for a row to exist
-- server-side WITHOUT being visible to admins yet. The user opens
-- a "block", makes N edits, and each one lands as a pending_
-- revisions row tagged `status = 'draft'` + sharing a bundle_id.
-- When they're done, the bundle gets atomically flipped to
-- `pending` (visible to admins). Discarding deletes the rows.
--
-- SQLite can't ALTER a CHECK constraint in place, so this is the
-- canonical 12-step rebuild — same shape as 20260512-1418 for
-- the parallel reason. Order matters: CREATE new → INSERT → DROP
-- old → RENAME. The inbound FKs to `pending_revisions` are the
-- self-FK on `cascade_parent_revision_id` (rewrites by SQLite's
-- on-rename FK retargeting) and the self-FK on rows pointing at
-- their bundle parents (NULL in production today; no rewrite
-- needed). Indexes recreated to match the original migration.

CREATE TABLE pending_revisions_new (
    id                          TEXT PRIMARY KEY,
    bundle_id                   TEXT,
    proposed_by_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposed_at                 TEXT DEFAULT CURRENT_TIMESTAMP,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
    entity_type                 TEXT NOT NULL
                                  CHECK (entity_type IN ('tag', 'tag_group', 'spell_rule', 'spell_rule_application', 'class_spell_list')),
    entity_id                   TEXT,
    operation                   TEXT NOT NULL
                                  CHECK (operation IN ('create', 'update', 'delete')),
    proposed_payload            TEXT,
    snapshot_at_proposal        TEXT,
    reviewed_by_user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at                 TEXT,
    rejection_reason            TEXT,
    notes_from_proposer         TEXT,
    cascade_parent_revision_id  TEXT REFERENCES pending_revisions_new(id) ON DELETE SET NULL
);

INSERT INTO pending_revisions_new
SELECT id, bundle_id, proposed_by_user_id, proposed_at, status, entity_type,
       entity_id, operation, proposed_payload, snapshot_at_proposal,
       reviewed_by_user_id, reviewed_at, rejection_reason,
       notes_from_proposer, cascade_parent_revision_id
FROM pending_revisions;

DROP TABLE pending_revisions;

ALTER TABLE pending_revisions_new RENAME TO pending_revisions;

-- Recreate the indexes from 20260518-2200.
CREATE INDEX idx_pending_revisions_status_proposed_at
    ON pending_revisions(status, proposed_at);
CREATE INDEX idx_pending_revisions_by_creator
    ON pending_revisions(proposed_by_user_id, status);
CREATE INDEX idx_pending_revisions_entity
    ON pending_revisions(entity_type, entity_id);
CREATE INDEX idx_pending_revisions_bundle
    ON pending_revisions(bundle_id);
