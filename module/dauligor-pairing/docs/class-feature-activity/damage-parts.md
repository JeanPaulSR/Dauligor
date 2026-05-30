# Damage Part Structure

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

## Damage Part Structure

Both damage-style and heal-style activities rely on `DamageField`.

Single damage or healing part structure:

```json
{
  "number": 1,
  "denomination": 6,
  "bonus": "@mod",
  "types": ["fire"],
  "custom": {
    "enabled": false,
    "formula": ""
  },
  "scaling": {
    "mode": "",
    "number": 1,
    "formula": ""
  }
}
```

Meaning:

- `number`: number of dice
- `denomination`: die faces
- `bonus`: additive formula text
- `types`: damage or healing tags
- `custom.enabled/formula`: bypass the auto dice builder and use a custom formula
- `scaling.mode/number/formula`: scaling behavior when the damage changes with spell level or feature scaling

This is one of the most important substructures to capture in a corpus, because your sample leaves every part empty.

The attack corpus example now proves three important real patterns:

1. standard automatic damage

```json
{
  "number": 1,
  "denomination": 4,
  "bonus": "3",
  "types": ["bludgeoning"]
}
```

2. custom-formula damage

```json
{
  "custom": {
    "enabled": true,
    "formula": "3d7"
  },
  "number": null,
  "denomination": null
}
```

3. non-empty scaling modes on a damage part

```json
{
  "scaling": {
    "mode": "whole"
  }
}
```

and:

```json
{
  "scaling": {
    "mode": "half"
  }
}
```

That means the importer should support:

- ordinary dice-based damage parts
- custom damage formulas
- explicit per-part scaling modes

