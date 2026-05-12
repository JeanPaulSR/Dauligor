# Compendium — Feats & Items

Feats and item records share the same editor scaffolding as features in [compendium-classes.md](compendium-classes.md): description, details, activities, effects.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/feats` | [FeatList.tsx](../../src/pages/compendium/FeatList.tsx) | Public feat browser (filter / search / detail panel) |
| `/compendium/feats/manage` | [FeatsEditor.tsx](../../src/pages/compendium/FeatsEditor.tsx) | Admin authoring manager |
| `/compendium/items` | [ItemsEditor.tsx](../../src/pages/compendium/ItemsEditor.tsx) | Item browser + editor (still admin-only) |

Feats now follow the same public-list / admin-manager split spells use: anyone can browse and read feat detail pages at `/compendium/feats`; admins see a "Feat Manager" button in the page header that links to the master-detail authoring surface at `/compendium/feats/manage`. The sidebar lists "Feats" alongside "Spells" for all users (no longer admin-gated). Items still travel through the legacy admin-only single-page editor — that overhaul is a future task.

## Data layer (D1)

| Table | Key columns |
|---|---|
| `feats` | `id`, `name`, `identifier`, `feat_type` (= `system.type.value`), `feat_subtype` (= `system.type.subtype`), `source_type`, `requirements`, `requirements_tree` (JSON tree), `repeatable`, `uses_max`, `uses_spent`, `uses_recovery` (JSON array), `description`, `image_url`, `activities` (JSON), `effects` (JSON), `source_id`, `page`, `tags` (JSON) |
| `items` | `id`, `name`, `identifier`, `item_type`, `rarity`, `quantity`, `weight`, `price_value`, `price_denomination`, `attunement` (BOOL), `equipped`, `identified`, `magical`, `description`, `image_url`, `activities` (JSON), `effects` (JSON), `source_id`, `page`, `tags` (JSON) |

Schema: [../database/structure/](../database/structure/), [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md).

## Feats

### Feat types — `feat_type` + `feat_subtype`

Mirrors dnd5e 5.x's `system.type.{value, subtype}` pair on the embedded feat item (cross-checked against `E:/DnD/Professional/Foundry-JSON/features/item-feature.json`, system v5.3.1):

- **`feat_type`** = `system.type.value` — the broad document category. Six canonical values: `feat`, `class`, `subclass`, `race`, `background`, `monster`.
- **`feat_subtype`** = `system.type.subtype` — the granular tag. The editor cascades the subtype dropdown on the feat_type value:
  - `feat` → enumerated: `general` / `origin` / `fightingStyle` / `epicBoon` (the canonical 5e PHB / Tasha's feat slots)
  - `class` / `subclass` / `race` / `background` / `monster` → free-text identifier (e.g. `wizard`, `tiefling`, `dragon`)

The split landed via migration `20260511-1830_feat_subtype_and_uses_recovery.sql`, which also normalized legacy rows: the four feat-subtype slugs got promoted into `feat_subtype` with `feat_type` rewritten to `feat`, and `classFeature` rewrote to `class`.

`source_type` is a separate enum (`feat` / `classFeature` / `subclassFeature`) that records which Foundry document the export pipeline should mint — most go to a `feat`-typed Item; class/subclass-feature variants get embedded onto a class instead.

### Repeatable feats
The `repeatable` boolean lets a feat be taken multiple times. Repeatable feats with stacking effects need to be authored carefully — the activity / effect side typically has a level scaling formula that uses the repeat count.

### Uses + recovery rules

Item-level `uses` mirrors dnd5e's `system.uses` shape:
- **`uses_max`** — formula or number (`@prof`, `3`, etc.)
- **`uses_spent`** — integer counter (runtime state)
- **`uses_recovery`** — JSON array of `{ period, type, formula }` rules. Each rule lands at `system.uses.recovery[<idx>]` on the Foundry-side feat item. Period catalog matches the activity-level recovery (`lr` / `sr` / `day` / `dawn` / `dusk` / `turn` / `turnStart` / `turnEnd` / `round` / `recharge` / `charges`); type catalog is `recoverAll` / `formula` / `loseAll`. The editor reuses the same row layout `ConsumptionTabEditor` uses for per-activity recovery so authors don't have to learn a second UI.

Empty array = the item's uses persist until manually reset (matches Foundry's behavior when `recovery[]` is empty).

### Prerequisites — structured tree + free-text fallback

Feats author prereqs through two parallel surfaces, the same pair the unique-option editor uses:

- **Free-text `requirements`** (legacy column) — narrative gates that don't fit the tree leaves (e.g. "DM approval", "Member of the Crimson Order"). Surfaces verbatim on the feat card as dnd5e's `system.requirements`. Not machine-checked.
- **Structured `requirements_tree`** (JSON column added by `20260510-2152_requirements_tree.sql`) — authored via the shared [`<RequirementsEditor />`](../../src/components/compendium/RequirementsEditor.tsx). Same leaf vocabulary as option items: `level` / `levelInClass` / `class` / `subclass` / `optionItem` / `feature` / `spell` / `spellRule` / `abilityScore` / `proficiency` / `string`. Composed with And/Or/Xor groups. Rendered live as a readable preview underneath the editor.

A lock icon appears on the feat manager's list rows whenever either surface is populated, so admins can tell at a glance which feats carry gates. See [compendium-options.md](compendium-options.md#compound-requirements-tree) for the leaf vocabulary and how the export remaps tree references to canonical source-ids.

### Manager layout
[`FeatsEditor.tsx`](../../src/pages/compendium/FeatsEditor.tsx) is a master-detail manager identical in shape to [`SpellsEditor.tsx`](../../src/pages/compendium/SpellsEditor.tsx)'s manual editor: a virtualized + searchable list on the left, a sticky-header detail pane with Save/Reset/Delete on the right, compact 126px icon at the top of the form. Loads the RequirementsEditor's lookup pools (classes / subclasses / spell rules / every Modular Option Group's items / proficiencies) in parallel with the feats list on mount.

### Public list layout
[`FeatList.tsx`](../../src/pages/compendium/FeatList.tsx) is the public-facing browse page at `/compendium/feats`. Same shape as [`SpellList.tsx`](../../src/pages/compendium/SpellList.tsx): a filter bar at top, a master-detail grid below with the virtualized feat list on the left and a `<FeatDetailPanel />` on the right. Filter facets are derived once at load time via [`lib/featFilters.ts`](../../src/lib/featFilters.ts) (`deriveFeatPropertyFlags`) — three sections:

- **Sources** — multi-select of book / source abbreviations
- **Feat Type** — six chips for the canonical `system.type.value` set (`feat` / `class` / `subclass` / `race` / `background` / `monster`)
- **Properties** — five boolean chips: Repeatable / Has Uses / Has Activities / Has Effects / Has Prereqs

[`FeatDetailPanel.tsx`](../../src/components/compendium/FeatDetailPanel.tsx) is a self-contained read-only preview pane (loads its own data on `featId` prop change, caches per-feat). Renders the BBCode description, the prerequisite gate (free-text + tree-formatted), and a "Recovery" summary line whenever `uses_recovery[]` is non-empty. Activity / Active-Effect counts surface as a footer summary; the structured editor surface for those lives in the admin manager.

### Activities and effects
Same shape as features. See [compendium-classes.md](compendium-classes.md) for the editor patterns.

### Use by character builder
The character builder pulls feat options when resolving an `AbilityScoreImprovement` advancement that the user chose to spend on a feat. The Dauligor ASI prompt (Foundry module) also queries the source feat catalog when resolving in Foundry.

## Items

### Item types
`item_type` covers: `weapon`, `armor`, `consumable`, `tool`, `container`, `equipment`, `loot`, `treasure`. The editor's tabs change based on type — weapons get damage / property fields, armor gets AC / dexterity-cap fields, consumables expose uses / recovery.

`equipped` and `attunement` are character-side state (when the item is owned), not authored on the catalog item.

### Activities and effects
Same scaffolding as feats and features. Magic items typically have effects like "+1 to weapon attacks" expressed as ActiveEffect changes.

### Magical / identified flags
- `magical` — reflects rules categorisation (anti-magic field interactions, etc.)
- `identified` — character-side; an unidentified magic item shows as "unidentified ____" until identified

## Tags

Both feats and items support tags via the `tags` JSON column. Tags are managed in [compendium-options.md](compendium-options.md).

## Image handling

Feat / item icons go to `images/feats/<id>/` or `images/items/<id>/` in R2. Compact upload component used in the icon slot.

## Common tasks

### Add a new feat
1. Create a row in `feats` via the editor.
2. Set `feat_type` and `source_type`.
3. Author the description (BBCode), activities (JSON), and effects.
4. Tag with the relevant feat group.

### Add a new magic item
1. Create a row in `items` via the editor.
2. Set `item_type`, `rarity`, `magical = true`.
3. Add the activity (e.g., damage roll on attack) and the effect (e.g., +1 to attack rolls).
4. Set `attunement` if the item requires attunement on the character side.

### Find unused feats
```sql
SELECT id, name FROM feats f
WHERE NOT EXISTS (SELECT 1 FROM character_selections cs WHERE cs.selected_ids LIKE '%' || f.id || '%')
ORDER BY name;
```

(That LIKE-on-JSON pattern is slow but fine for occasional admin queries. For heavy use, consider a dedicated junction.)

## Related docs

- [compendium-classes.md](compendium-classes.md) — same editor scaffolding for features
- [compendium-options.md](compendium-options.md) — tags
- [character-builder.md](character-builder.md) — how feats and items end up on a character
- [foundry-export.md](foundry-export.md) — feats/items in actor bundle export
- [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md)
