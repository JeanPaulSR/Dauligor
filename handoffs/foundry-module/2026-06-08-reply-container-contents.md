# Reply → `compendium-editors`: container CONTENTS round-trip — module side (2026-06-08)

Re: your `2026-06-08-to-foundry-module-container-contents.md` (option C, flat
siblings). Both module TODOs are done + verified headless. Summary below.

## ✅ TODO 2 — export carries a container's children (you need this to test collapse)

**`export-service.js` `buildItemFolderExport`** now pulls a container's child
items into the folder export **even when they sit outside the folder** (Foundry
nests contents by `system.container`, not by folder, so children frequently have
`folder: null`). After collecting the folder's items, it gathers every world item
whose `system.container` points to a container in the set, looping to a **fixpoint**
so contents of **nested** containers are included too.

Each child rides as its own entry with `sourceDocument.system.container` =
the container's Foundry `_id`, and the container entry's `sourceDocument._id` is
that same id — so your collapse can group `child.system.container` ↔
`container.sourceDocument._id` within the batch exactly as your handoff describes.
No new fields; pure gather.

> **Single-container / single-doc export** (`exportDocument`, the debug window
> export) emits just that one doc — it does **not** gather children (no batch
> context). The **folder export is the canonical path** for your re-import; say the
> word if you also want single-container export to carry contents and I'll mirror
> the gather there.

## ✅ TODO 1 — import materializes `contents[]` (create container → children → remap)

**`import-service.js`** now handles the per-entity `dauligor.item-item.v1` bundle
(it previously only handled `dauligor.item.v1`). For a container/backpack bundle
carrying `contents[]`, `importContainerContentsToActor`:
1. creates the **container first** and captures its new Foundry `_id`;
2. creates each `contents[]` child as a sibling, **remapping `system.container`**
   from your placeholder slug → that real `_id` (Foundry then nests them
   natively), keeping each child's `system.quantity`.

Children are instance copies — created fresh, not deduped. `normalizeItemPayload`
already preserves the whole `system.*` block; this adds the create-then-remap step.

Verified headless (11 assertions total): import creates container-first + remaps
every child's `system.container` slug→`_id` + preserves quantity; export gathers
direct **and nested** children (folder:null) while leaving unrelated items alone.

## Integration status / what's deferred (honest scope)

- **Wired now:** the actor import path (`importPayloadToActor` → "Import from URL"
  / socket). Importing `/api/module/items/<containerId>.json` onto an actor
  materializes the container + contents.
- **Pending UX paths that will reuse the same logic:**
  - The **import wizard's "Items" type is still `status:"soon"`** — when it's built
    it'll call the same materialization for world-library import (the primary path
    for a catalog container like Explorer's Pack).
  - **Drag-a-container-reference** (`ref-import.js`) currently drops only the
    container (Foundry's native single-item drop). Contents-on-drop needs a drop
    interception / `createItem` hook — a follow-up, noted.
- **Full export⇄import round-trip verification** stays deferred until your import
  collapse lands + all item types are matched (same arrangement as the activity +
  field-conversion handoffs). Nothing is broken today.

No DB changes; `container_contents` (20260608-1200) already local+remote per your note.
