# Creature Folder Export Contract

Foundry-side batch export that captures native `dnd5e` **NPC** actors (creatures /
monsters), so the Dauligor app team can model a dedicated **creatures table**
before the import round-trip is built.

## Purpose — export-first

Creatures are **Actors** (`type:"npc"`), not Items — a fundamentally different
document than the feat-family items (backgrounds / races). They carry a full stat
block (abilities, AC/HP, CR, senses, movement, traits, legendary actions) **plus
their own embedded items** (features/actions, weapons/attacks, spells). The app has
no creatures table yet, so this exporter hands over the **real Foundry shape**:
each entry includes the full `sourceDocument` (stat block + embedded items +
effects) plus a creature-focused summary surfacing the fields a table needs.

This is **evidence/transport**, not the final app schema. The import direction
(`dauligor.creature-actor.v1`) comes later, once the table exists — module-side
bundle-shape preferences are in
[`../../handoffs/foundry-module/2026-05-30-reply-to-compendium-editors-bg-race.md`](../../handoffs/foundry-module/2026-05-30-reply-to-compendium-editors-bg-race.md).

## Export Trigger

Actor Directory sidebar (GM): **`Export Creature Folder`**. Prompts for an Actor
folder and whether to include subfolders. Scoped to `type:"npc"` only — PCs /
vehicles / groups are covered by the generic `Export Actor Folder`.

## Payload Kind

```json
"dauligor.foundry-creature-folder-export.v1"
```

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-creature-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-30T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "creatures": []
}
```

The `game` / `folder` blocks and per-entry context fields (`id`, `uuid`, `name`,
`type`, `folderId`, `folderPath`, `relativeFolderPath`) match the other folder
exports — see [feat-folder-export-contract.md](feat-folder-export-contract.md).

## Summary

| Field | Notes |
|---|---|
| `creatureCount` | npc actors in scope. |
| `byCr` | CR histogram (numeric-sorted; e.g. `0.125`, `1`, `10`). |
| `byCreatureType` | `system.details.type.value` → count (humanoid / beast / …). |
| `withSpellcasting` | how many have a `system.attributes.spellcasting` ability set. |
| `withLegendary` | how many have legendary actions/resistance resources. |
| `totalEmbeddedItems` | sum of embedded items across all creatures. |

## Per-entry — `creatureSummary` (the fields to model)

Every entry also carries the full `sourceDocument` (raw `actor.toObject()`); this
digest surfaces the table-relevant fields. dnd5e v5 npc paths.

**Authored vs derived (contract split — 2026-06-09).** AUTHORED fields read from the
raw `sourceDocument.system.*`. **DERIVED/computed** numbers — resolved AC, PB, ability
saves, skill totals, passive Perception, spell DC/attack/level — read from the **live
prepared `actor.system.*`** (Foundry's `prepareDerivedData()` output). `toObject()`
never carries those, so the app cannot recompute them from the static export — most
critically the resolved AC for the ~306 `default`-calc creatures with no armor item.
`sourceDocument` stays raw (authored) as the fidelity fallback.

| Field | Source | Kind | Notes |
|---|---|---|---|
| `creatureType` | `system.details.type` | authored | `{value, subtype, swarm, custom}`. |
| `size` | `system.traits.size` | authored | e.g. `"med"`. |
| `alignment` | `system.details.alignment` | authored | — |
| `cr` | `system.details.cr` | authored | number (`0.25`, `5`, …). |
| `proficiencyBonus` | `actor.system.attributes.prof` | **derived** | PB from CR — absent in raw `toObject()`. |
| `passivePerception` | `actor.system.skills.prc.passive` | **derived** | the Senses-line passive Perception. |
| `source` | `system.source` | authored | `{book, page, rules}` — top-level in v5 (was the stale `system.details.source`). |
| `hp` | `system.attributes.hp` | authored | `{value, max, formula, temp}` — `formula` is the HD expression. |
| `ac` | `actor.system.attributes.ac.value` + raw `flat/formula/calc` | **derived value** | `{value, flat, formula, calc}`. `value` = RESOLVED AC; `flat/formula/calc` stay raw for provenance. |
| `abilities` | raw `system.abilities.*` + `actor.system.abilities.*` | mixed | per ability `{value, proficient}` (authored) + `{mod, save}` (derived; `save` = total save bonus). |
| `skills` | raw `system.skills.*` + `actor.system.skills.*` | mixed | proficient/expertise only (`value > 0`): `{value, ability}` (authored) + `{total, passive}` (derived). |
| `movement` | `system.attributes.movement` | authored | `{walk, fly, swim, climb, burrow, hover, units}`. |
| `senses` | `system.attributes.senses` | authored | `{darkvision, blindsight, tremorsense, truesight, special, units}`. |
| `traits` | `system.traits.{di,dr,dv,ci,languages}` | authored | damage immunities/resistances/vulnerabilities, condition immunities, languages. |
| `spellcasting` | `system.attributes.spellcasting` (authored) + `actor.system.attributes.spell.{level,dc,attack}` (derived) + `system.spells` | mixed | `{ability, level, dc, attack, slots}`; `slots` skips empty levels. `dc/attack` compute for non-casters too — key off `ability` being set. Per-spellcasting-feat DCs live in `sourceDocument.items`. |
| `legendary` | `system.resources.{legact,legres,lair}` | authored | `{actions:{value,max}, resistance:{value,max}, lair}`. |
| `embeddedTypeCounts` | `items[]` | authored | histogram by `item.type` (feat / weapon / spell / consumable / …) — the actual actions/attacks/spells live in `sourceDocument.items`. |

## Relationship to the import side

The reverse (`dauligor.creature-actor.v1` → embed an npc Actor with its items) is
**not built** — the app needs the creatures table first. Round-trip verification
comes after: export a Foundry creature, model the table from these shapes, then
import it back and confirm the stat block + embedded items survive.
