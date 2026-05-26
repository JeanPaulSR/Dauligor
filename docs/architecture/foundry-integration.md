# Dauligor & Foundry VTT Integration Philosophy

This document outlines the architectural relationship between Dauligor (the web-based class architect), Foundry VTT, and advanced import systems (modeling Plutonium).

## 1. The Class Import and Level-Up Lifecycle (Modeled on Plutonium)

To ensure high-fidelity compatibility, Dauligor models its data export structure around how advanced third-party modules handle feature management within Foundry.

**The Workflow:**
1. **Initial Import**: When a class is dragged (or imported) onto a character sheet, only the base class skeleton (Hit Dice, basic proficiencies, generic scaling columns) is applied. 
2. **Level-Up Interception**: Sophisticated modules often intercept Foundry's base level-up workflow. Rather than relying on Foundry's internal `ItemGrant` advancement arrays (which can be rigid), the module catches the level-up notification.
3. **Identification**: The module identifies the class using a combination of metadata—usually `name`, `system.source.book`, and `system.source.revision` (or a specific `hash`).
4. **Dynamic Assignment**: Upon successful identification, the module looks up the class in its own external index, manually fetches the features for the newly attained level, and assigns them directly to the player's sheet.

By structuring our `flags` and `identifiers` to match these expectations, Dauligor ensures that any pairing module we (or the community) build can cleanly map a user's web-based changes directly to the VTT.

## 2. Dual State Functionality

Dauligor is built with a dual-natured architecture to serve two completely different consumers:

### A. The Front-End (Human Readable)
For users browsing the web platform, evaluating classes, or making characters, Dauligor operates as a rich text wiki. It serves:
- Lore and narrative text.
- Human-readable BBCode and HTML formatting.
- Conceptual representations of how an ability works.

### B. The VTT Backend (Machine Readable)
Foundry VTT cannot parse BBCode to understand how much damage an ability does. Thus, our backend export pipeline must map these concepts into explicit, strictly-typed schemas:
- **Activities & Mechanics**: Defining exact range values, targeting shapes, durations, and damage formulas.
- **Scaling Columns**: Translating a table of numbers into Foundry's explicit nested `ScaleValue` advancement objects.

## 4. Dauligor's Role: JSON Export vs. Import Implementation

Dauligor's architecture is **NOT** designed to implement the actual Foundry VTT importation logic. Our application only cares about being able to read and write Foundry-compatible JSON. 

A completely separate module (the `dauligor-pairing` module or alternative third-party tools) will handle the actual implementation on Foundry's end. This module will ingest the semantic Dauligor JSON, resolve IDs, trigger the Foundry document creations, and attach the necessary flags.

## 5. Reference Captures

Because the import flow has to round-trip data through Foundry's `system` schema, the pairing module keeps reference captures from live Foundry items under [`module/dauligor-pairing/docs/corpus/`](../../module/dauligor-pairing/docs/corpus/). These are not "empty / example schemas" anymore — that older design was retired in favour of capturing real shipped 5etools / dnd5e exports and pinning them as evidence the import contract has to satisfy. The capture template + index live in [`module/dauligor-pairing/docs/corpus/catalog.md`](../../module/dauligor-pairing/docs/corpus/catalog.md) and [`capture-template.md`](../../module/dauligor-pairing/docs/corpus/capture-template.md).

Because of the dual-state architecture, we can heavily leverage native Foundry syntax directly within our web app's mechanical inputs without confusing the front-end user.

While the user reads a friendly description ("At 1st level, you deal additional fire damage equal to your proficiency bonus"), the backend mechanic can be explicitly configured to use Foundry's interpolation syntax.

**Examples of Supported Native Syntax:**
- **Proficiency Bonus**: Using `@prof` inside a damage formula or resource scaling field.
- **Scale Values**: Referencing a class's specific scaling column, such as `@scale.sorcerer.sorcery-points`, directly in a feature's macro or damage box.
- **Roll Data**: Incorporating dynamic actor data like `@classes.fighter.levels` for calculation.

By inputting this terminology in the "Mechanics" or "Automation" tabs of our features, Dauligor guarantees that when the item is finally exported and dropped into Foundry, the system natively understands and executes the math, ensuring seamless integration while keeping the web UI clean and accessible.

## 6. How the Pipeline is Wired Today

The Foundry pairing flow is served by `api/module.ts` (via Cloudflare Pages Function entry under `functions/api/module/`) and mirrored by `server.ts` (local Express). For the per-endpoint wire format, payload kinds, cache behavior, and migration history see [foundry-export.md](../features/foundry-export.md#dynamic-catalog-api). The headline routes:

| Endpoint | Returns | Built by |
|---|---|---|
| `/api/module/sources/catalog.json` | `dauligor.source-catalog.v1` — every active source, each entry carrying `counts.{classes,spells}`, `supportedImportTypes`, and per-payload URLs the wizard uses to decide which import flows light up | `buildTopLevelCatalog` ([`api/_lib/module-export-pipeline.ts`](../../api/_lib/module-export-pipeline.ts)) |
| `/api/module/<source>/classes/catalog.json` | `dauligor.class-catalog.v1` — class entries for one source, each with a `payloadKind: dauligor.semantic.class-export` link + `tagIndex` for filter chips | `buildSourceClassCatalog` ([`api/_lib/module-export-pipeline.ts`](../../api/_lib/module-export-pipeline.ts)) |
| `/api/module/<source>/classes/<identifier>.json` | `dauligor.semantic.class-export` — the full bundle: `{class, subclasses, features, scalingColumns, uniqueOptionGroups, uniqueOptionItems, spellsKnownScalings, alternativeSpellcastingScalings, spellRuleAllowlists, source}` | `exportClassSemantic` ([`api/_lib/_classExport.ts`](../../api/_lib/_classExport.ts)) |
| `/api/module/<source>/classes/<identifier>/spells.json` | `dauligor.class-spell-list.v1` — lightweight per-class curated spell summaries (no `system` block) the Prepare Spells manager loads on class select | `buildClassSpellListByIdentifier` ([`api/_lib/_classSpellList.ts`](../../api/_lib/_classSpellList.ts)) — live read-through, `Cache-Control: public, max-age=60` |
| `/api/module/<source>/spells.json` | `dauligor.source-spell-list.v1` — same lightweight summary shape, but every spell in the source (not class-curated). Feeds the standalone Spell Browser launched from the wizard's Spells import type | `buildSourceSpellListBundle` ([`api/_lib/_sourceSpellList.ts`](../../api/_lib/_sourceSpellList.ts)) — live read-through |
| `/api/module/spells/<dbId>.json` | `dauligor.spell-item.v1` — full Foundry-ready spell item (`system`, `effects`, flags) | `buildSpellItemBundle` ([`api/_lib/_spellExport.ts`](../../api/_lib/_spellExport.ts)) — live read-through, fetched lazily per row select / embed |
| `/api/module/tags/catalog.json` | Tag taxonomy filtered to spell-classified groups; powers the Prepare Spells filter modal | `buildTagCatalog` ([`api/_lib/_tagCatalog.ts`](../../api/_lib/_tagCatalog.ts)) |
| `POST /api/module/queue-rebake` · `POST /api/module/rebake-now` | Staff-only bundle invalidation / regeneration entry points | `module-export-queue.ts` / `module-export-pipeline.ts` |

`exportClassSemantic` exists in two places:
- **Client copy**: [`src/lib/classExport.ts`](../../src/lib/classExport.ts) — used by the `Export` buttons in `ClassView.tsx` and the source-zip downloaders.
- **Server copy**: [`api/_lib/_classExport.ts`](../../api/_lib/_classExport.ts) — used by the live `/api/module/...` endpoint and the local Express equivalent in `server.ts`.

### Why two copies — drift contract

The original justification was that Vercel's serverless bundler did not reliably traverse cross-folder imports from `api/` into `src/lib/` for this project — two attempts at `import { exportClassSemantic } from "../src/lib/classExport.js"` from `api/module.ts` crashed the function on load with `FUNCTION_INVOCATION_FAILED`. The workaround is to keep server-only siblings under `api/_lib/` (`_classExport.ts`, `_referenceSyntax.ts`, `_classProgression.ts`) and consume them from `api/module.ts` directly. Cloudflare Pages Functions don't have the same bundler limitation, but keeping the sibling pairs scopes the bundle cleanly and the drift contract still applies. The drift-warning header at the top of `_classExport.ts` says the same.

**The maintenance contract:** any change to the bundle shape — `denormalize*` helpers, `normalizeAdvancementForExport`, the `exportClassSemantic` body, the `ExportFetchers` interface — must land in **both** files. The client downloader and the server endpoint must produce byte-identical bundles for the same input. Forgetting either side will silently desync the Foundry module's import flow.

### Server-side data access

The server copy uses [`api/_lib/d1-fetchers-server.ts`](../../api/_lib/d1-fetchers-server.ts) (`SERVER_EXPORT_FETCHERS`) — adapters that match the client `fetchCollection`/`fetchDocument` signature but talk through `executeD1QueryInternal` instead of the auth-gated `/api/d1/query` proxy. Inlined `D1_TABLE_MAP` and JSON-column auto-parse list (kept in sync with [`src/lib/d1.ts:queryD1`](../../src/lib/d1.ts) — same caveat as elsewhere).

### Module-side contracts (canonical)

For the actual import shape — class data, spell data, feature activities, advancements, character bundles — the canonical contracts live in the module repository under [`module/dauligor-pairing/docs/`](../../module/dauligor-pairing/docs/). Master index: [`module/dauligor-pairing/docs/import-contract-index.md`](../../module/dauligor-pairing/docs/import-contract-index.md). Read those before changing anything in `_classExport.ts` or `classExport.ts` — they describe the exact shape the Foundry module expects to receive.

### Property slug vocabulary

The `items.properties` array (and the per-weapon `weapons.property_ids` table) share their slug vocabulary with Foundry's `CONFIG.DND5E.itemProperties`. The 11 standard 5e codes (`fin` / `hvy` / `lgt` / `lod` / `two` / `ver` / `thr` / `rch` / `amm` / `spc` / `sil`) round-trip 1:1; 4 app-custom slugs (`lance` / `net` / `range` / `improvised-weapons`) ship verbatim and are interpreted by the module side. Foundry-side homebrew slugs (e.g. Zweihänder's `superHeavy`) pass through both directions unchanged. Full contract: [`property-mapping.md`](../../module/dauligor-pairing/docs/property-mapping.md).

### Item proficiency resolution

Items reference the proficiency-definition tables (`weapons` / `armor` / `tools`) via polymorphic FK columns (`base_weapon_id` / `base_armor_id` / `base_tool_id`). The character sheet computes proficiency badges by walking the `character_proficiencies` table hierarchically (specific → category → property) — see [`proficiency-resolution.md`](proficiency-resolution.md) for the walker logic and the `weapon_type_filter` semantics that differentiate "Simple Weapons" from "Simple Melee Weapons" in the 2024 split.
