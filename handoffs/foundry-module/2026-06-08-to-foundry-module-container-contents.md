# Request → `foundry-module`: container CONTENTS round-trip (option C — flat siblings) (2026-06-08)

Follow-up to `2026-06-07-items-native-conversion.md`. We chose **option C (flat
siblings)** for container contents. The **app-side export is built + verified**: a
container's `dauligor.item-item.v1` bundle now carries a top-level `contents[]`
array — the `container_contents` recipe expanded into full child item docs. This
asks the module to (1) materialize those children on import, and (2) make sure a
container export carries its children back for our re-import.

## What the app now emits (the contract)

`GET /api/module/items/<dbId>.json` for a container returns the usual bundle PLUS a
`contents[]` array (verified live against a seeded `Explorer's Pack` = `10× Torch`
[reference] + `Ball bearings` [custom]):

```jsonc
{
  "kind": "dauligor.item-item.v1",
  "item": { "name": "Explorer's Pack", "type": "container", "system": { /* … */ } },
  "contents": [
    {                                    // REFERENCE content — a full copy of the catalog item
      "name": "Torch", "type": "loot",
      "system": { /* …full system… */, "container": "<containerSlug>", "quantity": 10 },
      "flags": { "dauligor-pairing": {
        "sourceId": "torch",             // ← child catalog item's slug (the re-import key)
        "container": "<containerSlug>",
        "contentKind": "reference",
        "contentQuantity": 10
      } }
    },
    {                                    // CUSTOM one-off — no catalog item
      "name": "Ball bearings", "type": "loot",
      "system": { "container": "<containerSlug>", "quantity": 1, /* … */ },
      "flags": { "dauligor-pairing": {
        "container": "<containerSlug>", "contentKind": "custom",
        "contentQuantity": 1, "custom": { "name": "Ball bearings" }
      } }
    }
  ]
}
```

- `contents` is present **only** for container/backpack bundles that have recipe
  rows; absent otherwise. Each entry is a complete item doc — create it as-is.
- `system.container` holds the **container's sourceId slug** as a placeholder — see
  the remap step below.
- `flags.dauligor-pairing.contentKind` = `reference` | `custom`. References carry
  the child's catalog `sourceId` slug (the re-import key); customs carry `custom`.

## Module TODO 1 — import-service: materialize `contents[]`

When importing a container bundle that has `contents[]`:
1. Create the container item first; capture its **new Foundry `_id`**.
2. For each `contents[]` child, create it as a sibling item and **remap**
   `system.container` from the placeholder slug to the container's new `_id`
   (Foundry's `system.container` must be a real item id, not our slug). Apply
   `system.quantity`.

This is the within-batch remap the contract depends on — Foundry then nests the
children under the container natively. `normalizeItemPayload` already preserves
`system.*`; this adds the create-container-then-children + id-remap step.

## Module TODO 2 — export-service: keep children with their container

For Foundry→app, our `itemImport` collapses a container's children back into
`container_contents` rows by matching each child's slug. For that, **a container
export must include its child items** (each a normal item entry carrying
`system.container`). For **folder exports this likely already happens** (children
are separate Foundry docs in the folder) — please confirm. If a single-container
export path drops the children, gather + include them.

App-side grouping is by `system.container` ↔ the container entry's
`sourceDocument._id` within the batch, so children only need `system.container`
set to their container's Foundry `_id` (Foundry-native) — no extra fields required.

## App side — status + what's left

- ✅ **Export expansion DONE + verified** (`_itemExport.ts buildItemBundle` →
  `contents[]`; reference + custom; `system.container` + `quantity` + flags).
- ✅ **Import collapse DONE** (`itemImport.ts` + `ItemImportWorkbench`: folder
  children grouped by `system.container` ↔ container `sourceDocument._id`,
  committed as `container_contents` rows — slug-match → reference, else custom;
  idempotent per-container replace). Now that your TODO 2 emits the children, this
  is unblocked + landed. Grouping verified by fixture.
- ⏳ **One check left:** a live end-to-end pass — export a Foundry folder with a
  populated container → import through the workbench → confirm the recipe rows.
  Slots into the deferred full round-trip verification whenever you're ready.

## Field round-trip (consumable + container) — also shipped app-side today

Separately, `_itemExport.ts`/`itemImport.ts` now round-trip the per-field data:
consumable `system.type.value` / `.subtype` + `system.damage`; container
`system.currency`; `type_inner_subtype`. (Fixed a bug where consumable subtype
always exported as `"potion"`.) Module side already handled per your reply.

## No DB changes
`container_contents` (migration `20260608-1200`) is already on local + remote.
