# Foundry Advancement Window Schematics

## Scope

This note captures the layout of the `dnd5e` advancement windows in local Foundry.

Reference install:

- Foundry system: `C:\Users\Jean\AppData\Local\FoundryVTT\Data\systems\dnd5e`
- Template folder: `C:\Users\Jean\AppData\Local\FoundryVTT\Data\systems\dnd5e\templates\advancement`

This is a layout reference for the website team.

It is not the advancement data contract.

For data structure and ownership rules, still use:

- `docs/advancement-construction-guide.md`
- `docs/class-import-and-advancement-guide.md`
- `notes-for-app-team/correcting-advancemnts.md`

## Shared Foundry Patterns

Across advancement windows, Foundry reuses a small set of layout ideas.

### 1. Authoring windows use stacked fieldsets

The editor windows are generally built as:

1. shared advancement details block
2. one or more type-specific fieldsets
3. tables or card lists for level rows / trait rows / item rows

Common shared controls come from:

- `templates/advancement/parts/advancement-controls.hbs`

That block contains:

- `Custom Title`
- `Custom Icon`
- `Class Restriction`
- `Level`
- `Hint`

These fields appear at the top of most advancement editor windows before the type-specific controls.

### 2. Player-facing flow windows use one content pane plus footer navigation

The level-up / advancement runtime windows use:

- title
- optional hint text
- one summary/content block
- footer buttons controlled by the advancement manager

Shared shell:

- `templates/advancement/advancement-flow.hbs`
- `templates/advancement/advancement-manager.hbs`

The manager footer is:

- `Previous Step`
- `Restart`
- `Next Step`
- `Complete`

depending on where the player is in the sequence.

### 3. Foundry uses repeating visual primitives

The windows repeatedly use:

- `fieldset` + `legend` sections
- `items-section card`
- `items-header header`
- `item-list`
- `pill-lg`
- `standard-form`
- `split-group`
- `table` style level grids

For the website, these should become reusable components, not one-off layouts.

## Item Sheet Advancement Tab

Template:

- `templates/items/advancement.hbs`

This is the tab shown on class/subclass/item sheets.

### Structure

The advancement tab is grouped by level.

Per level block:

1. level header row
2. `Value` column header
3. controls/status column
4. list of advancement rows

Each advancement row contains:

1. icon
2. title
3. optional summary
4. optional tags/icons
5. current value cell
6. controls:
   - edit
   - delete
   - context menu

### Schematic

```text
Advancement Tab
|
+-- Level N Card
    |
    +-- Header
    |   +-- "Level N"
    |   +-- "Value"
    |   +-- configure/status control
    |
    +-- Advancement Row
        +-- icon
        +-- title
        +-- summary
        +-- tags
        +-- value
        +-- row controls
```

### Website implication

If the website wants a Foundry-like progression editor preview, this tab is the main list view to mirror.

## Create Advancement Selection Dialog

Template:

- `templates/advancement/advancement-selection.hbs`

This is the chooser shown before creating a new advancement row.

### Structure

Single-column list of advancement types.

Per row:

1. icon
2. advancement type label
3. radio button
4. short hint/description under the row

Bottom:

- one `Create Advancement` button

### Schematic

```text
Choose Advancement Type
|
+-- Type Row
|   +-- icon
|   +-- label
|   +-- radio
|   +-- hint text
|
+-- Type Row
|
+-- Create button
```

### Website implication

This should be a lightweight modal, not a large multi-tab editor.

Pick type first, then open the type-specific editor.

## Shared Advancement Editor Shell

Templates:

- `templates/advancement/advancement-config.hbs`
- `templates/advancement/parts/advancement-controls.hbs`

### Shared top block

Every authoring window should expect the following shared fields first:

1. `Custom Title`
2. `Custom Icon`
3. `Class Restriction`
4. `Level`
5. `Hint`

### Schematic

```text
Advancement Editor
|
+-- Shared Details
|   +-- Custom Title
|   +-- Custom Icon
|   +-- Class Restriction
|   +-- Level
|   +-- Hint
|
+-- Type-Specific Sections
```

### Website implication

Do not bury these fields per type.

They should be in a consistent top section across all advancement editor windows.

## Hit Points Advancement

### Authoring window

Template:

- `templates/advancement/hit-points-config.hbs`

This editor is read-only for the derived numbers.

It shows:

1. `Hit Die`
2. `Hit Points at 1st Level`
3. `Average`

### Schematic

```text
Hit Points Editor
|
+-- Shared Details
|
+-- Hit Points Fieldset
    +-- Hit Die
    +-- Hit Points at 1st Level
    +-- Average
```

### Player-facing flow window

Template:

- `templates/advancement/hit-points-flow.hbs`

This is the level-up window players see.

Top area is a breakdown equation:

- previous HP
- plus roll or average or max
- plus ability modifier
- plus per-level bonus
- equals final HP

If manual rolling is enabled, a die button appears beside the equation.

Below that, for non-first-class levels, there is an `Options` fieldset with:

- `Take Average` checkbox

### Schematic

```text
Hit Points Flow
|
+-- Breakdown Row
|   +-- Previous
|   +-- +
|   +-- Roll / Average / Max
|   +-- + modifier
|   +-- + bonus
|   +-- = Final
|   +-- optional roll die button
|
+-- Options Fieldset
    +-- Take Average checkbox
```

### Website implication

If recreating this flow, the HP window should feel like a compact equation dialog, not a generic form.

## Trait Advancement

### Authoring window

Templates:

- `templates/advancement/trait-config-details.hbs`
- `templates/advancement/trait-config-guaranteed.hbs`
- `templates/advancement/trait-config-choices.hbs`
- `templates/advancement/trait-config-traits.hbs`

This editor is section-heavy.

It is effectively split into:

1. details/config
2. guaranteed traits
3. choice bundles
4. selectable trait list

#### Trait Details

Fields:

- `Mode`
- `Allow Replacements`

#### Guaranteed

Single selectable row representing fixed grants already attached to the advancement.

#### Choices

List of choice bundles.

Each row has:

- radio/select current bundle
- label
- remove button

Section header also has:

- add choice button

#### Traits section

The main selectable pool card.

Top split row includes:

- count input, if present
- trait type dropdown

Main body is a trait checklist/grid using the standard trait list partial.

### Schematic

```text
Trait Editor
|
+-- Shared Details
|
+-- Trait Details
|   +-- Mode
|   +-- Allow Replacements
|
+-- Guaranteed
|   +-- one fixed grant row
|
+-- Choices
|   +-- add choice button
|   +-- choice row
|   +-- choice row
|
+-- Traits Pool Card
    +-- count
    +-- trait type
    +-- checklist/grid of traits
```

### Player-facing flow window

Template:

- `templates/advancement/trait-flow.hbs`

Structure:

1. optional select box for adding a trait
2. card containing currently chosen traits
3. each chosen trait row can have delete control

### Schematic

```text
Trait Flow
|
+-- optional "Select Trait" fieldset
|
+-- Traits Card
    +-- header
    +-- chosen trait row
    +-- chosen trait row
```

### Website implication

Trait editing should be modeled as:

- define fixed grants
- define one or more choice bundles
- define the pool to choose from

not as one flattened “pick traits” widget.

## Item Choice Advancement

### Authoring window

Templates:

- `templates/advancement/item-choice-config-details.hbs`
- `templates/advancement/item-choice-config-levels.hbs`
- `templates/advancement/item-choice-config-items.hbs`

This editor is structured in three major parts.

#### Details fieldset

Fields:

- `Allow Drops`
- `Type`
- optional `Restriction Type`
- optional `Restriction Subtype`
- optional spell restrictions:
  - level
  - list

#### Levels table

Per level row:

- level label
- count
- replacement toggle

This is the section that makes Item Choice feel different from Trait.

Item Choice is level-table driven.

#### Items pool table

List of selectable items in the pool.

Per row:

- item link / name
- delete control

Bottom hint:

- drop area hint for dragging items in

### Schematic

```text
Item Choice Editor
|
+-- Shared Details
|
+-- Item Choice Details
|   +-- Allow Drops
|   +-- Type
|   +-- Restriction Type / Subtype
|   +-- optional Spell Restrictions
|
+-- Levels Table
|   +-- Level | Count | Replacement
|   +-- row
|   +-- row
|
+-- Items Pool Table
    +-- item row
    +-- item row
    +-- drop hint
```

### Player-facing flow window

Template:

- `templates/advancement/item-choice-flow.hbs`

Structure:

1. optional options fieldset
   - ability dropdown
   - replacement radio group
2. one or more item sections
   - grouped headers
   - item rows with checkbox or radio behavior
3. optional browse button at bottom

### Schematic

```text
Item Choice Flow
|
+-- Options Fieldset
|   +-- ability select
|   +-- replacement controls
|
+-- Section Card
|   +-- section header
|   +-- item row
|   +-- item row
|
+-- optional Browse button
```

### Website implication

For the web app:

- editor: model Item Choice around `details + level table + pool`
- player flow: model it around `sections of selectable items`

Do not merge those two views together.

## Subclass Advancement

### Player-facing flow window

Template:

- `templates/advancement/subclass-flow.hbs`

This flow is intentionally minimal.

It is a single large pill/button.

If no subclass is selected:

- empty pill with `Select Subclass`

If a subclass is selected:

- icon
- subclass name
- delete button

### Schematic

```text
Subclass Flow
|
+-- Large pill
    +-- empty state: "Select Subclass"
    +-- or selected state:
        +-- icon
        +-- name
        +-- delete button
```

### Website implication

The subclass selector should be a compact, dedicated control.

It should not be buried as one row inside a generic choice list.

## Scale Value Advancement

### Authoring window

Templates:

- `templates/advancement/scale-value-config-details.hbs`
- `templates/advancement/scale-value-config-levels.hbs`

#### Details fieldset

Fields:

- `Type`
- optional distance units
- `Identifier`

#### Levels table

A level-based table where visible columns depend on the selected scale type.

Examples:

- number
- die
- distance

### Schematic

```text
Scale Value Editor
|
+-- Shared Details
|
+-- Scale Details
|   +-- Type
|   +-- optional Units
|   +-- Identifier
|
+-- Levels Table
    +-- Level
    +-- one or more type-specific value columns
```

### Player-facing flow window

Template:

- `templates/advancement/scale-value-flow.hbs`

Very small display:

- initial value
- arrow
- final value

### Website implication

Scale Value is one of the simplest player-facing advancement windows.

The authoring complexity is in the table, not the runtime flow.

## Ability Score Improvement Advancement

### Player-facing flow window

Template:

- `templates/advancement/ability-score-improvement-flow.hbs`

This flow has two distinct areas:

1. ability score controls
2. feat selection area

#### Ability score area

- list/grid of six ability controls
- points remaining / lock message
- optional point cap display

#### Feat area

- recommended feat pill
- ASI pill
- optional browse/select feat pill

### Schematic

```text
ASI Flow
|
+-- Ability Score Controls
|   +-- score control
|   +-- score control
|   +-- score control
|
+-- Feat Section
    +-- recommended feat pill
    +-- ASI pill
    +-- browse/select feat pill
```

### Website implication

ASI is not just “modify stats.”

It is a split-choice window between:

- direct score increases
- feat choice

## Item Grant Advancement

### Player-facing flow window

Template:

- `templates/advancement/item-grant-flow-v2.hbs`

Structure:

1. optional spell ability fieldset
2. item card list
3. each item row has:
   - icon
   - name
   - optional checkbox if the grant is optional

### Schematic

```text
Item Grant Flow
|
+-- optional Spell Ability fieldset
|
+-- Items Card
    +-- granted item row
    +-- granted item row
```

## Confirmation / Deletion Dialog

Template:

- `templates/advancement/advancement-confirmation-dialog.hbs`

Structure:

1. warning/note paragraph
2. options fieldset
3. single checkbox to apply the advancement-side deletion behavior

### Website implication

If the website supports deleting or rewinding advancement rows, this is the confirmation pattern to mimic.

## Recommended Website Component Map

If the website wants to feel Foundry-aligned without copying the HTML exactly, the minimum component set should be:

1. `AdvancementDetailsSection`
   - title
   - icon
   - class restriction
   - level
   - hint
2. `AdvancementFieldset`
   - titled section with legend
3. `AdvancementLevelsTable`
   - reusable for Item Choice and Scale Value
4. `AdvancementItemsCard`
   - reusable for Item Choice and Item Grant
5. `AdvancementTraitPoolCard`
   - reusable for Trait grants and choices
6. `AdvancementPillSelector`
   - reusable for subclass and feat picks
7. `AdvancementFlowShell`
   - title
   - hint
   - summary/content
   - footer navigation

## Direct Template List

Core shell:

- `templates/advancement/advancement-config.hbs`
- `templates/advancement/parts/advancement-controls.hbs`
- `templates/advancement/advancement-flow.hbs`
- `templates/advancement/advancement-manager.hbs`

Item sheet tab:

- `templates/items/advancement.hbs`

Selection / confirmation:

- `templates/advancement/advancement-selection.hbs`
- `templates/advancement/advancement-confirmation-dialog.hbs`

Hit Points:

- `templates/advancement/hit-points-config.hbs`
- `templates/advancement/hit-points-flow.hbs`

Trait:

- `templates/advancement/trait-config-details.hbs`
- `templates/advancement/trait-config-guaranteed.hbs`
- `templates/advancement/trait-config-choices.hbs`
- `templates/advancement/trait-config-traits.hbs`
- `templates/advancement/trait-flow.hbs`

Item Choice:

- `templates/advancement/item-choice-config-details.hbs`
- `templates/advancement/item-choice-config-levels.hbs`
- `templates/advancement/item-choice-config-items.hbs`
- `templates/advancement/item-choice-flow.hbs`

Scale Value:

- `templates/advancement/scale-value-config-details.hbs`
- `templates/advancement/scale-value-config-levels.hbs`
- `templates/advancement/scale-value-flow.hbs`

Subclass:

- `templates/advancement/subclass-flow.hbs`

Ability Score Improvement:

- `templates/advancement/ability-score-improvement-flow.hbs`

Item Grant:

- `templates/advancement/item-grant-flow-v2.hbs`

## Practical Rule For The App Team

If the website is rebuilding Foundry advancement UX, copy:

1. the section order
2. the split between authoring views and runtime/player views
3. the repeated primitives: fieldsets, cards, tables, pill selectors

Do not copy:

1. Foundry-specific custom elements
2. exact CSS class names
3. exact control chrome where it conflicts with the website design system

The important part is preserving the information architecture, not the exact HTML.
