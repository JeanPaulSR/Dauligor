# Compendium — Unique Option Groups & Tags

Modular choice systems (Metamagic, Invocations, Maneuvers, Spell Schools, etc.) and the global tagging system that classifies everything.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/options` | [UniqueOptionGroupList.tsx](../../src/pages/compendium/UniqueOptionGroupList.tsx) | Group browser |
| `/compendium/options/edit/:id` | [UniqueOptionGroupEditor.tsx](../../src/pages/compendium/UniqueOptionGroupEditor.tsx) | Group + items editor |
| `/compendium/tags` | [TagManager.tsx](../../src/pages/compendium/TagManager.tsx) | Global tag catalog |
| `/compendium/tags/groups/:id` | [TagGroupEditor.tsx](../../src/pages/compendium/TagGroupEditor.tsx) | Tag-group editor |

## Unique option groups

A "group" is a pool of mutually-exclusive (or stacking, depending on `is_repeatable`) modular choices. Examples:
- Sorcerer Metamagic options
- Warlock Eldritch Invocations
- Battle Master Maneuvers
- Artificer Infusions
- Wizard Schools (when modelled as options)

### Tables

| Table | Role |
|---|---|
| `unique_option_groups` | Group identity, description, source, `class_ids` (JSON) restricting which classes see it |
| `unique_option_items` | Items belonging to groups; `group_id` FK; level/string prerequisites; `is_repeatable` |

Schema: [../database/structure/](../database/structure/), [../_archive/migration-details/phase-1-foundation.md](../_archive/migration-details/phase-1-foundation.md).

### Group-level class restriction
`class_ids` (JSON array on `unique_option_groups`) controls which classes see the entire group in the advancement editor's option group selector. Empty = visible to every class. Restricted = only the listed classes. **This is a group-level field**, not a per-item one.

### Class-level mapping
Classes opt into option groups via `classes.advancements` (an `ItemChoice` advancement with `optionGroupId`). The advancement determines:
- Which group is offered
- How many choices the player makes at each level (fixed or scaling)
- Whether the choice is optional

### Item editor
Items are managed in a Dialog modal (no inline editing) consistent with the ClassEditor feature modal pattern. Per-item:
- Name, description (BBCode)
- Icon
- Level prerequisite (number)
- String prerequisite (text)
- Class restrictions (junction)
- Repeatable flag
- Activities and effects (same shape as features)

Source: [src/pages/compendium/UniqueOptionGroupEditor.tsx](../../src/pages/compendium/UniqueOptionGroupEditor.tsx).

### Class-restriction multi-select
Group Details has a searchable multi-select for class restrictions: chip display for selected classes + search input + scrollable filtered list with gold checkboxes.

### Cross-class option discovery
`AdvancementManager.tsx` (the advancement editor) has an inline "Search all option groups" panel for cross-class discovery — for example, a Wizard subclass that grants access to Warlock invocations. The class restriction is then implicit on the parent group (the Warlock invocations group is `class_ids: [warlock]`, but the Wizard's advancement can still grant items from it).

## Tags

A general-purpose tagging system used across:
- Classes (`classes.tag_ids`)
- Spells (`spells.tags` and `spell_summaries.tagIds`)
- Feats (`feats.tags`)
- Items (`items.tags`)
- Lore articles (`lore_article_tags` junction)

### Tables

| Table | Role |
|---|---|
| `tag_groups` | Group identity, category, classifications (JSON: which entity types can use this group) |
| `tags` | Group membership, name, slug |

Schema: [../database/structure/tags.md](../database/structure/tags.md).

### Classifications
A tag group's `classifications` JSON limits which entity types can be tagged with its tags. Examples:
- `["class"]` — only classes can use these tags
- `["spell"]` — only spells
- `["class", "spell"]` — both
- `[]` — universal

The filtering UI in `ClassList`, `SpellList`, etc. only fetches tag groups that include the relevant classification.

### Tag UI
- **Author side**: editors expose a multi-select that filters to relevant tag groups. Selecting tags writes to the entity's `tags`/`tag_ids` JSON or the junction table.
- **Filter side**: list pages (`ClassList`, `SpellList`) build their tag filters from the tag groups visible to that entity type. Three-state filtering (`include`/`exclude`/`ignore`) supports `AND`/`OR`/`XOR` operators.

## Common tasks

### Add a new option group (e.g., a homebrew Maneuver set)
1. `/compendium/options` → create new group.
2. Set name, description, source, class restrictions.
3. Add items in the modal.
4. Open the relevant class editor, add an `ItemChoice` advancement at the right level pointing at this group.

### Add a new tag
1. `/compendium/tags` → pick or create a tag group.
2. Add the tag with name and slug.
3. The tag becomes available in editors that match the group's classifications.

### Tag scope a class as "Combat" + "Martial"
1. Make sure a tag group with classification `class` exists, say "Class Style".
2. Add tags `Combat` and `Martial` to it.
3. In the class editor, select both. They're stored in `classes.tag_ids`.
4. The class list filter will surface them under "Class Style".

### Find which classes use a specific option group
```sql
SELECT id, name FROM classes
WHERE advancements LIKE '%"optionGroupId":"<group-id>"%';
```

(JSON-LIKE is slow but tolerable for occasional admin queries.)

## Table mapping

The `D1_TABLE_MAP` in [src/lib/d1Tables.ts](../../src/lib/d1Tables.ts) maps:
- `uniqueOptionGroups` → `unique_option_groups`
- `uniqueOptionItems` → `unique_option_items`
- `tagGroups` → `tag_groups`
- `tags` → `tags`

## Related docs

- [compendium-classes.md](compendium-classes.md) — `ItemChoice` advancement that consumes option groups
- [compendium-spells.md](compendium-spells.md) — spell tags
- [compendium-feats-items.md](compendium-feats-items.md) — feat / item tags
- [character-builder.md](character-builder.md) — choice resolution at level-up
- [../database/structure/tags.md](../database/structure/tags.md)
