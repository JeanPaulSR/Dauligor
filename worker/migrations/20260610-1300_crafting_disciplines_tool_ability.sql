-- Give crafting disciplines their core mechanics: the TOOL a discipline uses
-- (e.g. alchemist's supplies, smith's tools) and the ABILITY its crafting roll
-- keys off (Int / Wis / Str / ...). These turn a discipline from a bare label
-- into the thing recipes and characters actually key off.
--
-- Column names are snake_case (`tool_id` / `ability_id`) — NOT the table's
-- camelCase convention — because the shared ProficiencyEntityShell drives both
-- fields: it hardcodes `ability_id` for its ability picker, and its configurable
-- `categoryFK` is pointed at the `tools` table writing `tool_id`. Matching the
-- shell avoids forking it for one taxonomy. (Facility is intentionally NOT
-- captured — it is a per-case DM call handled in the Foundry module.)
--
-- D1 wraps each migration atomically — no BEGIN/COMMIT/PRAGMA.

ALTER TABLE crafting_disciplines ADD COLUMN tool_id    TEXT REFERENCES tools(id);
ALTER TABLE crafting_disciplines ADD COLUMN ability_id TEXT REFERENCES attributes(id);
