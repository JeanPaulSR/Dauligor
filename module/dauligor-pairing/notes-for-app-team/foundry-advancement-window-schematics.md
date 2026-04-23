# Foundry Advancement Window Schematics

## Purpose

This note is a UI reference for the app team.

It captures the actual `dnd5e` advancement templates from local Foundry, with trimmed Handlebars/HTML skeletons and the real class names Foundry uses.

Use this when the goal is:

- mirror Foundry's layout structure
- keep the same section order
- improve the styling without changing the interaction model

Do not use this as the advancement data contract.

For data and ownership rules, still use:

- `docs/advancement-construction-guide.md`
- `docs/class-import-and-advancement-guide.md`
- `notes-for-app-team/correcting-advancemnts.md`

## Local Source Of Truth

- system root:
  - `C:\Users\Jean\AppData\Local\FoundryVTT\Data\systems\dnd5e`
- advancement templates:
  - `C:\Users\Jean\AppData\Local\FoundryVTT\Data\systems\dnd5e\templates\advancement`
- item sheet advancement tab:
  - `C:\Users\Jean\AppData\Local\FoundryVTT\Data\systems\dnd5e\templates\items\advancement.hbs`

## Repeated Foundry UI Primitives

These are the main design primitives Foundry reuses across advancement windows.

### Structural wrappers

- `form`
- `fieldset`
- `legend`
- `ol`
- `ul`

### Repeated layout classes

- `standard-form`
- `items-section card`
- `items-header header`
- `item-list unlist`
- `pill-lg`
- `split-group`
- `flexrow`
- `flexcol`

### Repeated controls

- `control-button`
- `unbutton`
- `item-control`
- `dnd5e-checkbox`
- `file-picker`
- `prose-mirror`

These should be treated as Foundry's layout language.

## 1. Item Sheet Advancement Tab

Template:

- `templates/items/advancement.hbs`

### Actual trimmed template shape

```hbs
<section class="advancement tab {{ tab.cssClass }}" data-tab="{{ tab.id }}" data-group="{{ tab.group }}">
  {{#each advancement}}
  <div class="items-section card" data-level="{{ @key }}">
    <div class="items-header header">
      <h3 class="item-name">Level Header</h3>
      <div class="item-header advancement-value">Value</div>
      <div class="item-header item-controls">Status / Configure</div>
    </div>

    <ol class="item-list unlist">
      {{#each items}}
      <li class="advancement-item item {{ classes }}" data-id="{{ id }}" data-uuid="{{ uuid }}">
        <div class="item-row">
          <div class="item-name">
            <dnd5e-icon class="item-image gold-icon"></dnd5e-icon>
            <div class="name">
              <div class="title">Title</div>
              <div class="summary">Summary</div>
            </div>
            <div class="tags">Tag icons</div>
          </div>

          <div class="item-detail advancement-value">Value</div>
          <div class="item-detail item-controls">Edit / Delete / Menu</div>
        </div>
      </li>
      {{/each}}
    </ol>
  </div>
  {{/each}}
</section>
```

### Layout meaning

- grouped by level
- each level is its own card
- each advancement row behaves like an item row
- `Value` is a narrow fixed column
- row controls always live on the far right

### Website guidance

Mirror:

- level-grouped cards
- narrow value column
- icon + title + summary item rows

Improve:

- spacing
- readability of row controls
- hierarchy between title and summary

## 2. Advancement Type Picker

Template:

- `templates/advancement/advancement-selection.hbs`

### Actual trimmed template shape

```hbs
<form autocomplete="off" onsubmit="event.preventDefault();">
  <ol class="items-list">
    {{#each types as |advancement name|}}
    <li class="item flexrow">
      <div class="item-name flexrow">
        <div class="item-image"></div>
        <h3>Type Label</h3>
      </div>
      <div class="item-controls flexrow">
        <input name="type" type="radio" value="{{name}}">
      </div>
      <div class="item-hint notes">Hint</div>
    </li>
    {{/each}}
  </ol>

  <button class="dialog-button" data-button="submit" disabled>
    Create Advancement
  </button>
</form>
```

### Layout meaning

- one-column list
- each row is icon + label + radio + hint
- one action button at bottom

### Website guidance

This should remain a small chooser, not a full-screen builder.

## 3. Shared Advancement Editor Shell

Templates:

- `templates/advancement/advancement-config.hbs`
- `templates/advancement/parts/advancement-controls.hbs`

### Actual shell

```hbs
<form autocomplete="off">
  {{> "dnd5e.advancement-controls"}}
</form>
```

### Actual shared controls partial

```hbs
<div class="form-group">
  <label>Custom Title</label>
  <div class="form-fields">
    <input type="text" name="title">
  </div>
</div>

<div class="form-group">
  <label>Custom Icon</label>
  <div class="form-fields">
    <file-picker type="image" name="icon"></file-picker>
  </div>
</div>

<div class="form-group">
  <label>Class Restriction</label>
  <div class="form-fields">
    <select name="classRestriction"></select>
  </div>
</div>

<div class="form-group">
  <label>Level</label>
  <div class="form-fields">
    <select name="level"></select>
  </div>
</div>

<prose-mirror class="slim" name="hint" compact></prose-mirror>
```

### Layout meaning

Every advancement editor starts with the same top block:

1. custom title
2. custom icon
3. class restriction
4. level
5. hint

### Website guidance

Do not scatter these fields per type.

Keep one consistent top block across all advancement editors.

## 4. Shared Player-Facing Advancement Flow

Templates:

- `templates/advancement/advancement-flow.hbs`
- `templates/advancement/advancement-manager.hbs`

### Actual flow shell

```hbs
<form>
  <h3>{{{ title }}}</h3>
  {{#if hint}}<p>{{ hint }}</p>{{/if}}
  {{{ summary }}}
</form>
```

### Actual manager shell

```hbs
<div class="flexcol">
  <div class="step {{ flowClasses }}">
    <template id="{{ flowId }}"></template>
  </div>
  <nav class="flexrow">
    <button type="button" data-action="previous">Previous Step</button>
    <button type="button" data-action="restart">Restart</button>
    <button type="button" data-action="next">Next Step</button>
    <button type="button" data-action="complete">Complete</button>
  </nav>
</div>
```

### Layout meaning

- the flow body is intentionally small
- the manager owns navigation
- the content of each step is meant to be task-focused

### Website guidance

Player-facing windows should feel compact and decisive, not like admin panels.

## 5. Hit Points

Templates:

- config:
  - `templates/advancement/hit-points-config.hbs`
- flow:
  - `templates/advancement/hit-points-flow.hbs`

### Actual config skeleton

```hbs
<fieldset>
  <legend>Hit Points</legend>
  <div class="form-group">
    <label>Hit Die</label>
    <span class="form-field-readonly">d6</span>
  </div>
  <div class="form-group">
    <label>Hit Points at 1st Level</label>
    <span class="form-field-readonly">6</span>
  </div>
  <div class="form-group">
    <label>Average</label>
    <span class="form-field-readonly">4</span>
  </div>
</fieldset>
```

### Actual flow skeleton

```hbs
<div class="standard-form">
  <div class="breakdown form-group split-group">
    <div class="form-fields">
      <div class="form-group label-top">Previous</div>
      <span class="separator">+</span>
      <div class="form-group label-top">Roll / Max / Average</div>
      <span class="separator">+</span>
      <div class="form-group label-top">Modifier</div>
      <span class="separator">+</span>
      <div class="form-group label-top">Bonus</div>
      <span class="separator">=</span>
      <div class="form-group label-top">Final</div>
    </div>
    <button class="roll-button dice-button" type="button">d6</button>
  </div>

  <fieldset>
    <legend>Options</legend>
    <div class="form-group">
      <label>Take Average</label>
      <div class="form-fields">
        <dnd5e-checkbox name="useAverage"></dnd5e-checkbox>
      </div>
    </div>
  </fieldset>
</div>
```

### Website guidance

Keep the compact equation layout.

This should not look like a long vertical form.

## 6. Trait

Templates:

- `templates/advancement/trait-config-details.hbs`
- `templates/advancement/trait-config-guaranteed.hbs`
- `templates/advancement/trait-config-choices.hbs`
- `templates/advancement/trait-config-traits.hbs`
- `templates/advancement/trait-flow.hbs`

### Actual config sections

#### Details

```hbs
<fieldset>
  <legend>Details</legend>
  Mode field
  Allow replacements checkbox
</fieldset>
```

#### Guaranteed

```hbs
<fieldset class="selected-trait">
  <legend>Guaranteed</legend>
  <ul class="unlist">
    <li>
      <label class="selected">
        <input type="radio" name="selectedIndex">
        <i class="fa-solid fa-arrow-right-long"></i>
        <span>Granted traits summary</span>
      </label>
    </li>
  </ul>
</fieldset>
```

#### Choices

```hbs
<fieldset class="selected-trait">
  <legend>
    Choices
    <button type="button" class="control-button unbutton" data-action="addChoice">
      <i class="fas fa-plus"></i>
    </button>
  </legend>
  <ul class="unlist">
    <li>
      <label>
        <input type="radio" name="selectedIndex">
        <i class="fa-solid fa-gear"></i>
        <span>Choice bundle summary</span>
      </label>
      <button type="button" class="control-button unbutton" data-action="removeChoice">
        <i class="fa-solid fa-trash"></i>
      </button>
    </li>
  </ul>
</fieldset>
```

#### Traits pool

```hbs
<fieldset class="card traits">
  <legend>Trait Pool</legend>
  <div class="form-group split-group">
    <div class="form-fields">
      Count input
      Trait type selector
    </div>
  </div>

  {{> "dnd5e.traits-list"}}
</fieldset>
```

### Actual flow skeleton

```hbs
<div class="standard-form">
  <fieldset>
    <legend>Select Trait</legend>
    Trait input
  </fieldset>

  <div class="items-section card">
    <div class="items-header header">
      <h4 class="item-name">Traits</h4>
    </div>
    <ul class="item-list unlist">
      <li class="item flexrow">
        <div class="item-name flexrow">
          <dnd5e-icon class="gold-icon"></dnd5e-icon>
          <div class="name-stacked">
            <div class="title">Trait label</div>
          </div>
        </div>
        <div class="item-controls flexrow">
          <button type="button" class="unbutton control-button item-control">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </li>
    </ul>
  </div>
</div>
```

### Website guidance

Trait editing should look like a multi-section builder with a current selection context, not one giant list.

## 7. Item Choice

Templates:

- `templates/advancement/item-choice-config-details.hbs`
- `templates/advancement/item-choice-config-items.hbs`
- `templates/advancement/item-choice-config-levels.hbs`
- `templates/advancement/item-choice-flow.hbs`

### Actual config details skeleton

```hbs
<fieldset>
  <legend>Details</legend>
  Allow drops checkbox
  Type selector
  Restriction type selector
  Restriction subtype selector
  Spell level restriction
  Spell list restriction
</fieldset>
```

### Actual config items skeleton

```hbs
<fieldset class="card items table">
  <legend>Pool</legend>
  <div class="header">
    <div class="item-name name-header">Item</div>
  </div>
  <ol class="items-list unlist">
    <li class="item flexrow">
      <div class="item-name">Item link</div>
      <div class="item-controls flexrow">
        <a class="item-control item-action"><i class="fas fa-trash"></i></a>
      </div>
    </li>
  </ol>
  <div class="form-group">
    <p class="hint centered drop-area">Drop hint</p>
  </div>
</fieldset>
```

### Actual config levels skeleton

```hbs
<fieldset class="card levels table">
  <legend>Choices</legend>
  <div class="header">
    <span class="level-header">Lvl</span>
    <span class="count-header">Count</span>
    <span class="replacement-header">Replacement</span>
  </div>
  <ol class="levels-list unlist">
    <li class="level">
      <div class="level-level">3</div>
      <div class="level-count"><input type="number"></div>
      <div class="level-replacement"><dnd5e-checkbox></dnd5e-checkbox></div>
    </li>
  </ol>
</fieldset>
```

### Actual flow skeleton

```hbs
<div class="standard-form">
  <fieldset>
    <legend>Options</legend>
    Ability selector
    Replacement radio set
  </fieldset>

  <div class="items-section card">
    <div class="items-header header">
      <h4 class="item-name">Section Header</h4>
    </div>
    <ul class="item-list unlist current-level">
      <li class="item flexrow">
        <div class="item-name flexrow">
          <img class="gold-icon">
          <div class="name-stacked">
            <div class="title">Item name</div>
          </div>
        </div>
        <div class="item-controls flexrow">
          <dnd5e-checkbox></dnd5e-checkbox>
        </div>
      </li>
    </ul>
  </div>

  <div class="pill-lg roboto-upper empty" data-action="browse">
    Browse / Select
  </div>
</div>
```

### Website guidance

This is the clearest Foundry pattern for Metamagic-like UI.

Keep:

- details block
- pool table
- level progression table
- grouped choice cards in the flow

## 8. Item Grant

Templates:

- `templates/advancement/item-grant-config-details.hbs`
- `templates/advancement/item-grant-config-items.hbs`
- `templates/advancement/item-grant-flow-v2.hbs`

### Actual config skeleton

```hbs
<fieldset>
  <legend>Details</legend>
  Optional checkbox
</fieldset>

<fieldset class="card items table">
  <legend>Items</legend>
  <div class="header">
    <div class="item-optional">Optional</div>
    <div class="item-name name-header">Item</div>
  </div>
  <ol class="items-list unlist">
    <li class="item flexrow">
      <div class="item-optional"><dnd5e-checkbox></dnd5e-checkbox></div>
      <div class="item-name">Item link</div>
      <div class="item-controls flexrow">
        <a class="item-control item-action"><i class="fas fa-trash"></i></a>
      </div>
    </li>
  </ol>
</fieldset>
```

### Actual flow skeleton

```hbs
<div class="standard-form">
  <fieldset>
    <legend>Spell Ability</legend>
    Ability selector
  </fieldset>

  <div class="items-section card">
    <div class="items-header header">
      <h4 class="item-name">Granted Items</h4>
    </div>
    <ul class="item-list unlist">
      <li class="item flexrow">
        <div class="item-name flexrow">
          <img class="gold-icon">
          <div class="name-stacked">
            <div class="title">Item name</div>
          </div>
        </div>
        <div class="item-controls flexrow">
          <dnd5e-checkbox></dnd5e-checkbox>
        </div>
      </li>
    </ul>
  </div>
</div>
```

### Website guidance

Item Grant is visually simpler than Item Choice.

It should read as a grant list, not a chooser.

## 9. Scale Value

Templates:

- `templates/advancement/scale-value-config-details.hbs`
- `templates/advancement/scale-value-config-levels.hbs`
- `templates/advancement/scale-value-flow.hbs`

### Actual config details skeleton

```hbs
<fieldset>
  <legend>Details</legend>
  Type selector
  Distance units selector
  Identifier field
  Identifier hint
</fieldset>
```

### Actual levels table skeleton

```hbs
<fieldset class="card levels table" data-type="{{ configuration.data.type }}">
  <legend>Scale</legend>
  <div class="header">
    <span class="level-level">Lvl</span>
    <span class="value-header">Value column(s)</span>
  </div>
  <ol class="levels-list unlist">
    <li class="level">
      <div class="level-level">2</div>
      <div class="level-value"><input></div>
    </li>
  </ol>
</fieldset>
```

### Actual flow skeleton

```hbs
<div>
  <span class="initial-scale-value">Previous</span>
  <span class="arrow">→</span>
  <span class="new-scale-value">Final</span>
</div>
```

### Website guidance

Config should feel like a dense progression grid.

Flow should feel like a compact “value changes from X to Y” display.

## 10. Ability Score Improvement

Templates:

- `templates/advancement/ability-score-improvement-config-details.hbs`
- `templates/advancement/ability-score-improvement-config-scores.hbs`
- `templates/advancement/ability-score-improvement-flow.hbs`

### Actual flow skeleton

```hbs
<div class="standard-form">
  <ul class="ability-scores unlist">
    Score controls
  </ul>

  <div class="feat-section flexcol">
    <div class="pill-lg">Recommended feat</div>
    <div class="pill-lg">ASI option</div>
    <div class="pill-lg roboto-upper empty">Browse feat</div>
  </div>
</div>
```

### Website guidance

Keep the “ASI versus feat” decision visually obvious.

## 11. Subclass

Template:

- `templates/advancement/subclass-flow.hbs`

### Actual flow skeleton

```hbs
<div class="pill-lg {{#unless subclass}}roboto-upper empty{{/unless}}"
     {{#if subclass}}data-uuid="{{ subclass.uuid }}"{{else}}data-action="browse"{{/if}}>
  {{#if subclass}}
  <img class="gold-icon" data-action="viewItem" src="{{ subclass.img }}" alt="{{ subclass.name }}">
  <div class="name-stacked">
    <div class="title">{{ subclass.name }}</div>
  </div>
  <button type="button" class="unbutton control-button item-control" data-action="deleteItem">
    <i class="fas fa-trash"></i>
  </button>
  {{else}}
  Select Subclass
  {{/if}}
</div>
```

### Website guidance

This is intentionally a single focused selector.

Do not turn subclass selection into a heavy admin form.

## 12. Size

Templates:

- `templates/advancement/size-config-details.hbs`
- `templates/advancement/size-flow.hbs`

### Actual flow skeleton

```hbs
<div>
  <fieldset>
    <legend>Select Size</legend>
    Size selector
  </fieldset>
</div>
```

### Website guidance

This should stay narrow and minimal.

## Best Website Mirroring Targets

If the team only wants the windows most relevant to classes first, mirror these in order:

1. item sheet advancement tab
2. shared advancement controls
3. Hit Points flow
4. Trait config
5. Item Choice config and flow
6. Item Grant config and flow
7. Scale Value config
8. Subclass flow

## What To Preserve

Preserve these Foundry interaction rules:

- shared controls in a fixed top block
- `fieldset` and `legend` as the primary grouping pattern
- level-grouped cards in the advancement tab
- `ItemChoice` and `ItemGrant` as table/list hybrids
- `ScaleValue` as a dense progression table
- `HitPoints` as a compact equation flow
- `Subclass` as a single-pill selector

## What Can Be Improved Safely

The website can improve:

- spacing
- visual hierarchy
- action-button clarity
- readability of dense tables
- icon/button size
- section separation

The goal should be:

- Foundry structure
- cleaner presentation
- no change in core interaction model
