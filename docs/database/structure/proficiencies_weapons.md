# Table Structure: `weapons`

The mechanical templates for weapon proficiencies and base items.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT | `name` | |
| `identifier` | TEXT UNIQUE NOT NULL | `identifier` | Slug (e.g., `longsword`). |
| `category_id` | TEXT (FK) | `categoryId` | Links to `weapon_categories.id`. |
| `weapon_type` | TEXT | `weaponType` | Melee or Ranged. |
| `ability_id` | TEXT (FK) | `ability` | Links to `attributes.id`. |
| `foundry_alias` | TEXT | `foundryAlias` | 3-letter code (e.g., `lng`). |
| `description` | TEXT | `description` | Markdown content. |
| `property_ids` | JSON | `propertyIds` | Array of `weapon_properties.id`. |
| `source` | TEXT | `source` | |
| `page` | INTEGER | `page` | |
| `basic_rules` | BOOLEAN | `basicRules` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Migration Refinements

### 1. Complex Property Mapping
- **Refinement**: Weapon properties are stored as a JSON array of IDs. The migration script ensures these IDs exist in the `weapon_properties` table.

### 2. Multi-Key Normalization
- **Refinement**: Simultaneously resolves `category_id`, `ability_id`, and `property_ids` during the migration pass.

### 3. Foundry slug alignment (20260526-1700)

Migration `20260526-1700_items_completeness_and_proficiency_source.sql` renamed
the 11 standard 5e `weapon_properties.identifier` values to match dnd5e's
`CONFIG.DND5E.itemProperties` codes. The renames:

| Before | After (Foundry-aligned) |
|---|---|
| `finesse` | `fin` |
| `heavy` | `hvy` |
| `light` | `lgt` |
| `loading` | `lod` |
| `two-handed` | `two` |
| `versatile` | `ver` |
| `thrown` | `thr` |
| `reach` | `rch` |
| `ammunition` | `amm` |
| `special` | `spc` |
| `silvered-weapons` | `sil` |

The `name` column stays human-readable ("Finesse", "Heavy", etc.). Only the
`identifier` slug changed — this is what the Foundry import/export pipeline
matches against and what gets written to `items.properties`.

**Safety note**: `weapons.property_ids` stores the FK row IDs, NOT the
identifier slugs. The rename is safe — no FK references depend on the old slug
values.

4 app-custom slugs (`lance`, `net`, `range`, `improvised-weapons`) were NOT
renamed — they stay as Dauligor extensions. See
[property-mapping.md](../../../module/dauligor-pairing/docs/property-mapping.md)
for the full app↔Foundry slug contract.

## Related docs

- [character_proficiencies.md](character_proficiencies.md) — how a character's
  weapon proficiency rows reference this table via `entity_id`
- [proficiency-resolution.md](../../architecture/proficiency-resolution.md) — the
  resolver that walks `character_proficiencies` → `weapons` for items
- [property-mapping.md](../../../module/dauligor-pairing/docs/property-mapping.md)
  — the app↔Foundry property slug vocabulary
