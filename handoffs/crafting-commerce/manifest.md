# Branch: `crafting-commerce`

Started: `2026-06-12`
Owner: `Claude`
Goal: Own and continue the Crafting & Commerce subsystem (materials, enchantments, recipes, disciplines, magic-items, shops) so `compendium-editors` can stay focused on the core compendium editors. Phase A is already on `main`; this branch picks up Phase B–D.
Status: `planned`

> **Base off `origin/main`.** Phase A (catalogs + magic-items tab + basic shop) already shipped to
> `main` @ `73ebf2a` / `f78b5bb`. This branch does NOT re-do that work — it *owns the existing files*
> going forward and builds the deferred phases on top. See
> [2026-06-12-crafting-commerce-handoff.md](2026-06-12-crafting-commerce-handoff.md) for the full pickup.

## Primary files (exclusive)

Crafting/commerce code now on `main`. `compendium-editors` **cedes these** to this branch (it kept a broad
`src/components/compendium/**` + `src/pages/compendium/*Editor.tsx` claim; these specific files are carved
out here). Coordinate before touching.

- `src/pages/compendium/CraftingMaterialsEditor.tsx` · `CraftingMaterialsList.tsx`
- `src/components/compendium/CraftingMaterialDetailPanel.tsx`
- `src/pages/compendium/EnchantmentsEditor.tsx` · `EnchantmentsList.tsx`
- `src/components/compendium/EnchantmentDetailPanel.tsx`
- `src/pages/compendium/RecipesEditor.tsx` · `RecipesList.tsx`
- `src/components/compendium/RecipeDetailPanel.tsx`
- `src/pages/compendium/ShopEditor.tsx` · `ShopList.tsx`
- `src/components/compendium/ShopDetailPanel.tsx`
- New Phase B–D files: a `characters.currency` wallet, shop transactions, live crafting execution
  (new components/lib, paths TBD)

## Shared files (append-only)

- `src/App.tsx` — crafting/shop routes (additive)
- `src/components/Sidebar.tsx` — the Crafting nav section (additive)
- `src/lib/d1Tables.ts` — `D1_TABLE_MAP` entries (enchantments/recipes/craftingDisciplines/craftingMaterials/shops)
- `src/lib/d1.ts` — `jsonFields` auto-parse list
- `api/_lib/d1-fetchers-server.ts` — `JSON_COLUMNS` auto-parse list
- `worker/migrations/` — new timestamped migrations (local-first)
- `src/pages/compendium/ItemList.tsx` — `magicalOnly` prop (general Items browser excludes magical;
  magic-items tab opts in). Generic file; coordinate with `compendium-editors`.
- `src/pages/admin/AdminProficiencies.tsx` — Crafting Disciplines tab (`includeAbility` + `categoryFK`).

## Open requests to other branches

- [ ] `(2026-06-12)` `compendium-editors` to stop editing the crafting/shop/enchantment/recipe/material
  files listed above — cede to this branch. (Coordination, not a code change.)

## Handoff log

- `2026-06-12` — [2026-06-12-crafting-commerce-handoff.md](2026-06-12-crafting-commerce-handoff.md)
