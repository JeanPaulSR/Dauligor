# General Advancement Families

> Part of the [Advancement Construction Guide](../advancement-construction-guide.md).

## General Advancement Families

The list below reflects the advancement families registered in `CONFIG.DND5E.advancementTypes` in `dnd5e` `5.3.1`.

### `AbilityScoreImprovement`

Valid item families:

- `background`
- `class`
- `race`
- `feat`

Purpose:

- models ASI or epic-boon style point allocation

Observed configuration shape:

```json
{
  "cap": 2,
  "fixed": {},
  "locked": [],
  "points": 0,
  "recommendation": null
}
```

Typical usage:

- class levels that grant ASI
- backgrounds or feats that give stat increases

For Dauligor class import:

- this is a future-supported advancement family
- it is the correct long-term place for ASI choices
- do not fake ASI by directly mutating actor abilities without any advancement row

### `HitPoints`

Valid item families:

- `class`

Purpose:

- stores class hit point gains by level

Observed shape:

```json
{
  "type": "HitPoints",
  "configuration": {},
  "value": {
    "1": "max",
    "2": 4,
    "3": 6
  }
}
```

Important behavior:

- `configuration` is usually empty
- `value` is the important part
- level 1 commonly uses `"max"`
- later levels store concrete numeric results

For class importing:

- class hit die belongs on `system.hd`
- the actual per-level gained HP belongs in `HitPoints.value`
- do not rely only on overriding actor `hp.max`

If the actor's HP total changes but the class `HitPoints` advancement stays blank, the import is not correct yet.

### `ItemChoice`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- allows choosing one or more items from a pool
- also supports replacement behavior

Observed configuration shape:

```json
{
  "allowDrops": true,
  "choices": {
    "4": {
      "count": 2,
      "replacement": true
    },
    "10": {
      "count": 3,
      "replacement": false
    }
  },
  "pool": [
    {
      "uuid": "Item.7nukcdynNu8SURbx"
    }
  ],
  "restriction": {
    "list": []
  },
  "spell": null,
  "type": null
}
```

Observed value shape:

```json
{
  "added": {},
  "replaced": {}
}
```

For class creation:

- this is the better long-term home for option-group style item choices
- examples include fighting styles, maneuvers, invocations, metamagic-style itemized choices, or similar option pools

For current Dauligor flow:

- actor-side option selection is still partly custom workflow driven
- the long-term target is to converge those choices into real ItemChoice persistence where it makes sense

### `ItemGrant`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- grants concrete items when the advancement applies

Observed configuration shape:

```json
{
  "items": [
    {
      "uuid": "Actor.57AKVzw7TMdf0wIH.Item.VLRgIeVtJdQ7L1oM",
      "optional": false
    }
  ],
  "optional": false,
  "spell": {
    "ability": [""],
    "uses": {
      "max": "",
      "per": "",
      "requireSlot": false
    },
    "prepared": 0
  }
}
```

Observed value shape:

```json
{
  "added": {
    "VLRgIeVtJdQ7L1oM": "Actor.57AKVzw7TMdf0wIH.Item.VLRgIeVtJdQ7L1oM"
  }
}
```

This is the normal advancement family for class and subclass features.

Use it when:

- a class grants Spellcasting at level 1
- a class grants Font of Magic at level 2
- a subclass grants Divine Magic at level 1

For Dauligor:

- the app should send semantic feature references
- the module should resolve them to world or actor UUIDs
- `value.added` should track what was actually created/attached

### `ScaleValue`

> **Owner scope (Phase A/B "advancements outside classes" — May 2026)** —
> `ScaleValue` advancements work on any advancement-carrying item type
> dnd5e exposes, not just on `type: "class"`. App-side, the underlying
> `scaling_columns` table is polymorphic across `parent_type ∈ { class,
> subclass, feat, race, background, item }`. Foundry's resolver
> (`@scale.<owner-identifier>.<column-identifier>`) treats them
> identically regardless of owner. See § "Pitfall 1" below for the
> design call that still holds — class progression that's *conceptually*
> class-scoped stays on the class item; the owner-scope generalization
> is for content that *isn't* class-scoped (a homebrew feat with its own
> scaling die, a magic item with bumped charges, etc.).

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- defines a level-based scale such as numbers, dice, or strings

Observed configuration shape:

```json
{
  "identifier": "sorcery-points",
  "type": "number",
  "distance": {
    "units": ""
  },
  "scale": {
    "2": { "value": 2 },
    "3": { "value": 3 },
    "4": { "value": 4 }
  }
}
```

Observed value shape:

```json
{}
```

Typical class usage:

- cantrips known
- spells known
- sorcery points
- metamagic known
- any class resource that scales deterministically by level

Important rule:

- the progression belongs in `configuration.scale`
- actor-specific current value is derived from level
- `value` is usually empty

### `ItemBumpUses`

> **App-only advancement type (Phase C — May 2026)** — bumps the
> `uses.max` of a target feature / feat that the character already
> owns. Used for "Cleric: Divine Intervention Improvement" (+1 to
> Channel Divinity), "Amulet of the Devout" (+1 charge), and homebrew
> feats that add to existing class-feature uses.

Valid item families (app-side authoring):

- `feat` (covers feat / race / background via `feat_type` discriminator)
- `item`
- `class`, `subclass`, `feature` (rare but valid — a class feature can
  bump another class feature's uses, e.g. a tier-up at a later level)

Purpose:

- after the granting entity is added to a character, the app finds the
  target on the sheet and adds the configured amount to its `uses.max`
- target-not-present → warning surfaced to the author; the bump is
  silently skipped so the granting entity still applies cleanly

Configuration shape:

```json
{
  "target": { "kind": "feature", "id": "<features.id or feats.id>" },
  "amount": "+1"
}
```

- `target.kind` is `"feature"` (class / subclass features in the
  `features` table) or `"feat"` (rows in `feats`).
- `amount` is a Foundry-roll-engine formula string. Plain numbers
  (`"1"`), signed numbers (`"+1"`), `@prof`, `@scale.<owner>.<col>`,
  and arithmetic combinations all work — the app emits the combined
  formula via `combineUsesMaxWithBumps()` so Foundry resolves the
  final value at play time.

Foundry export behavior:

- bumps are baked into each granted feature item's `system.uses.max`
  via app-side stitching — no runtime `ActiveEffect` involved
- each bumped feature item carries
  `flags["dauligor-pairing"].itemBumpUses: [{amount, sourceKind,
  sourceId, sourceName, sourceAdvancementId}]` so debug / audit UIs
  can show where the bump came from
- the actor itself carries
  `flags["dauligor-pairing"].itemBumpUses: { bumps, warnings }` —
  the whole-actor map, including any target-not-present warnings the
  app produced during the walk

App-side caveats (track in
[`docs/handoff-phase-c-itembumpuses.md`](../../../docs/handoff-phase-c-itembumpuses.md)):

- feat-authored bumps don't fire in the server export today
  (`rebuildCharacterFromSql` doesn't synthesize `character.feats`)
- item-authored bumps don't fire in the character runtime today
  (`collectItemBumpUses` accepts `ownedFeats` but not `ownedItems`)

### `Size`

Valid item families:

- `race`

Purpose:

- controls size progression or size choice

This is not a core class advancement family, but it exists in the system and belongs in the general model.

For class-focused work:

- you usually do not need this

### `Subclass`

Valid item families:

- `class`

Purpose:

- defines subclass selection as a real advancement

This is the system-native advancement family for choosing a subclass from a class.

For Dauligor:

- this is the long-term best home for base-class-to-subclass branching
- right now some of our workflow still makes subclass selection externally
- the target architecture should still treat subclass choice as advancement state, not just temporary wizard state

### `Trait`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- grants or chooses traits and proficiencies

Observed configuration shape:

```json
{
  "mode": "default",
  "allowReplacements": false,
  "grants": [],
  "choices": [
    {
      "count": 2,
      "pool": [
        "skills:arc",
        "skills:dec",
        "skills:ins",
        "skills:itm",
        "skills:per",
        "skills:rel"
      ]
    }
  ]
}
```

Also observed:

- `classRestriction` can be present, for example `"primary"`

Observed value shape:

```json
{
  "chosen": [
    "skills:itm",
    "skills:per"
  ]
}
```

Typical class usage:

- saving throws
- skill choices
- weapon proficiencies
- armor proficiencies
- tool proficiencies
- languages

This is the correct place for class skill choice persistence.

Do not:

- present a skill choice UI
- grant the chosen proficiencies on the actor
- then leave the class `Trait` advancement empty

That loses the canonical class-state record.

