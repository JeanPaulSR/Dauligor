# Compendium — Races & Backgrounds

> **Status:** ✅ Editors shipped, ⚠️ Public list pages still placeholders.
>
> **Read first:**
> - [`docs/features/compendium-feats-items.md`](compendium-feats-items.md) — feats live in the same table, same shape applies
> - [`docs/features/compendium-spells-browser.md`](compendium-spells-browser.md) — the public-browser template the placeholders aim to grow into

This page tells a future contributor how to take the Races / Backgrounds **placeholder** list pages and grow them into a real public browse surface — patterned after `/compendium/spells` and `/compendium/feats`. It also documents the storage shape so backend work that adds dedicated tables knows where to slot in.

---

## 1. What ships today

| Surface | URL | Component | Status |
|---|---|---|---|
| Public list (Races) | `/compendium/races` | `src/pages/compendium/RacesList.tsx` | **Placeholder** — explains the storage shape and links to `/manage` for admins |
| Public list (Backgrounds) | `/compendium/backgrounds` | `src/pages/compendium/BackgroundsList.tsx` | **Placeholder** — same shape |
| Admin editor (Races) | `/compendium/races/manage` | `src/pages/compendium/RaceEditor.tsx` → `FeatsEditor scopeFeatType="race"` | ✅ Shipped |
| Admin editor (Backgrounds) | `/compendium/backgrounds/manage` | `src/pages/compendium/BackgroundEditor.tsx` → `FeatsEditor scopeFeatType="background"` | ✅ Shipped |
| Sidebar nav | `Compendium → Races / Backgrounds` | `src/components/Sidebar.tsx` | ✅ Shipped |

The placeholders intentionally include a "Manage" button for admins / content-creators so the editor is reachable from the public surface while the browser catches up.

---

## 2. Storage shape (today)

Race + Background entries live **inside the `feats` table** with a discriminator column:

```sql
SELECT * FROM feats WHERE feat_type = 'race';        -- races
SELECT * FROM feats WHERE feat_type = 'background';  -- backgrounds
```

Everything else about the row matches the existing feat schema — same `description`, `requirements_tree`, `advancements`, `activities`, `effects`, `tags`, etc. This was a deliberate decision: races and backgrounds are mechanically very close to feats (both grant features, ability bumps, language / tool proficiencies, sometimes spells) so duplicating the table layout would have created three near-identical migration paths for very little payoff.

When dedicated `races` / `backgrounds` tables eventually land, the discriminator-based reads become the migration source — see §5.

---

## 3. RaceEditor / BackgroundEditor — thin wrappers

```tsx
// src/pages/compendium/RaceEditor.tsx
export default function RaceEditor({ userProfile }: { userProfile: any }) {
  return <FeatsEditor userProfile={userProfile} scopeFeatType="race" />;
}
```

Both editors are 21-line wrappers that forward `scopeFeatType` to `FeatsEditor`. The prop drives four behaviours in `FeatsEditor` ([`src/pages/compendium/FeatsEditor.tsx`](../../src/pages/compendium/FeatsEditor.tsx)):

1. **List filter** — only rows with matching `feat_type` show up in the master pane
2. **New-entry default** — the "+ New" button defaults the new row to the scoped type
3. **Shell labels** — back link reads "Back to Races" / "Back to Backgrounds", title shows accordingly
4. **AdvancementManager parentContext** — `parentContext='race'` / `'background'` is forwarded, which configures the advancement editor for the feat-context behaviour (hidden HitPoints / Size, level-floor of 0, etc.)

**When the dedicated `races` / `backgrounds` tables ship**, swap the body of these wrappers to point at the new editors. The route + sidebar entry stay the same so users see no change.

---

## 4. Implementing the public list pages

The placeholders should grow into full list pages mirroring [`SpellList.tsx`](../../src/pages/compendium/SpellList.tsx) / [`FeatList.tsx`](../../src/pages/compendium/FeatList.tsx). Both consume the shared [`CompendiumBrowserShell`](../../src/components/compendium/CompendiumBrowserShell.tsx) — the foundation is already in place; the work is in wiring the data + filter axes.

### 4.1 Recommended dependencies

Everything needed already exists in `origin/main`:

| Need | Use |
|---|---|
| 3-pane responsive layout | `<CompendiumBrowserShell>` (page shell with master + detail) |
| Tri-state filter pills | `<SectionFilterPanel>` + `useAxisFilters` hook |
| Search input with clear ✕ + count | `<SearchInput>` (drop-in) |
| Filter button + active-count badge | `<FilterBar>` (drop-in) |
| Detail pane | Pattern after `FeatDetailPanel.tsx` — same shape can serve all three since storage is identical |
| Favorites system (if wanted) | Add `useRaceFavorites` / `useBackgroundFavorites` libs paralleling [`featFavorites.ts`](../../src/lib/featFavorites.ts) + a new D1 migration |

### 4.2 Data flow

The same fetch path FeatList uses:

```ts
fetchCollection<any>('feats', {
  where: "feat_type = ?",
  params: ['race'],            // or 'background'
  orderBy: 'name ASC',
})
```

Server-side endpoint: existing `/api/d1/query` proxy. Foundry-side
endpoint for the importer: when the dedicated source-races / source-backgrounds endpoints land, mirror `_sourceFeatList.ts` + `_featExport.ts` — those are the closest precedents.

### 4.3 Suggested filter axes

Mirroring the feat filter set from [`src/lib/featFilters.ts`](../../src/lib/featFilters.ts):

**Races:**
- Source (PHB / TCE / MOTM / …)
- Size (Small / Medium / Large)
- Speed bucket (25 / 30 / 35+)
- Tag-group filters (Heritage, Subrace tag groups, etc.)
- Repeatable? (the same flag feats use; rarely set for races)

**Backgrounds:**
- Source
- Granted skill proficiencies (filter by which skills it gives)
- Granted tool / language proficiencies
- Has feature? (some backgrounds have a unique feature, others don't)
- Tag-group filters

### 4.4 Step-by-step

1. **Copy `FeatList.tsx` to `RacesList.tsx`** (or `BackgroundsList.tsx`); rename the export, drop the existing placeholder body.
2. **Scope the fetch** — add `where: "feat_type = 'race'"` to the `fetchCollection` call.
3. **Add filter axes** — define the relevant axes in a new `src/lib/raceFilters.ts` (or `backgroundFilters.ts`) paralleling `featFilters.ts`.
4. **Wire up the detail panel** — point `renderDetail` at a new `RaceDetailPanel` (copy `FeatDetailPanel` and trim the feat-only fields).
5. **Test in the browser** — verify the placeholder warning is gone and the rows render.
6. **Update this doc** — flip the status table in §1 to ✅.

The CompendiumBrowserShell handles all the responsive collapse, virtualization, sort-column rendering, and favourites pin behaviour for you.

---

## 5. Migration path — when dedicated tables land

If / when the team decides races and backgrounds deserve their own D1 tables (likely once distinguishing fields like ASI bonus, speed, size, racial features become first-class enough to deserve their own columns), the migration path is:

1. **Add `races` / `backgrounds` tables** — copy the `feats` schema minus the `feat_type` / `feat_subtype` columns. Add table-specific columns (e.g. `races.size`, `races.speed`, `races.ability_score_increases`, `backgrounds.starting_equipment`).
2. **One-shot migration** — `INSERT INTO races SELECT … FROM feats WHERE feat_type = 'race'`; same for backgrounds. The unique IDs are preserved so cross-references survive.
3. **Drop the discriminator rows** from `feats` after verification.
4. **Replace `RaceEditor.tsx` / `BackgroundEditor.tsx` bodies** with the new dedicated editors. Route + sidebar entry stay the same — users see no break.
5. **Update `AdvancementManager.parentContext`** to read from the dedicated tables (the prop name stays — the logic for race / background context is already discriminator-aware).

The wrappers' job is to **defer that decision** until product needs it, without leaving the route + nav surface in limbo.

---

## 6. Foundry round-trip

Today the Foundry import workbenches treat races / backgrounds as **feats with a discriminator**:

- `feat-import-contract.md` § "General Feats vs. Class Features" — the same `sourceType` discriminator works for `'race'` / `'background'` if the module ever exports them as that shape
- The Foundry feat browser (`module/dauligor-pairing/scripts/feat-browser-app.js`) doesn't currently surface a "race" / "background" filter axis. Adding one is a small section-filter-panel addition keyed on `flags.dauligor-pairing.featType`

When the dedicated tables land per §5, the Foundry side would need its own import contracts (`race-import-contract.md`, `background-import-contract.md`) + their per-source endpoints, paralleling the existing feat contract.

---

## 7. Cross-references

- [`docs/features/compendium-feats-items.md`](compendium-feats-items.md) — the canonical feats reference; everything in §2 is just "the feats schema" + a discriminator
- [`docs/architecture/compendium-editor-patterns.md`](../architecture/compendium-editor-patterns.md) — the shell architecture
- [`src/pages/compendium/FeatsEditor.tsx`](../../src/pages/compendium/FeatsEditor.tsx) — read the `scopeFeatType` prop handling around lines 162–414 to see exactly what behaviours the wrapper triggers
- [`module/dauligor-pairing/docs/feat-import-contract.md`](../../module/dauligor-pairing/docs/feat-import-contract.md) — the Foundry-side feat contract that race / background imports would extend
