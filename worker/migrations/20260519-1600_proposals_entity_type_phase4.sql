-- Phase 4 — extend `pending_revisions.entity_type` with the heavy entities
-- ============================================================
-- Adds `spell`, `class`, `unique_option_group`, `unique_option_item`
-- to the entity allowlist. Same SQLite "can't ALTER a CHECK in place"
-- rebuild as 20260519-1300 — pattern identical, indexes recreated.
--
-- After this migration, the per-entity configs in
-- `api/_lib/proposals.ts` need matching ENTITY_CONFIGS entries
-- (writable column allowlist + JSON-column markers) or any submit
-- against one of the new types will throw on payload sanitisation.

CREATE TABLE pending_revisions_new (
    id                          TEXT PRIMARY KEY,
    bundle_id                   TEXT,
    proposed_by_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposed_at                 TEXT DEFAULT CURRENT_TIMESTAMP,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
    entity_type                 TEXT NOT NULL
                                  CHECK (entity_type IN (
                                    'tag', 'tag_group',
                                    'spell_rule', 'spell_rule_application',
                                    'class_spell_list',
                                    'spell', 'class',
                                    'unique_option_group', 'unique_option_item'
                                  )),
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

CREATE INDEX idx_pending_revisions_status_proposed_at
    ON pending_revisions(status, proposed_at);
CREATE INDEX idx_pending_revisions_by_creator
    ON pending_revisions(proposed_by_user_id, status);
CREATE INDEX idx_pending_revisions_entity
    ON pending_revisions(entity_type, entity_id);
CREATE INDEX idx_pending_revisions_bundle
    ON pending_revisions(bundle_id);
