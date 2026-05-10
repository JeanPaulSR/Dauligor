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
| `unique_option_items` | **Full feat-shape feature documents** belonging to groups. `group_id` FK + the standard feat columns (`feature_type`, `subtype`, `requirements`, `image_url`, `uses_max/spent/recovery`, `properties`, `activities`, `effects`, `advancements`, `tags`, `quantity_column_id`, `scaling_column_id`) + option-specific extras (`level_prerequisite`, `string_prerequisite`, `is_repeatable`, `class_ids`, `requires_option_ids`). Migrations `20260508-1951_unique_option_items_requires.sql` (Required Options chain) and `20260509-1356_unique_option_items_feat_shape.sql` (the rest). |

Schema: [../database/structure/](../database/structure/), [../_archive/migration-details/phase-1-foundation.md](../_archive/migration-details/phase-1-foundation.md).

### Group-level class restriction
`class_ids` (JSON array on `unique_option_groups`) controls which classes see the entire group in the advancement editor's option group selector. Empty = visible to every class. Restricted = only the listed classes. **This is a group-level field**, not a per-item one.

### Class-level mapping
Classes opt into option groups via `classes.advancements` (an `ItemChoice` advancement with `optionGroupId`). The advancement determines:
- Which group is offered
- How many choices the player makes at each level (fixed or scaling)
- Whether the choice is optional

### Item editor
Items are managed in a Dialog modal with a five-tab layout matching the ClassEditor feature modal: **Description / Details / Activities / Effects / Advancement**. Authoring a Battle Master Maneuver / Eldritch Invocation / Artificer Infusion feels identical to authoring a class feature.

| Tab | Fields |
|---|---|
| **Description** | Icon, Name, Markdown body |
| **Details** | Source, Page, `Feature Type` (free-form, e.g. `"Maneuver"`/`"EldritchInvocation"`/`"Infusion"`; matches dnd5e v5.x `system.type.subtype` per [actor-spell-flag-schema.md](../../module/dauligor-pairing/docs/actor-spell-flag-schema.md)), Subtype, Requirements, Level Prereq, **Required Options** (chained sibling prereqs), String Prereq, Repeatable |
| **Activities** | `<ActivityEditor />` — same component class features use |
| **Effects** | `<ActiveEffectEditor />` — same |
| **Advancement** | `<AdvancementManager />` standalone-mode — option items can have their own advancements (rare; used by Invocations granting spells via `ItemGrant`) |

The Required Options picker is gated by a master checkbox so the picker stays compact when no prereqs are set. Selected sibling option IDs render as chips on top, plus a searchable scrollable list below. The picker uses the shared [`<EntityPicker />`](../../src/components/ui/EntityPicker.tsx) component.

Source: [src/pages/compendium/UniqueOptionGroupEditor.tsx](../../src/pages/compendium/UniqueOptionGroupEditor.tsx).

### Linked-feature concept (removed)
A `feature_id` FK on `unique_option_items` once let an option point at a feature row for content. **Dropped** in `20260509-1356_unique_option_items_feat_shape.sql` — option items now carry their own mechanical content end-to-end (activities / effects / advancements / uses), so there's nothing to delegate. If a class feature wants to grant shared option content, it does so via the option group itself in an `ItemChoice` / `ItemGrant` advancement, not by linking a single feature row.

### Class-restriction multi-select
Group Details has a searchable multi-select for class restrictions: chip display for selected classes + search input + scrollable filtered list with gold checkboxes. (Currently inline; planned swap to `<EntityPicker />` is tracked as cleanup.)

### Cross-class option discovery
`AdvancementManager.tsx` (the advancement editor) has an inline "Search all option groups" panel for cross-class discovery — for example, a Wizard subclass that grants access to Warlock invocations. The class restriction is then implicit on the parent group (the Warlock invocations group is `class_ids: [warlock]`, but the Wizard's advancement can still grant items from it).

### Per-grant attachments on `ItemChoice` / `ItemGrant` advancements

When an `ItemChoice` or `ItemGrant` advancement uses `choiceType: "option-group"` to grant from a shared group, the advancement itself carries two extra fields that drive *per-grant* runtime behavior. The same option group can resolve differently depending on who's granting it:

- **`usesFeatureId`** — picks any feature in the parent class. At import the bridge wires every granted option's `consumption.targets[]` (type `itemUses`) to consume from this feature's `system.uses` pool. Example: Battle Master "Maneuvers Known" sets Uses Feature → Combat Superiority, so Trip Attack consumes from the Superiority Dice pool.
- **`optionScalingColumnId`** — picks any scaling column in the parent class. Translated at export to `optionScalingSourceId` / a resolved `@scale.<class>.<column>` formula. Drives the `@scale.linked` substitution in damage formulas (see below). The Reaver subclass picks Barbarian's `superiority-dice` column; Battle Master picks Fighter's; the same Trip Attack feature resolves correctly under both.

### `@scale.linked` placeholder

Authors writing damage / dice / consumption formulas inside option-item activities can use the literal `@scale.linked` token. At import the bridge resolves it from (in priority order):

1. The granting advancement's `optionScalingColumnId` (`@scale.<class>.<column>`)
2. The Uses Feature's own `flags.scaleFormula` (set when the feature has a `scaling_column_id` attached)
3. The option's own `flags.scaleFormula` (legacy fallback when nothing more specific is set)

This is what makes a single Trip Attack feature reusable across Battle Master and Reaver — its damage formula stays `@scale.linked + @mods.str.mod`, and the granter decides which class's scaling that resolves to.

### Subclass-attributed groups

Option groups referenced from a *subclass-root* advancement (Battle Master Maneuvers, Eldritch Knight pools, etc.) carry `subclassSourceId` in the bundle. The runtime suppresses the prompt for non-matching subclasses — picking Champion doesn't show Maneuvers; picking Battle Master does. Class-root and feature-owned groups are unaffected and use the existing `featureSourceId` / `grantedFeatureSourceIds` filter.

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
