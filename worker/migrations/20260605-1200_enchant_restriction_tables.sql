-- Enchant restriction reference tables: consumable categories, loot categories,
-- and item properties (with per-item-type validity). Seeded from dnd5e 5.3.1
-- CONFIG (consumableTypes / lootTypes / itemProperties + validProperties) so the
-- Enchant activity's Restrictions tab can reveal per-Item-Type Valid Categories /
-- Valid Properties for every enchantable type (weapon/armor/tool categories +
-- weapon already live in their own tables).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT(id) DO NOTHING
-- (stable ids, never clobbers admin edits). Safe to re-run against local or prod.

CREATE TABLE IF NOT EXISTS consumable_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loot_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_properties (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT UNIQUE NOT NULL,
    "order" INTEGER,
    description TEXT,
    -- JSON array of item-type keys this property is valid for (Foundry's
    -- CONFIG.DND5E.validProperties), e.g. ["weapon","equipment"].
    valid_types TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO consumable_categories (id, identifier, name, "order") VALUES
  ('ccat-ammo','ammo','Ammunition',1),
  ('ccat-food','food','Food',2),
  ('ccat-poison','poison','Poison',3),
  ('ccat-potion','potion','Potion',4),
  ('ccat-rod','rod','Rod',5),
  ('ccat-scroll','scroll','Scroll',6),
  ('ccat-trinket','trinket','Trinket',7),
  ('ccat-wand','wand','Wand',8),
  ('ccat-wondrous','wondrous','Wondrous Item',9)
ON CONFLICT(id) DO NOTHING;

INSERT INTO loot_categories (id, identifier, name, "order") VALUES
  ('lcat-art','art','Art Object',1),
  ('lcat-gear','gear','Adventuring Gear',2),
  ('lcat-gem','gem','Gemstone',3),
  ('lcat-junk','junk','Junk',4),
  ('lcat-material','material','Material',5),
  ('lcat-resource','resource','Resource',6),
  ('lcat-trade','trade','Trade Good',7),
  ('lcat-treasure','treasure','Treasure',8)
ON CONFLICT(id) DO NOTHING;

INSERT INTO item_properties (id, identifier, name, valid_types, "order") VALUES
  ('iprop-ada','ada','Adamantine','["weapon","equipment"]',1),
  ('iprop-amm','amm','Ammunition','["weapon"]',2),
  ('iprop-concentration','concentration','Concentration','["spell"]',3),
  ('iprop-fin','fin','Finesse','["weapon"]',4),
  ('iprop-fir','fir','Firearm','["weapon"]',5),
  ('iprop-foc','foc','Focus','["weapon","equipment","tool"]',6),
  ('iprop-hvy','hvy','Heavy','["weapon"]',7),
  ('iprop-lgt','lgt','Light','["weapon"]',8),
  ('iprop-lod','lod','Loading','["weapon"]',9),
  ('iprop-material','material','Material','["spell"]',10),
  ('iprop-mgc','mgc','Magical','["weapon","equipment","consumable","container","feat","tool","loot"]',11),
  ('iprop-rch','rch','Reach','["weapon"]',12),
  ('iprop-rel','rel','Reload','["weapon"]',13),
  ('iprop-ret','ret','Returning','["weapon"]',14),
  ('iprop-ritual','ritual','Ritual','["spell"]',15),
  ('iprop-sil','sil','Silvered','["weapon"]',16),
  ('iprop-somatic','somatic','Somatic','["spell"]',17),
  ('iprop-spc','spc','Special','["weapon"]',18),
  ('iprop-stealthdis','stealthDisadvantage','Stealth Disadvantage','["equipment"]',19),
  ('iprop-thr','thr','Thrown','["weapon"]',20),
  ('iprop-trait','trait','Passive Trait','["feat"]',21),
  ('iprop-two','two','Two-Handed','["weapon"]',22),
  ('iprop-ver','ver','Versatile','["weapon"]',23),
  ('iprop-vocal','vocal','Verbal','["spell"]',24),
  ('iprop-weightless','weightlessContents','Weightless Contents','["container"]',25)
ON CONFLICT(id) DO NOTHING;
