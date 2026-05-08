# Compendium — Feats & Items

Feats and item records share the same editor scaffolding as features in [compendium-classes.md](compendium-classes.md): description, details, activities, effects.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/feats` | [FeatsEditor.tsx](../../src/pages/compendium/FeatsEditor.tsx) | Feat browser + editor |
| `/compendium/items` | [ItemsEditor.tsx](../../src/pages/compendium/ItemsEditor.tsx) | Item browser + editor |

(Both are admin-only; players see feats indirectly through advancement choices and items through inventory.)

## Data layer (D1)

| Table | Key columns |
|---|---|
| `feats` | `id`, `name`, `identifier`, `feat_type`, `source_type`, `requirements`, `repeatable`, `uses_max`, `uses_spent`, `description`, `image_url`, `activities` (JSON), `effects` (JSON), `source_id`, `page`, `tags` (JSON) |
| `items` | `id`, `name`, `identifier`, `item_type`, `rarity`, `quantity`, `weight`, `price_value`, `price_denomination`, `attunement` (BOOL), `equipped`, `identified`, `magical`, `description`, `image_url`, `activities` (JSON), `effects` (JSON), `source_id`, `page`, `tags` (JSON) |

Schema: [../database/structure/](../database/structure/), [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md).

## Feats

### Feat types
Feats fall into a few `feat_type` values:
- **General** — earned at ASI levels via the AbilityScoreImprovement advancement's feat branch
- **Origin** — granted by background or starting feat
- **Fighting style** — fighting-style feats picked from class advancement choices
- **Class** — class-feature-style feats granted directly by class progression

`source_type` records where the feat originated: `homebrew`, `phb`, `xge`, etc.

### Repeatable feats
The `repeatable` boolean lets a feat be taken multiple times. Repeatable feats with stacking effects need to be authored carefully — the activity / effect side typically has a level scaling formula that uses the repeat count.

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
