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
