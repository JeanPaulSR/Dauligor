# What The Sample Proves

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

## What The Sample Proves

`item-feature.json` is useful because it shows:

- the root `feat` item shell
- one example of every major activity type
- the shared base activity envelope
- which fields are type-specific versus shared

It is not enough on its own to prove:

- fully populated damage parts
- real consumption targets
- real save DC strategies
- real summon profiles
- real transform profiles
- real enchantment rider behavior
- real activity visibility gating
- real effect rows with level gates and rider links

So this document can define the structure, but not every best-practice value. For the missing parts, see `docs/feature-activity-corpus-plan.md`.

`item-test-attack-feature.json` is useful because it proves a real populated `attack` activity with:

- non-empty activation value and condition
- multiple consumption target types
- a scalar duration
- explicit target counts and template type
- activity-local uses and recovery
- populated damage parts

That file is currently the best concrete attack-activity example in the corpus.

`item-test-cast-feature.json` is useful because it proves two real `cast` activity variants:

- a mostly default cast activity with a linked spell UUID
- an override-heavy cast activity with custom activation, duration, range, target, uses, visibility, and spell challenge values

That file is currently the best concrete cast-activity example in the corpus.

`item-test-check-feature.json` is useful in a narrower way:

- the export itself is still default or empty
- but the paired sheet inspection confirms the concrete option sets the `dnd5e` UI allows for check activities

So this file is currently a good UI-discovery reference, but not yet a fully populated persistence example.

`item-test-damage-feature.json` is useful because it proves a real `damage` activity with:

- direct damage parts outside `attack`
- a normal dice damage row
- a custom-formula damage row
- `critical.allow = false`

That file is currently the best concrete damage-only activity example in the corpus.

`item-test-enchant-feature.json` is useful because it proves a real `enchant` activity with:

- a real enchantment effect profile on the item
- populated activity-level enchantment application rows
- rider links to:
  - sibling activities
  - base effects
  - item UUIDs
- level-gated enchantment availability
- `enchant.self = true`
- `restrictions.allowMagical = true`

That file is currently the best concrete enchant-activity example in the corpus.

`item-test-forward-feature.json` is useful because it proves a real `forward` activity with:

- a referenced sibling `activity.id`
- activation override
- activity-local uses and recharge recovery
- populated `consumption.targets`
- a persisted `material` consumption target

That file is currently the best concrete forward-activity example in the corpus.

`item-test-heal-feature.json` is useful because it proves a real `heal` activity with:

- a populated healing `DamageField`
- explicit healing-related `types`
- ordinary dice healing plus formula bonus
- a real activity-local effect row

That file is currently the best concrete heal-activity example in the corpus.

`item-test-save-feature.json` is useful because it proves a real `save` activity with:

- one and many save abilities
- explicit save DC calculation modes
- custom damage-on-save behavior
- real damage rows
- effect rows with `onSave`

That file is currently the best concrete save-activity example in the corpus.

`item-test-summon-feature.json` is useful because it proves a real `summon` activity with:

- populated summon profiles
- real Actor UUID links
- summon bonus formulas
- match and inheritance toggles
- summon mode and prompt behavior

That file is currently the best concrete summon-activity example in the corpus.

`item-test-transform-feature.json` is useful because it proves a real `transform` activity with:

- populated transform profiles
- real Actor UUID links
- explicit transform settings
- preset-driven and custom transform states
- spell-list retention and transformation-setting sets

That file is currently the best concrete transform-activity example in the corpus.

