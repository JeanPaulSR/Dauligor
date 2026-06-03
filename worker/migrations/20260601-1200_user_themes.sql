-- Appearance revamp, Phase 1: per-user custom colour themes.
--
-- See docs/_drafts/appearance-revamp-theme-builder-2026-06-01.html. A "custom
-- theme" is a small set of colour overrides (background, card, text, accent)
-- layered on top of one of the built-in presets (parchment | light | dark).
-- Stored in its own table — not a blob on users — so a user can keep multiple
-- named themes, and so an interesting theme can later be promoted/shared
-- (a future curation layer builds on this table).
--
-- This migration is ADDITIVE and behaviour-neutral on its own:
--   * users.active_theme_id defaults to NULL → "use my built-in preset", which
--     is exactly today's behaviour (users.theme + users.accent_color). No
--     existing user is affected until they create and activate a custom theme.
--   * tokens is sparse JSON: only the overridden CSS-variable values, keyed by
--     logical name, e.g. {"background":"#f5f5f0","card":"#fff","text":"#1a1a1a",
--     "textMuted":"#5a5a5a","accent":"#c5a059"}. Derived tokens (--secondary,
--     --muted, --popover, --primary, --ring …) are computed at apply time from
--     these primaries, so the stored payload stays minimal and portable.

CREATE TABLE IF NOT EXISTS user_themes (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    base_preset  TEXT NOT NULL DEFAULT 'parchment'
                   CHECK (base_preset IN ('parchment', 'light', 'dark')),
    tokens       TEXT NOT NULL DEFAULT '{}',   -- JSON: overridden values only
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_themes_user ON user_themes(user_id);

-- Active-theme pointer. NULL = fall back to the built-in preset (back-compat).
-- ON DELETE SET NULL: deleting the active theme cleanly reverts the user to
-- their preset rather than orphaning the reference.
ALTER TABLE users ADD COLUMN active_theme_id TEXT
    REFERENCES user_themes(id) ON DELETE SET NULL;
