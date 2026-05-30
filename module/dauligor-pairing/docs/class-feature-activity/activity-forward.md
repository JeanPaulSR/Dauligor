# forward activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

### `forward`

Use when one activity simply forwards into another activity with altered consumption or activation context.

Type-specific fields:

```json
{
  "activity": {
    "id": null
  }
}
```

Important meanings:

- `activity.id`: referenced sibling activity id on the same item

Field contract:

- `activity.id`
  - type: Foundry document id string
  - expected source: sibling activity `_id` on the same item
- shared fields which still apply:
  - `activation`
  - `consumption`
  - `description`
  - `uses`
  - `visibility`

Important difference:

Forward activities remove these base fields:

- `duration`
- `effects`
- `range`
- `target`

So do not try to model them like ordinary activities.

What the forward sample proves:

- `activation.override = true`
- `consumption.spellSlot = true`
- `consumption.scaling.allowed = true`
- `consumption.scaling.max = "1"`
- `consumption.targets[]` can include:
  - `type = "material"`
  - `value = "1"`
  - `target = ""`
  - `scaling.mode = "amount"`
  - `scaling.formula = "5"`
- activity-local `uses` can persist:
  - `spent = 3`
  - `max = "3"`
  - `recovery = [{ "period": "recharge", "type": "recoverAll", "formula": "5" }]`

