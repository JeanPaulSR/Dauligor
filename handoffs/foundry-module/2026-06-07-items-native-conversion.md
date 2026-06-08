# Items — app ↔ Foundry native-conversion contract (module branch)

**2026-06-07 · from `compendium-editors` · GROWING** — one section per item
type as each type's Details tab is finished. Nothing here round-trips **yet**.

## Purpose
The items editor is being rebuilt to Foundry dnd5e 5.3.1 fidelity, one item
type at a time. As each type's **Details** lands in the app, this doc records
the new / changed semantic fields the Foundry round-trip must carry. Two sides
are still TODO:
- **App-side semantic export/import** (this branch, `compendium-editors`):
  `src/lib/itemImport.ts` + `api/_lib/_itemExport.ts`.
- **Module-side native conversion** (the `foundry-module` branch):
  `module/dauligor-pairing/scripts/{import,export}-service.js`.

> **Status: PENDING** — the consumable UI is done in-app, but neither the
> app-side nor the module-side round-trip is wired. Author both when we pick the
> items track back up (after the remaining item types are built).

---

## Consumable  *(app UI complete 2026-06-07)*

### Type + second axis
| App column | Foundry path | Values |
|---|---|---|
| `items.type_subtype` | `system.type.value` | potion · scroll · poison · ammo · wand · rod · food · trinket · wondrous |
| `items.type_inner_subtype` *(new — migration `20260607-1300`)* | `system.type.subtype` | **ammo:** arrow · crossbowBolt · firearmBullet · slingBullet · energyCell · blowgunNeedle · **poison:** contact · ingested · inhaled · injury |

The second-axis values are **admin-managed** in two new tables,
`ammunition_types` + `poison_types`, whose `identifier`s are exactly the Foundry
`CONFIG.consumableTypes.<value>.subtypes` keys above — so the conversion is a
pass-through of the identifier.

### Ammunition damage  *(consumable, type = ammo)*
- `system.damage.base` — a DamagePart `{ number, denomination, bonus, types[], custom{enabled,formula} }`.
- `system.damage.replace` — bool ("Replace Weapon Damage").
- **App:** stored in `items.damage` as `{ base: <DamagePart>, replace: <bool> }`.
  (NB: weapons also use `items.damage` but with a different shape — branch on `item_type`.)

### Properties → `system.properties` (slug array, Foundry-standard)
The app surfaces a per-subtype subset, but the stored slugs are standard:
- **ammo:** `mgc`, `ada`, `ret`, `sil`
- **scroll:** `mgc`, `concentration`, `ritual`, `somatic`, `vocal`
- **other consumables:** `mgc`
- (App filters the editor grid via `item_properties.valid_types`, extended with
  `ammo` / `scroll` pseudo-types in migrations `20260607-1400` / `-1500` — that's
  **editor-only**; the slugs themselves are vanilla dnd5e.)

### Magical
Now the **`mgc` property** (no separate field). The app keeps the legacy
`items.magical` boolean in sync by deriving it from `mgc` on save.

### Chat description
`items.chat_description` *(new — migration `20260607-1200`)* → `system.description.chat`.
The app export already emits it; standard Foundry field, no special conversion.

---

## TODO checklist

**App-side (`compendium-editors`):**
- [ ] `_itemExport.ts buildItemBundle`: emit `system.type.value` ← `type_subtype`,
      `system.type.subtype` ← `type_inner_subtype`, `system.damage` ← `damage`.
- [ ] `itemImport.ts`: capture `system.type.subtype` → `type_inner_subtype`,
      `system.damage` → `damage`. (`type_subtype` already captured.)

**Module-side (`foundry-module`):**
- [ ] import-service: map the semantic fields above → native item shapes (mostly pass-through).
- [ ] export-service: map native Foundry item → the semantic fields above.

## DB migrations  *(LOCAL-only — remote pending owner go-ahead)*
`20260607-1200_items_chat_description` · `20260607-1300_consumable_taxonomies`
· `20260607-1400_ammo_item_properties` · `20260607-1500_scroll_item_properties`

---

## Next types (append as finished)
container · weapon · equipment · tool · loot
