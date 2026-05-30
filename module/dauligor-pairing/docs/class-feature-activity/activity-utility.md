# utility activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

### `utility`

Use for generic rolls, passive support actions, or arbitrary nonstandard utility rolls.

Type-specific fields:

```json
{
  "roll": {
    "formula": "",
    "name": "",
    "prompt": false,
    "visible": false
  }
}
```

Important meanings:

- `roll.formula`: arbitrary roll formula
- `roll.name`: label for the roll
- `roll.prompt`: whether to prompt before rolling
- `roll.visible`: whether to expose the roll in UI/chat

