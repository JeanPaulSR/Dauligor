# Table Structure: `enchantments`

A reusable library of **enchantment definitions** — the first step of the crafting
system (design: [`docs/_drafts/crafting-commerce-design-2026-06-09.html`](../../_drafts/crafting-commerce-design-2026-06-09.html)).

An enchantment is **not** a carried item; it is a reusable **effect** applied to many
base items (Flame Tongue = +2d6 fire on a shortsword *or* a greatsword). It lives in
its own table rather than `items` per the *new-table-for-new-functionality* rule.

Migration: `20260609-1300_create_enchantments.sql` — **camelCase columns** (the
post-2026-05-27 convention; no `compendium.ts` snake↔camel alias layer). Starts empty;
the editor lands first to prove the schema (Phase A).

## Foundry model (dnd5e 5.x)

An enchantment is an Active Effect of `type: "enchantment"` applied to an **Item**
(not an actor), delivered by an **Enchant activity** whose `restrictions` gate which
items are valid targets. Our `SemanticActivity.enchant` (`src/types/activities.ts`)
already mirrors this shape, and the shared `ActivityEditor` (`enchant` kind) + Active
Effect editor author it. The Enchant activity's Restrictions tab reads the reference
taxonomies seeded by migration `20260605-1200_enchant_restriction_tables.sql`
(`consumable_categories` / `loot_categories` / `item_properties.valid_types`) — this
table's `restrictions` JSON references that same vocabulary; it is **not** duplicated
here.

## Layout Specs

| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | Foundry-style 16-char id or UUID |
| `name` | TEXT NOT NULL | Display name (e.g. "Flame Tongue") |
| `identifier` | TEXT NOT NULL | Slug; unique within source (index below) |
| `sourceId` | TEXT (FK) | → `sources.id` |
| `page` | TEXT | Page number(s) |
| `description` | TEXT | BBCode authored body |
| `imageUrl` | TEXT | CDN URL or relative path |
| `restrictions` | JSON | `{allowMagical, type, categories[], properties[]}` — the enchant-activity gate (what item types/categories/properties this may apply to) |
| `effects` | JSON | Active Effect document(s) of `type:"enchantment"` — the actual changes (name override, `system.magicalBonus`, damage riders, AC…) |
| `riders` | JSON | `{activity[], effect[], item[]}` granted alongside the enchantment |
| `magicalBonus` | INTEGER | Convenience flat +N (mirrors `items.magical_bonus`) |
| `rarity` | TEXT | Rarity conferred on the finished item (`none|common|…|artifact`) |
| `attunement` | TEXT | 3-state: `''` / `'required'` / `'optional'` |
| `price` | JSON | `{value, denomination}` — economy delta (feeds shop / crafting cost) |
| `tags` | JSON | Tag-table FK array |
| `contentHash` | TEXT | SHA-256 of canonical content (update detection); NULL until populated |
| `createdAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updatedAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP — write paths update manually |

> **No top-level `level` column.** Per-effect level gating (`effects[].level
> {min,max}`, from the `SemanticActivity.enchant.effects` shape) lives **nested inside
> `effects`**. A bare `level` column is deliberately avoided because `d1.ts`'s
> `jsonFields` auto-parse list is **global** — a `level` entry would try to JSON-parse
> every table's scalar `level` (character level, spell level, …).

## Indexes

- `idx_enchantments_source` ON (`sourceId`)
- `enchantments_source_identifier_uniq` UNIQUE ON (`COALESCE(sourceId, ''), identifier`)
  — source-scoped slug uniqueness; COALESCE collapses orphan (NULL-source) rows into
  one bucket so duplicates are still blocked.

## JSON columns (auto-parsed on read)

`restrictions` + `riders` were added to the `d1.ts` `jsonFields` list and the server
mirror `api/_lib/d1-fetchers-server.ts` `JSON_COLUMNS` set (migration 20260609-1300).
`effects`, `tags`, and `price` were already present (shared with `items`).

## Editor + reuse

The enchantments editor is a dedicated page mirroring the feats/spells editors
(`CompendiumEditorShell`). It reuses:
- the shared **`ActivityEditor`** in `enchant` mode → authors `restrictions` + the
  effect binding (level / riders),
- the **Active Effect editor** → authors `effects` (the changes),
- the **restriction taxonomies** (`consumable_categories` / `loot_categories` /
  `item_properties`) for the Valid Categories / Valid Properties pickers.

## Related docs

- [`docs/_drafts/crafting-commerce-design-2026-06-09.html`](../../_drafts/crafting-commerce-design-2026-06-09.html) — the crafting & commerce design seed
- [`items.md`](items.md) — the catalog table enchantments are applied to (Bake flow, Phase B)
- [`src/types/activities.ts`](../../../src/types/activities.ts) — `SemanticActivity.enchant` shape
- `worker/migrations/20260605-1200_enchant_restriction_tables.sql` — the restriction vocabulary
