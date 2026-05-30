# Dauligor TODO

> Module-side (`dauligor-pairing`) work queue. Items are grouped by subsystem.
> The current-state audit (`docs/_drafts/module-current-state-2026-05-30.html`) is the
> source for what is *built* vs *deferred*; this file is the deferred-work backlog.

## Backgrounds & Races importer

- **[done]** Consume `GET /api/module/backgrounds/<dbId>.json` (`dauligor.background-item.v1`,
  item `type:"background"`) and `GET /api/module/races/<dbId>.json` (`dauligor.race-item.v1`,
  item `type:"race"`). Implemented in `feat-browser-app.js`: the source-feat-list already returns
  bg/race rows (tagged by `featType`), so the browser pool already shows them; the detail fetch +
  imported item type now route by `featType` via `detailEndpointFor()`. Type-specific `system`
  fields (`startingEquipment`/`wealth`, `movement`/`senses`/`type`) pass through. Match by
  `sourceId` + name, same as feats. Labels updated (Background / Race).
  - **App-side dependency:** the bg/race route arms in `functions/api/module/[[path]].ts` live on
    `compendium-editors` and aren't on `main` yet — the endpoints go live when that branch merges.
    The builders (`_backgroundExport.ts` / `_raceExport.ts`) are already on `main`.
- **[done] Foundry → app export (the current priority).** `export-service.js` now has
  `buildBackgroundFolderExport` / `buildRaceFolderExport` (+ `export*Folder`), emitting
  `dauligor.foundry-background-folder-export.v1` / `…-race-folder-export.v1`. Each entry carries the
  full `sourceDocument` + a typed summary (`startingEquipment`/`wealth` for backgrounds;
  `movement`/`senses`/`type` for races). Wired to two Item-directory sidebar buttons. Contract:
  `docs/background-race-folder-export-contract.md`. This gives `compendium-editors` the real shapes
  to design the bg/race table. **Not yet runtime-tested in a live Foundry world** (needs real
  bg/race items present).
- **Follow-up — round-trip verification (after the app table exists):** once the app has dedicated
  bg/race columns and re-serves them, export a real Foundry bg/race, import it back, and confirm the
  `system` shapes survive the round-trip — the empirical check the export-first approach is for.
- **Follow-up — reply to `compendium-editors`:** confirm the import contract works, report the
  round-trip result, and send creature/NPC bundle-shape preferences (creatures are deferred —
  Actor shape; a separate `dauligor.creature-actor.v1` spec is coming).
- Heads-up: type-specific fields currently arrive as schema-clean **empty placeholders** (the
  feats table has no dedicated bg/race columns yet) — expect empty equipment/movement blocks in
  test data until a dedicated table lands.
- Spec: `../../handoffs/foundry-module/2026-05-30-from-compendium-editors-bg-race-export.md`.

## Creatures / NPCs (export-first)

- **[done] Foundry → app creature export.** `export-service.js` `buildCreatureFolderExport` /
  `exportCreatureFolder` → `dauligor.foundry-creature-folder-export.v1` (npc-only). Each entry
  carries the full `sourceDocument` (stat block + embedded items + effects) + a rich
  `creatureSummary` (type, CR, AC/HP, abilities, skills, movement, senses, traits, spellcasting,
  legendary, embedded-type counts). Wired to an Actor-directory `Export Creature Folder` button.
  Contract: `docs/creature-folder-export-contract.md`. Gives `compendium-editors` the shapes to
  design the creatures table. **Not yet runtime-tested in a live Foundry world.**
- **Deferred — creature importer.** `dauligor.creature-actor.v1` (embed an npc Actor + its items)
  waits until the app has a creatures table. Module-side bundle-shape preferences already sent to
  `compendium-editors` (see the reply handoff). Round-trip verification after the table lands.

## Option picker / requirements

- **[done 2026-05-30] Honor `excludedOptionIds`** — the picker now hides options a group excludes
  (was showing e.g. Arcane Warrior in a Blood Hunter's Alternate Fighting Style). `class-import-service.js`
  `buildOptionGroupExclusions` + filters in all three option-list paths.
- **Follow-up — entity-prerequisite leaves are advisory/non-blocking.** `requirements-walker.js`
  evaluates `optionItem`/`level`/`abilityScore`/`proficiency`/`spellRule` leaves, but `class` /
  `subclass` / `feature` / `spell` leaves are rendered as advisory text only (not remapped to the
  actor's owned ids), so an option gated on "requires feature/subclass X" is NOT actually blocked.
  If options that should be prereq-gated still appear, this is why — needs the export to remap those
  leaf references to sourceIds + the walker to evaluate them against owned items.

## Feature Manager

- **[done]** Spells tab: the Prepare Spells manager is embedded under the Feature Manager shell
  (`DauligorSpellPreparationApp.renderInto`). One front door for spell changes between sessions.
- Wire ItemChoice `replaces` semantics on the importer side.
  - Detect "swappable" prior picks for a given ItemChoice advancement at the
    current grant level (e.g. Eldritch Invocations at L5/L7/L9/L12/L15/L18).
  - In the level-up flow, present the prior pool with a "Replace" option that
    rewrites `value.added[priorLevel]` and adds the new pick to
    `value.added[currentLevel]`.
- Manager-side swap flows.
  - Long-rest scope: today the "Swap this pick" button re-picks an option group
    **immediately** (delete + create), ungated. Gate it on a source-side flag
    (`option_groups.swappable_on_long_rest` — still a placeholder concept; needs the
    app side to add the column) so only rest-swappable groups offer the rest-scoped swap.
  - Level-up scope: route the Change button to the importer's level-up
    wizard, pre-targeting the relevant option group (the Advancement tab is a
    placeholder today).
  - Make the long-rest queue commit `optionItem` entries (currently only `spellChange`
    commits; `optionItem` is a stub). Remove the dead legacy `_renderGroupSection`.
- Feats tab: surface every ASI advancement slot and which feat (if any) was
  taken; let the player retrain in the level-up flow. (Placeholder tab today.)
- Crafting tab + Advancement tab are placeholders — scope before building.

## Spell Preparation Manager

- **Virtual folders in the prep manager.** Folders are fully built on the **alt character
  sheet** (`customFolders`, add/rename/delete, drag-reorder) but the **Prepare Spells manager**
  has no folder support (it groups by class + spell level only). Add folder creation +
  assignment to the manager, reusing the alt-sheet `customFolders` model where possible so the
  two surfaces share folder state. (Sections are an alt-sheet concept and already done.)
- Expand the current first-pass actor spell preparation window.
  - Keep refining the current actor-spell manager layout and interactions.
  - Add richer class summary data, better badges.
- Continue wiring the manager to Dauligor class spell lists.
  - Surface available-but-not-imported spells from app data (the class/source spell-list
    endpoints already feed the importer-mode pool — extend coverage in sheet mode).
  - Add import, remove, and known-spell replacement flows. (Known-caster "one swap per long
    rest" is already enforced in embedded mode.)
- Fix the host inconsistency: the sources-catalog and tag-catalog fetches in
  `spell-preparation-app.js` hardcode `https://www.dauligor.com` and ignore the
  `apiEndpointMode` setting, so they 404 against a local dev server in `local` mode. Route them
  through `_resolveApiHost()` like the other endpoints.
- Add optional long-rest reminder behavior.
  - Use `dnd5e.restCompleted` (already wired in `main.js` for the Feature Manager commit prompt —
    extend for prepared-caster review / known-caster replacement prompts).

## References (semantic reference normalization)

`reference-service.js` parses most documented tokens, but a few in `reference-syntax-guide.md`
are documented and **not implemented** — either build them or down-mark the doc to "planned":

- `@source[…]` entity ref — matched by the regex but `findEntityDocument` hard-returns `null`
  for `kind: "source"`, so it never resolves to a UUID. Decide whether sources should resolve.
- `@class.<id>.spellcasting-ability` — documented (→ `@classes.<id>.spellcasting.ability`) but the
  scalar regex only matches `level|tier|hit-die*`. Not parsed.
- Dotted skill form `@skill.<skill>.prof|value` — documented but only the **bare** slug form
  (`@acrobatics` → `@skills.acr.total`) is implemented. Either add the dotted form or document
  the bare form in the grammar.

## Item / Actor / Journal importers

Today `import-service.js` is a **test harness** — it consumes only `dauligor.character.v1`,
`dauligor.item.v1`, and bare Foundry-like objects. The contract docs describe fuller catalog +
detail importers that don't exist yet:

- Real **item** importer consuming `dauligor.item-catalog.v1` + `dauligor.item.v1` (browser flow
  like feats/spells). Wire `importedAt`/`lastSyncedAt`/`moduleVersion` provenance flags here
  (only the class importer writes them today).
- Real **actor** importer consuming `dauligor.actor-bundle.v1` / `dauligor.actor-catalog.v1`
  (blocked on the app having an actor/creature table — coordinate with the creature/NPC work).
- Real **journal** importer consuming `dauligor.journal.v1` / `dauligor.journal-catalog.v1`.

## Property mapping (runtime)

`property-mapping.md` is the intended contract: weapon-property slugs should be **interpreted at
runtime with their correct display names**, so newly-added / homebrew properties surface
correctly. Today the module passes `system.properties` through verbatim with **no per-slug
interpreter**. Build the runtime resolver:

- Resolve the 11 standard 5e slugs + the 4 app-custom slugs (`lance`/`net`/`range`/
  `improvised-weapons`) to display labels via `CONFIG.DND5E.itemProperties`, registering the
  custom ones if absent so they render with proper names.
- Pass Foundry-side homebrew slugs through unchanged but display their label if registered.

## UI consistency

- **[done 2026-05-30] Stylesheet split + finder doc.** The monolithic
  `styles/dauligor-importer.css` (7,228 lines) was split into 15 per-area files
  (`tokens` / `base` / one per window + `responsive`), wired into `module.json` in load order.
  Content-identical (byte count + brace balance verified). Finder doc: `docs/styles-guide.md`.
  **Needs a live-Foundry eyeball** at narrow widths (responsive.css loads last) + the cross-block
  bridge spots (embedded spell manager, sequence/subclass-preview importer states).
- **Duplicate-component dedup pass [done 2026-05-30]** (audit: `docs/_drafts/duplicate-components-audit-2026-05-30.html`).
  Tokenized 38 remaining raw accent tints; folded `wizard__toolbar-button` into the canonical button +
  merged the section-filter toolbar/footer button pair; **unified the duplicated detail pane into a shared
  `.dauligor-detail` component** (base.css) consumed by the option picker (via `__header--with-image`) and
  the subclass preview + feature-manager re-select — renamed the markup in `importer-app.js` +
  `feature-manager-app.js`, removed the per-block copies, unified body color to the token. Appearance-
  preserving except the deliberate reconciliations (button heights, body color). **Needs a Foundry eyeball.**
- **First unification pass [done 2026-05-30]** (audit: `docs/_drafts/ui-consistency-audit-2026-05-30.html`).
  Unified the three near-identical flat-button rules (wizard / class-browser / spell-tab-tools /
  spell-manager) into one canonical `.dauligor-…__button` rule (per-block layout deltas kept;
  `directory-tools` left to inherit Foundry's sidebar styling). Defined the previously-phantom
  tokens as real `--dauligor-accent-tint` / `--dauligor-accent-gold` RGB channels (used as
  `rgba(var(--token, fallback), α)`, preserving every per-use alpha); fixed `--dauligor-muted` →
  `--dauligor-text-muted`. Added a vars-only token block so standalone windows resolve the palette.
  Tokenized 6 exact-match hardcoded hexes. All appearance-preserving (fallbacks retained); not yet
  eyeballed in a live Foundry world.
- **Deferred polish (need a visual check in Foundry):**
  - The two accent tints (`-tint` #aa8250 vs `-gold` #b58838) are near-identical warm golds — likely
    mergeable to one, but kept separate to preserve exact appearance. Merge after eyeballing.
  - `__badge` naming is loose (spell-manager label chip vs feature-manager uppercase *tag* vs
    spell-picker micro-indicator) — three different jobs; consider renaming the tag one.
  - `__empty` states could share the muted-text/serif treatment (kept distinct sizes for now).
  - Non-token hardcoded shades remain (`#242424`, `#141414`, `#9b988f`, gradients) — intentional
    one-offs; tokenize only if they should follow the theme.

## Documentation hygiene (Q4 doctrine)

- Markdown contract docs are for agents — keep them as detailed as necessary; split long ones
  into modules with an index (the import-contract-index is the master map). HTML docs are
  developer overviews (parchment/gold), kept in `docs/_drafts/` until promoted.
- Resolve the bg/race-aspirational sections in `actor-import-contract.md`,
  `journal-import-contract.md`, `item-import-contract.md` once the real importers land.
- `constants.js` has two dead path constants (`SAMPLE_FILE`, `CLASS_CATALOG_FILE`) pointing at
  files that no longer exist (`data/sample-character.json`, `data/classes/catalog.json`).
  Remove or re-point them.

## Integration Follow-Ups

- Resume `dnd5e-spellpoints` compatibility work.
  - Keep the current post-import offer to attach the Advanced Magic spell-points item.
  - Add safer actor-side support for editing `flags.spellpoints.override` and `flags.spellpoints.config`.
  - Decide whether Dauligor should expose spell-point behavior only as a compatibility layer or as a fuller actor workflow.

## Hosting And Deployment

- Evaluate replacing The Forge with self-hosted Foundry behind the Dauligor website.
  - Compare `play.<domain>` versus `<domain>/foundry`.
  - Document reverse-proxy requirements (`hostname`, `routePrefix`, `proxySSL`, `proxyPort`).
  - Decide whether the website is only a launcher/dashboard or also manages campaign/account access.
  - Confirm license and multi-instance implications before implementation.
