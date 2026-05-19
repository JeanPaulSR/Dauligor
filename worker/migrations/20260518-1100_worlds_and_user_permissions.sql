-- Phase: Worlds entity + additive user_permissions
-- ============================================================
-- Foundation of the Content Proposals workflow (Phase 1).
--
-- 1) `worlds` — container for compendium content. The default
--    ("base Dauligor") world is seeded so existing global content
--    has an implicit owner once per-entity world_id columns arrive
--    in a later phase. Users can author their own worlds later;
--    Phase 1 just stands the table up.
--
-- 2) `user_permissions` — additive capability layer on top of
--    `users.role`. Lets an admin grant `content-creator` (and
--    future capabilities) on top of any base role without changing
--    the role itself. `scope_json` narrows the capability to
--    specific worlds / campaigns / eras; NULL means unrestricted.
--
-- Nothing existing changes. Approving / rejecting proposals,
-- proxy hardening, and the proposal table itself ship in Phase 2.

-- ============================================================
-- worlds
-- ============================================================
CREATE TABLE worlds (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    description     TEXT,
    owner_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_worlds_owner ON worlds(owner_user_id);
CREATE INDEX idx_worlds_sort ON worlds(sort_order);

-- Partial unique index: at most one row may have is_default = 1.
-- Rows with is_default = 0 fail the WHERE clause and never enter
-- the index, so multiple non-default worlds coexist freely.
CREATE UNIQUE INDEX worlds_default_singleton
    ON worlds(is_default) WHERE is_default = 1;

-- Seed the canonical Dauligor world. All existing compendium
-- content is implicitly tied to it; explicit per-entity world_id
-- columns arrive in a later phase.
INSERT INTO worlds (id, name, slug, description, is_default, sort_order)
VALUES (
    'dauligor-base',
    'Dauligor',
    'dauligor',
    'The canonical Dauligor compendium and shared world. Default for all global content.',
    1,
    0
);

-- ============================================================
-- user_permissions
-- ============================================================
-- The CHECK allowlist grows as new capabilities are introduced.
-- For now `content-creator` is the only valid key. Adding a key
-- later requires a follow-up migration that rebuilds the table —
-- SQLite can't ALTER a CHECK in place.
CREATE TABLE user_permissions (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_key      TEXT NOT NULL CHECK (permission_key IN ('content-creator')),
    -- JSON: { worlds: [...], campaigns: [...], eras: [...] }.
    -- NULL = unrestricted on every axis. An axis present but empty
    -- ([]) is treated as "no rows allowed on that axis" — the admin
    -- UI should usually delete the row instead of saving an empty
    -- scope, but the data model permits both shapes.
    scope_json          TEXT,
    granted_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    granted_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (user_id, permission_key)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX idx_user_permissions_key ON user_permissions(permission_key);
