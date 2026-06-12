# Notice + 2 decisions → `foundry-module`: crafting materials (loot subtype `material`) (2026-06-10)

New feature on `compendium-editors`: a **Crafting Materials** catalog (the inputs of
the forthcoming crafting system). This is mostly a heads-up — the carryable side
**already round-trips through your existing loot path** — plus two small round-trip
decisions (a new rarity tier + whether Foundry needs the crafting metadata).

Follow-up to `2026-06-07-items-native-conversion.md` (see its **Loot** section).

## What a crafting material is (the data model)

A material is **two rows**, joined by `crafting_materials.itemId → items.id`:

1. **A backing `items` loot row** — `item_type='loot'`, **`type_subtype='material'`**.
   This is the carryable "base item sheet": name / description / image / price /
   weight / rarity / tags. It's minted/updated automatically when the material is
   saved in the new editor, and it's what a character actually carries.
2. **A `crafting_materials` row** (new camelCase table, local-only so far) — the
   crafting-domain metadata that loot items don't have:

   | Column | Meaning |
   |---|---|
   | `category` | `reagent`/`essence`/`magicalInk`/`metal`/`hide`/`wood`/`part`/`gem`/`cookingSupply`/`misc` |
   | `subtype` | freeform flavor within the category (e.g. metal grade `mithril`) |
   | `usedFor` | JSON array of `crafting_disciplines.id` — which disciplines consume it |
   | `rarity` | mirrors the item, **but adds a new `trivial` tier** (see decision 1) |
   | `price` / `weight` | mirrored onto the backing item |

The material is **hidden from our app's gear browser** (it gets its own view); in
Foundry it should simply look like a loot item of subtype "Crafting Material".

## The good news: the carryable side ALREADY works

Per the loot contract in `2026-06-07-items-native-conversion.md`:
> Loot: `type_subtype` (`art`/`gear`/`gem`/`junk`/**`material`**/`resource`/`trade`/`treasure`) → `system.type.value` … handled by the generic export else-branch + `itemImport.ts` common payload.

So the backing loot row exports as a normal loot item with **`system.type.value =
'material'`** — which dnd5e 5.x already renders as its own loot subtype. **No new
module conversion is needed** for materials to appear as Crafting Materials in
Foundry, and import already maps them back to a `type_subtype='material'` loot row.
(Please just confirm the dnd5e display label for the `material` subtype matches the
intent — "Crafting Material" / "Trade Good" / etc. — so we name it consistently.)

## Decision 1 — the new `trivial` rarity tier ⚠️

We added a **`trivial`** rarity tier below `common` for cheap raw materials. dnd5e's
`CONFIG.DND5E.itemRarity` has no `trivial`, so a material exporting
`system.rarity='trivial'` is an invalid Foundry rarity (it'd render blank).

- **App side (ours):** we'll map `trivial → ''` (mundane/blank) on export in
  `_itemExport.ts`, and leave blank `''` → mundane on import. That keeps Foundry
  valid. **This is our follow-up** — flagging it so your import doesn't trip on a
  `trivial` value if one slips through pre-fix.
- **Decision for you:** do you want the `trivial` distinction preserved in Foundry
  at all (e.g. a `flags.dauligor-pairing.rarityTier`), or is collapsing it to
  mundane fine? We lean **collapse to mundane** — `trivial` is an app-economy tier,
  not a Foundry concept. Confirm and we'll finalize the export map.

## Decision 2 — does Foundry need the crafting metadata?

The crafting-domain fields (`category`, `subtype`, `usedFor` disciplines) live on
`crafting_materials`, **not** on the items row — so today they **do not** export to
Foundry. The loot item carries only its carryable identity.

- **If Foundry never runs crafting itself** (materials are just carryable loot that
  our app's crafting system consumes), this is correct as-is — **nothing to do.**
- **If a future in-Foundry crafting flow needs the metadata,** we'd emit it on the
  bundle as `flags.dauligor-pairing.material = { category, subtype, usedFor }` and
  ask you to preserve the flag round-trip (you already pass `flags.dauligor-pairing`
  through). We'd add that only when crafting execution lands.

**Decision for you:** confirm you **don't need** the crafting metadata in Foundry
for now (Phase A = catalogs). If you do, say which fields and we'll add the flag.

## App-side status

- ✅ Editor built (`/compendium/materials/manage`); saving mints the backing
  `loot` / `material` item + links `itemId`; materials hidden from our gear browser.
- ✅ Backing item exports via the **existing** loot path — no new export code for the
  carryable. Verified the data contract locally (item + material + JSON + filter).
- ⏳ `trivial → ''` export map (decision 1) — small `_itemExport.ts` follow-up, ours.
- ⏳ Crafting-metadata flag (decision 2) — only if you need it; deferred otherwise.

## DB / no migration for the round-trip
The carryable round-trip reuses existing `items` columns — **no new migration** for
Foundry. The crafting tables (`crafting_materials` / `crafting_disciplines` /
`recipes` / `enchantments`) are **local D1 only** so far; none are on remote, and
none are needed module-side for the loot round-trip.

## TL;DR for the module
Materials already surface correctly as loot subtype `material` — **no build needed
right now.** Two confirmations wanted: (1) collapsing our app-only `trivial` rarity
to Foundry mundane is fine; (2) you don't need the crafting metadata
(category/subtype/usedFor) in Foundry yet. We own the `trivial→''` export fix.
