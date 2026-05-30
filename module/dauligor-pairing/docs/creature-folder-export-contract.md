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

Every entry also carries the full `sourceDocument`; this digest surfaces the
table-relevant fields. dnd5e v5 npc paths.

| Field | Source | Notes |
|---|---|---|
| `creatureType` | `system.details.type` | `{value, subtype, swarm, custom}`. |
| `size` | `system.traits.size` | e.g. `"med"`. |
| `alignment` | `system.details.alignment` | — |
| `cr` | `system.details.cr` | number (`0.25`, `5`, …). |
| `proficiencyBonus` | `system.attributes.prof` | — |
| `source` | `system.details.source` | `{book, page}`. |
| `hp` | `system.attributes.hp` | `{value, max, formula, temp}` — `formula` is the HD expression. |
| `ac` | `system.attributes.ac` | `{value, flat, formula, calc}`. |
| `abilities` | `system.abilities.*` | `{value, proficient}` per ability (derived mods aren't in source). |
| `skills` | `system.skills.*` | proficient/expertise skills only (`value > 0`) + their `ability`. |
| `movement` | `system.attributes.movement` | `{walk, fly, swim, climb, burrow, hover, units}`. |
| `senses` | `system.attributes.senses` | `{darkvision, blindsight, tremorsense, truesight, special, units}`. |
| `traits` | `system.traits.{di,dr,dv,ci,languages}` | damage immunities/resistances/vulnerabilities, condition immunities, languages. |
| `spellcasting` | `system.attributes.spellcasting` + `system.details.spellLevel` + `system.spells` | `{ability, level, slots}`; `slots` skips empty levels. |
| `legendary` | `system.resources.{legact,legres,lair}` | `{actions:{value,max}, resistance:{value,max}, lair}`. |
| `embeddedTypeCounts` | `items[]` | histogram by `item.type` (feat / weapon / spell / consumable / …) — the actual actions/attacks/spells live in `sourceDocument.items`. |

## Relationship to the import side

The reverse (`dauligor.creature-actor.v1` → embed an npc Actor with its items) is
**not built** — the app needs the creatures table first. Round-trip verification
comes after: export a Foundry creature, model the table from these shapes, then
import it back and confirm the stat block + embedded items survive.
