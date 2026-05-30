# Identity, Sync Metadata, Descriptions & Feature Types

> Part of the [Class Import Contract](../class-import-contract.md).

## Identity Rule

Dauligor should always send stable, semantic ids.

Foundry-safe 16-character `_id` values are a module concern, not an app concern.

That means:

- class `flags.dauligor-pairing.sourceId` should be stable
- class feature `flags.dauligor-pairing.sourceId` should be stable
- advancement `_id` values should be stable semantic ids such as `sorcererHitPoints`
- Dauligor should not try to pre-generate random Foundry ids for advancements

On actor-sheet imports, the module will:

1. convert each semantic advancement id into a valid 16-character Foundry id
2. store that mapping on the embedded actor class item
3. reuse the same mapping on later reimports and level-based syncs

This prevents advancement identity from changing every time a class is re-imported.

## Module-Owned Sync Metadata

The module writes and maintains additional metadata under `flags.dauligor-pairing`.

Dauligor should treat these as importer-managed fields:

- `importedAt`
- `lastSyncedAt`
- `importMode`
- `moduleVersion`
- `payloadKind`
- `schemaVersion`
- `advancementIdMap`

Recommended class flag shape after import:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-sorcerer",
      "sourceType": "class",
      "sourceSystem": "dauligor",
      "sourceEntity": "class",
      "sourceRecordId": "class-sorcerer",
      "rules": "2014",
      "revision": 1,
      "payloadKind": "dauligor.class-bundle.v1",
      "schemaVersion": 1,
      "importMode": "actor",
      "importedAt": "2026-04-18T18:00:00.000Z",
      "lastSyncedAt": "2026-04-18T18:05:00.000Z",
      "moduleVersion": "0.4.1",
      "advancementIdMap": {
        "sorcererHitPoints": "AbCdEf123456GhIj",
        "sorcererSavingThrows": "KlMnOp789012QrSt"
      }
    }
  }
}
```

Important:

- `advancementIdMap` is only needed on embedded actor class items
- world items may keep semantic advancement ids directly
- actor feature items do not need `advancementIdMap`
- embedded actor class items may also persist `proficiencyMode`, currently `primary` or `multiclass`

## Description Payloads

The module now accepts these description families for class, subclass, feature, and class-option text:

- rendered HTML
- BBCode from the app editor
- simple markdown-like prose

Preferred contract:

- if the app is not sending HTML yet, BBCode is the preferred rich-text transport

The module will normalize BBCode and plain markdown-like prose into Foundry HTML during import.

## Feature Type Metadata

Imported class-related feat items now use native `dnd5e` feature typing.

Expected shapes:

- ordinary class/subclass features:

```json
{
  "system": {
    "type": {
      "value": "class",
      "subtype": ""
    }
  }
}
```

- class option items:

```json
{
  "system": {
    "type": {
      "value": "class",
      "subtype": "artificerInfusion"
    }
  }
}
```

or another runtime-registered subtype derived from the option-group name.

The module may also preserve:

- `flags.dauligor-pairing.featureTypeValue`
- `flags.dauligor-pairing.featureTypeSubtype`
- `flags.dauligor-pairing.featureTypeLabel`

for future sorting and display work.

## ASI Behavior

`AbilityScoreImprovement` rows should still be exported as native advancement entries in the root class advancement tree.

During actor import, when the gained class levels cross one or more ASI rows, the module now opens a **custom Dauligor ability-score-improvement app** (`DauligorAbilityScoreImprovementApp`) for those ASIs after the class import completes — not the native `dnd5e` AdvancementManager. The choice is applied directly to the actor.

### Embedded Advancement Metadata

When the module rewrites actor-side advancement ids, it also preserves the Dauligor-side semantic id on each advancement entry:

```json
{
  "_id": "AbCdEf123456GhIj",
  "type": "HitPoints",
  "flags": {
    "dauligor-pairing": {
      "sourceAdvancementId": "sorcererHitPoints"
    }
  }
}
```

That means the actor item can always map:

- semantic Dauligor advancement id
- Foundry-safe local advancement id

without depending on names or timestamps.

