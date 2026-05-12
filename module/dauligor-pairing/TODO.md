# Dauligor TODO

## Feature Manager

- Wire ItemChoice `replaces` semantics on the importer side.
  - Detect "swappable" prior picks for a given ItemChoice advancement at the
    current grant level (e.g. Eldritch Invocations at L5/L7/L9/L12/L15/L18).
  - In the level-up flow, present the prior pool with a "Replace" option that
    rewrites `value.added[priorLevel]` and adds the new pick to
    `value.added[currentLevel]`.
- Manager-side swap flows.
  - Long-rest scope: identify groups flagged "swappable while resting"
    (currently just a placeholder concept — needs a source-side flag on
    `option_groups.swappable_on_long_rest`) and let players re-pick without
    touching levels.
  - Level-up scope: route the Change button to the importer's level-up
    wizard, pre-targeting the relevant option group.
- Spells tab: bring the Prepare Spells manager under the same shell so a
  player has one front door for everything they can change between sessions.
- Feats tab: surface every ASI advancement slot and which feat (if any) was
  taken; let the player retrain in the level-up flow.

## Integration Follow-Ups

- Resume `dnd5e-spellpoints` compatibility work.
  - Keep the current post-import offer to attach the Advanced Magic spell-points item.
  - Add safer actor-side support for editing `flags.spellpoints.override` and `flags.spellpoints.config`.
  - Decide whether Dauligor should expose spell-point behavior only as a compatibility layer or as a fuller actor workflow.

## Spell Preparation Manager

- Expand the current first-pass actor spell preparation window.
  - Keep refining the current actor-spell manager layout and interactions.
  - Add richer class summary data, better badges, and folder workflows.
- Wire the manager to Dauligor class spell lists once the app-side payload is ready.
  - Surface available-but-not-imported spells from app data instead of only current actor spell items.
  - Support class tags, favorites, and list-type metadata from the app.
  - Add import, remove, and known-spell replacement flows.
- Add optional long-rest reminder behavior.
  - Use `dnd5e.restCompleted`.
  - Support prepared-caster review and known-caster replacement prompts.

## Hosting And Deployment

- Evaluate replacing The Forge with self-hosted Foundry behind the Dauligor website.
  - Compare `play.<domain>` versus `<domain>/foundry`.
  - Document reverse-proxy requirements (`hostname`, `routePrefix`, `proxySSL`, `proxyPort`).
  - Decide whether the website is only a launcher/dashboard or also manages campaign/account access.
  - Confirm license and multi-instance implications before implementation.
