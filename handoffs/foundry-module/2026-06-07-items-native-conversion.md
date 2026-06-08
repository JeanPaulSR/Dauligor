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

> **Status: PENDING** — the consumable + container UIs are done in-app, but
> neither the app-side nor the module-side round-trip is wired. Author both when
> we pick the items track back up (after the remaining item types are built).

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

## Container  *(app UI complete 2026-06-08)*

Containers are Foundry-special: **Details + Contents tabs only** — no
activities, effects, advancement, or scaling. **Zero new DB columns / no
migration** — `capacity`, `currency`, `container_id`, `attunement`, and
`properties` already exist, and `item_properties` already carries `mgc` +
`weightlessContents` with `container` in `valid_types`.

### Properties → `system.properties` (slug array)
- `mgc` — Magical
- `weightlessContents` — Weightless Contents (contents ignore encumbrance, e.g. Bag of Holding)

(`items.magical` boolean stays derived from `mgc` on save, as for every type.)

### Attunement → `system.attunement`
3-state string, surfaced in the editor only when `mgc` is set (Foundry shows the
field for magic items): `''` (not required) · `required` · `optional`. Stored raw
in `items.attunement`.

### Capacity → `system.capacity`  *(dnd5e 5.x shape — CHANGED from 3.x)*
Stored in `items.capacity` (JSON) exactly as Foundry shapes it, so conversion is a
pass-through:
```json
{
  "count":  <int|null>,                              // max item count, null = unlimited
  "volume": { "value": <number>, "units": "cubicFoot" },
  "weight": { "value": <number>, "units": "lb" }
}
```
- volume `units` ∈ `CONFIG.DND5E.volumeUnits`: `cubicFoot` (default) · `liter`
- weight `units` ∈ `CONFIG.DND5E.weightUnits`: `lb` (default) · `kg` · `tn` · `Mg`
- ⚠️ OLD app shape was `{ type:'items'|'weight', value, units, weightlessContents }`
  (dnd5e 3.x). The new editor reads the 5.x shape and ignores the old keys
  (`weightlessContents` is now the *property*, not a capacity flag). Re-save any
  stale container row to normalize. **`export-service.js` still comments the 3.x
  shape — update it to 5.x.**

### Contents — TWO layers (template recipe vs character instances)
Foundry stores contents as independent child item documents (copies) whose
`system.container` = the container's item `_id`. We split that into two layers:

**1. Catalog/template recipe → `container_contents`** *(new — migration `20260608-1200`)*
A compendium container (e.g. Explorer's Pack) defines a *recipe* of contents —
references to catalog items + a quantity, no duplicate item rows:

| Column | Meaning |
|---|---|
| `container_id` → items.id | the container (FK, `ON DELETE CASCADE`) |
| `item_id` → items.id | catalog reference; `NULL` when custom |
| `is_custom` / `custom_data` | inline one-off (JSON snapshot) when not a catalog item |
| `quantity` | count |
| `sort_order` | display order |

The editor's **Contents tab authors these** (catalog picker + qty, plus a custom
one-off). It's references, not copies — catalog edits propagate to every pack.

**2. Character instances → `character_inventory`** (existing table)
A player's actual bag holds independent *copies* carrying instance state
(equipped, attuned, spent uses, identified, renamed). They are MATERIALIZED,
never referenced live — so removing an item from one character's bag never
touches the template or another character.

**Round-trip**
- **Export** a catalog container: expand each `container_contents` row → a child
  item document with `system.container = <container>`; reference rows copy the
  catalog item + set `quantity`; custom rows emit the `custom_data` snapshot.
- **Import** a catalog container with contents: collapse the children
  (`system.container` set) → `container_contents` rows; match against catalog by
  source identifier → reference row, else `is_custom` snapshot.
- **Import a character**: the actor's bag children become **`character_inventory`**
  instances (NOT `container_contents`); remap each child's container pointer from
  the Foundry `_id` to the new instance id, or it dangles. (`itemImport.ts` for a
  single item still stamps `items.container_id` with the raw Foundry `_id` —
  staging only; the character importer owns the remap.)

**Currency** the container itself holds → `system.currency` (5-coin grid
`{cp,sp,ep,gp,pp}`) ↔ `items.currency`. Already passed through on import.

---

## TODO checklist

**App-side (`compendium-editors`):**
- [ ] `_itemExport.ts buildItemBundle`: emit `system.type.value` ← `type_subtype`,
      `system.type.subtype` ← `type_inner_subtype`, `system.damage` ← `damage`,
      and for containers `system.capacity` ← `capacity`, `system.currency` ←
      `currency`, `system.container` ← `container_id`.
- [ ] `itemImport.ts`: capture `system.type.subtype` → `type_inner_subtype`,
      `system.damage` → `damage`. (`type_subtype`, `capacity`, `currency`,
      `container_id` already captured — see container `_id` remap note above.)
- [ ] `_itemExport.ts`: expand a catalog container's `container_contents` rows →
      child item docs (`system.container`); copy referenced catalog items + qty,
      emit custom snapshots.
- [ ] `itemImport.ts`: collapse a catalog container's child docs →
      `container_contents` rows (match catalog → reference, else `is_custom`).

**Module-side (`foundry-module`):**
- [ ] import-service: map the semantic fields above → native item shapes (mostly pass-through).
- [ ] export-service: map native Foundry item → the semantic fields above.
- [ ] export-service: container `capacity` comment/handling still says 3.x
      `{type,value}` — update to the 5.x `{count,volume,weight}` shape.

## DB migrations  *(LOCAL-only — remote pending owner go-ahead)*
`20260607-1200_items_chat_description` · `20260607-1300_consumable_taxonomies`
· `20260607-1400_ammo_item_properties` · `20260607-1500_scroll_item_properties`
· `20260608-1200_container_contents`

---

## Next types (append as finished)
weapon · equipment · tool · loot
