# Table Structure: `crafting_materials`

The crafting-domain catalog of raw/intermediate materials (reagents, essences, ingots,
hides, parts, wood, gems…) — the **inputs** of the crafting system. Each material is
**backed by a loot-type `items` row** (`type_subtype='material'`) as its carryable "base
item sheet" (so it stacks / prices / sells / saves to a character sheet like any item),
while this table holds the crafting-domain metadata.

Migration `20260609-1500_create_crafting_materials.sql`. camelCase. The column set is the
slim, authoring-focused set from the
[Kibbles reconciliation](../../_drafts/kibbles-reconciliation-2026-06-09.html).

## Layout Specs

| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g. "Common Arcane Essence", "Mithril Ingot" |
| `identifier` | TEXT NOT NULL | Slug; unique within source (index below) |
| `sourceId` | TEXT (FK) | → `sources.id` |
| `page` | TEXT | |
| `description` | TEXT | BBCode |
| `imageUrl` | TEXT | |
| `itemId` | TEXT (FK) | → `items.id` — the backing carryable loot row (`type_subtype='material'`). NULL until paired |
| `category` | TEXT NOT NULL | `reagent`\|`essence`\|`magicalInk`\|`metal`\|`hide`\|`wood`\|`part`\|`gem`\|`cookingSupply`\|`misc` |
| `rarity` | TEXT | `trivial`\|`common`\|`uncommon`\|`rare`\|`veryRare`\|`legendary` (bare TEXT, app-validated — note the new `trivial` tier) |
| `subtype` | TEXT | Category-specific flavor (see below) |
| `usedFor` | JSON | `crafting_disciplines.id` array (many-to-many: a material feeds 1..N disciplines) |
| `price` | JSON | `{value, denomination}` buy price (sell ≈ half, derived) |
| `weight` | JSON | `{value, units}` per-unit weight |
| `tags` | JSON | Tag-table FK array |
| `contentHash` | TEXT | |
| `createdAt` / `updatedAt` | DATETIME | |

## The material slot — `category` × `rarity` × `subtype`

Kibbles materials are interchangeable within (category + subtype + rarity); the **name is
flavor**. So `category` + `subtype` + `rarity` is the addressable "slot" a recipe input
matches against. `subtype` is freeform, **discriminated by `category`**:
- `reagent` → `curative` | `reactive` | `poisonous`
- `essence` → `arcane` | `divine` | `primal` | `psionic`
- `metal` → grade (`iron`/`steel`/`mithril`/`adamant`/`adamantine`…)
- `wood` → quality · `hide` → form

## Indexes
- `idx_crafting_materials_source` (`sourceId`), `idx_crafting_materials_category`
  (`category`), `idx_crafting_materials_item` (`itemId`)
- `crafting_materials_source_identifier_uniq` UNIQUE (`COALESCE(sourceId,''), identifier`)

## JSON columns (auto-parsed)
`usedFor` added to `d1.ts` jsonFields + the server mirror (migration 20260609-1500);
`price`/`weight`/`tags` already global.

## Deferred (NOT built — Kibbles reconciliation)
`equivalentGoldValue` (shop-era normalization), `salvageable` (execution), `sourceMetadata`
(harvest creature-type/biome provenance) — add when the Shop (Phase C) / harvesting
(Phase D) land.

## Related docs
- [`crafting_disciplines.md`](crafting_disciplines.md) — the `usedFor` target
- [`recipes.md`](recipes.md) — recipes consume materials via `inputs`
- [`items.md`](items.md) — the backing loot row
