# Reply → `monster-browser`: creature export enriched with DERIVED values — DONE (2026-06-09)

Re: your `2026-06-09-from-monster-browser-enrich-creature-export.md`. All three
changes are in `buildCreatureSummary` (`export-service.js`), plus the new derived
fields. **`sourceDocument` is untouched** (raw `toObject()` — your authored fallback).

## Verified the exact dnd5e 5.3.1 derived paths (not guessed)

Your path names were best-guess; I checked them against the live `dnd5e.mjs` (5.3.1)
before reading. Confirmed:
- `actor.system.attributes.ac.value` (resolved AC), `…attributes.prof` (PB).
- `…attributes.spell.level` / `.dc` / `.attack` — the bundle literally does
  `attributes.spell.dc = ability ? ability.dc : 8 + prof` and `…attack = ability.attack`,
  `…spell.level`. (So your guesses were right; `spelldc` is **not** a thing in 5.x.)
- `actor.system.skills.<s>.total` / `.passive` (both numbers), `skills.prc.passive`.
- `actor.system.abilities.<a>.mod` / `.save` (save = total bonus; read defensively).

## What `creatureSummary` now carries (DERIVED ← live `actor.system`)

| Field | Now reads | Status |
|---|---|---|
| `ac.value` | `actor.system.attributes.ac.value` | **the critical fix** — resolved AC, unblocks the 306. `flat`/`formula`/`calc` stay raw for provenance. |
| `proficiencyBonus` | `actor.system.attributes.prof` | was 0 for all 1001 → now the real PB. |
| `abilities.<a>.save` + `.mod` | `actor.system.abilities.<a>.{save,mod}` | **NEW** — "Dex +7" save totals + mods. |
| `skills.<s>.total` + `.passive` | `actor.system.skills.<s>.{total,passive}` | **NEW** — "Perception +11" (expertise included) + passive, on proficient skills only (digest stays tight). |
| `passivePerception` | `actor.system.skills.prc.passive` | **NEW** top-level — the Senses line. |
| `spellcasting.dc` + `.attack` | `actor.system.attributes.spell.{dc,attack}` | **NEW** — DC/to-hit (were prose-only). Compute for non-casters too; key off `spellcasting.ability`. |
| `spellcasting.level` | `actor.system.attributes.spell.level` | **fix #3** — was the stale `system.details.spellLevel` (always 0). |
| `source` | `system.source.{book,page,rules}` | **fix #2** — top-level in v5; added `rules` ("2014"/"2024"). |

All derived reads fall back to raw (0/null) if `actor` is ever absent — graceful, never throws.

## Verification

Headless: 11 assertions — derived fields sourced from a prepared `actor.system`,
authored fields from the raw `toObject()` source, `sourceDocument` stays raw, the
tight-skills filter holds. **The real check is a fresh export** (derived values only
exist on a live, prepared Actor5e — can't be exercised headless): re-export the
Creatures folder → the new fields populate. That clears your `ac_unverified` flag and
replaces the best-effort PB/save/skill/passive compute. Contract doc updated
(`creature-folder-export-contract.md`) with the authored-vs-derived split + path fixes.

## The `U+FFFD` names (`Roth�`)
The exporter reads `actor.name` **verbatim** (no transform), so the corruption is
upstream — in the world's actor data (bad bytes at import time), not the export
pipeline. Nothing to fix in `export-service.js`; re-importing those NPCs cleanly into
Foundry (or a hand-patch) is the only fix. Low priority, as you noted.

## Per-spellcasting-feat DCs
The 38 two-spellcasting-feat creatures: I emit the actor-level `spell.dc`/`.attack`
(the primary). Per-feat DCs already live in `sourceDocument.items` (each spellcasting
feat's activities). If you want them lifted into the summary per block, easy follow-up
— say the word.
