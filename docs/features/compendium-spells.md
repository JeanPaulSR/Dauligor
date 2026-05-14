# Compendium — Spells

Spell list and editor — data layer, summary index, common tasks. The page-specific UX and authoring flows are split across dedicated docs so this one stays a quick index.

## Sub-docs

| Topic | Doc |
|---|---|
| Public browser (`/compendium/spells`) — layout, columns, sort, settings, detail pane | [compendium-spells-browser.md](compendium-spells-browser.md) |
| Admin editor + Foundry importer (`/compendium/spells/manage`) | [compendium-spells-editor.md](compendium-spells-editor.md) |
| Favourites system (Universal + per-character, cloud sync) | [spell-favorites.md](spell-favorites.md) |

## Pages

| Route | File | Purpose |
|---|---|---|
| `/compendium/spells` | [SpellList.tsx](../../src/pages/compendium/SpellList.tsx) | Public spell browser |
| `/compendium/spells/manage` | [SpellsEditor.tsx](../../src/pages/compendium/SpellsEditor.tsx) | Admin: manual editor + Foundry import workbench |

## Data layer (D1)

| Table | Role |
|---|---|
| `spells` | Full spell document (level, school, components, description, activities, effects, foundry_data, image_url, source_id, page, tags) |
| `spell_summaries` | Light index for list/search rendering (name, identifier, level, school, tagIds, image_url, source meta) |
| `user_spell_favorites` | Universal-scope favourites — see [spell-favorites.md](spell-favorites.md) |
| `character_spell_favorites` | Per-character-scope favourites — see [spell-favorites.md](spell-favorites.md) |

Schema for `spells` + `spell_summaries`: full breakdown in [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md). The `spells` table mirrors Foundry's spell shape — `system.activities`, top-level `effects`, plus `foundryDocument` (the authoritative original Foundry payload kept for round-trips).

## Summary index pattern

Listing every spell would mean fetching the full row including descriptions, activities, and effects — wasteful when the user is just scanning a table. The `spell_summaries` table holds a thin row per spell with the fields needed for left-pane rendering and filters; the full row is only fetched when a spell is selected.

Helper module: [src/lib/spellSummary.ts](../../src/lib/spellSummary.ts).

> **Migration status:** `spellSummary.ts` is on D1; the summary index is derived on demand from the `spells` table rather than maintained as a separate `spell_summaries` table.

## Spell preparation modes

Foundry-native values:

| Value | Means |
|---|---|
| `spell` | Default for prepared casters (was incorrectly `prepared` previously — fixed) |
| `pact` | Warlock pact magic |
| `prepared` | (Legacy / non-canonical — avoid) |
| `always` | Always-prepared (e.g., domain spells) |
| `innate` | Innate casting |
| `ritual` | Ritual-only |

Preparation behaviour is handled by Foundry on import; Dauligor just records the mode.

## Common tasks

### Add a new spell

- Use the **Foundry Import** workbench at `/compendium/spells/manage` if you have a Foundry export — it preserves the authoritative payload. See [compendium-spells-editor.md — Foundry Import workbench](compendium-spells-editor.md#foundry-import-workbench).
- Use the **Manual Editor** (same page, other tab) for homebrew. Generated images can be uploaded inline; the icon goes to `images/spells/<id>/`.

### Add a new spell tag

Tags are managed in `/compendium/tags` (see [compendium-options.md](compendium-options.md)). Create a tag group with classification `spell`, then add tags. Spells get tagged in the importer's right pane or in the editor's right-column Tags tab.

### Bulk import a source's spell list

1. In Foundry, organise the source's spells into a single Item folder.
2. Use the pairing module's "Export Spell Folder" → save the JSON.
3. Open the workbench, drag the JSON in, assign source if not auto-matched, batch-import.

### Re-importing existing spells

The importer matches by `identifier`. Re-importing updates `foundry_data` and any shell fields that were changed. Manual edits to description/tags are **not** preserved across re-imports — keep manual changes in mind.

### Star a spell for later

Use the ⭐ button on a row in the detail pane on `/compendium/spells`. The favourites pane on the left shows your starred spells. Switching between **Universal Favorite** and a specific character in the scope dropdown changes which list the star toggles target. See [spell-favorites.md](spell-favorites.md).

## Related docs

- [compendium-classes.md](compendium-classes.md) — how class spell lists reference spells
- [compendium-options.md](compendium-options.md) — tag groups and tags
- [foundry-export.md](foundry-export.md) — round-trip back to Foundry
- [../ui/bbcode.md](../ui/bbcode.md) — description storage format
- [../../worker/migrations/0006_spells.sql](../../worker/migrations/0006_spells.sql) — `spells` table DDL (no per-table doc yet under `docs/database/structure/`)
- [../_archive/foundry-spell-import-research.md](../_archive/foundry-spell-import-research.md) — design notes from the import research pass
