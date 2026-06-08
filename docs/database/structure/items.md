# Table Structure: `items`

The unified catalog of all non-spell, non-facility items — weapons, armor, tools,
consumables, containers, loot. Each row represents one entry in the item catalog
(template definition); per-character ownership lives in `character_inventory`.

Schema baseline migrations (chronological):
- `0004_items.sql` — initial table
- `20260524-1800` — Foundry-shape nested JSON columns (weight/price/damage/range,
  per-shape stat columns)
- `20260525-1800` — base-item polymorphic FK columns
- `20260526-1700` — items completeness + 3-state attunement + slug rename

## Layout Specs

### Identity + catalog
| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | Foundry-style 16-char alphanumeric or UUID |
| `name` | TEXT NOT NULL | Display name |
| `identifier` | TEXT NOT NULL UNIQUE | Slug (e.g. `flame-tongue-greatsword`) |
| `item_type` | TEXT NOT NULL | `weapon|equipment|consumable|tool|container|loot` |
| `type_subtype` | TEXT | Primary subtype (`potion`/`light`/`art`/etc.) — Foundry's `system.type.value` |
| `description` | TEXT | BBCode |
| `image_url` | TEXT | CDN URL or relative path |
| `source_id` | TEXT (FK) | → `sources.id`. ON DELETE SET NULL |
| `page` | TEXT | Page number(s) |
| `tags` | JSON | Tag-table FK array |
| `unidentified_description` | TEXT | Pre-identification copy. Optional |

### Physical
| Column | Type | Notes |
|---|---|---|
| `rarity` | TEXT | `none|common|uncommon|rare|veryRare|legendary|artifact` |
| `quantity` | INTEGER | Stack size on the catalog row (default 1) |
| `weight` | JSON | `{value: number, units: 'lb'|'kg'}` |
| `price` | JSON | `{value: number, denomination: 'cp'|'sp'|'ep'|'gp'|'pp'}` |
| `magical` | INTEGER (bool) | True for any non-`none` rarity or `mgc` property |
| `properties` | JSON | Slug array — Foundry-aligned post 20260526-1700 |

### Equippability (post 20260526-1700)
| Column | Type | Notes |
|---|---|---|
| `attunement` | TEXT | 3-state: `''` / `'required'` / `'optional'` |
| `equipped` | INTEGER (bool) | Default-equipped state |
| `identified` | INTEGER (bool) | Default-identified state |

> **Migration note**: pre-20260526-1700 `attunement` was INTEGER 0/1. The widening
> to TEXT preserves all prior data (`0` → `''`, `1` → `'required'`). Old code
> reading the column as a boolean still resolves truthy/falsy correctly because
> the empty string is falsy.

### Uses block (post 20260526-1700)
| Column | Type | Notes |
|---|---|---|
| `uses` | JSON | `{max: string, spent: number, recovery: RecoveryRule[], autoDestroy: boolean}` |

The legacy flat columns (`uses_max` / `uses_spent` / `uses_period` / `uses_recovery`)
that features still use were never added to items — items' uses always live in a
single JSON column. The `normalizeCompendiumData` function skips the legacy
decomposition when payload has `item_type` set.

### Weapon-specific (only set when `item_type = 'weapon'`)
| Column | Type | Notes |
|---|---|---|
| `base_weapon_id` | TEXT (FK) | → `weapons.id`. Polymorphic — only one of the three base_*_id is non-null |
| `base_item` | TEXT | Foundry slug (`greatsword`) — kept verbatim for re-resolution if FK fails |
| `damage` | JSON | Foundry's `system.damage` — `{base: {number, denomination, types, bonus}, ...}` |
| `range` | JSON | Foundry's `system.range` — `{value, long, reach, units}` |
| `magical_bonus` | INTEGER | Flat int added to attack + damage (e.g. 1 for Flame Tongue) |
| `mastery` | TEXT | 2024-only weapon mastery slug. Captured but UI-hidden (2014-rules base) |
| `ammunition` | JSON | Optional ammunition reference |
| `proficient` | INTEGER (bool) | Override flag — usually NULL (proficiency resolves dynamically) |

### Armor-specific (only set when `item_type = 'equipment'` AND subtype is light/medium/heavy/shield)
| Column | Type | Notes |
|---|---|---|
| `base_armor_id` | TEXT (FK) | → `armor.id` |
| `armor_value` | INTEGER | Base AC |
| `armor_dex` | INTEGER | Dex max — NULL = unlimited (light), 2 = medium, 0 = heavy |
| `armor_magical_bonus` | INTEGER | Flat int added to AC |
| `armor_type` | TEXT | Mirror of `type_subtype` for armor-shaped equipment |
| `strength` | INTEGER | Required STR (heavy armor) |

Stealth-disadvantage is stored as the `stealthDisadvantage` slug in `properties`,
not a separate column. The pre-20260526-1700 `stealth` boolean column was dropped.

### Tool-specific (only set when `item_type = 'tool'`)
| Column | Type | Notes |
|---|---|---|
| `base_tool_id` | TEXT (FK) | → `tools.id` |
| `tool_type` | TEXT | Mirror of `type_subtype` for tools (`art`/`game`/`music`) |
| `bonus` | TEXT | Check bonus formula (`+1`, `@prof`) |
| `ability_id` | TEXT (FK) | → `attributes.id`. Default ability for the tool's check |
| `chat_flavor` | TEXT | Pre-pended chat-card flavor line |

### Container-specific (only set when `item_type = 'container'`)
| Column | Type | Notes |
|---|---|---|
| `capacity` | JSON | dnd5e 5.x shape: `{count: int\|null, volume: {value, units: 'cubicFoot'\|'liter'}, weight: {value, units: 'lb'\|'kg'\|'tn'\|'Mg'}}`. `count` null = unlimited. (Weightless is the `weightlessContents` **property**, not a capacity flag.) |
| `currency` | JSON | 5-coin grid the container itself holds: `{cp, sp, ep, gp, pp}` |
| `container_id` | TEXT (FK) | → `items.id` of the **parent** container this item sits inside (Foundry's `system.container` back-pointer). Null for top-level / catalog items. |

> **Container contents are NOT on this table.** A catalog container's *recipe* of
> contents lives in its own **`container_contents`** table (migration
> `20260608-1200`): `{ container_id → items.id, item_id → items.id (or
> is_custom + custom_data), quantity, sort_order }` — references to catalog items
> with counts, no duplicate item rows. Per-character bag *instances* (independent
> copies with state) live in `character_inventory`, materialized by expanding the
> recipe. See the items native-conversion handoff for the Foundry round-trip.

### Activities + effects
| Column | Type | Notes |
|---|---|---|
| `activities` | JSON | Foundry activity definitions |
| `effects` | JSON | Active Effect documents |

Auto-parsed on read by `d1.ts`'s `jsonFields` allowlist.

### Timestamps
| Column | Type | Notes |
|---|---|---|
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP — write paths update manually |

## Indexes

- `idx_items_type` ON (`item_type`)
- `idx_items_rarity` ON (`rarity`)
- `idx_items_source` ON (`source_id`)

## camelCase aliases for the editor

`src/lib/compendium.ts` maps the following snake_case columns to camelCase for the
React editor (the form's `formData` uses camelCase, the DB row is snake_case):

| Column | camelCase alias |
|---|---|
| `image_url` | `imageUrl` |
| `item_type` | `itemType` |
| `magical_bonus` | `magicalBonus` |
| `base_item` | `baseItem` |
| `base_weapon_id` | `baseWeaponId` |
| `base_armor_id` | `baseArmorId` |
| `base_tool_id` | `baseToolId` |
| `armor_value` | `armorValue` |
| `armor_dex` | `armorDex` |
| `armor_magical_bonus` | `armorMagicalBonus` |
| `armor_type` | `armorType` |
| `tool_type` | `toolType` |
| `ability_id` | `abilityId` |
| `chat_flavor` | `chatFlavor` |
| `container_id` | `containerId` |
| `type_subtype` | `typeSubtype` |
| `unidentified_description` | `unidentifiedDescription` |

Other columns (`uses`, `capacity`, `currency`, `quantity`, `weight`, `price`,
`damage`, `range`, `attunement`, `equipped`, `identified`, `magical`, `properties`,
`mastery`, `ammunition`, `proficient`, `bonus`, `strength`, `description`, `name`,
`identifier`, `page`, `tags`, etc.) are already lowercase single tokens and don't
need renaming.

## Polymorphic base_*_id FKs

Exactly one of `base_weapon_id` / `base_armor_id` / `base_tool_id` is non-null per
row, driven by `item_type`. They point at the proficiency definition tables
(`weapons` / `armor` / `tools`) — those tables exist to hold the rules-level
definition (Greatsword's category, weapon_type, ability, properties) so the
catalog item can reference them instead of duplicating.

`base_item` (TEXT) preserves Foundry's `system.type.baseItem` slug verbatim. When
the FK fails to resolve at import time (proficiency definition doesn't exist),
the slug is still there so a future re-resolve can wire the FK once the
definition lands.

## Related docs

- [compendium-items.md](../../features/compendium-items.md) — feature guide
- [proficiency-resolution.md](../../architecture/proficiency-resolution.md) — how
  the polymorphic FK chain resolves to a `[Proficient]` badge
- [proficiencies_weapons.md](proficiencies_weapons.md) — the weapons proficiency
  table that `base_weapon_id` references
- [proficiencies_armor.md](proficiencies_armor.md) — same, for armor
- [proficiencies_tools.md](proficiencies_tools.md) — same, for tools
