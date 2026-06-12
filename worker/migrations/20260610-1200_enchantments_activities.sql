-- Add an `activities` column to `enchantments`: the full Activity document(s) the
-- enchantment grants to the item it's applied to — e.g. a magic weapon whose
-- enchantment confers a "swipe" attack activity, not just a passive bonus.
--
-- Mirrors `items.activities`. Pairs with the existing `effects` (Active Effect
-- documents) + `riders` (id references). An enchantment can now carry BOTH
-- activities and effects, exactly like an item — so baking it onto a base item
-- (Phase B) copies both onto the enchanted item.
--
-- `activities` is ALREADY in d1.ts's global `jsonFields` auto-parse list (items
-- use it) + the server `JSON_COLUMNS` mirror, so this needs NO data-layer change.
--
-- D1 wraps each migration atomically — no BEGIN/COMMIT/PRAGMA.

ALTER TABLE enchantments ADD COLUMN activities TEXT DEFAULT '[]';
