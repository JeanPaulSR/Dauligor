# World Items, Actor Items & Persistence

> Part of the [Advancement Construction Guide](../advancement-construction-guide.md).

## World Items Versus Actor-Embedded Items

The same advancement row behaves differently depending on where it lives.

### World item

Purpose:

- define the canonical progression tree

Good place for:

- semantic/source-backed advancement identity
- stable configuration tables
- world UUID references

### Actor-embedded class or subclass item

Purpose:

- define that actor's realized progression state

Must preserve:

- actor-safe advancement `_id`
- semantic advancement id in flags
- chosen `value`
- granted item mappings in `value.added`

If the world class is the blueprint, the actor-embedded class is the filled-in worksheet.

## Actor Persistence Rules

For actor import or character creation, these rules matter most.

### HP must persist in `HitPoints.value`

Example:

```json
{
  "value": {
    "1": "max",
    "2": 4,
    "3": 6
  }
}
```

Why:

- later level-up needs to know what was already chosen
- export needs to reflect the actual class build history
- actor reconstruction should not infer all HP gains from current `hp.max`

### Skill choices must persist in `Trait.value.chosen`

Example:

```json
{
  "value": {
    "chosen": [
      "skills:acr",
      "skills:ath"
    ]
  }
}
```

Why:

- the class item should remember which class skills were chosen
- actor root skill proficiency is derived output, not the deeper source of truth

### Granted feature state must persist in `ItemGrant.value.added`

Example:

```json
{
  "value": {
    "added": {
      "VLRgIeVtJdQ7L1oM": "Actor.XXX.Item.VLRgIeVtJdQ7L1oM"
    }
  }
}
```

Why:

- cleanup and reimport need to know what came from that advancement
- the item grant should be traceable to real embedded items

### Item choices must persist in `ItemChoice.value`

Typical shape:

```json
{
  "value": {
    "added": {},
    "replaced": {}
  }
}
```

Why:

- later edits or reimports need to know what was chosen
- replacement logic depends on remembering what got swapped

