# Compendium — Items

Unified item catalog covering weapons, armor, tools, consumables, containers, and
loot. Public browser at `/compendium/items`; admin manager at `/compendium/items/manage`.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/items` | [ItemList.tsx](../../src/pages/compendium/ItemList.tsx) | Public browser, filter / search, inline detail panel |
| `/compendium/items/manage` | [ItemsEditor.tsx](../../src/pages/compendium/ItemsEditor.tsx) | Admin manager — Foundry Import tab + dynamic Manual Editor |

Bastion facilities live in a separate table + page — see
[compendium-facilities.md](compendium-facilities.md). Spell items live in their own
catalog with a different shape — see [compendium-spells.md](compendium-spells.md).

## Data layer (D1)

Items live in a single unified table since migration `20260525-1800` retired the
separate per-shape tables. Weapon / armor / tool **proficiency definitions** still
live in `weapons` / `armor` / `tools` (see `/admin/proficiencies`); the catalog item
references them via polymorphic FK columns.

```text
items (unified)
├── id, name, identifier, item_type, rarity, quantity, ...
├── weight: JSON {value, units}      — Foundry system.weight
├── price:  JSON {value, denomination} — Foundry system.price
├── uses:   JSON {max, spent, recovery[], autoDestroy}  — Foundry system.uses
│   └─ ItemUsesField.tsx authors this block
├── damage / range (weapon-only JSON)
├── capacity / currency (container-only JSON)
├── properties: JSON string[]        — Foundry-aligned slugs
├── base_weapon_id / base_armor_id / base_tool_id — polymorphic FK to
│   proficiency tables. ONLY ONE is non-null per row.
└── ...
```

Full column reference: [`docs/database/structure/items.md`](../database/structure/items.md).

## Item types

`items.item_type` is the document-type discriminator. Mirrors Foundry's `item.type`:

| `item_type` | Foundry equivalent | Editor sub-form |
|---|---|---|
| `weapon` | `item.type='weapon'` | damage / range / magicalBonus |
| `equipment` | `item.type='equipment'` | armor block when armor subtype, else worn-gear |
| `consumable` | `item.type='consumable'` | magical bonus + activity hint |
| `tool` | `item.type='tool'` | ability / bonus / chat flavor |
| `container` | `item.type='container'` or `'backpack'` | capacity + currency 5-coin |
| `loot` | `item.type='loot'` | no sub-form — subtype only |

`items.type_subtype` carries Foundry's `system.type.value` (the primary subtype slug
like `potion` / `light` / `art` / `simpleM`). For equipment it doubles up with
`armor_type`; for tools with `tool_type`. The dynamic editor reads `type_subtype` as
the canonical primary-axis value across all item shapes.

> **Known gap**: Foundry's `system.type.subtype` (secondary axis — `'contact'` for
> poison delivery, `'arrow'` for ammo shape) is currently dropped on import. The
> primary axis (`system.type.value`) was prioritised because every shape needed a
> landing column; the rare two-axis case loses the secondary until either a new
> `items.type_inner_subtype` column lands or a packed-slug convention (e.g.
> `type_subtype = "poison:contact"`) is adopted.

## The dynamic editor — type-dispatching body

`ItemsEditor.tsx`'s `ItemManualEditor` is a thin wrapper around
[`DevelopmentCompendiumManager`](../../src/components/compendium/DevelopmentCompendiumManager.tsx).
The `renderSpecificFields` callback delegates to `DynamicItemFields`, which:

1. Fetches the lookup tables once (`weapons`, `armor`, `tools`, `attributes`,
   `weaponProperties`).
2. Renders four shared sections that apply to every item type:
   - **TYPE** — Item Type + Subtype + Base-item FK (where applicable)
   - **PHYSICAL** — Rarity, Quantity, Weight, Price, Magical
   - **EQUIPABILITY** — Attunement (3-state), Equipped, Identified, Unidentified
     description (hidden for `loot`)
   - **PROPERTIES** — multiselect from `weapon_properties` table (hidden for `loot`)
3. Renders `ItemUsesField` for everything except `loot` and `container` —
   `showAutoDestroy` is gated to consumables only.
4. Renders ONE type-specific sub-form based on `formData.itemType`:
   - `weapon` → damage editor (number / denomination / type / bonus / magicalBonus)
     + range (value / long / reach / units)
   - `equipment` → armor block when subtype is light/medium/heavy/shield
     (armorValue / armorDex / armorMagicalBonus / strength); plain note otherwise
   - `consumable` → magicalBonus + activity-authoring hint
   - `tool` → default ability dropdown + bonus formula + chatFlavor
   - `container` → capacity (count or weight-based) + currency 5-coin grid

Each sub-form receives the full `formData` + `setFormData` from the manager.

## Foundry round-trip

Items round-trip cleanly to Foundry via [itemImport.ts](../../src/lib/itemImport.ts).
`buildUnifiedItemSavePayload` builds a snake_case row keyed by `items` column names;
the `ItemImportWorkbench` writes them in batch via `upsertItemBatch`.

Specifics worth noting:

- **Weight + price** stay nested as `{value, units}` / `{value, denomination}` —
  zero unflattening needed on export.
- **Properties** are pass-through. Standard 5e slugs are Foundry-aligned post the
  20260526-1700 rename (`fin` / `hvy` / `lgt` / `lod` / `two` / `ver` / `thr` /
  `rch` / `amm` / `spc` / `sil`). Custom app slugs (`lance` / `net` / `range` /
  `improvised-weapons`) and Foundry custom extensions (e.g. Zweihänder's
  `superHeavy`) pass verbatim — the module handles their interpretation. See
  [property-mapping.md](../../module/dauligor-pairing/docs/property-mapping.md)
  for the full contract.
- **Attunement** is a 3-state TEXT column post 20260526-1700: `''` / `'required'` /
  `'optional'`. Editor surfaces it as a dropdown; the legacy boolean coercion path
  on import handles older exports.
- **Base-item FK**: Foundry's `system.type.baseItem` slug (e.g. `'greatsword'`)
  resolves to the matching row in `weapons.identifier` (or `armor.identifier` /
  `tools.identifier`). Unresolved slugs surface as an admin warning + the slug
  stays in `items.base_item` for later re-resolution when the proficiency
  definition gets added.
- **Mastery** (2024-only weapon mastery property) is captured in `items.mastery`
  for round-trip but is NOT surfaced in the editor — the game is 2014-rules base.

## Proficiency badge

The character sheet (and eventually the public ItemList) surfaces a `[Proficient]`
chip on rows where the current character is proficient with the item. The match is
computed by [`resolveItemProficiency`](../../src/lib/proficiencyResolver.ts), which
walks the `character_proficiencies` table hierarchically:

```text
SPECIFIC (weapon|armor|tool by id)
  → CATEGORY (weapon|armor|tool_category by id, honoring weapon_type_filter)
    → PROPERTY (weapon_property by id)
```

Full mechanism: [proficiency-resolution.md](../architecture/proficiency-resolution.md).

The editor itself does NOT surface the badge — proficiency is character-scoped
state, and the editor view is per-item not per-character. The list page is where
the badge belongs.

## Custom properties contract (app → Foundry)

When an authored item carries a property slug that isn't in the standard 5e
vocabulary, the export still ships it verbatim — the module is responsible for
interpreting it. Examples shipped today:

| Slug | Origin | Module behavior |
|---|---|---|
| `lance` | App-custom | Treated as a normal weapon property — module decorates with the "must use 2 hands when mounted" hint |
| `net` | App-custom | Same — module knows it's a special-rules weapon |
| `range` | App-custom | Module decorates as a generic "has a range" hint |
| `improvised-weapons` | App-custom | Module marks affected weapons as improvised |
| `superHeavy` | Foundry-custom (per Zweihänder homebrew) | Module reads, applies its own rules |
| (anything else) | Pass-through | Module sees it, decides how to surface it |

The reverse direction (Foundry → app) does NOT invent reverse mappings. If a
Foundry export carries `properties: ['mysterySlug']`, the importer writes
`['mysterySlug']` to `items.properties` verbatim. Unknown slugs aren't filtered
out — they're preserved so the original export can round-trip.

## Foundry Import tab (admin)

The admin tab routes Foundry items folder exports through
[`ItemImportWorkbench`](../../src/components/compendium/ItemImportWorkbench.tsx).
The workbench:

1. Parses the dropped JSON (Foundry's `Item` folder export format).
2. Resolves `system.source.book` against the `sources` table.
3. For each item: classifies the shape (`classifyItemShape`), resolves the
   base-item FK if applicable, dedupes by `(identifier, source_id)`, and builds
   a write-ready `savePayload`.
4. Surfaces a per-row preview + warnings; the admin approves the batch and
   `upsertItemBatch` writes them via `ON CONFLICT(id) DO UPDATE`.

**Not yet supported**: facility items. The workbench's per-shape routing is
items-specific; adding `'facilities'` as a target requires a separate write path
to the `facilities` table. Flagged as follow-up.

## Common tasks

### Add a new magic weapon
1. Navigate to `/compendium/items/manage`.
2. New row → Item Type = `weapon` → pick Base Weapon from the dropdown (e.g.
   "Greatsword"). The FK gets populated; the `base_item` slug auto-fills.
3. Set damage / range overrides if the magic version diverges from base. Set
   `magicalBonus = 1` (or higher).
4. Set Rarity → Magical = true; Attunement → `required` if applicable.
5. Switch to Activities + Effects tabs to author the magic effect (e.g. "+1 to
   attack rolls" as an Active Effect).

### Add a healing potion
1. New row → Item Type = `consumable` → Subtype = `potion`.
2. Quantity = 1, Weight = `{value: 0.5, units: 'lb'}`, Price = `{value: 50,
   denomination: 'gp'}`.
3. Uses block: `max = '1'`, `autoDestroy = true`. No recovery rules (potions
   don't recharge).
4. Activities → add a Heal activity; the dice roll lives there, not on the item.

### Find unattuned magic items in a character's inventory
```sql
SELECT i.id, i.name
FROM items i
JOIN character_inventory ci ON ci.item_id = i.id
WHERE ci.character_id = ?
  AND i.attunement = 'required'
  AND ci.attuned IS NOT TRUE;
```

## Related docs

- [compendium-facilities.md](compendium-facilities.md) — Bastion facilities (separate table)
- [compendium-feats.md](compendium-feats.md) — feats catalog (separate, formerly combined here)
- [proficiency-resolution.md](../architecture/proficiency-resolution.md) — how proficiency badges resolve
- [items.md](../database/structure/items.md) — full column reference
- [property-mapping.md](../../module/dauligor-pairing/docs/property-mapping.md) — module side property contract
- [foundry-integration.md](../architecture/foundry-integration.md) — Foundry round-trip philosophy
