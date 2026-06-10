-- Crafting disciplines: the admin-managed taxonomy that organizes ALL crafting
-- (Alchemy, Blacksmithing, Enchanting, ...). The organizing axis of the crafting
-- editor and the "used for" target of crafting materials. Per the 2026-06-09 Kibbles
-- reconciliation (docs/_drafts/kibbles-reconciliation-2026-06-09.html) and the user's
-- decision, the discipline is a LIGHTWEIGHT taxonomy now (mirroring loot_categories /
-- consumable_categories); execution fields (ability score / tool / forge facility) are
-- DEFERRED to Phase D (live crafting).
--
-- camelCase columns (Foundry is camelCase end-to-end — verified against real exports:
-- `baseItem`, `magicalBonus`, `createdTime`, and the ordering field is `sort`). We are
-- migrating OFF snake_case, so new tables (including this taxonomy) are camelCase. The
-- shared taxonomy editor `ProficiencyEntityShell` is driven in camelCase mode for this
-- table (columnCase="camel": it persists `sort` + `updatedAt` instead of `order` +
-- `updated_at`).
--
-- Seeded from Kibbles Ch.6 disciplines, idempotent (ON CONFLICT DO NOTHING, stable ids)
-- and admin-editable. Numbered BEFORE recipes (20260609-1400) so recipes.disciplineId can
-- reference it. D1 wraps each migration atomically - no BEGIN/COMMIT/PRAGMA.

CREATE TABLE IF NOT EXISTS crafting_disciplines (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    identifier  TEXT NOT NULL UNIQUE,
    description TEXT,
    sort        INTEGER,                            -- display order (Foundry's `sort` field name)
    createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO crafting_disciplines (id, identifier, name, sort) VALUES
  ('cdisc-alchemy','alchemy','Alchemy',1),
  ('cdisc-poisoncraft','poisoncraft','Poisoncraft',2),
  ('cdisc-blacksmithing','blacksmithing','Blacksmithing',3),
  ('cdisc-cooking','cooking','Cooking',4),
  ('cdisc-enchanting','enchanting','Enchanting',5),
  ('cdisc-scrollscribing','scrollscribing','Scrollscribing',6),
  ('cdisc-wand-whittling','wand-whittling','Wand Whittling',7),
  ('cdisc-leatherworking','leatherworking','Leatherworking',8),
  ('cdisc-tinkering','tinkering','Tinkering',9),
  ('cdisc-woodcarving','woodcarving','Woodcarving',10),
  ('cdisc-runecarving','runecarving','Runecarving',11),
  ('cdisc-engineering','engineering','Engineering',12),
  ('cdisc-jewelcrafting','jewelcrafting','Jewelcrafting',13)
ON CONFLICT(id) DO NOTHING;
