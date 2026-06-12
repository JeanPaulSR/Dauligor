-- Seed: a small EXAMPLE / test set for the crafting system so the editors have
-- data to exercise — 3 crafting materials (each with its backing loot item), one
-- recipe wiring them together (Potion of Healing, alchemy), and one enchantment.
-- Data only, no prose. Material prices + the enchantment are generic placeholders;
-- the Potion-of-Healing recipe figures follow the book's crafting table. Delete or
-- edit freely — these are just to test the loops.
--
-- INSERT OR IGNORE (NOT REPLACE) so re-running skips existing rows without the
-- delete-then-reinsert cascade footgun.
--
-- Apply to LOCAL D1:
--   wrangler d1 execute dauligor-db --local --config worker/wrangler.toml \
--     --file docs/database/seeds/crafting-examples.sql

-- ── Material backing items (loot · subtype 'material') ───────────────────────
INSERT OR IGNORE INTO items (id, name, identifier, item_type, type_subtype, rarity, price, weight, tags, description, updated_at) VALUES
 ('ex-item-curative','Common Curative Reagent','ex-common-curative-reagent','loot','material','common','{"value":10,"denomination":"gp"}','{}','[]','', CURRENT_TIMESTAMP),
 ('ex-item-poison','Common Poisonous Reagent','ex-common-poisonous-reagent','loot','material','common','{"value":10,"denomination":"gp"}','{}','[]','', CURRENT_TIMESTAMP),
 ('ex-item-vial','Glass Vial','ex-glass-vial','loot','material','common','{"value":1,"denomination":"gp"}','{}','[]','', CURRENT_TIMESTAMP);

-- ── Crafting materials (linked to the backing items via itemId) ──────────────
INSERT OR IGNORE INTO crafting_materials (id, name, identifier, itemId, category, rarity, subtype, usedFor, price, weight, tags, updatedAt) VALUES
 ('ex-mat-curative','Common Curative Reagent','ex-common-curative-reagent','ex-item-curative','reagent','common','curative','["cdisc-alchemy"]','{"value":10,"denomination":"gp"}','{}','[]', CURRENT_TIMESTAMP),
 ('ex-mat-poison','Common Poisonous Reagent','ex-common-poisonous-reagent','ex-item-poison','reagent','common','poisonous','["cdisc-alchemy","cdisc-poisoncraft"]','{"value":10,"denomination":"gp"}','{}','[]', CURRENT_TIMESTAMP),
 ('ex-mat-vial','Glass Vial','ex-glass-vial','ex-item-vial','misc','common','','[]','{"value":1,"denomination":"gp"}','{}','[]', CURRENT_TIMESTAMP);

-- ── Recipe: Potion of Healing (alchemy) — 3 curative reagent + 1 glass vial ──
INSERT OR IGNORE INTO recipes (id, name, identifier, disciplineId, outputType, outputItemId, outputQuantity, inputs, goldCost, craftTime, craftChecks, craftDifficultyDC, craftRequirements, tags, updatedAt) VALUES
 ('ex-recipe-poh','Potion of Healing','ex-potion-of-healing','cdisc-alchemy','item','95f4f59e-ea32-4272-859f-098171e1c3cd',1,
  '[{"itemId":"ex-item-curative","quantity":3},{"itemId":"ex-item-vial","quantity":1}]',
  '{}','{"value":2,"unit":"hour"}',1,13,'{}','[]', CURRENT_TIMESTAMP);

-- ── Enchantment: +1 Weapon (generic example) ────────────────────────────────
INSERT OR IGNORE INTO enchantments (id, name, identifier, restrictions, effects, riders, activities, magicalBonus, rarity, attunement, price, tags, description, updatedAt) VALUES
 ('ex-ench-plus1','+1 Weapon','ex-plus-1-weapon',
  '{"allowMagical":false,"type":"weapon","categories":[],"properties":[]}','[]','{}','[]',1,'uncommon','','{}','[]','', CURRENT_TIMESTAMP);
