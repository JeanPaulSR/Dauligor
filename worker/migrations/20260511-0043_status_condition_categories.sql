-- Migration: wire `status_conditions` to `condition_categories`.
--
-- The `condition_categories` table has existed in the schema since
-- migration 0001 but was never linked to anything and never seeded.
-- The Active Effect editor's status-condition picker used to display a
-- nice category badge ("PHB Conditions" / "Combat States" / "Spell
-- States" / "System Extras") sourced from a hardcoded catalog; this
-- migration moves that grouping onto authored data so the same badge
-- appears in the picker AND the StatusesEditor admin page after we
-- swap the source over.
--
-- What this does
-- --------------
-- 1. Adds a nullable `category_id` foreign key on `status_conditions`.
-- 2. Seeds four canonical categories — the same vocabulary that lived
--    in `src/lib/activeEffectStatuses.ts` before it was trimmed back
--    to just the document-type list.
-- 3. Backfills `category_id` on the well-known dnd5e 5.x identifiers
--    that match the previous hardcoded mapping. Rows with custom
--    identifiers stay NULL and the user can categorise them through
--    the StatusesEditor admin page.
--
-- INSERT OR IGNORE on category seeds is intentional — if a category
-- with the same `identifier` already exists (e.g. a future run or a
-- partial replay), we leave the existing row alone rather than
-- conflict on the UNIQUE index.

-- ===== 1. Add category_id FK =====

ALTER TABLE status_conditions ADD COLUMN category_id TEXT
  REFERENCES condition_categories(id);

CREATE INDEX IF NOT EXISTS idx_status_conditions_category_id
  ON status_conditions(category_id)
  WHERE category_id IS NOT NULL;

-- ===== 2. Seed condition_categories =====

INSERT OR IGNORE INTO condition_categories (id, identifier, name, "order", description) VALUES
  ('cat-phb-conditions', 'phb-conditions', 'PHB Conditions', 1,
   'The 15 canonical conditions from the Player''s Handbook: blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious.'),
  ('cat-combat-states', 'combat-states', 'Combat States', 2,
   'Tactical / action-economy states tracked by dnd5e and Midi: dodging, hiding, surprised, marked, raging.'),
  ('cat-spell-states',  'spell-states', 'Spell States', 3,
   'Conditions inflicted or maintained by spell effects: concentrating, cursed, silenced, transformed, ethereal.'),
  ('cat-system-extras', 'system-extras', 'System Extras', 4,
   'Extra status conditions shipped by dnd5e 5.x beyond the PHB list: bleeding, burning, dehydrated, diseased, falling, flying, hovering, malnourished, sleeping, stable, suffocation, dead.');

-- ===== 3. Backfill category_id on canonical identifiers =====

UPDATE status_conditions SET category_id = 'cat-phb-conditions'
WHERE category_id IS NULL AND identifier IN (
  'blinded','charmed','deafened','exhaustion','frightened','grappled',
  'incapacitated','invisible','paralyzed','petrified','poisoned',
  'prone','restrained','stunned','unconscious'
);

UPDATE status_conditions SET category_id = 'cat-combat-states'
WHERE category_id IS NULL AND identifier IN (
  'dodging','hiding','surprised','marked','raging'
);

UPDATE status_conditions SET category_id = 'cat-spell-states'
WHERE category_id IS NULL AND identifier IN (
  'concentrating','cursed','silenced','transformed','ethereal'
);

UPDATE status_conditions SET category_id = 'cat-system-extras'
WHERE category_id IS NULL AND identifier IN (
  'bleeding','burning','dehydrated','diseased','falling','flying',
  'hovering','malnourished','sleeping','stable','suffocation','dead'
);
