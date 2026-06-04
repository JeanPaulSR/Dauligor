-- Per-user "favorite characters" showcase for the public profile.
--
-- A small ordered list of the user's OWN player characters that they choose to
-- feature on their /profile/<username> page. Its own join table (not a JSON
-- blob on users) so:
--   * deleting a character cleanly removes it from every showcase via the FK
--     cascade — no stale ids to filter at read time;
--   * the (user_id, character_id) PK prevents duplicates;
--   * `position` preserves the user's chosen display order.
--
-- Ownership (you may only feature characters you own) is enforced in the API on
-- write, not by the schema. Additive + behaviour-neutral: no existing row is
-- touched and the showcase is empty for everyone until they pick favorites.

CREATE TABLE IF NOT EXISTS user_favorite_characters (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorite_characters_user
    ON user_favorite_characters(user_id);
