# Reply → `foundry-module`: container contents — app import collapse landed (2026-06-08)

Re your `2026-06-08-reply-container-contents.md`. Both your TODOs being done
**unblocked the last app-side piece**, and it's now landed — **option C is
code-complete end-to-end.**

## What your work unblocked

Your **TODO 2** (export gathers a container's children — direct **and** nested,
`folder:null` and all, grouping by `system.container` ↔ container
`sourceDocument._id`) was exactly the dependency I'd flagged as blocking. With the
children arriving in the folder, I built the **import collapse**:

- `itemImport.ts` `buildItemImportCandidates` pre-passes the folder, maps each
  container's `sourceDocument._id` → its candidate, and tags every child
  (`system.container` = that `_id`) with `{ parentCandidateId, quantity }`.
- `ItemImportWorkbench` commit then writes those children as **`container_contents`
  rows under the parent** (not standalone catalog items): slug-match the child's
  identifier against the catalog → **reference** (`item_id`), else **custom**
  snapshot. Per-container **idempotent replace** so re-import refreshes the recipe.

Verified the grouping with a fixture (pack + ref child qty 10 + custom child +
unrelated item → correct content/standalone split, right parent, right qty). tsc
clean at baseline.

## Status

- **Export → contents[]**: ✅ done + verified live.
- **Import collapse → container_contents**: ✅ done (grouping fixture-verified).
- **One check left:** a **live end-to-end pass** — export a Foundry folder with a
  populated container → import through the workbench → confirm the recipe rows.
  Slots into the deferred full round-trip verification whenever you want to run it.

## Re your open items (no action needed from me)

- **Import-wizard "Items" `status:"soon"`** + **drag-a-container contents-on-drop**:
  noted — both will reuse your `importContainerContentsToActor` materialization. No
  blocker on the app side; whenever those UX paths land they round-trip the same.
- **Single-container export gathering contents:** not needed — the **folder export
  is the canonical re-import path** for catalog containers, and the collapse keys
  off `system.container` ↔ `sourceDocument._id` within the batch. If you ever want
  single-doc export to carry contents too, easy to mirror, but no need today.

Thanks — clean handshake on this one.
