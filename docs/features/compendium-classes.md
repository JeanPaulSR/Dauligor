# Compendium — Classes, Subclasses, Features

The mechanical core of the app. Classes hold the progression schedule, subclasses extend it, and features are the per-level rules players actually use. Activities and active effects describe automation behaviour for FoundryVTT export.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/classes` | [ClassList.tsx](../../src/pages/compendium/ClassList.tsx) | Browse / filter / preview classes |
| `/compendium/classes/:id` | [ClassView.tsx](../../src/pages/compendium/ClassView.tsx) | Read-only class detail with table |
| `/compendium/classes/edit/:id` | [ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx) | Author class data |
| `/compendium/subclasses/edit/:id` | [SubclassEditor.tsx](../../src/pages/compendium/SubclassEditor.tsx) | Author subclass data |

Most editors also use shared components in `src/components/compendium/` — `AdvancementManager`, `ActivityEditor`, `ActiveEffectEditor`, `ModularChoiceView`, `FilterBar`, etc.

## Data layer (D1)

| Table | Role |
|---|---|
| `classes` | Class identity, hit die, proficiencies (JSON), advancements (JSON), spellcasting (JSON), images |
| `subclasses` | Subclass with FK to `classes`; spellcasting and advancements (JSON) |
| `features` | Per-level feature with `parent_id` + `parent_type` (`class` or `subclass`) |
| `scaling_columns` | Class scaling tables (cantrip damage, sneak attack dice, ...) |
| `unique_option_groups` / `unique_option_items` | Modular choices (Metamagic, Invocations, Maneuvers, ...) |
| `spellcasting_progressions` | Standard / pact / known progression tables |
| `multiclass_master_chart` | Standard multiclass slot table |

Full schema: [../database/structure/classes.md](../database/structure/classes.md) and [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md).

## Filtering (`ClassList`)

Three-state filter on tags: `0` (ignore), `1` (include), `2` (exclude). Boolean operators: `AND`, `OR`, `XOR`. Client-side, with `useMemo` over the fetched class list.

The filter UI is built on the shared [FilterBar](../../src/components/compendium/FilterBar.tsx) shell, also used by `SpellList`. Custom sections (sources, levels, schools, tags) plug into the same modal.

## Class editor (`ClassEditor`)

Tabs:
- **Description** — `description`, `lore`, `preview` (BBCode via `MarkdownEditor`)
- **Details** — name, source, hit die, primary ability, subclass title, subclass feature levels, multiclass requirements
- **Proficiencies** — saving throws, skills, tools, weapons, armour, languages
- **Multiclass Proficiencies** — separate state, only used when this class is taken as a multiclass
- **Spellcasting** — type, formula, ability, prep mode (when enabled). The "Spellcasting" toggle deletes the field entirely on save when off
- **Advancements** — root advancement timeline (HP, ItemChoice, ItemGrant, AbilityScoreImprovement, Subclass, Trait, ScaleValue, Size)
- **Features** — subordinate feature list (per-level rules)
- **Activities / Effects** — subordinate to features (see below)

### Initialize Base Advancements

A "Initialize Base Advancements" button regenerates the standard rows (HP, ItemChoice for starting equipment, Subclass marker, ASI levels) from the editor's other fields. Authors don't need to hand-create these. See [src/lib/classProgression.ts](../../src/lib/classProgression.ts) for the canonical builder.

The shared progression builder is also used by `classExport.ts` for export and `CharacterBuilder.tsx` for builder consumption — one source of truth.

### Save flow

1. Save normalises advancement state via `src/lib/advancementState.ts` (canonical shape, no legacy fields).
2. Mirrors editor fields (uses, usage, properties) into compatibility fields used elsewhere.
3. Writes the class row, then upserts feature rows in batch.
4. Calls `bumpFoundationUpdate()` indirectly (via the persistent-table mutation path).

## Subclass editor (`SubclassEditor`)

Mirrors the class editor for subclass-specific fields:
- Spellcasting (independent of parent class — for half-casters and martial casters)
- Advancements (subclass-specific custom advancements; the primary feature track is locked to the parent class's `subclass_feature_levels`)
- Features

Subclass features always grant at their authored levels once the subclass is selected, just like main-class features. Custom advancements are allowed at non-subclass levels.

## Feature editor (modal in ClassEditor / SubclassEditor)

The feature editor follows Foundry's item-window structure (Description / Details / Activities / Effects / Advancement) with Dauligor-specific extensions.

Tabs:
- **Description** — BBCode body
- **Details** — source, classification, identifier, requirements, prerequisites, uses + recovery, properties, subclass-choice toggle
- **Activities** — see [Activity editor](#activity-editor)
- **Effects** — Active Effect list (see [Active Effect editor](#active-effect-editor))
- **Advancement** — feature-owned advancement rows

Save mirrors Foundry-style fields back into compatibility fields used by other consumers.

## Activity editor

Each feature can have multiple **activities** (attack, save, check, heal, damage, utility, spell, enchant, forward, summon, transform, cast). The activity editor follows Foundry's per-type form layout with parity-checked option lists.

Stored as JSON in `features.activities`. See [foundry-export.md](foundry-export.md) for the semantic contract that exports translate into Foundry-native activities.

Important parity details (already applied):
- **Recovery period keys** match Foundry: `lr`, `sr`, `day`, `dawn`, `dusk`, `turn`, `turnStart`, `turnEnd`, `round`, `recharge`, `charges`.
- **Consumption target types** match Foundry: `activityUses`, `itemUses`, `material`, `hitDice`, `spellSlots`, `attribute`.
- **Damage types**, **save abilities**, and **DC calculation options** are toggle-button multi-selects matching Foundry's option lists.

Source: [src/components/compendium/ActivityEditor.tsx](../../src/components/compendium/ActivityEditor.tsx).

## Active Effect editor

Active effects modify the actor when the feature is on the sheet. The editor mirrors Foundry's `ActiveEffectConfig`:

- **List view** — passive effect list with `actor` / `suspended` badges
- **Details tab** — icon tint, description, suspended toggle, apply-to-actor toggle, icon path
- **Duration tab** — seconds, start time, combat (rounds, turns), start (round, turn)
- **Changes tab** — key + mode + value + priority rows

Effect modes (Foundry-native): 0=Custom, 1=Multiply, 2=Add, 3=Downgrade, 4=Upgrade, 5=Override. Priority defaults follow `mode * 10`.

Stored as JSON in `features.effects`. Source: [src/components/compendium/ActiveEffectEditor.tsx](../../src/components/compendium/ActiveEffectEditor.tsx).

## Class view (`ClassView`)

Read-only display:
- **Slots table** — generated when `spellcasting` is configured.
- **Scaling columns** — joins `scaling_columns` where `parent_id` matches.
- **Features** — queries `features` where `parent_id` matches, sorted by `level`.
- **Subclass switcher** — overlays subclass features and scaling columns on the base class table.

## Editor ergonomics

- `Ctrl+S` / `Cmd+S` saves without clicking Save.
- `useUnsavedChangesWarning` blocks navigation away from a dirty editor.
- The shared `MarkdownEditor` keeps height across mode toggles.

## Known issues / TODOs

### Cascade-delete prompt missing on class / subclass deletion
**Status:** open · **Priority:** medium

Today, deleting a class or subclass document in the editor only removes the parent document itself. Its children — features (`features.parent_id`), scaling columns (`scaling_columns.parent_id`), and (for classes) all of the class's subclasses — remain in the database with stale `parent_id` references. They become orphans.

Two real-world incidents from the migration era surfaced this:
- The original Sorcerer class doc was replaced; the new class was authored as a separate doc but the old children were never removed. The migration script flagged 8 orphaned subclasses, 49 orphaned features (6 base + 43 from those subclasses), and 2 orphaned scaling columns. They had to be cleaned up via a one-off Firestore script.
- A deleted homebrew Barbarian subclass (`PsliJfnVfKCdLj3xApcv`) left behind 3 features (Persevere / Prevail / Beacon of Hope).

**What the editor should do** when an admin deletes a class or subclass:
1. Run a reference scan (similar to the image manager's `scanForReferences`):
   - Features where `parent_id` matches and `parent_type` matches.
   - Scaling columns where `parent_id` matches and `parent_type` matches.
   - For classes: subclasses where `class_id` matches (and recursively their features + scaling columns).
2. Show a confirmation dialog listing the children that will be affected:
   - Option A: **"Delete all"** — delete the parent + all descendants in a batch.
   - Option B: **"Re-parent"** — pick a different class/subclass to inherit the children. Useful when replacing one class with another.
   - Option C: **"Cancel"** — abort.
3. The actual delete should run as a single batched D1 mutation (`batchQueryD1`) so partial failures don't leave a half-detached tree.

**Where to implement:** the delete handlers in [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx) and [src/pages/compendium/SubclassEditor.tsx](../../src/pages/compendium/SubclassEditor.tsx). The reference-scan helper could go in [src/lib/compendium.ts](../../src/lib/compendium.ts) so other editors (feats, items, spells) can reuse the pattern when they need cross-table cascade behaviour.

**Until this lands**, occasional Firestore-side cleanup remains necessary. The `scripts/cleanup-firestore-orphans.js` (during the migration window) and the editor itself (post-migration) cover cases where this pattern recurs.

## Exporting classes

The Foundry-VTT export pipeline turns class data into a semantic JSON bundle. See [foundry-export.md](foundry-export.md). Authoring decisions in this editor (advancements, activities, scaling references) translate into native Foundry advancements and activities.

## Related docs

- [compendium-spells.md](compendium-spells.md) — spell side of the compendium
- [compendium-feats-items.md](compendium-feats-items.md) — feats and items
- [compendium-scaling.md](compendium-scaling.md) — scaling columns and progression tables
- [compendium-options.md](compendium-options.md) — unique option groups and tags
- [character-builder.md](character-builder.md) — how this data drives builder progression
- [foundry-export.md](foundry-export.md) — semantic class export contract
- [../architecture/reference-syntax.md](../architecture/reference-syntax.md) — `@scale.<class>.<column>` and friends
- [../database/structure/classes.md](../database/structure/classes.md) — class table schema
