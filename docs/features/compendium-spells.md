# Compendium — Spells

Spell list, importer, and the lightweight summary index that powers fast browsing.

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

Schema: full breakdown in [../_archive/migration-details/phase-4-compendium.md](../_archive/migration-details/phase-4-compendium.md). The `spells` table mirrors Foundry's spell shape — `system.activities`, top-level `effects`, plus `foundryDocument` (the authoritative original Foundry payload kept for round-trips).

## Summary index pattern

Listing every spell would mean fetching the full row including descriptions, activities, and effects — wasteful when the user is just scanning a table. The `spell_summaries` table holds a thin row per spell with the fields needed for left-pane rendering and filters; the full row is only fetched when a spell is selected.

Helper module: [src/lib/spellSummary.ts](../../src/lib/spellSummary.ts).

> **Migration status:** `spellSummary.ts` is on D1; the summary index is derived on demand from the `spells` table rather than maintained as a separate `spell_summaries` table.

## Spell list (`SpellList`)

Layout: two-pane split.
- **Left** — virtualised summary table (`VirtualizedList`): name, level, school, source abbreviation
- **Right** — selected spell detail view (image, description, activities)

Filters (top toolbar):
- Sources (multi-select)
- Spell level (0–9 multi-select)
- Spell school (multi-select)
- Custom tags (Tag Manager-defined; **hierarchical** — filtering on a parent tag also matches spells tagged with any subtag of it; see [../database/structure/tags.md](../database/structure/tags.md#hierarchical-query-matching))
- Casting time bucket (Action / Bonus / Reaction / Minute / Hour / Special)
- Range bucket (Self / Touch / Close ≤5 / Short ≤30 / Medium ≤60 / Long ≤120 / Far >120)
- Shape bucket (Cone / Cube / Cylinder / Line / Radius / Sphere / Square / Wall / None) — from `system.target.template.type`
- Duration bucket (Instantaneous / Round / Minute / Hour / Day / Permanent / Special)
- Properties (Concentration / Ritual / V / S / M)

Range and shape are orthogonal — a "self (15 ft cone)" spell has range bucket `Self` and shape bucket `Cone`.

Filter UI is built on the shared [FilterBar](../../src/components/compendium/FilterBar.tsx). Same modal language as `ClassList` (no spell-specific variation): `ADVANCED FILTERS` title, section headers with `Include All / Clear`, `filter-tag` toggles for options.

> **Range bucket gotcha:** the bucket VALUES (`5ft`, `30ft`, `60ft`, `120ft`, `long`, `other`) are exact-distance strings carried over from an earlier exact-value implementation. The labels (`Close`, `Short`, `Medium`, `Long`, `Far`) are band-based. The mismatch is intentional — renaming values would break stored spell-rule queries. See `src/lib/spellFilters.ts` `RangeBucket` type comment.

### Selection-only image loading
Spell icons aren't rendered in the table rows (too noisy). The right detail pane shows the icon at native 126×126 inside an `overflow-hidden` wrapper so there's no inline gap below the art. Image loading goes through [src/components/compendium/SpellArtPreview.tsx](../../src/components/compendium/SpellArtPreview.tsx), which preloads the next spell's image and shows a gold spinner while loading.

### Description rendering
Spell descriptions are stored as BBCode (converted from Foundry HTML on import via `htmlToBbcode`). At display time, Foundry inline syntax tokens are flattened **for display only** — never stripped from storage. Rules:

| Stored | Displayed |
|---|---|
| `[[/r 1d8]]` | `1d8` |
| `[[/damage 2d6]]` | `2d6` |
| `[[/damage 4d8 type=acid]]` | `4d8 acid` |
| `@... [status||Frightened]` | `Frightened` |
| `@...[status]` (unlabelled) | `Status` |

**Display precedence:** the detail panel renders `spells.description` (BBCode → `bbcodeToHtml`) first; the raw Foundry HTML at `foundryDocument.system.description.value` is only used as a fallback for legacy rows that predate BBCode conversion. Edits made in the manual editor flow through BBCode, not raw HTML.

**Round-trip back to Foundry:** on save in the manual editor, the BBCode description is converted via `bbcodeToHtml` and written into `foundryDocument.system.description.value` so the next Foundry read (pairing-module import, actor-bundle re-export) ships the user's edits as HTML. Inline Foundry syntax tokens (`[[/r ...]]`, `@...[status||...]`) survive a BBCode round-trip because the BBCode pipeline doesn't recognize them — they pass through as literal text and Foundry re-interprets them on the receiving end.

## Spell importer (`SpellImportWorkbench`)

A staff-only workbench at `/compendium/spells/manage` (Foundry Import tab).

**Input**: `dauligor.foundry-spell-folder-export.v1` JSON files exported from the FoundryVTT pairing module's "Export Spell Folder" sidebar button. Each payload is one folder of native Foundry spell items.

**Workbench**:
- Multi-file JSON upload (drag-and-drop)
- Batch summary: total / new / matching-existing / errors
- Left-column searchable spell list (matches `spell_summaries` against incoming candidates)
- Right-column 5etools-style spell detail preview
- Per-spell tag assignment (from spell-classified tag groups in Tag Manager)
- Single-spell import or visible-batch import buttons

**On import**:
- Source is matched by slug to the user's `sources` table.
- Image paths starting with `icons/...` or `/icons/...` are normalised to `https://images.dauligor.com/...`.
- The full Foundry payload is preserved as `foundry_data` (JSON column).
- The shell fields (level, school, components, etc.) are extracted from the Foundry payload for normal D1 querying.

Source: [src/components/compendium/SpellImportWorkbench.tsx](../../src/components/compendium/SpellImportWorkbench.tsx), [src/lib/spellImport.ts](../../src/lib/spellImport.ts).

## Manual spell editor (`SpellsEditor`)

Two tabs: **Foundry Import** (the workbench above) and **Manual Editor**.

The manual editor mirrors the importer rhythm:
- Left column — virtualised draft list with search; same visual language as the importer's left pane
- Right column — dedicated editor form (no `DevelopmentCompendiumManager` wrapper)

Form is split across **inner tabs** for focus instead of one long scroll:

| Tab | Holds |
|---|---|
| **Basics** | Icon, name, identifier, source, level, school, preparation mode |
| **Description** | MarkdownEditor (kept its own tab — it's the long one) |
| **Mechanics** | Casting time, range, duration, ritual, concentration, V/S/M components, material text/cost/consumed |
| **Activities** | `ActivityEditor` + raw effects JSON textarea |
| **Tags & Prereqs** | `SpellTagPicker` for descriptive tags AND a second instance for `required_tags`; per-tag-group collapsible sections, parent-row + indented-subtag-row layout |

Save / Delete / Reset live in the Card header above the TabsList, so the action bar is one click away regardless of which tab is showing. Form state is fully controlled (every input is bound to `formData`), so `Radix Tabs` unmounting inactive tab content does NOT lose unsaved values on tab switch.

### `SpellTagPicker` layout

Per-tag-group collapsible card with header showing selected/total counts. When expanded:

- Each **root tag** gets its own row.
- Its **subtags** (if any) get an indented sub-row directly below, with a thin gold left-border as the tree hint. No `↳` glyph on chips — the indent does the work.
- Orphaned subtags (parent not in the visible set, rare with consistent data) fall to a separate amber-edged sub-row so they don't disappear when filtering.

Used twice in the Tags & Prereqs tab: once for descriptive tags (`spells.tags`), once for prerequisites (`spells.required_tags`).

### Admin actions

- **Save / delete** — calls D1 helpers via the manual editor.
- **Purge All Spells** — destructive admin action that wipes both `spells` and `spell_summaries`. Was previously a client-side Firestore batch; now hits a server route that performs the purge after explicit `requireAdminAccess` verification.

Once `spellSummary.ts` finishes migrating to D1, manual save/delete will route through [src/lib/d1.ts](../../src/lib/d1.ts) (currently they go through the Firestore admin API for safety during migration).

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
- Use the **Foundry Import** workbench if you have a Foundry export — it preserves the authoritative payload.
- Use the **Manual Editor** for homebrew. Generated images can be uploaded inline; the icon goes to `images/spells/<id>/`.

### Add a new spell tag
Tags are managed in `/compendium/tags` ([compendium-options.md](compendium-options.md)). Create a tag group with classification `spell`, then add tags. Spells get tagged in the importer's right pane or the manual editor.

### Bulk import a source's spell list
1. In Foundry, organise the source's spells into a single Item folder.
2. Use the pairing module's "Export Spell Folder" → save the JSON.
3. Open the workbench, drag the JSON in, assign source if not auto-matched, batch-import.

### Re-importing existing spells
The importer matches by `identifier`. Re-importing updates `foundry_data` and any shell fields that were changed. Manual edits to description/tags are **not** preserved if you re-import — keep manual changes in mind.

## Related docs

- [compendium-classes.md](compendium-classes.md) — how class spell lists reference spells
- [compendium-options.md](compendium-options.md) — tag groups and tags
- [foundry-export.md](foundry-export.md) — round-trip back to Foundry
- [../ui/bbcode.md](../ui/bbcode.md) — description storage format
- [../../worker/migrations/0006_spells.sql](../../worker/migrations/0006_spells.sql) — `spells` table DDL (no per-table doc yet under `docs/database/structure/`)
- [../_archive/foundry-spell-import-research.md](../_archive/foundry-spell-import-research.md) — design notes from the import research pass
