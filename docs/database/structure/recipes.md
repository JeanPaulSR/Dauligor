# Table Structure: `recipes`

The **universal creation rule** — the spine of the crafting system
(design: [`docs/_drafts/crafting-commerce-design-2026-06-09.html`](../../_drafts/crafting-commerce-design-2026-06-09.html)).

A recipe is **"inputs → output"**: the one mechanism behind everything craftable — plain
items, magic items, consumables, materials, **and** enchantments. It is authored **before**
the enchantments editor because recipes are used in the creation of all of those (the user's
2026-06-09 direction), and because *applying an enchantment to a base item is itself a recipe*
(recipes subsume the earlier one-off "bake/apply" flow).

**App-native concept.** Foundry dnd5e has no first-class recipe document (the Bastion
`facilities.craft` block is narrow + facility-bound, not a general engine). Foundry export of
recipes is a later, separate module-side concern. Migration `20260609-1400_create_recipes.sql`
— camelCase columns; starts empty (editor proves the schema first).

## The universal model — three output modes

`outputType` selects one of three creation modes:

| `outputType` | Produces | Used for |
|---|---|---|
| `item` | `outputItemId` × `outputQuantity` | a potion, a refined material, a forged mundane item, **or** a pre-authored magic item |
| `enchantment` | `outputEnchantmentId` | crafts the enchantment **definition** itself (research / discovery) |
| `enchant-item` | `outputEnchantmentId` applied to `outputBaseItemId` → a magic item | the "apply an enchantment to a base" flow, as a recipe. `outputBaseItemId` **NULL** = any base valid per the enchantment's own `restrictions`, chosen at craft time |

The three nullable output FK columns mirror items' polymorphic `base_*_id` pattern — exactly
the columns relevant to the chosen mode are set.

## Layout Specs

| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | Foundry-style id or UUID |
| `name` | TEXT NOT NULL | Display name (e.g. "Forge Flame Tongue Greatsword") |
| `identifier` | TEXT NOT NULL | Slug; unique within source (index below) |
| `sourceId` | TEXT (FK) | → `sources.id` |
| `page` | TEXT | Page number(s) |
| `description` | TEXT | BBCode |
| `imageUrl` | TEXT | CDN URL or relative path |
| `disciplineId` | TEXT (FK) | → `crafting_disciplines.id` — the organizing axis (Alchemy/Blacksmithing/Enchanting…) |
| `outputType` | TEXT NOT NULL | `item` \| `enchantment` \| `enchant-item` (CHECK-constrained); default `item` |
| `outputItemId` | TEXT (FK) | → `items.id` — mode `item` |
| `outputEnchantmentId` | TEXT (FK) | → `enchantments.id` — mode `enchantment` / `enchant-item` |
| `outputBaseItemId` | TEXT (FK) | → `items.id` — mode `enchant-item` (NULL = any valid base) |
| `outputQuantity` | INTEGER | default 1 |
| `inputs` | JSON | `[{itemId, quantity}]` — consumed items/materials (a crafting material is its backing loot item) |
| `goldCost` | JSON | `{value, denomination}` |
| `craftTime` | JSON | `{value, unit}` — e.g. `{value:8, unit:'hour'}` |
| `craftRequirements` | JSON | `{tools:[toolId], minLevel, spells:[id], features:[id], custom}` — proficiency / level / prereqs (NOT consumed) |
| `craftChecks` | INTEGER | Number of successful crafting rolls required (Kibbles "Checks" column). Author-entered, nullable; stored, not computed |
| `craftDifficultyDC` | INTEGER | The per-check DC (Kibbles "Difficulty" column). Nullable, no range constraint |
| `tags` | JSON | Tag-table FK array |
| `contentHash` | TEXT | SHA-256 of canonical content; NULL until populated |
| `createdAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updatedAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP — write paths update manually |

## Indexes

- `idx_recipes_source` ON (`sourceId`)
- `idx_recipes_output_item` ON (`outputItemId`)
- `idx_recipes_output_enchantment` ON (`outputEnchantmentId`)
- `recipes_source_identifier_uniq` UNIQUE ON (`COALESCE(sourceId, ''), identifier`)

## JSON columns (auto-parsed on read)

`inputs`, `goldCost`, `craftTime`, `craftRequirements` were added to the `d1.ts` `jsonFields`
list + the server mirror `JSON_COLUMNS` (migration 20260609-1400). **Distinctive names on
purpose** — the auto-parse list is *global*, so bare `time` / `cost` / `requirements` would
risk colliding with other tables' scalar columns. `tags` was already present.

## Editor + reuse

`RecipesEditor` (`CompendiumEditorShell`) with an **output-mode switch** that reveals the
relevant output picker:
- an **item picker** (for `outputItemId`, each `inputs` row, and `outputBaseItemId`),
- an **enchantment picker** (for `outputEnchantmentId`),
- reuses source assignment, tags, the image field, and the standard list/detail shells.

## Worked examples

1. **Brew a Potion of Healing** — `outputType:'item'`, `outputItemId:<potion-of-healing>`,
   `inputs:[{herb, 2}]`, `goldCost:{25,'gp'}`, `craftTime:{8,'hour'}`,
   `craftRequirements:{tools:['herbalism-kit']}`.
2. **Craft the Flame Tongue enchantment** (research) — `outputType:'enchantment'`,
   `outputEnchantmentId:<flame-tongue>`, `inputs:[{fire-elemental-heart, 1}]`,
   `goldCost:{500,'gp'}`, `craftTime:{1,'week'}`, `craftRequirements:{minLevel:5, spells:[<fireball>]}`.
3. **Forge a Flame Tongue greatsword** (enchant a base) — `outputType:'enchant-item'`,
   `outputEnchantmentId:<flame-tongue>`, `outputBaseItemId:<greatsword>` (or NULL = any valid
   weapon), `inputs:[{ruby, 1}]`, `craftRequirements:{tools:['smiths-tools']}`.

## Related docs

- [`docs/_drafts/crafting-commerce-design-2026-06-09.html`](../../_drafts/crafting-commerce-design-2026-06-09.html) — the crafting & commerce design seed
- [`enchantments.md`](enchantments.md) — the enchantment definitions recipes produce / apply
- [`items.md`](items.md) — inputs, output items, and base items all reference `items`
