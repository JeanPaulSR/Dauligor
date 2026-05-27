# Manual Verification — Scaling Non-Class Owners

Step-by-step checklist for everything shipped on the
`feat/scaling-non-class-owners` branch. Walk through this once the
branch is merged (or while it's still on the branch) to confirm each
piece works end-to-end. Tick boxes as you go.

Linked from [roadmap § Scaling columns for non-class owners](roadmap.md#scaling-columns-for-non-class-owners--follow-ups)
and the [handoff doc](handoff-scaling-non-class-owners.md). Designed
to be skimmable — each item is one user-visible behavior, not an
internal implementation step.

---

## A. ClassEditor regression check (the panel migration)

Phase A.1 extracted the class-columns sidebar into the shared
`ScalingColumnsPanel`. ClassEditor should be visually + behaviorally
identical to before.

- [ ] Open `/compendium/classes/edit/<any-class>` (e.g. Wizard).
- [ ] Right sidebar shows the "Class Columns" panel as before.
- [ ] Inline-renaming a column writes to D1 (verify by refreshing the page).
- [ ] Deleting a column removes it from the sidebar.
- [ ] Clicking "+ Add" opens the full matrix editor.
- [ ] After Save in the matrix editor, the new column appears in the sidebar.
- [ ] "Open Full Matrix Editor" link inside each column row works.

## B. FeatsEditor — column authoring

Phase A.1 + A.1 follow-up: the panel shows in the Advancement
sub-tab, scoped by `feat_type`.

- [ ] Open `/compendium/feats/manage`.
- [ ] Click an existing feat with `feat_type='feat'` (a generic feat).
- [ ] Switch to the **Advancement** sub-tab.
- [ ] At viewports ≥ xl (1280px+), the "Feat Columns" panel appears on the right.
- [ ] At < xl widths, the panel stacks below the AdvancementManager.
- [ ] For a feat with `feat_type='class'` or `'subclass'`, the panel does NOT appear (class features inherit columns from the parent class).
- [ ] In RaceEditor (or feats scoped to `feat_type='race'`), the panel labels as "Race Columns".
- [ ] In BackgroundEditor (or feats scoped to `feat_type='background'`), the panel labels as "Background Columns".
- [ ] On a brand-new unsaved feat, an inert placeholder card reads "Save this feat first to add scaling columns." The panel proper does NOT render yet.
- [ ] After saving the new feat, the placeholder card is replaced with the real panel.

## C. ItemsEditor — column authoring

Phase A.2: items get a Scaling sub-tab.

- [ ] Open `/compendium/items/manage`.
- [ ] Pick an existing item.
- [ ] A new sub-tab labelled **Scaling** sits between Activities and Effects.
- [ ] The "Item Columns" panel renders inside. Same UX as feats.
- [ ] Inline-rename writes through; delete removes; "+ Add" opens the matrix editor.
- [ ] On a brand-new unsaved item, the inert "Save this item first" placeholder appears in the Scaling tab.

## D. URL-backed `editingId` (Phase A.2 navigation fix)

Both FeatsEditor and ItemsEditor now sync `?editingId=<uuid>` on every selection.

- [ ] Open `/compendium/feats/manage`, pick a feat. The URL gains `?editingId=<uuid>`.
- [ ] Refresh the page — same feat is still selected.
- [ ] Pick a different feat — URL updates to the new uuid via `replaceState` (no extra back-button history entries).
- [ ] Click "+ Add" on the Feat Columns panel → ScalingEditor opens. Author + Save.
- [ ] After Save, browser back-nav returns to the feat editor with the **same feat still selected** and the new column visible in the panel.
- [ ] Use browser back / forward — selection follows the URL.
- [ ] Type `?editingId=<some-uuid>` directly in the address bar (without reloading via Enter is fine in React Router) — the editor switches to that feat.
- [ ] Repeat all of the above in ItemsEditor — same behavior.

## E. AdvancementManager picks up owner-scoped columns

The owner's columns should be selectable inside any advancement type that references a `scalingColumnId`.

- [ ] In FeatsEditor on a `feat_type='feat'`, author a Feat Column ("Test Column").
- [ ] In the Advancement sub-tab, add a new ScaleValue advancement.
- [ ] The "Linked scaling column" dropdown lists "Test Column".
- [ ] Pick it → fill in some per-level values via the matrix editor → save.
- [ ] Refresh the page — the linkage is still in place; the ScaleValue advancement still shows "Test Column" as its linked column.
- [ ] Repeat the same in ItemsEditor with an Item Column.

## F. Feat Foundry round-trip (Phase B v1 — `10fa13c`)

- [ ] Author a feat with a column (e.g. "Bloodlust Rage Die") + a ScaleValue advancement linked to that column.
- [ ] Fill in the matrix editor with some per-level values (test both numeric and dice; e.g. `1d6` at level 1, `1d8` at level 5).
- [ ] In Foundry, use the Dauligor importer to import this feat.
- [ ] The imported feat's `system.advancement` map (visible in Foundry's item sheet → Advancement tab) carries a ScaleValue with the right scale data.
- [ ] In a chat macro or formula, `@scale.<feat-identifier>.<column-identifier>` resolves to the matching value at the right character level. (`@scale.bloodlust.rage-die`)
- [ ] Test a race feat with a column — confirm the same flow works for `parent_type='race'`.
- [ ] Test a background feat with a column — same.

## G. Importer round-trip (Phase B.3 — `3cf87a3`)

- [ ] In Foundry, export the feat folder (or any feat with ScaleValue advancements baked in).
- [ ] Open `/compendium/feats/manage`, switch to the **Foundry Import** tab.
- [ ] Drop the export JSON into the workbench.
- [ ] The feat candidate appears in the list. Resolve source mapping if needed.
- [ ] Click "Import" (single or via batch).
- [ ] After import, the feat's row exists. Open it in the Manual Editor.
- [ ] The **Feat Columns** panel shows a new scaling column matching the ScaleValue advancement's identifier.
- [ ] Open the matrix editor for that column — values match what Foundry sent (`1d6` at level 1, etc.).
- [ ] The ScaleValue advancement in the Advancement sub-tab now has its "Linked scaling column" dropdown pointing at the imported column (not blank).
- [ ] **Re-import the same feat**: the column doesn't duplicate. The existing row updates in place.
- [ ] If the existing column was renamed by the author, the rename is **preserved** (only `type`, `values`, `distance_units` get refreshed).

## F'. Item Server Export endpoint (Phase B.2 items — forward direction)

The app now serves `/api/module/items/<dbId>.json` with the Foundry-ready item document, including synthesized ScaleValue advancements from owned `scaling_columns`.

- [ ] Author an item with at least one Item Column (e.g. Amulet of the Devout, "Channel Divinity Bonus" with +1 at every level).
- [ ] Find the item's `dbId` (e.g. via DevTools → Network → look for the item row's id when ItemsEditor loads).
- [ ] Visit `https://www.dauligor.com/api/module/items/<dbId>.json` (or your local dev URL).
- [ ] Response JSON has `kind: "dauligor.item-item.v1"`.
- [ ] `item.system.identifier` matches the item's identifier.
- [ ] `item.system.advancement` contains a ScaleValue entry whose `configuration.identifier` matches the column's identifier.
- [ ] The ScaleValue's `configuration.scale` map has entries for the levels you filled in.
- [ ] Per-item_type system block populated correctly:
  - Weapons: `system.damage`, `system.range`, `system.type.baseItem`
  - Equipment: `system.armor.value`, `system.armor.dex`, `system.strength`, `system.stealth`
  - Tools: `system.type.value` (tool subtype), `system.bonus`
  - Containers: `system.capacity`
- [ ] `flags.dauligor-pairing.sourceId` carries the item's identifier.

Module-side consumer doesn't exist yet — verification is via the URL response only. Once a Foundry-side item importer lands, the full end-to-end test (import item → @scale.<item>.<col> resolves in play) becomes available.

## H'. Item Importer round-trip (Phase B.3 items — follow-up to `3cf87a3`)

The item importer now extracts ScaleValue advancements off
`sourceDocument.system.advancement` and persists them as
`scaling_columns` rows owned by the item.

- [ ] In Foundry, attach a `ScaleValue` advancement to an item (Amulet of the Devout, etc.) with a per-level scale (e.g. +1 channel-divinity charge from level 1 onward).
- [ ] Export the item via the folder-export workflow.
- [ ] In the app, open `/compendium/items/manage` → **Foundry Import** tab → drop the JSON.
- [ ] Resolve source mapping, hit Import.
- [ ] After import, open the item in the Manual Editor.
- [ ] The **Scaling** sub-tab shows the new "Item Column" matching the ScaleValue's identifier.
- [ ] Matrix editor for that column matches the Foundry-side per-level data.
- [ ] **Re-import**: column doesn't duplicate. Existing row updates in place.
- [ ] Author-side rename of the column persists across re-import (only `type`, `values`, `distance_units` get refreshed).

## H. Verifying the parent_type mapping

The importer's mapping of `feat_type` → `parent_type` matters for cross-direction consistency.

- [ ] Import a Foundry feat with `system.type.value='race'`. The created `scaling_columns` row has `parent_type='race'`.
- [ ] Import one with `system.type.value='background'`. Row has `parent_type='background'`.
- [ ] Import one with `system.type.value='feat'`. Row has `parent_type='feat'`.
- [ ] Import a class feature (`system.type.value='class'`). NO scaling column row is created — class features inherit from the parent class.

(Browser DevTools → Network → check D1 fetch responses, or open `/compendium/scaling/edit/<col-id>` and confirm the parent_type field.)

## I. Visual / regression spot checks

Things that should NOT regress.

- [ ] Class editor still saves correctly (no scaling-related errors in console).
- [ ] FeatsEditor save → stays on the same feat (Phase C of the previous session — sessionKey-stable save). Description editor doesn't scroll back to top.
- [ ] FeatsEditor's prereq detail surface shows resolved proficiency names ("Athletics Proficiency", not "ath Proficiency").
- [ ] FeatList hash deep-link (`#bloodlust_abh`) still works at the public-browser level.
- [ ] No new TypeScript errors when running `npx tsc --noEmit` — only the 7 pre-existing ones.

## J. ItemBumpUses end-to-end (Phase C v1)

Phase C v1 shipped the `ItemBumpUses` advancement type end-to-end:
authoring on classes / subclasses / feats / items, character builder
runtime, and Foundry actor export. See
[handoff-phase-c-itembumpuses.md](handoff-phase-c-itembumpuses.md)
for design calls and what's still queued.

### J.1 Authoring on classes / subclasses / feats

- [ ] Open a class editor (e.g. Cleric) → Advancement tab → "+ Add Row".
- [ ] In the modal's **Advancement Type** dropdown, "Bump Uses" appears in the list.
- [ ] Pick "Bump Uses". The editor body shows two fieldsets:
  - **Target**: a kind picker (Class Feature / Feat) + an entity dropdown.
  - **Bump Amount**: a formula input + a "Resolution" help card.
- [ ] Default target kind is "Class Feature". Switching to "Feat" repopulates the dropdown with the catalog passed via `availableFeats`.
- [ ] Pick a target (e.g. "Channel Divinity" feature on Cleric) and type an amount (e.g. `+1`).
- [ ] Save the advancement. The list row shows the title (or default label "Bump Uses") with the subtitle `+1 to a feature's uses`.
- [ ] Reopen the advancement — the kind / target / amount survive the round-trip.
- [ ] Try the same in a **feat editor** (`/compendium/feats/manage` → pick a feat with `feat_type='feat'` → Advancement sub-tab). "Bump Uses" should appear in the type list there too.

### J.2 Character builder runtime (Phase C.4)

The shared walker in [characterLogic.ts](../src/lib/characterLogic.ts)
(`collectItemBumpUses`) feeds a new effect in
[CharacterBuilder.tsx](../src/pages/characters/CharacterBuilder.tsx)
that derives `character.derivedItemBumpUses = { bumps, warnings }`.

- [ ] Author a class feature with a `usesMax` (e.g. Channel Divinity, uses_max = `1`).
- [ ] On a different feature (or a feat), author an `ItemBumpUses` advancement targeting the first feature with amount `+1`.
- [ ] Create a character that owns both. The character state (DevTools React inspector → `character.derivedItemBumpUses`) shows a `bumps` map with one entry under `feature:<channel-divinity-id>`.
- [ ] Demote the character below the level that grants the bumping feature. The bump disappears from the map (effective-level gating).
- [ ] Author a bumping advancement that targets a feature/feat the character doesn't own. A toast appears with the warning text: `<source name> (<source kind>) → target <kind> <id> not present on the character.` The warning fingerprint dedupes so the toast doesn't re-fire on every render.
- [ ] Author a bumping advancement and leave the target picker empty — the toast reports `... ItemBumpUses advancement has no target picked.`

### J.3 Foundry export pass-through (Phase C.5)

The exporter in [characterShared.ts](../src/lib/characterShared.ts)
fetches feature rows from D1, calls the same `collectItemBumpUses`
helper, and bakes the result into the exported actor.

- [ ] Run "Export Character" on the character set up above.
- [ ] In the downloaded JSON, find the feature item under `items[]` whose `flags["dauligor-pairing"].sourceId` matches the bumped feature's identifier.
- [ ] `system.uses.max` is the **combined formula** — the feature's authored `uses_max` plus each bump's amount stitched with normalized signs (e.g. `1 + 1` for a base of `1` and a single `+1` bump).
- [ ] `flags["dauligor-pairing"].itemBumpUses` is an array of `{amount, sourceKind, sourceId, sourceName, sourceAdvancementId}` — one entry per bump that stacked on this feature.
- [ ] `actor.flags["dauligor-pairing"].itemBumpUses` carries `{ bumps, warnings }` for the whole actor — the module side can read this for audit / debug UIs without re-walking the advancements.
- [ ] Features with **no** bump and **no** authored `uses_max` still render without `system.uses` (no shape regression for existing exports).

### J.4 Items as bump authors (Phase C — items advancements column)

Items now own the same `advancements` JSON column feats use. Migration
`20260527-1200_items_advancements.sql` adds the column;
[ItemsEditor.tsx](../src/pages/compendium/ItemsEditor.tsx) mounts the
same `AdvancementManager` classes / subclasses / feats use on a new
**Advancement** sub-tab between Activities and Scaling.

- [ ] Apply the local migration (auto-applied via the migration runner; manually via `wrangler d1 execute dauligor-db --local --file=worker/migrations/20260527-1200_items_advancements.sql`).
- [ ] Open `/compendium/items/manage` → pick an item (Amulet of the Devout works well).
- [ ] A new sub-tab labelled **Advancement** sits between Activities and Scaling.
- [ ] The familiar AdvancementManager renders inside, with the type menu including "Bump Uses".
- [ ] Author an ItemBumpUses targeting a class feature (e.g. Channel Divinity) with amount `+1`.
- [ ] Save the item. Refresh the page — the advancement is still there with all fields preserved.
- [ ] Re-open the advancement — kind / target / amount round-trip correctly.
- [ ] Pick an item with `item_type='weapon'` or `'tool'` — the Advancement tab is available regardless of item type (item type discriminates other fields, not advancements).

### J.5 Known limitations

1. **Item-authored bumps don't fire in the character runtime yet**. `collectItemBumpUses` accepts `ownedFeats` but not `ownedItems`. Authoring round-trips cleanly through the items editor (per § J.4), but the CharacterBuilder + Foundry export don't walk item advancements yet. Unblocks once the walker is extended to accept owned items.
2. **Feat-authored bumps don't fire in the server export**. The export pipeline rebuilds the character from D1 columns, and `character.feats` is a client-only synthesis — it doesn't round-trip through `rebuildCharacterFromSql`. Feat advancements that bump a feature work app-side (toast + derived state) but the exported actor data won't carry those bumps until a server-side feat synthesizer ships.
3. **`derivedItemBumpUses` is not persisted to D1**. It re-derives every time the character is loaded or the relevant deps change. Don't rely on it being present in raw D1 reads.
4. **Remote migration not yet applied**. The local D1 has the items.advancements column; the remote D1 still needs `wrangler d1 execute dauligor-db --remote --file=worker/migrations/20260527-1200_items_advancements.sql` (gated behind explicit user permission per project policy).

---

## When something fails

Note the specific step that breaks + paste the browser console + any
network failures. The shared code paths most likely to be the
culprit:

- `src/components/compendium/ScalingColumnsPanel.tsx` — UI for any scaling column surface
- `src/lib/scalingImport.ts` — the importer-side normalizer
- `api/_lib/_classExport.ts` — the export-side normalizer (shared between class + feat)
- `api/_lib/_featExport.ts` — feat-specific export wiring

If a step still fails after a Vite restart + hard refresh, that's a real bug; flag the step number and we'll dig in.
