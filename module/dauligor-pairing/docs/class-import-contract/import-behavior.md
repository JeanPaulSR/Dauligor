# Import Behavior & Legacy Payloads

> Part of the [Class Import Contract](../class-import-contract.md).

## Import Behavior

When importing a `dauligor.class-bundle.v1` payload, the module should:

1. validate `kind`
2. validate that `classItem.type === "class"`
3. upsert `classFeatures[]` into world items
4. resolve `ItemGrant` references by `sourceId`
5. upsert the `classItem` into world items
6. preserve `flags.dauligor-pairing.sourceId` on every imported document
7. preserve `flags.dauligor-pairing.entityId` and `flags.dauligor-pairing.sourceBookId` when supplied

World item matching order:

1. `flags.dauligor-pairing.entityId`
2. `flags.dauligor-pairing.sourceId`
3. `system.identifier`
4. `name` + `type` as a fallback

Actor item matching order:

1. `flags.dauligor-pairing.entityId`
2. `flags.dauligor-pairing.sourceId`
3. `system.identifier`
4. `name` + `type` as a fallback

## Actor Import Notes

When a class is imported from an actor sheet:

1. the class is embedded directly on that actor
2. only non-`ItemGrant` advancements are kept on the embedded class item
3. `ItemGrant` advancements are resolved by the importer into embedded class-feature items
4. only features at or below the chosen class level are embedded
5. higher-level class features previously imported for the same class are removed
6. the module reuses `flags.dauligor-pairing.advancementIdMap` so actor-side advancements keep stable local ids

This is important for future reimport and level-up support.

## Legacy Raw Payloads

The module should also keep accepting these research/testing payloads:

1. a raw Foundry-like class item object
2. `dauligor.item.v1` where `item.type === "class"`

These legacy payloads are useful for research, but they are not the preferred Dauligor app contract because they cannot safely express feature references without leaking Foundry-specific UUID assumptions.

