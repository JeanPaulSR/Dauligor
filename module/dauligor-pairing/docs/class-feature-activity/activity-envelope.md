# Shared Activity Envelope

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

## Shared Activity Envelope

All normal activities inherit this common shell from local `BaseActivityData`.

`system.activities` is a map keyed by Foundry activity `_id`.

```json
{
  "HAv1I90q2gpngadL": {
    "_id": "HAv1I90q2gpngadL",
    "type": "attack",
    "name": "",
    "img": null,
    "sort": 0,
    "activation": {},
    "consumption": {},
    "description": {},
    "duration": {},
    "effects": [],
    "flags": {},
    "range": {},
    "target": {},
    "uses": {},
    "visibility": {}
  }
}
```

### Shared Activity Fields

### `_id`

Foundry activity id. The module should generate this.

### `type`

Your sample includes these activity types:

- `attack`
- `cast`
- `check`
- `damage`
- `enchant`
- `forward`
- `heal`
- `save`
- `summon`
- `transform`
- `utility`

### `name`

Optional activity label.

Use it when one feature has multiple activities and each button needs its own name.

### `img`

Optional activity-specific icon override.

### `sort`

Controls display order.

The sample uses large sort gaps:

- `0`
- `100000`
- `200000`

That makes later insertions easier. The module can manage this.

### `activation`

Shared activation structure:

```json
{
  "type": "action",
  "value": 1,
  "condition": "",
  "override": false
}
```

Meaning:

- `type`: action kind such as action, bonus, reaction, minute, hour, special
- `value`: numeric count when the activation type is scalar
- `condition`: text condition such as reaction trigger text
- `override`: whether this activity overrides inherited/default timing

Field contract:

- `type`
  - type: string
  - stored activity values confirmed from local `dnd5e` config:
    - `action`
    - `bonus`
    - `reaction`
    - `minute`
    - `hour`
    - `day`
    - `longRest`
    - `shortRest`
    - `encounter`
    - `turnStart`
    - `turnEnd`
    - `legendary`
    - `mythic`
    - `lair`
    - `crew`
    - `special`
- `value`
  - type: integer or omitted/null
  - relevant to scalar activation types such as:
    - `minute`
    - `hour`
    - `day`
    - `legendary`
    - `mythic`
    - `crew`
- `condition`
  - type: string
- `override`
  - type: boolean

User-facing options confirmed from the attack test notes:

- Standard:
  - Action
  - Bonus Action
  - Reaction
- Time:
  - Minute
  - Hour
  - Day
- Rest:
  - End of a Long Rest
  - End of a Short Rest
- Combat:
  - Start of Encounter
  - Start of Turn
  - End of Turn
- Monster:
  - Legendary Action
  - Mythic Action
  - Lair Action
- Vehicle:
  - Crew Action
- Passive/no-cost states:
  - Special
  - None

Important note:

- the modern activity schema uses `special` for the passive/no-cost state
- the older item-level activation config also exposes a `none` label, so app-side docs should preserve both labels even though the stored activity key is centered on `special`

### `consumption`

Shared resource-consumption structure:

```json
{
  "scaling": {
    "allowed": false,
    "max": ""
  },
  "spellSlot": true,
  "targets": [
    {
      "type": "activityUses",
      "target": "",
      "value": "1",
      "scaling": {
        "mode": "",
        "formula": ""
      }
    }
  ]
}
```

Meaning:

- `scaling.allowed`: whether upcast or scaled spending is allowed
- `scaling.max`: deterministic formula for maximum scaling
- `spellSlot`: whether the activity can consume spell slots
- `targets[]`: explicit consumption rows

Each consumption target row contains:

- `type`: what pool is consumed
- `target`: the referenced pool or target key
- `value`: formula for how much is consumed
- `scaling.mode`
- `scaling.formula`

Field contract:

- `scaling.allowed`
  - type: boolean
- `scaling.max`
  - type: deterministic formula string
- `spellSlot`
  - type: boolean
- `targets`
  - type: array of consumption target rows

Each `targets[]` row:

- `type`
  - type: string
  - currently proven values:
    - `activityUses`
    - `itemUses`
    - `hitDice`
    - `spellSlots`
    - `attribute`
- `target`
  - type: string
  - meaning depends on `type`
  - proven examples:
    - `smallest`
    - `1`
    - `abilities.str.value`
- `value`
  - type: formula string
- `scaling.mode`
  - type: string
  - values proven directly by the corpus/config:
    - `""`
    - `amount`
    - `level` for `spellSlots`
- `scaling.formula`
  - type: formula string

The generic sample leaves this empty, but the attack and forward corpus examples prove these concrete target types:

- `activityUses`
- `itemUses`
- `hitDice`
- `spellSlots`
- `attribute`
- `material`

It also proves some concrete `target` values:

- `hitDice.target = "smallest"`
- `hitDice.target = "largest"` is supported by local `dnd5e` logic
- `hitDice.target = "d6"`-style specific die denominations are supported by local `dnd5e` logic
- `spellSlots.target = "1"`
- `attribute.target = "abilities.str.value"`
- `material.target = ""` can persist on a generic material-consumption row

So this part of the schema is now structurally confirmed, even though we still need more examples to know which target types Dauligor should support first.

Working field notes:

- `activityUses`
  - consumes the current activity's own `uses`
- `itemUses`
  - consumes the parent item's root `system.uses`
- `attribute`
  - `target` should be an actor/system path which resolves to a numeric resource
- `hitDice`
  - `target` can be a specific denomination like `d6`, or selector values like `smallest` or `largest`
- `spellSlots`
  - `target` is a spell level slot key such as `"1"`
- `material`
  - the saved export proves persistence, but we still want one more behavioral note before calling the exact semantics fully locked down

### `description`

Shared activity description structure:

```json
{
  "chatFlavor": ""
}
```

Use this when an activity needs its own chat-card flavor separate from the root feature description.

### `duration`

Shared duration structure:

```json
{
  "value": "",
  "units": "inst",
  "special": "",
  "concentration": false,
  "override": false
}
```

Meaning:

- `value`: deterministic formula when duration is scalar
- `units`: duration unit such as `inst`, `round`, `minute`, `hour`
- `special`: display-only custom duration text
- `concentration`: whether the effect requires concentration
- `override`: whether this activity overrides inherited/default duration

Field contract:

- `value`
  - type: deterministic formula string or empty string
- `units`
  - type: string
  - values proven directly by saved exports:
    - `inst`
    - `minute`
    - `turn`
- `special`
  - type: string
- `concentration`
  - type: boolean
- `override`
  - type: boolean

User-facing duration options confirmed from the attack test notes:

- Instantaneous
- Special
- Time-based:
  - Turn
  - Round
  - Minute
  - Hour
  - Day
  - Month
  - Year
- Permanent-style:
  - Until Dispelled
  - Until Dispelled or Triggered
  - Permanent

The saved corpus has not yet locked down every stored duration-unit key for the longer-duration and permanent variants, so Dauligor should treat those labels as accepted UI states and let the module normalize them until we capture one export for each.

### `effects`

Activity-local effect applications.

Base activities use generic applied effect rows.

Some activity types extend these rows with type-specific fields such as:

- enchantment riders
- `onSave`
- level-gated applicability

### `flags`

Activity-local metadata. This is where Dauligor-specific activity provenance or mapping hints can live if needed.

### `range`

Shared range structure:

```json
{
  "value": "",
  "units": "self",
  "special": "",
  "override": false
}
```

Meaning:

- `value`: scalar range formula when relevant
- `units`: self, touch, ft, mi, special, and related system values
- `special`: custom display text
- `override`: whether this activity overrides inherited/default range

Field contract:

- `value`
  - type: deterministic formula string or empty string
- `units`
  - type: string
  - stored values confirmed from local `dnd5e` config:
    - special range types:
      - `self`
      - `touch`
      - `spec`
      - `any`
    - scalar distance units come from `CONFIG.DND5E.movementUnits`
      - common UI labels recorded by the test notes:
        - Feet
        - Miles
        - Meters
        - Kilometers
- `special`
  - type: string
- `override`
  - type: boolean

### `target`

Shared targeting structure:

```json
{
  "template": {
    "count": "",
    "contiguous": false,
    "stationary": false,
    "type": "",
    "size": "",
    "width": "",
    "height": "",
    "units": "ft"
  },
  "affects": {
    "count": "",
    "type": "",
    "choice": false,
    "special": ""
  },
  "override": false,
  "prompt": true
}
```

Meaning:

- `template`: measured template information
- `affects`: who or how many targets are affected
- `override`: inherited/default target override
- `prompt`: whether Foundry should prompt for targets

Field contract:

- `template.count`
  - type: scalar string
- `template.contiguous`
  - type: boolean
- `template.stationary`
  - type: boolean
- `template.type`
  - type: string
  - stored values confirmed from local `dnd5e` config:
    - `circle`
    - `cone`
    - `cube`
    - `cylinder`
    - `line`
    - `radius`
    - `sphere`
    - `square`
    - `wall`
- `template.size`
  - type: scalar string
  - used by `radius`/emanation-style targeting
- `template.width`
  - type: scalar string
- `template.height`
  - type: scalar string
- `template.units`
  - type: string
  - scalar distance units such as:
    - `ft`
    - `mi`
    - `m`
    - `km`
- `affects.count`
  - type: scalar string
- `affects.type`
  - type: string
  - stored values confirmed from local `dnd5e` config:
    - `self`
    - `ally`
    - `enemy`
    - `creature`
    - `object`
    - `space`
    - `creatureOrObject`
    - `any`
    - `willing`
- `affects.choice`
  - type: boolean
- `affects.special`
  - type: string
- `override`
  - type: boolean
- `prompt`
  - type: boolean

User-facing target options confirmed from the attack test notes:

- Target type:
  - Self
  - Ally
  - Enemy
  - Creature
  - Object
  - Space
  - Creature or Object
  - Any
  - Willing Creature
- Area shape:
  - Cone
  - Cube
  - Cylinder
  - Emanation
  - Line
  - Sphere
  - Circle
  - Square
  - Wall
- Multi-template controls:
  - Amount
  - Contiguous

Shape-specific size inputs confirmed from the recorded sheet notes:

- Cone:
  - `length`
- Cube:
  - `width`
- Cylinder:
  - `radius`
  - `height`
- Emanation:
  - `size`
  - `stationary`
- Line:
  - `length`
  - `width`
- Sphere:
  - `radius`
- Circle:
  - `radius`
- Square:
  - `width`
- Wall:
  - `length`
  - `thickness`
  - `height`

The attack corpus example proves these concrete patterns:

- `target.template.count = "2"`
- `target.template.type = "wall"`
- `target.affects.count = "2"`
- `target.affects.type = "creatureOrObject"`
- `target.affects.special` can hold extra explanatory text
- `target.prompt = false` is a real persisted state

### `uses`

Activity-local use tracking:

```json
{
  "spent": 0,
  "max": "",
  "recovery": [
    {
      "period": "lr",
      "type": "recoverAll",
      "formula": ""
    }
  ]
}
```

Meaning:

- `spent`: already-spent uses
- `max`: deterministic maximum formula
- `recovery[]`: one or more recharge/recovery rules

Activity `uses` uses the same schema as root `system.uses`.

Field contract:

- `spent`
  - type: integer
  - allowed values: `0` or greater
- `max`
  - type: deterministic formula string
- `recovery`
  - type: array of recovery rows
  - each row has:
    - `period`: string
    - `type`: string
    - `formula`: formula string when needed

Accepted `period` values:

- `lr`
- `sr`
- `day`
- `dawn`
- `dusk`
- `initiative`
- `turnStart`
- `turnEnd`
- `turn`
- `recharge`

Accepted `type` values for non-recharge rows:

- `recoverAll`
- `loseAll`
- `formula`

Recharge behavior:

- `period = "recharge"` forces `type = "recoverAll"`
- `formula` becomes the recharge threshold
- valid recharge threshold choices come from the recharge picker and are effectively `2` through `6`
- empty recharge formula defaults to `"6"`

The attack corpus example proves:

- activity-local uses can have `max = "2"`
- activity-local `recovery` rows persist correctly
- root feature-level uses can coexist with activity-local uses

The same feature also shows a broad set of root feature recovery periods:

- `lr`
- `sr`
- `day`
- `dawn`
- `dusk`
- `initiative`
- `turnStart`
- `turnEnd`
- `turn`
- `recharge`

and recovery types such as:

- `recoverAll`
- `loseAll`
- `formula`

### `visibility`

Shared visibility gating:

```json
{
  "identifier": "",
  "level": {
    "min": 0,
    "max": 0
  },
  "requireAttunement": false,
  "requireIdentification": false,
  "requireMagic": false
}
```

Meaning:

- `identifier`: stable gating identifier
- `level.min/max`: only show this activity in a level band
- `requireAttunement`
- `requireIdentification`
- `requireMagic`

The sample leaves most of this blank, so this is another area that needs corpus examples.

Field contract:

- `identifier`
  - type: string
  - cast sample proves a real non-empty value such as `sorcerer`
- `level.min`
  - type: integer or `null`
- `level.max`
  - type: integer or `null`
- `requireAttunement`
  - type: boolean
- `requireIdentification`
  - type: boolean
- `requireMagic`
  - type: boolean

User-facing labels confirmed from the attack and cast test notes:

- Level Limit
- Class Identifier
- Require Magic
- Require Attunement
- Require Identification

The cast sample additionally proves that visibility is a real stored activity gate, not just a UI hint.

