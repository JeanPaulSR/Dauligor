-- =============================================================================
-- Spell list resolution v2 — query-time + opportunistic cache
-- =============================================================================
--
-- Companion to the upcoming classSpellListQuery.ts library. This migration
-- is intentionally additive: existing read paths keep working until the new
-- resolver ships behind a feature flag. No data is moved.
--
-- What changes:
--
--   1. spell_rules.manual_exclusions — new TEXT column holding a JSON array
--      of spell ids that match the rule's query but should be excluded
--      from its contribution. Companion to the existing `manual_spells`
--      array which inverts the logic ("include despite query miss").
--
--      Resolution per rule becomes:
--          contribution = queryMatches(rule) ∪ rule.manual_spells
--                       − rule.manual_exclusions
--
--      Exclusion is rule-scoped, not class-scoped. A class is bound 1:1
--      to a rule in the new mental model (cross-class sharing goes
--      through the "Grant Spell Rule" advancement), so "exclude from
--      rule" is equivalent to "exclude from class" for the common case
--      and avoids the per-class manual table the v1 plan had.
--
--   2. consumer_spell_list_cache — new table. Optimisation layer for the
--      runtime-query resolver. One row per (consumer_type, consumer_id);
--      polymorphic key because the resolver applies uniformly to every
--      consumer type that spell_rule_applications supports (class,
--      subclass, feat, feature, background, item, unique_option_item).
--
--      `inputs_fingerprint` is a hash of every input that could change
--      the resolved list — applied rule set, rule.updated_at, spell
--      catalogue mtime, referenced tag mtimes. On read, recompute the
--      fingerprint cheaply; if it matches the row, serve cached.
--      Otherwise recompute the full list and update.
--
--      No FK constraint on (consumer_type, consumer_id) — SQLite doesn't
--      do polymorphic FKs. Integrity is maintained app-side.
--
-- What this migration does NOT do:
--   • Move data out of class_spell_lists. That stays in place during the
--     feature-flagged rollout. A follow-up migration handles the existing
--     source='manual' rows once we've verified the new resolver matches
--     the old output across every class.
--   • Drop class_spell_lists. Same reasoning — kill switch needs the old
--     path live.
--   • Touch advancement-side data. The new resolver reads from
--     spell_rule_applications + rules + the new tables; advancement
--     integration ("additional spells" advancements, "Grant Spell Rule")
--     is a separate phase.
--
-- D1 notes: ALTER TABLE ADD COLUMN for a nullable TEXT works fine; no
-- table rebuild. wrangler runs each statement in its own D1-managed
-- transaction. No PRAGMA, no BEGIN/COMMIT — D1 rejects both.
-- =============================================================================

ALTER TABLE spell_rules ADD COLUMN manual_exclusions TEXT;

CREATE TABLE consumer_spell_list_cache (
  consumer_type       TEXT NOT NULL,
  consumer_id         TEXT NOT NULL,
  computed_at         TEXT NOT NULL,
  inputs_fingerprint  TEXT NOT NULL,
  spell_ids_json      TEXT NOT NULL,
  PRIMARY KEY (consumer_type, consumer_id)
);
