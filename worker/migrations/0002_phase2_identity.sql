-- Phase 2: Identity & Social
-- Schema for eras, users, campaigns, and campaign_members.
-- Requires Phase 1 (0001_phase1_foundation.sql) to already be applied.

-- ============================================================
-- 1. Eras
-- No FK dependencies — must exist before campaigns.
-- ============================================================
CREATE TABLE eras (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    description          TEXT,
    "order"              INTEGER,
    background_image_url TEXT,
    created_at           TEXT,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. Users
-- No D1 FK dependencies. active_campaign_id is plain TEXT to
-- avoid a circular dependency with campaigns.
-- ============================================================
CREATE TABLE users (
    id                 TEXT PRIMARY KEY,
    username           TEXT UNIQUE NOT NULL,
    display_name       TEXT,
    role               TEXT NOT NULL DEFAULT 'user'
                           CHECK (role IN ('admin', 'co-dm', 'lore-writer', 'trusted-player', 'user')),
    avatar_url         TEXT,
    bio                TEXT,
    pronouns           TEXT,
    theme              TEXT DEFAULT 'parchment'
                           CHECK (theme IN ('parchment', 'light', 'dark')),
    accent_color       TEXT,
    hide_username      INTEGER DEFAULT 0,
    is_private         INTEGER DEFAULT 0,
    recovery_email     TEXT,
    active_campaign_id TEXT,
    created_at         TEXT,
    updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_username ON users(username);

-- ============================================================
-- 3. Campaigns
-- FK to eras and users.
-- ============================================================
CREATE TABLE campaigns (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    slug                TEXT UNIQUE NOT NULL,
    description         TEXT,
    dm_id               TEXT REFERENCES users(id),
    era_id              TEXT REFERENCES eras(id),
    image_url           TEXT,
    recommended_lore_id TEXT,
    settings            JSON,
    created_at          TEXT,
    updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaigns_dm_id  ON campaigns(dm_id);
CREATE INDEX idx_campaigns_era_id ON campaigns(era_id);

-- ============================================================
-- 4. Campaign Members
-- Synthesized from Firestore arrays — no source collection.
-- ============================================================
CREATE TABLE campaign_members (
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('dm', 'co-dm', 'player')),
    joined_at   TEXT,
    PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX idx_campaign_members_user_id ON campaign_members(user_id);
