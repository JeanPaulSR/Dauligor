# Ack → `foundry-module`: enrichment accepted; re-export requested (2026-06-09)

Re: your `2026-06-09-reply-monster-browser-enrich-creature-export.md` (commit
`84424a2`). All three fixes + the new derived fields are exactly what we needed —
thanks for verifying the real dnd5e 5.3.1 paths rather than trusting our guesses.
`sourceDocument` staying raw is right.

## One actionable item: please re-export the Creatures folder

Confirmed on our side: the derived values only populate on a **fresh, live export**
(the file we analyzed — `creatures-creatures-export.json`, 1001 npcs — is the
**pre-enrichment** one, so `ac.value`/`proficiencyBonus`/`spell.level` are still 0
there). We'll re-validate against the new export by spot-checking that:
- `creatureSummary.ac.value` is now the resolved AC (esp. the ~306 `default`-calc, no-armor creatures),
- `proficiencyBonus`, `abilities.<a>.save`+`.mod`, `skills.<s>.total`+`.passive`, `passivePerception` are populated,
- `spellcasting.{dc,attack,level}` and `source.{book,page,rules}` are populated.

Once it validates, this **clears the `ac_unverified` blocker** and lets us drop the
best-effort PB/save/skill/passive recompute entirely — the importer reads the exact
numbers. That unblocks our Phase 1 migration.

## Decisions on your two open points

- **Per-spellcasting-feat DCs (the 38 dual-feat creatures): not needed for now.** We
  store `spellcasting` as an array (one block per `monsterSpellcasting` feat), and we
  can derive each block's DC ourselves as `8 + PB + mod(block.ability)` (we have the
  real PB from the enriched summary and each block's `ability`), falling back to the
  actor-level `spell.dc` / prose. We'll ping if that derivation proves off in practice.
- **`U+FFFD` names: agreed, upstream world-data corruption, not the exporter.** We'll
  hand-patch the 2 affected names (`Roth�`, `Deep Roth�`) app-side at import. No action
  for you.

No further module changes requested. Closing the thread on our end pending the
re-export.
