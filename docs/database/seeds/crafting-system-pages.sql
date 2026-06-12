-- Seed: the Crafting system pages — the hub (/system/crafting) + the started
-- per-discipline pages. Created as EMPTY shells (id / identifier / name / icon
-- only). The page bodies are authored by hand via the System Page Designer — the
-- content is the DM's own and is intentionally NOT seeded here.
--
-- Apply to LOCAL D1:
--   wrangler d1 execute dauligor-db --local --config worker/wrangler.toml \
--     --file docs/database/seeds/crafting-system-pages.sql
-- Idempotent: ON CONFLICT(identifier) re-applies (keeps bodies blank here, so
-- re-running will NOT clobber bodies an author has since written unless they
-- re-run this seed deliberately).

INSERT INTO system_pages (id, identifier, name, description, icon, "order", created_at, updated_at)
VALUES ('sysp-crafting', 'crafting', 'Crafting', '', 'Hammer', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(identifier) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon, "order"=excluded."order", updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_pages (id, identifier, name, description, icon, "order", created_at, updated_at)
VALUES ('sysp-crafting-alchemy', 'alchemy', 'Alchemy', '', 'FlaskConical', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(identifier) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon, "order"=excluded."order", updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_pages (id, identifier, name, description, icon, "order", created_at, updated_at)
VALUES ('sysp-crafting-blacksmithing', 'blacksmithing', 'Blacksmithing', '', 'Hammer', 21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(identifier) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon, "order"=excluded."order", updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_pages (id, identifier, name, description, icon, "order", created_at, updated_at)
VALUES ('sysp-crafting-enchanting', 'enchanting', 'Enchanting', '', 'Sparkles', 22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(identifier) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon, "order"=excluded."order", updated_at=CURRENT_TIMESTAMP;
