# Request → `foundry-module`: import an NPC Actor from the monster export bundle

**From:** `monster-browser` · **Date:** 2026-06-10 · **Type:** request (NEW module capability)
**Owner:** foundry-module is sole steward of `module/dauligor-pairing/` — hence this handoff.

## TL;DR
The Monster Browser now publishes a Foundry-ready **NPC actor bundle** at a new app
endpoint. The module already converts SemanticActivity → Foundry `system.activities`
for items/feats/spells/classes; it does **not** yet create **NPC actors**. We need the
module to: pull the bundle → create an `Actor` (type `"npc"`) → embed the action/trait
Items → run each embedded item's `system.activities` through the **existing**
`normalizeSemanticActivityCollection`. That closes the monster Foundry round-trip and
makes the activities functional (attack/save/damage rolls).

## The new endpoint (app side — DONE, live)
```
GET /api/module/<source>/monsters/<identifier>.json
```
Live read-through (no R2 cache), so editor edits propagate on the next import.
Builder: `api/_lib/_monsterExport.ts` (`buildMonsterBundleForIdentifier`); routed in
`functions/api/module/[[path]].ts`. (A per-source monster **list/catalog** endpoint can
be added when the importer wizard needs one — tell us the shape you want.)

## Bundle shape (`dauligor.monster-actor.v1`)
```jsonc
{
  "kind": "dauligor.monster-actor.v1",
  "schemaVersion": 1,
  "dbId": "<foundry-actor-id>",
  "sourceId": "<identifier slug>",
  "actor": {
    "name": "Adult Black Dragon",
    "type": "npc",
    "img": "<portrait url>",
    "prototypeToken": { "texture": { "src": "<token url>" } },
    "system": {
      "abilities": { "str": { "value": 23, "proficient": 0 }, … },
      "attributes": {
        "ac": { "flat": 19, "calc": "natural", "formula": "" },
        "hp": { "value": 195, "max": 195, "formula": "17d12 + 85" },
        "movement": { "walk": 40, "fly": 80, "swim": 40, "units": "ft" },
        "senses": { "blindsight": 60, "darkvision": 120, "units": "ft" },
        "spellcasting": ""
      },
      "details": { "cr": 14, "type": { "value": "dragon", "subtype": "", "swarm": "" },
                   "alignment": "Chaotic Evil", "biography": { "value": "<HTML>" },
                   "habitat": { "value": [ { "type": "swamp" } ], "custom": "" } },
      "traits": { "size": "huge",
                  "di": { "value": ["acid"], "bypasses": [] }, "dr": {…}, "dv": {…},
                  "ci": { "value": [] },
                  "languages": { "value": ["common","draconic"], "custom": "",
                                 "communication": { "telepathy": { "value": null, "units": "ft" } } } },
      "skills": { "prc": { "value": 2, "ability": "wis" }, "ste": { "value": 1, "ability": "dex" } },
      "resources": { "legact": { "value": 3, "max": 3 }, "legres": { "value": 3, "max": 3 },
                     "lair": { "value": true, "initiative": 20, "inside": false } },
      "source": { "book": "MM", "page": "88", "rules": "2014", … }
    },
    "items": [
      {
        "name": "Bite",
        "type": "feat",
        "system": {
          "type": { "value": "monster", "subtype": "" },
          "description": { "value": "<HTML prose>", "chat": "" },
          "activities": { "<key>": { /* SemanticActivity — id, kind, attack{ability,bonus:"@mod"…},
                                       save{abilities,dc:{calculation,formula}}, damage{parts:[{number,
                                       denomination,bonus,types}]}, activation, uses, … */ } },
          "uses": { "max": "1", "spent": 0, "recovery": [ { "period": "recharge", "formula": "5", "type": "recoverAll" } ] },
          "source": { … }
        },
        "flags": { "plutonium": { "page": "monsterAction" },
                   "dauligor-pairing": { "schemaVersion": 1, "entityKind": "monster-feature" } }
      }
      // … traits / actions / bonus / reactions / legendary / lair / regional, in render order
    ],
    "flags": { "dauligor-pairing": { "schemaVersion": 1, "entityKind": "monster", "dbId": "…", "sourceId": "…" } }
  },
  "spellcasting": [ /* blocks: ability/level/method/slots/prose + spells:[{identifier,name,level,method}] */ ]
}
```

## What the module needs to do
1. **Create the Actor** (`type: "npc"`) from `bundle.actor` — `system.*` is already in
   Foundry dnd5e v5 npc shape (we reconstructed it as the inverse of the importer's read).
   Validate against a real npc; flag any field we got wrong (see Caveats).
2. **Embed the Items.** Each `actor.items[]` is a `feat` Item. Its `system.activities` is
   our **SemanticActivity** keyed-map — run it through the existing
   `normalizeSemanticActivityCollection()` (the SAME path `normalizeWorldItem` /
   `class-import-service.js` already use) BEFORE the item is created, so `kind→type`,
   `id→_id`, `attack.type` nesting, `save.ability`, and `damage.parts` land as Foundry
   wants. `flags.plutonium.page` carries the stat-block section (monsterTrait /
   monsterAction / monsterBonus / monsterReaction / monsterLegendary / monsterLairActions /
   monsterRegionalEffects) if you want to re-bucket on the sheet.
3. **Spellcasting** (optional, phase 2): `bundle.spellcasting[]` lists spells by
   `identifier`; resolve each from the existing `/api/module/<source>/spells.json` and embed
   as `spell` Items (don't duplicate spell data). Non-casters have `spellcasting: []`.

This should be **create-actor + reuse the existing converter** — no new conversion code,
just the NPC-actor assembly the module doesn't do yet.

## Caveats / open
- The actor `system.*` is a **v1** reconstruction. Most-likely-to-need-tweaks: `attributes.ac`
  `calc`/`flat` encoding, `skills.<s>.value` proficiency rank, `details.habitat` shape,
  `traits.languages.communication.telepathy`. Please verify against a freshly-imported npc and
  send back any field corrections (we'll fix the builder app-side).
- The endpoint resolves by `identifier` (globally near-unique); the `<source>` path segment is
  currently informational. Say if you need strict source-scoping.
- Round-trip provenance: `flags.dauligor-pairing.dbId` = the original Foundry actor id, so a
  re-export onto the same actor is matchable.

## Status on our side (app)
Endpoint + builder shipped on `monster-browser` (commit `2f85b0b`), verified live (Adult Black
Dragon → 200; Bite activity `damage.parts[0].bonus="@mod"`). Activities are real SemanticActivity
(rework commit `95530ec`). Ping `monster-browser` with any bundle-shape corrections.
