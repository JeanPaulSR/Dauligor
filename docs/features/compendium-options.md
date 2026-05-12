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
| `unique_option_items` | **Full feat-shape feature documents** belonging to groups. `group_id` FK + the standard feat columns (`feature_type`, `subtype`, `image_url`, `uses_max/spent/recovery`, `properties`, `activities`, `effects`, `advancements`, `tags`, `quantity_column_id`, `scaling_column_id`) + option-specific extras (`level_prerequisite`, `level_prereq_is_total`, `string_prerequisite`, `is_repeatable`, `class_ids`, `requirements_tree`). Migrations: `20260509-1356_unique_option_items_feat_shape.sql` (feat-shape body), `20260510-2152_requirements_tree.sql` (compound requirements + `level_prereq_is_total` total-vs-class-level flag — also dropped `requires_option_ids` and the redundant `requirements` text column). |

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
| **Details** | Source, Page, **Modular Option Group** (read-only display of the parent group's name; drives dnd5e v5.x `system.type.subtype` on export so authors don't have to remember to fill in `featureType`), Subtype, Level Prereq + **Total character level** checkbox, String Prereq, **Compound Requirements** (the full requirements tree — see below), Repeatable |
| **Activities** | `<ActivityEditor />` — same component class features use |
| **Effects** | `<ActiveEffectEditor />` — see [active-effects.md](active-effects.md) for the autocomplete + status picker + categories wiring |
| **Advancement** | `<AdvancementManager />` standalone-mode — option items can have their own advancements (rare; used by Invocations granting spells via `ItemGrant`) |

Source: [src/pages/compendium/UniqueOptionGroupEditor.tsx](../../src/pages/compendium/UniqueOptionGroupEditor.tsx).

### Compound Requirements tree

Migration `20260510-2152_requirements_tree.sql` replaced the flat `requires_option_ids` array and the free-text `requirements` column with a single JSON tree column (`requirements_tree`) capturing arbitrary And/Or/Xor compositions of typed leaves. This unblocks compound prereqs like *Ultimate Pact Weapon (UA) = Pact of the Blade **AND** Superior Pact Weapon*.

**Leaf vocabulary** (see [`src/lib/requirements.ts`](../../src/lib/requirements.ts) for the full type definition):

| Leaf type | Payload | Purpose |
|---|---|---|
| `levelInClass` | `classId`, `minLevel` | "Warlock 5+" |
| `class` | `classId` | "must have any levels in Warlock" |
| `subclass` | `subclassId` | "Battle Master" |
| `optionItem` | `itemId`, optional `groupId` | "must have picked Pact of the Blade" — most common leaf |
| `feature` | `featureId` | "must already have feature X" |
| `spell` | `spellId` | "knows Cure Wounds" |
| `spellRule` | `spellRuleId` | "knows any spell matching this Spell Rule" |
| `abilityScore` | `ability`, `min` | "STR 13 or higher" |
| `proficiency` | `category` (weapon/armor/tool/skill/language), `identifier` | "Weapon proficiency: longsword". The `identifier` is the Foundry slug picked from the matching campaign pool (weapons + categories / armor + categories / tools + categories / skills / languages + categories) via `<SingleSelectSearch>`; not free-text. |
| `level` | `minLevel`, `isTotal` | Character-level or total-level gate (option items also have a flat `level_prerequisite` column for the common case) |
| `string` | `value` | Free-text leaf for compound expressions where the requirement isn't machine-checkable (e.g. `"Member of the Crimson Order"` inside an `all` group with other typed leaves). Note: option items also keep a flat `string_prerequisite` column for the simple case — both surfaces coexist, see [list-row rendering](#list-row-summary-formats-the-tree) below. |

**Group nodes** combine children with `all` (AND), `any` (OR), or `one` (XOR — exactly one). Groups can nest.

**Editor**: [`<RequirementsEditor />`](../../src/components/compendium/RequirementsEditor.tsx) — a recursive card-with-children component matching the activity/effect group pattern. Used by `UniqueOptionGroupEditor` today; will be ported to the feats editor in a follow-up. Every entity leaf picker (class / subclass / `levelInClass` / feature / spell / spellRule / `optionItem`) uses the shared [`<SingleSelectSearch />`](../../src/components/ui/SingleSelectSearch.tsx) — a portal'd combobox with search-as-you-type — instead of a native `<select>`. With 50+ option groups and hundreds of option items in aggregate, the searchable single-pick is the only thing that scales.

The `optionItem` leaf renders as a **cascading group → item picker** so authors first narrow to the parent Modular Option Group (Eldritch Invocations, Battle Master Maneuvers, etc.) and then pick a specific option inside it. The leaf stores the item PK + an optional `groupId` convenience hint; on export both translate to the canonical source-ids the module recognises.

**Export**: The exporter walks the tree, remaps the `optionItem.itemId` PKs to canonical source-ids (so the module recognises them at import time), and renders the result into dnd5e's `system.requirements` free-text via `formatRequirementText()`. The structured tree is also forwarded to the module as `flags.dauligor-pairing.requirementsTree`; the legacy `requiresOptionIds` flat array is still forwarded for back-compat with old exports.

**Importer**: [`module/dauligor-pairing/scripts/requirements-walker.js`](../../module/dauligor-pairing/scripts/requirements-walker.js) is the module-side walker. Used by `runOptionGroupStep` to render each option row with its full requirement summary in the secondary line (e.g. "Pact of the Blade and Charisma 13+"), and to block selection only when at least one auto-evaluable leaf is unmet. V1 auto-evaluates `optionItem` (against picked sourceIds), `level` (vs class-level being imported or character total level), and `abilityScore` (vs the actor's ability score). Other leaf types — `class`, `subclass`, `feature`, `spell`, `spellRule`, `levelInClass`, `proficiency`, `string` — are rendered as advisory text without blocking (the entity-id remap on those leaves hasn't been wired through export yet; once it is, the walker can extend its `evaluateLeaf` switch). Falls back to the legacy flat-array shape via `treeFromFlatRequiresOptionIds()` when an old bundle ships no tree.

**Drift-managed pair**: `src/lib/requirements.ts` ↔ `api/_lib/_requirements.ts` — same reason as the `_classExport.ts` pair, the Vercel function bundle can't import across the `api/`/`src/` boundary. Keep them in sync.

### Total character level vs class level

Most option items gate on level — typically "available at level 5" of the importing class. The flat `level_prerequisite` column carries this number; `level_prereq_is_total` (boolean, default 0) flips the interpretation:
- `0` (default) — the gate checks the *importing class's* level (Battle Master Maneuvers' "level 5" = Fighter 5).
- `1` — the gate checks *total character level* (rare; some feat-shape options need character-level 4 regardless of class).

Surfaced in the editor as a "Total character level (default: class level)" checkbox under the Level Prerequisite input.

### List-row summary formats the tree
{#list-row-summary-formats-the-tree}

The Individual Options list under the group page renders a one-line prereq summary per row. The flat-level + flat-string fields render first, then the tree is rendered to readable text via `formatRequirementText(tree, lookup)`:

- `{ abilityScore: dex 13 }` → "Dexterity 13 or higher"
- `{ any: [proficiency simple-weapons, proficiency martial-weapons] }` → "Simple or Martial Weapons"
- Flat level 6 + `{ optionItem: classical-swordplay }` → "Level 6+ · Classical Swordplay"

The `lookup` is memoized at the editor level from `classes` / `subclasses` / `spellRules` / `allOptionGroups`, so entity names (not raw PKs) appear in the rendered text.

### In-session state sync

`allOptionGroups` — the list backing the `optionItem` leaf picker — is fetched once on mount. Save and delete handlers in `UniqueOptionGroupEditor` mirror their item change into this state alongside the per-group `items` array, so adding a new option in the current group makes it immediately available to a sibling option's requirement picker without a page reload. Cross-group changes from other tabs still need a reload (intentional — keeps the page query-cheap; see [d1.ts query cache](../platform/d1-architecture.md) for the TTL).

### Linked-feature concept (removed)
A `feature_id` FK on `unique_option_items` once let an option point at a feature row for content. **Dropped** in `20260509-1356_unique_option_items_feat_shape.sql` — option items now carry their own mechanical content end-to-end (activities / effects / advancements / uses), so there's nothing to delegate. If a class feature wants to grant shared option content, it does so via the option group itself in an `ItemChoice` / `ItemGrant` advancement, not by linking a single feature row.

### `requires_option_ids` + `requirements` text (removed)
The flat `requires_option_ids` array (sibling-option AND gate) and the redundant free-text `requirements` column were both **dropped** in `20260510-2152_requirements_tree.sql` and folded into the new `requirements_tree` JSON column (see Compound Requirements tree above). Existing rows' `requires_option_ids` arrays were auto-backfilled into the tree as a top-level `all` group of `optionItem` leaves; the `requirements` text was promoted onto `string_prerequisite` where that column was empty.

### Class-restriction multi-select
Group Details uses the shared `<EntityPicker />` for class restrictions — chip display for selected classes + search input + scrollable filtered checkbox list, identical to the picker used for damage types, status conditions, and the other multi-select surfaces in the compendium. `EntityPicker` was originally extracted from this exact widget; the call site was migrated over after the picker had matured. Empty list = group visible to all classes in the advancement editor.

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

### Feature-attached `ItemChoice` (Pact Boon path)

A class feature can itself carry an `ItemChoice` advancement that references an option group — Pact Boon is the canonical example: granted to a warlock at level 3, the feature's own `system.advancement` contains an `ItemChoice` whose `configuration.optionGroupId` points at the Pact Boons option group. The export pipeline's `collectReferencedOptionGroupIds` includes feature records, so the group ends up in the class document's `flags.dauligor-pairing.optionGroups` catalog. The runtime contribution to `selectionCountsByLevel` from feature-attached advancements is *not* exported (that map is built only from class+subclass records), so the catalog entry's `selectionCountsByLevel` ends up empty.

To bridge this, [`module/dauligor-pairing/scripts/class-import-service.js`](../../module/dauligor-pairing/scripts/class-import-service.js)'s `choiceAdvancements` tagger annotates every feature/option-item-attached advancement with `_ownerSourceId` + `_ownerLevel` (the class level at which the parent feature is granted). The ItemChoice filter passes any advancement with either an inline `pool` *or* an `optionGroupId` reference. [`module/dauligor-pairing/scripts/importer-app.js`](../../module/dauligor-pairing/scripts/importer-app.js) then runs a dedicated feature-attached ItemChoice loop in `runImportSequence` *after* the class-root `optionGroups` loop but *before* the Trait choice loop. It:

1. Filters `workflow.choiceAdvancements` to `type === "ItemChoice"` entries with `_ownerSourceId` set + `configuration.optionGroupId` populated.
2. Skips when the owning feature isn't in `grantedFeatureSourceIds` (i.e., not being granted at this import) or when `_ownerLevel <= existingClassLevelForSkip` (already granted on a prior level-up).
3. Synthesises a feature-attached group object (cloned from the catalog entry but with `maxSelections` derived from the advancement's own `configuration.choices`).
4. Calls `runOptionGroupStep` with the synthesised group so the picker UI, prerequisite-walker, and selection state all behave identically to a class-root option-group prompt.

The class-root option-groups loop above this one short-circuits feature-attached entries naturally: a feature-attributed catalog entry has empty `selectionCountsByLevel`, so its derived `maxSelections` is 0 and the loop's `if (!group?.options?.length || !group?.maxSelections) continue` skip clears it. The two loops cover orthogonal sets.

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
