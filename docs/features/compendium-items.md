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

Both pages load a **slim catalog projection** — name / source / type + the filter
columns — and fetch the **full item row lazily on select** (`fetchItem`); the heavy
`description` / `activities` / `effects` columns aren't shipped for every row. The
read-only detail panel (`ItemDetailPanel`, shared by the public browser and the
editor's live-preview pane) renders the item art (with a graceful fallback for
unhosted Foundry icon paths) and the description through the BBCode displayer,
matching the feat / spell panels.

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
| `consumable` | `item.type='consumable'` | subtype + ammo/poison inner subtype + damage |
| `tool` | `item.type='tool'` | ability / bonus / chat flavor |
| `container` | `item.type='container'` or `'backpack'` | capacity + currency 5-coin |
| `loot` | `item.type='loot'` | no sub-form — subtype only |

`items.type_subtype` carries Foundry's `system.type.value` (the primary subtype slug
like `potion` / `light` / `art`). For equipment it doubles up with `armor_type`; for
tools with `tool_type`. The editor reads `type_subtype` as the canonical primary-axis
value across all item shapes.

> **Weapons are the exception.** For weapons, `type_subtype` carries our proficiency
> **category** (`simple` / `martial` / `exotic` / …) — NOT Foundry's melee/ranged
> split (`simpleM` / `simpleR` / …), which our categories don't have. The split rides
> the linked base weapon (`weapons.weapon_type` = `Melee`/`Ranged`): import folds
> `simpleM`→`simple` (`FOUNDRY_WEAPON_TYPE_TO_CATEGORY`), and export re-folds
> category + base-weapon M/R back to `simpleM`. See [Foundry round-trip](#foundry-round-trip).

Foundry's `system.type.subtype` (the **secondary** axis — `'contact'` for poison
delivery, `'arrow'` for ammo shape) lands in `items.type_inner_subtype` as of
migration `20260607-1300`, keyed to the `ammunition_types` / `poison_types`
taxonomies. (An earlier revision of this doc flagged this axis as "dropped on
import" — that gap is closed; see [`items.md`](../database/structure/items.md).)

## The editor — per-type Foundry-matching sheets

`ItemsEditor.tsx` was rebuilt (2026-06) to mirror **Foundry dnd5e 5.3.1 item sheets,
one type at a time** (driven by per-type screenshots). It renders through
[`CompendiumEditorShell`](../../src/components/compendium/CompendiumEditorShell.tsx)
(catalog list · tabbed editor · live-preview pane). The per-type mechanics are
dispatched by `MechanicsTab`, which early-returns to a dedicated `<XDetails>`
component keyed off `formData.itemType`:

| `item_type` | Component | Key fields |
|---|---|---|
| `weapon` | `WeaponDetails` | Weapon Type (`weapon_categories`) · Base Weapon (`weapons` by category) · damage (`DamagePartEditor`) · range (reach, or normal + long) · magical bonus · ammunition type · properties |
| `equipment` | `EquipmentDetails` | base / armor (value · dex · magical bonus · strength) / vehicle sub-forms, chosen by subtype |
| `consumable` | `ConsumableDetails` | subtype (potion/scroll/ammo/poison) · ammo or poison inner subtype · properties · damage |
| `tool` | `ToolDetails` | tool category · base tool · ability · proficiency · bonus · chat flavor |
| `container` | `ContainerDetails` | capacity · currency 5-coin grid · nested Contents panel |
| `loot` | `LootDetails` | subtype only — Foundry-simple, no mechanics sub-form |

Type-independent surfaces live on the other tabs: **Basics** (name / source / type /
subtype / rarity / image), the shared Physical (quantity / weight / price / magical),
Attunement (3-state) / Equipped / Identified, Properties (multiselect from
`item_properties`), and a Usage block (Limited Uses — shown on weapon / equipment / consumable / tool, not loot / container; auto-destroy only on consumables), plus **Activities + Effects** (the shared
`ActivityEditor` + Active Effect editor). Dropdown vocabularies are data-driven from
the admin catalogs — `weapon_categories`, `armor_categories`, `tool_categories`,
`damage_types`, `ammunition_types`, `poison_types`, `item_properties` — so homebrew
entries appear without a code change.

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
- **Activities** are stored in the app's **semantic** shape (`SemanticActivity` —
  `kind` / `id`, flat `attack.type`), the form the shared `ActivityEditor` edits. On
  import, `foundryActivityToSemantic`
  ([`foundryActivities.ts`](../../src/lib/foundryActivities.ts)) converts Foundry's raw
  `system.activities` (`type` / `_id`, nested `attack.type`) into that shape so
  imported activities render in the editor; on export the pairing module's
  `normalizeSemanticActivity` converts back to Foundry-native (wired into
  `normalizeWorldItem` for standalone items + feats). The same shared converter serves
  items, feats, and spells — spells additionally keep the raw `foundry_data` block as
  their round-trip source. (Earlier code stored raw Foundry activities, which the
  kind-based editor couldn't render.)

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
3. For each item: classifies the shape (`classifyItemShape` — DB-driven off the live
   `armor_categories`, so homebrew armor categories shape as `armor` rather than the
   generic `items`), resolves the base-item FK if applicable, mints a
   per-source-unique `identifier`, dedupes by `(identifier, source_id)`, and builds a
   write-ready `savePayload`.
4. Surfaces a per-row preview + warnings — unresolved **source** and unresolved
   **base item** each get a header stat + a per-row badge. The admin can assign a
   source to unresolved rows, remove individual candidates, then approve the batch;
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
