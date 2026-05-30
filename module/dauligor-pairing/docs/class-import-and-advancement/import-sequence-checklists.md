# Import Sequence & Checklists

> Part of the [Class Import & Advancement Guide](../class-import-and-advancement-guide.md).

## Correct Actor Import Sequence For A Character Creator

This is the sequence the Dauligor-side character creator should assume the Foundry module follows.

### Step 1. Determine import context

- actor import only
- no world document creation

### Step 2. Determine selected class row

There are two meaningful selections:

- base class row
  - import class only
- subclass row
  - import class plus that subclass

If only the class row was selected:

- do not silently attach the first subclass

### Step 3. Determine current class state on the actor

Read:

- whether the actor already has this class
- current `system.levels` for that class
- existing subclass, if any
- existing advancement values

### Step 4. Determine minimum and target level

The importer should not reset to level 1 if the actor already has class levels.

Instead:

- current class level becomes the floor
- target level must be greater than or equal to current level

If actor already has Sorcerer 3:

- the next import should start from 3
- the user should choose an ending level such as 4 or 5

### Step 5. Gather advancement choices for gained levels only

This is where the character creator matters most.

Choices may include:

- HP gain per new level
- subclass choice
- skill choices
- option-group choices such as Metamagic
- future spell/equipment choices

Do not ask again for levels that already exist unless explicitly reconfiguring them.

### Step 6. Update the embedded class item

The class item should end this step with:

- `system.levels = targetLevel`
- actor-safe local advancement `_id` values
- semantic advancement ids preserved in flags
- `HitPoints.value` updated for gained levels
- `Trait.value.chosen` updated for chosen skills or other chosen traits
- `ItemGrant.value.added` updated for granted actor items

### Step 7. Update or embed subclass

If subclass was selected:

- embed the subclass item if not already present
- update subclass item advancement state if needed
- embed subclass features granted at or below the class level

If subclass was not selected:

- do not embed a subclass automatically

### Step 8. Update actor root state

This should be derived from advancement results, not used as a substitute for them.

Examples:

- actor HP current/max
- actor skill proficiencies
- actor saving throw proficiencies

The advancement data on the class item should still remain the deeper source of truth.

## Correct Class Import Checklist

For a class import to be considered correct, all of these should be true.

### Payload correctness

- the class has stable semantic identity
- the class has a real `system.identifier`
- the class has valid `system.hd.denomination`
- the class has valid `system.spellcasting`
- the class has a complete `system.advancement` object

### Advancement correctness

- `HitPoints` exists if the class uses HP advancement
- saving throws are modeled as `Trait`
- skills are modeled as `Trait` choices
- scale tracks are modeled as `ScaleValue`
- feature grants are modeled as `ItemGrant`

### Actor import correctness

- class level is saved on the class item
- HP choices are saved in `HitPoints.value`
- chosen skills are saved in `Trait.value.chosen`
- granted features are reflected in `ItemGrant.value.added`
- subclass is only imported if actually selected
- no world items are created during actor import

### Reimport correctness

- advancement local ids stay stable on the actor
- prior chosen values are preserved where still valid
- removed higher-level features are cleaned up
- actor state is not rebuilt blindly from scratch if only level is increasing

## What The App Must Provide vs What The Module Must Provide

### App must provide

- semantic class identity
- semantic subclass identity
- semantic feature identity
- class hit die
- class spellcasting model
- class advancement semantics
- skill choice pools
- option-group progression semantics

### Module must provide

- Foundry-safe local `_id` values
- world UUID resolution
- actor embedded UUID resolution
- advancement id remapping on actors
- actor-specific persistence in `value`
- synchronization between embedded class state and actor root data

## Practical Recommendation

The app should keep exporting the richest semantic class payload it can.

The module should continue owning:

- normalization into real `dnd5e` class/subclass/feat items
- actor-side advancement persistence
- world-vs-actor import policy

That is the cleanest split for supporting both:

- a world library importer
- a Dauligor character creator

