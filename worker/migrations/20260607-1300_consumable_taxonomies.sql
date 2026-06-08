-- Migration: Consumable taxonomies — ammunition + poison types
-- Date: 2026-06-07
--
-- Two admin-managed reference tables backing the consumable Details
-- tab's second-axis dropdowns (Foundry `system.type.subtype` for ammo
-- + poison), plus the items column that stores the chosen value. They
-- match the existing taxonomy-table shape (feat_categories etc.) so
-- they drop straight into /admin/proficiencies via the shared
-- ProficiencyEntityShell. Identifiers match dnd5e 5.3.1's
-- CONFIG.consumableTypes subtype keys for export round-trip fidelity.

CREATE TABLE IF NOT EXISTS ammunition_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ammunition_types_sort ON ammunition_types(sort_order, name);

CREATE TABLE IF NOT EXISTS poison_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_poison_types_sort ON poison_types(sort_order, name);

-- `type_inner_subtype` — Foundry `system.type.subtype`, the second axis
-- under a consumable's type (ammo: arrow / crossbowBolt / ...; poison:
-- contact / ingested / ...). Closes the documented import drop
-- (itemImport.ts previously discarded it).
ALTER TABLE items ADD COLUMN type_inner_subtype TEXT;

-- Seed: ammunition types (labels + order per the dnd5e consumable sheet).
INSERT OR IGNORE INTO ammunition_types (id, identifier, name, sort_order) VALUES
  ('ammo-arrow',          'arrow',         'Arrow',            1),
  ('ammo-bolt',           'crossbowBolt',  'Bolt',             2),
  ('ammo-firearm-bullet', 'firearmBullet', 'Bullet (Firearm)', 3),
  ('ammo-sling-bullet',   'slingBullet',   'Bullet (Sling)',   4),
  ('ammo-energy-cell',    'energyCell',    'Energy Cell',      5),
  ('ammo-needle',         'blowgunNeedle', 'Needle',           6);

-- Seed: poison types.
INSERT OR IGNORE INTO poison_types (id, identifier, name, sort_order) VALUES
  ('poison-contact',  'contact',  'Contact',  1),
  ('poison-ingested', 'ingested', 'Ingested', 2),
  ('poison-inhaled',  'inhaled',  'Inhaled',  3),
  ('poison-injury',   'injury',   'Injury',   4);
