# Archived — `compendium-editors`: Subspecies + Species Options (SHIPPED to main, 2026-06-03)

> **Archival record** (not a resume doc). Everything below shipped and deployed on
> 2026-06-03. `origin/main` @ `939b2fb`; Cloudflare Pages auto-deployed; the 3 remote
> D1 migrations were applied first (schema before code, so species saves never broke).

## What shipped (10 commits, `80096b2..939b2fb`)

### Subspecies — child species under a parent (Elf → High Elf)
- **Model:** a subspecies is a *complete* species that names a parent and exports as its own
  stand-alone Foundry `race` item (dnd5e has no subrace item type). Reuses the species editor,
  `_raceExport`, browser, and `/api/module/races/<id>.json` unchanged.
- **Schema:** `species.parentSpeciesId` self-FK `ON DELETE SET NULL` (deleting a parent promotes
  children to base species — verified empirically) + `idx_species_parent`.
- **Editor:** a base-species-only **Subspecies tab** (`SubspeciesTab`) lists children, "New
  Subspecies" creates a child pre-filled from the parent then opens it in the same editor (with a
  "Subspecies of X · ← Back" banner), plus edit/delete. One level deep. Children hidden from the
  flat list. Shell gained a generic `contextBanner` slot + a defensive active-sub-tab guard.
- **Browser:** children grouped under their parent (hidden from the top list; listed on the parent
  detail; back-link from a child).
- **Export:** optional `flags.dauligor-pairing.parentRaceId` = parent dbId (metadata for future
  module grouping).

### Import-workbench fixes
- Themed the source pickers (`SingleSelectSearch`, replacing raw `<select>`s).
- Fixed the `species_source_identifier_uniq` crash on batch import: resolve each candidate's target
  row by its EFFECTIVE (possibly overridden) natural key (source + identifier) and dedupe the batch,
  so re-imports / source-overrides UPDATE in place instead of inserting a colliding new uuid.

### Species Options — `species_features` consolidated into one mechanism
- **`species_features` retired** → `species_options` (20260603-1600) is the single mechanism for a
  species's granted features. Identical column shape; the old grant path was never finished.
- **Authoring + attaching folded into the species editor's "Options" tab** (`SpeciesOptionsTab`):
  one searchable list of all options with an attach-checkbox per row (writes `speciesOptionIds`) +
  inline create / edit / delete. Creating an option writes to the shared table → it appears for
  every species and auto-attaches to the current one. The standalone manager was removed (route +
  Species-browser "Options" button gone; `CompendiumFeatureEditor` is back to background-only).
- **Foundry export:** `api/_lib/_speciesOptionExport.ts` (a `feat` item, `system.type.value="race"`,
  `flags.entityKind="species-option"`); `_raceExport` reads `speciesOptionIds` → `ItemGrant`
  advancements + embeds the items in `RaceItemBundle.features[]`; live route
  `/api/module/species-options/<id>.json`.
- **View:** the species detail page shows attached options as a "Traits & Options" section.
- **Data migration** `20260603-1900` copied any `species_features` rows into `species_options`
  (0 rows on prod). `species_features` remains as an orphaned tombstone — no destructive DROP.

## Remote D1 migrations applied (2026-06-03)
`20260603-1600` (species_options + `speciesOptionIds`), `20260603-1800` (subspecies
`parentSpeciesId`), `20260603-1900` (species_features → species_options copy). Verified on remote:
both columns present, `species_options` table exists, `parentSpeciesId` FK = SET NULL.

## Open follow-ups (NOT done)
- **🔌 Module handshake (`foundry-module` branch):** the `dauligor-pairing` module must learn to
  consume `/api/module/species-options/<id>.json` + the race bundle's `features[]` (mirrors how it
  imports background features), and optionally group subspecies under a parent via `parentRaceId`.
  App side is self-describing; module side is unimplemented.
- **Inline option editor is lean** (name / identifier / source / page / image / description). The
  other `species_options` columns (`advancements` / `activities` / `effects` / `tags`) are preserved
  across edits but not yet editable in the tab — add if richer options are needed.

## Key files
| Concern | File |
|---|---|
| Species/background editor (tabs: Basics · Traits · Options · Subspecies · Advancement · Scaling) | `src/pages/compendium/SpeciesBackgroundEditor.tsx` |
| Species Options tab (library + attach + inline CRUD) | `src/components/compendium/SpeciesOptionsTab.tsx` |
| Subspecies tab | `src/components/compendium/SubspeciesTab.tsx` |
| Public view (subspecies grouping + attached options) | `src/pages/compendium/SpeciesBackgroundBrowser.tsx` |
| Editor shell (`contextBanner`, sub-tab guard) | `src/components/compendium/CompendiumEditorShell.tsx` |
| Species (race) export + option export | `api/_lib/_raceExport.ts` · `api/_lib/_speciesOptionExport.ts` · `api/_lib/_speciesBackgroundShared.ts` |
| Module route (`species-options/<id>.json`) | `functions/api/module/[[path]].ts` |
| Migrations | `worker/migrations/20260603-1600_species_options.sql` · `…-1800_species_subspecies.sql` · `…-1900_species_features_to_options.sql` |
| Design doc | `docs/_drafts/species-options-design-2026-06-03.html` · feature doc `docs/features/compendium-races-backgrounds.md` |
