# CamelCase Column Migration — retire the compendium alias layer

**Status:** planned tech-debt · **not started** · do as a focused, table-by-table effort
(NOT mixed with feature work).

## The situation

The app has **two** column-naming conventions living side by side:

- **Legacy tables — snake_case columns:** `items`, `feats`, `spells`, `classes`,
  `subclasses`, `features`, `facilities`, `characters` + `character_*`. Columns like
  `source_id`, `image_url`, `item_type`.
- **New tables — camelCase columns** (the 2026-05-27 convention decision): `backgrounds`,
  `species`, `species_options`, `background_features`, `enchantments`. Columns like
  `sourceId`, `imageUrl`.

Every React editor works in camelCase (`formData.imageUrl`). To bridge the legacy
snake_case tables to the camelCase editors, `src/lib/compendium.ts` runs every legacy row
through a translation layer:

- `denormalizeCompendiumData(row)` — on **read**: snake → adds camelCase aliases (~50 mappings).
- `normalizeCompendiumData(data)` — on **save**: camelCase → snake (~40 mappings).

New camelCase tables **skip this layer entirely** — the `d1.ts` data layer
(`upsertDocument` / `fetchDocument`) is column-name-agnostic, so camelCase round-trips with
zero translation.

## Why migrate (retire the layer)

1. **One convention.** Foundry is camelCase end-to-end; the editors are camelCase; new
   tables are camelCase. The legacy snake tables are the last holdouts.
2. **Delete ~90 hand-maintained mappings + two functions.** Today, every new column on a
   legacy table needs an entry in **both** maps, or the editor silently reads/writes the
   wrong key.
3. **Kill a real bug class.** A denormalized row carries **both** `image_url` *and*
   `imageUrl`. On save the spread includes both keys, so a stale snake value could overwrite
   a fresh camel edit — `compendium.ts` needed a careful two-pass workaround (see the long
   comment in `normalizeCompendiumData`, ~line 81). Single-convention rows cannot have this
   bug.

## Scope — where the snake columns are referenced

Per table, the snake columns are enumerated in three places:
- the alias maps in `src/lib/compendium.ts` (the authoritative list of what's translated),
- the per-table schema docs in `docs/database/structure/<table>.md`,
- the `d1.ts` `jsonFields` list (snake JSON entries like `uses_recovery`, `class_ids`).

Code that reads/writes snake columns and must change in lockstep:
- the editors (drop the camel aliasing; read columns directly),
- the export pipeline — `api/_lib/_classExport.ts`, `_spellExport.ts`, the item/feat
  exporters — **and** their client mirrors (`src/lib/classExport.ts`, …),
- the importers — `src/lib/itemImport.ts`, `featImport.ts`, `spellImport.ts`, class import,
- character code — `src/lib/characterShared.ts` + `api/_lib/_characterShared.ts`,
- raw SQL in `api/_lib/*` and `server.ts`.

## Also in scope: the admin taxonomy tables

The admin taxonomies edited by `ProficiencyEntityShell` (`tool_categories`,
`weapon_categories`, `damage_types`, `ammunition_types`, `loot_categories`, …) are
snake_case too (`order`, `updated_at`). The shell now takes an opt-in
`columnCase: 'snake' | 'camel'` prop (added 2026-06-09 for the new camelCase
`crafting_disciplines` table). Migrating one of these taxonomies to camelCase is therefore:
rename its columns (`order` → `sort`, `updated_at` → `updatedAt`, `created_at` → `createdAt`)
and flip its `AdminProficiencies` tab to `columnCase="camel"`. **No shell change needed** —
that work is already done.

## ⚠ Module-contract impact — flag, do NOT silently change

Renaming a DB column is a **schema change the Foundry module can see**. The export pipeline
builds Foundry JSON from these columns, and the module's field mapping lives in
`module/dauligor-pairing/docs/schema-crosswalk.md`. Per the app↔module handshake:
**flag `schema-crosswalk.md` for the module agent and coordinate via a `handoffs/` note**
before renaming any column the exporters read. Do not edit module canonical contracts from
the app side.

## How — behavior-preserving, table by table

No back-compat (repo rule): update the sources to the new shape; don't keep dual reads.

1. Pick **one** table — start with the least-referenced (e.g. `facilities` or `features`)
   to prove the pattern.
2. Migration: `ALTER TABLE <t> RENAME COLUMN <snake> TO <camel>` per column (SQLite/D1
   supports `RENAME COLUMN`). **Local-first** (never `migrations apply --remote`).
3. Update the `d1.ts` `jsonFields` list (snake → camel) + the server mirror
   (`api/_lib/d1-fetchers-server.ts`).
4. Remove that table's entries from **both** `compendium.ts` maps.
5. Update every code + SQL reference (exporters, importers, editors, character code).
6. Update `docs/database/structure/<table>.md`.
7. `tsc` + a manual round-trip (load editor → edit → save → reload) before the next table.
8. When the **last** legacy table is done, delete `normalizeCompendiumData` /
   `denormalizeCompendiumData` entirely.

## Related

- [`src/lib/compendium.ts`](../../src/lib/compendium.ts) — the alias layer being retired
- [`docs/database/structure/`](structure/) — per-table schemas (update on each rename)
- `worker/migrations/20260601-1200_backgrounds_species_tables.sql` — the camelCase
  convention's origin + rationale
- `module/dauligor-pairing/docs/schema-crosswalk.md` — module field mapping (flag on rename)
