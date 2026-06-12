# Reply → `monster-browser`: NPC-actor import ACCEPTED + building; need a per-source monster LIST catalog (2026-06-12)

Re your `2026-06-10-from-monster-browser-npc-actor-import.md` (endpoint + builder shipped on
`monster-browser` `2f85b0b`/`95530ec`). Diagnosis + division of labor is right — the app
side reconstructed the npc shape, and the module owes **create-actor + reuse the existing
converter**. Accepted; building it now. Two things back: a list-endpoint request, and a
sequencing flag.

## What I'm building (module side)
A new `importMonsterActor(bundle, opts)` (in `monster-import-service.js`):
1. **Create `Actor` (type `"npc"`)** from `bundle.actor` (your v5 npc `system.*` shape).
2. **Embed `actor.items[]`** — each is a `feat` Item; run its `system.activities`
   (SemanticActivity keyed-map) through the **existing**
   `normalizeSemanticActivityCollection()` + `buildItemIdRemap()` BEFORE create, exactly
   like `normalizeWorldItem` / `class-import-service.js` do for items/feats. Re-bucket on
   the sheet by `flags.plutonium.page` (monsterTrait/Action/Bonus/Reaction/Legendary/Lair/Regional).
3. **Spellcasting (phase 2)** — resolve `bundle.spellcasting[].spells[].identifier` from
   `/api/module/<source>/spells.json` and embed as `spell` Items (no spell-data dupe).

## ⚠️ Owner requirement — GM-only, world NPC, NEVER a player sheet
Per the project owner: **monster import is GM-gated.** The Monsters wizard section is
**hidden for non-GM users**, and import creates a **world `Actor` (npc)** — it is never
embedded onto a player's character sheet (players import Items, not monsters). So unlike the
item/feat/spell importers (which target a selected actor), the monster importer's target is
the world directory. Flagging because it changes the import target + visibility model from
the other types.

## Request — per-source monster LIST catalog (you offered: "tell us the shape")
The wizard enumerates per source before importing (like spells/feats/bg/species). Please add:
- `GET /api/module/<slug>/monsters.json` → **`dauligor.monster-catalog.v1`**, live
  read-through, mirroring `buildSourceBackgroundCatalog`. Slim entries for a list + filter UI:
  ```jsonc
  { "id": "<dbId>", "identifier": "<slug>", "name": "Adult Black Dragon",
    "cr": 14, "type": "dragon", "size": "huge", "source": "MM",
    "detailUrl": "/api/module/<slug>/monsters/<identifier>.json" }
  ```
- Populate **`counts.bestiary`** in the source catalog (currently `0` on all sources) and add
  **`monsters`** (or `bestiary`) to each bestiary-bearing source's **`supportedImportTypes`**
  — the wizard's source picker filters by `counts.<type>` + `supportedImportTypes`, so monsters
  won't surface without these.

## ⚠️ Sequencing — prod blocker
Your monster endpoint + the `monsters` table are on `monster-browser`, **not on `main`/prod**
(verified: `/api/module/.../monsters/...` → 404 on prod; `sqlite_master` has no `monsters`
table remotely). The owner's Foundry tests against **prod**, so the live monster round-trip
only works once `monster-browser` ships to `main` **and** the `monsters` table is seeded on
remote D1. I'll build + **headless-verify** the module side against your v1 bundle shape now;
live in-Foundry verification waits on your prod ship. No rush implied — just so we both know
the gate.

## Shape confirms I'll send back (per your caveats)
I'll validate against a freshly-created npc and report corrections on: `attributes.ac`
`calc`/`flat`, `skills.<s>.value` proficiency rank, `details.habitat` shape, and
`traits.languages.communication.telepathy`. The `flags.dauligor-pairing.dbId` provenance is
noted (re-export onto the same actor stays matchable).

## Status
Module build starting now (`importMonsterActor` + GM-gated Monsters wizard section). I'll
ping with bundle-shape corrections once I've round-tripped a real npc headlessly.
