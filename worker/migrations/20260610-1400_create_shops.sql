-- Shops: named shops that sell a pool of catalog items at their listed prices.
-- The FIRST commerce surface of the crafting & commerce system.
--
-- DESIGN (basic shop): a shop sells a POOL of items it explicitly stocks — items
-- are NOT in any shop by default. The pool is the `shopItems` JSON list; the price
-- shown is the item's own `price`, or a per-entry override. "Basic" = prices only
-- (no buy/sell transactions yet — those need a character currency wallet, a later
-- phase). The JSON-pool model keeps a shop a flat, single-table entity for now; it
-- can normalize into a `shop_inventory` join table when stock / transactions land.
--
-- camelCase columns (Foundry-aligned; skips the compendium.ts alias layer).
-- `shopItems` is added to d1.ts's jsonFields auto-parse list + the server mirror.
--
-- D1 wraps each migration atomically — no BEGIN/COMMIT/PRAGMA.

CREATE TABLE IF NOT EXISTS shops (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    identifier  TEXT NOT NULL,                 -- slug (unique below)
    description TEXT,
    imageUrl    TEXT,
    campaignId  TEXT,                          -- NULL = global shop; per-campaign scoping is a later phase
    shopItems   TEXT DEFAULT '[]',            -- JSON [{ itemId, priceOverride?: {value, denomination} }]
    sort        INTEGER,
    createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS shops_identifier_uniq ON shops(identifier);
CREATE INDEX IF NOT EXISTS idx_shops_campaign ON shops(campaignId);
