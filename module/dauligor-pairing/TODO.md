# Dauligor TODO

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
