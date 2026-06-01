# Compendium — Species & Backgrounds

> **Status:** ✅ Dedicated tables + editors + Foundry exporters + importers + public browsers all shipped (migration `20260601-1200`). Tables start empty; populate them via each editor's admin-only **Foundry Import** tab.
>
> **Naming:** the user-facing entity is **"Species"** (the D&D 2024 rename of "Race"). The table is `species`, the editor + sidebar say "Species", but the **Foundry export `type` stays `"race"`** for dnd5e compatibility, and the route URL stays `/compendium/races`.
>
> **Read first:**
> - [`docs/features/compendium-feats-items.md`](compendium-feats-items.md) — the feat/item editors; Species + Backgrounds graduated out of the feats table and reuse its widgets (AdvancementManager, TagPicker, ScalingColumnsPanel)
> - [`docs/features/compendium-spells-browser.md`](compendium-spells-browser.md) — the public-browser template these pages are built on (`CompendiumBrowserShell`)

Species and Backgrounds used to live in the `feats` table behind a `feat_type` discriminator (an intentional placeholder). They've now been **promoted to their own dedicated tables** per the roadmap's "new table for new functionality" principle. This page documents what shipped and what's left.

---

## 1. What ships today

| Surface | URL | Component | Status |
|---|---|---|---|
| Public browser (Species) | `/compendium/races` | `RacesList.tsx` → `SpeciesBackgroundBrowser kind="species"` | ✅ Shipped |
| Public browser (Backgrounds) | `/compendium/backgrounds` | `BackgroundsList.tsx` → `SpeciesBackgroundBrowser kind="background"` | ✅ Shipped |
| Import workbench | each editor's "Foundry Import" tab | `SpeciesBackgroundImportWorkbench` | ✅ Shipped (admin-only) |
| Editor (Species) | `/compendium/races/manage` | `RaceEditor.tsx` → `SpeciesBackgroundEditor kind="species"` | ✅ Shipped |
| Editor (Backgrounds) | `/compendium/backgrounds/manage` | `BackgroundEditor.tsx` → `SpeciesBackgroundEditor kind="background"` | ✅ Shipped |
| Foundry export (Species) | `/api/module/races/<dbId>.json` | `api/_lib/_raceExport.ts` | ✅ Reads the `species` table |
| Foundry export (Backgrounds) | `/api/module/backgrounds/<dbId>.json` | `api/_lib/_backgroundExport.ts` | ✅ Reads the `backgrounds` table |
| Sidebar nav | `Compendium → Species / Backgrounds` | `src/components/Sidebar.tsx` | ✅ Shipped |

---

## 2. Storage shape

Two dedicated tables, created by [`worker/migrations/20260601-1200_backgrounds_species_tables.sql`](../../worker/migrations/20260601-1200_backgrounds_species_tables.sql). **Columns are camelCase** (the roadmap's 2026-05-27 decision: new compendium tables are camelCase from day one — Foundry is camelCase end-to-end; the legacy snake_case tables migrate later).

**`species`** — `id`, `name`, `identifier`, `sourceId`, `page`, `description`, `advancements` (JSON), `movement` (JSON `{walk,fly,swim,climb,burrow,hover,units}`), `senses` (JSON `{darkvision,blindsight,tremorsense,truesight,units,special}`), `creatureType` (JSON `{value,subtype,swarm,custom}`), `tags` (JSON), `imageUrl`, `contentHash`, `createdAt`, `updatedAt`.

**`backgrounds`** — `id`, `name`, `identifier`, `sourceId`, `page`, `description`, `advancements` (JSON), `startingEquipment` (JSON EquipmentEntryData tree), `wealth` (formula string), `tags` (JSON), `imageUrl`, `contentHash`, `createdAt`, `updatedAt`.

Both carry a **source-scoped unique index** `…_source_identifier_uniq ON (COALESCE(sourceId,''), identifier)` — two sources may both ship "soldier"; one source may not ship it twice (same pattern as feats/items).

### Plumbing

- **`src/lib/d1Tables.ts`** — `D1_TABLE_MAP` aliases `backgrounds`/`species` to themselves.
- **`src/lib/d1.ts`** — both tables are in `PERSISTENT_TABLES` (read-heavy, sessionStorage-cached); the JSON columns `startingEquipment`/`movement`/`senses`/`creatureType` are added to `queryD1`'s `jsonFields` auto-parse list (`tags`/`advancements` were already there).
- **No `compendium.ts` mapping.** Because the columns are already camelCase, the editor reads/writes through `fetchDocument` / `upsertDocument` **directly** — it does NOT run `normalizeCompendiumData` / `denormalizeCompendiumData` (those are snake↔camel mappers for the legacy tables). The only boundary rename is `tags` (column) ↔ `tagIds` (form), done inline.

---

## 3. SpeciesBackgroundEditor — the shared editor

[`src/pages/compendium/SpeciesBackgroundEditor.tsx`](../../src/pages/compendium/SpeciesBackgroundEditor.tsx) is one component that drives both entities via a `kind: 'species' | 'background'` prop. `RaceEditor.tsx` / `BackgroundEditor.tsx` are now thin wrappers that pass `kind`:

```tsx
export default function RaceEditor({ userProfile }) {
  return <SpeciesBackgroundEditor userProfile={userProfile} kind="species" />;
}
```

It's a **Pattern E** editor built on [`CompendiumEditorShell`](../../src/components/compendium/CompendiumEditorShell.tsx) (3-pane list | editor | preview, super-tabs Editor/Tags). `kind` selects:

- the target table (`species` / `backgrounds`),
- the type-specific Editor sub-tab — **Traits** (movement / senses / creature type) for species, **Details** (wealth / starting equipment) for backgrounds,
- the `AdvancementManager` `parentContext` (`'race'` / `'background'`).

Shared sub-tabs: **Basics** (image / name / identifier / source / page / description), **Advancement** (`AdvancementManager` with the feats/features/option-group/option-item catalogs + the row's own scaling columns), **Scaling** (`ScalingColumnsPanel`, `parentType='race'|'background'` — for ScaleValue traits like Dragonborn breath), and the **Tags** super-tab (`TagPicker`).

**v1 scope / known follow-ups:**
- **Direct-write, admin + content-creator.** Proposal-mode authoring (cascade banners, review highlights, block drafts) is NOT wired — `species` / `background` aren't registered proposal entity types yet (would need a `proposals` CHECK migration). Other editors route content-creators through `/proposals/edit/*`; these don't yet.
- The admin-only **Foundry-Import** workbench mode is wired (see §5).
- **Starting equipment** has no structured tree editor yet (the `wealth` field is editable; existing `startingEquipment` entries round-trip unchanged). The EquipmentEntryData tree is populated by the importer.

---

## 4. Foundry export — live read-through

Both endpoints are public GET, served live (no R2 cache), and now read the **dedicated tables**:

- `api/_lib/_raceExport.ts` → `buildRaceItemBundle` → `type:"race"` + `system.movement` / `system.senses` / `system.type` (from `creatureType`).
- `api/_lib/_backgroundExport.ts` → `buildBackgroundItemBundle` → `type:"background"` + `system.startingEquipment` / `system.wealth`.

Both share [`api/_lib/_speciesBackgroundShared.ts`](../../api/_lib/_speciesBackgroundShared.ts) → `buildSpeciesBackgroundItem`, which builds the common `system` block: `identifier`, `description` (BBCode → HTML), `advancement` (array → dnd5e keyed-object map, with ScaleValue normalization against the row's `scaling_columns`), and `source` (resolved from the `sourceId` FK). Flags preserve the feat-export keys (`featType` = the Foundry type, `featSubtype: ""`, `featSpellSourceId`).

> **Server-side JSON note:** the client `queryD1` auto-parses JSON columns, but the server `ExportFetchers` path does NOT — so the shared builder runs every JSON column through `parseJsonField`, same as `_featExport`/`_classExport`.

Verified end-to-end against local D1: a seeded Mountain Dwarf exports with `movement {walk:25}`, `senses {darkvision:60}`, `type {value:humanoid,subtype:dwarf}`, advancement map, and resolved source block; a seeded Soldier exports with `wealth:"50"` and `startingEquipment:[]`. Both HTTP 200.

---

## 5. Public browsers + import workbench (shipped)

Both `/compendium/races` and `/compendium/backgrounds` render [`SpeciesBackgroundBrowser`](../../src/pages/compendium/SpeciesBackgroundBrowser.tsx) (one component, `kind` prop) on [`CompendiumBrowserShell`](../../src/components/compendium/CompendiumBrowserShell.tsx). Search + a Source axis (+ Creature Type for species); a thumbnail in the name column surfaces imported art; the detail pane renders image / traits / advancements / description (BBCode→HTML) + a Favorite toggle. `RacesList.tsx` / `BackgroundsList.tsx` are thin wrappers passing `kind`. The browsers are **public**; the editor "Manager" link in the toolbar shows for admins only.

Per-user **favorites** persist via `user_species_favorites` / `user_background_favorites` (migration `20260601-1300`) through the `/api/species-favorites` + `/api/background-favorites` endpoints + the [`speciesBackgroundFavorites.ts`](../../src/lib/speciesBackgroundFavorites.ts) hook (one hook, `kind`-keyed). Mirrors feat/spell favorites exactly: local-first for anonymous users, cloud-synced + merged on sign-in; the endpoint derives `user_id` from the verified token. (The shell also gained a `hideFavorites` opt-out, symmetric with `hideFilters`, for future browsers that don't want a favorites pane.)

**Import** — each editor's admin-only **"Foundry Import"** tab mounts [`SpeciesBackgroundImportWorkbench`](../../src/components/compendium/SpeciesBackgroundImportWorkbench.tsx), backed by [`speciesBackgroundImport.ts`](../../src/lib/speciesBackgroundImport.ts). It ingests the dauligor-pairing folder exports (`races` / `backgrounds` arrays) → camelCase rows via direct `upsertDocument`. Notable mapping rules:

- **Images** follow the spell importer (the working reference): absolute `cdn.5e.tools` art is kept; Foundry-relative plutonium placeholders (`family-tree.svg`) drop to empty (they'd 404 off our R2). ~236/280 species + 76/152 backgrounds carry real art.
- **`&Reference[key=Value]`** 5etools enrichers (HTML-escaped) are resolved by the shared `foundryHtmlCleanup` — added there so feat/spell/item imports benefit too.
- **Senses** flatten from `.ranges` on import; `_raceExport` re-nests them for valid dnd5e on export.

---

## 6. Populating the tables

The tables start **empty**; content comes from the Foundry export at `E:\DnD\Professional\Foundry Export` (152 backgrounds + 280 species) via the import workbench (§5). Load the export JSON, review, and **Import Visible** (or per-row). Source-matching is by book/rules against the `sources` table — many 5etools books (EEPC, MPMM, VGM, …) won't match and import with **no source set** (a warning, surfaced as an "unresolved" count + filter, not a blocker). If a future need surfaces a missing column (e.g. top-level `effects`), add it via a follow-up `ALTER TABLE` (local-first).

---

## 7. Cross-references

- [`docs/features/compendium-feats-items.md`](compendium-feats-items.md) — feats/items editors; the shared widgets (AdvancementManager, TagPicker, ScalingColumnsPanel, CompendiumEditorShell) are documented there
- [`docs/architecture/compendium-editor-patterns.md`](../architecture/compendium-editor-patterns.md) — the Pattern E shell architecture
- [`module/dauligor-pairing/docs/feat-import-contract.md`](../../module/dauligor-pairing/docs/feat-import-contract.md) — the Foundry-side feat contract that race / background imports parallel
