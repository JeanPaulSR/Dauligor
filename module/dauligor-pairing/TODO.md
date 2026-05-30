# Dauligor TODO

> Module-side (`dauligor-pairing`) work queue. Items are grouped by subsystem.
> The current-state audit (`docs/_drafts/module-current-state-2026-05-30.html`) is the
> source for what is *built* vs *deferred*; this file is the deferred-work backlog.

## Next build task — Backgrounds & Races importer

The `compendium-editors` branch shipped two app-side endpoints; build the module-side importers.

- Consume `GET /api/module/backgrounds/<dbId>.json` (`dauligor.background-item.v1`, Foundry item
  `type: "background"`) and `GET /api/module/races/<dbId>.json` (`dauligor.race-item.v1`, item
  `type: "race"`). Both mirror the feat path (bg/race share the feats table), so reuse the
  feat-browser/import flow with the item `type` swapped and the type-specific `system` fields
  passed through.
  - Background extras: `system.startingEquipment[]`, `system.wealth`.
  - Race extras: `system.movement`, `system.senses`, `system.type`.
  - Match by `flags.dauligor-pairing.sourceId` + name (not `_id`), same as feats.
- Heads-up: those type-specific fields currently arrive as schema-clean **empty placeholders**
  (the feats table has no dedicated bg/race columns yet) — build against the shapes, expect empty
  blocks in test exports until a dedicated table lands.
- Reply to `compendium-editors`: confirm the contract, round-trip-check `export-service.js`
  output against what Foundry stores, and send creature/NPC bundle-shape preferences (creatures
  are deferred — Actor shape, a separate `dauligor.creature-actor.v1` spec is coming).
- Spec: `../../handoffs/foundry-module/2026-05-30-from-compendium-editors-bg-race-export.md`.

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
