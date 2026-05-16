# Foundry VTT Export

The semantic export pipeline that turns Dauligor data into JSON the Foundry pairing module can consume. Two export targets:

1. **Source bundle** — a ZIP containing all classes/subclasses/features for a source book (`dauligor.source-catalog.v1`)
2. **Actor bundle** — a single character export for sheet import (`dauligor.actor-bundle.v1`)

For the architectural philosophy behind the dual-state design (human-readable on the web, machine-readable on export), see [../architecture/foundry-integration.md](../architecture/foundry-integration.md).

## The pairing module

| Path | Role |
|---|---|
| `module/dauligor-pairing/` | Foundry module dev source (in this repo) |
| `module/dauligor-pairing/data/sources/` | Static export catalog used by the pairing module |
| `module/dauligor-pairing/scripts/` | Module runtime code |
| `module/dauligor-pairing/docs/` | Module-side documentation (separate from app docs) |

The live runtime copy lives at:
`C:\Users\Jean\AppData\Local\FoundryVTT\Data\modules\dauligor-pairing`

Sync command (when needed):
```powershell
robocopy "E:\DnD\Professional\Dev\Dauligor\module\dauligor-pairing" "C:\Users\Jean\AppData\Local\FoundryVTT\Data\modules\dauligor-pairing" /MIR /XD data
```

The dev module copy is the **code source of truth**. The live Foundry module copy is the runtime copy. `data/` is allowed to drift because source payload delivery is moving toward app endpoints.

## Source export pipeline

Triggered from the Sources list or Source Detail page (staff only). Produces a ZIP with this layout:

```
data/
  sources/
    catalog.json                    # master library index
    <source-slug>/
      source.json                   # source metadata
      classes/
        catalog.json                # class index for this source
        <class-id>.json             # full semantic class export
```

Once extracted into `FoundryVTT/Data/modules/dauligor-pairing`, the module's importer can read from these local files as if they were live API endpoints.

### Semantic class bundle contents

Each `<class-id>.json` is a "Semantic Bundle":
- Base class data (name, identifier, hit die, primary ability, image, advancements)
- Linked subclasses (full data each)
- Associated class and subclass features
- Scaling tables for both
- Spellcasting progression(s)
- Unique option groups + their items
- Tag references
- **`spellRuleAllowlists: Record<ruleId, sourceId[]>`** — bake-time resolution of every `spellRule` requirement leaf referenced by any option in this class. Each rule maps to the spell sourceIds that satisfy it (manualSpells + tag-query matches against the live spell catalog). The module's `requirements-walker.js` intersects this with the actor's known spell sourceIds — that's how a Warlock invocation gated on "knows any 1st-level evocation" auto-evaluates without re-running the matcher in JS. See [compendium-options.md](compendium-options.md#compound-requirements-tree).
- **`spellRuleNameById: Record<ruleId, string>`** — display names for the same rules, used by the picker's pill renderer so spellRule pills show "Knows Fire Spells" instead of "(spell rule)".

The per-source class-catalog endpoint additionally emits **`tagIndex: Record<tagId, tagName>`** alongside `entries` — collected from every unique tagId referenced across the catalog's classes, resolved via one `SELECT id, name FROM tags WHERE id IN (…)` at bake time. The module's class-browser filter chips read this directly so they label as "Martial" / "Spellcaster" instead of raw D1 PKs.

Source: [src/lib/classExport.ts](../../src/lib/classExport.ts).

### Three export layers

1. **Canonical** — raw D1 data
2. **Semantic** — internal IDs replaced with stable `sourceId` strings (e.g., `class-feature-action-surge`); modular choice mappings flattened; subclass features namespaced with level to prevent upsert collisions
3. **Foundry** — semantic JSON deeply transformed into Foundry's `system` schema (activities, effects, advancements, ScaleValue blocks, item references)

The pairing module reads layer 3 — but the app stores layer 1 and produces layer 2/3 on demand.

### Dynamic catalog API

`/api/module/*` (also in `server.ts` and `api/module*.ts`) serves catalogs and class records straight from D1 — no static export needed. Path patterns:

| Path | Returns |
|---|---|
| `/api/module/sources/catalog.json` | All `status='ready'` sources |
| `/api/module/sources/<slug>/classes/catalog.json` | Class catalog for one source |
| `/api/module/sources/<slug>/classes/<class-identifier>.json` | Single semantic class export |
| `/api/module/sources/<slug>/classes/<class-identifier>/spells.json` | Per-class curated spell list (live read-through, see below) |

Falls back to filesystem read at `module/dauligor-pairing/data/sources/<path>` if D1 doesn't have the requested resource. Useful as a transitional convenience: classes created in the app are immediately available in Foundry without manual ZIP redeploys.

### Spell list decoupling (May 2026)

The per-class curated spell list used to be **baked into the class bundle** as a `classSpellItems` array. Every edit to `class_spell_lists` (manual curation in `/compendium/spell-lists`) or to any spell that a rule referenced required a full class rebake to make the new pool visible on the Foundry side. A single spell tag edit fanned out to a class rebake on every class whose applied rules touched that tag.

The spell list is now served on its own endpoint with **live read-through** from D1:

```
/api/module/<source>/classes/<class>/spells.json
```

**Wire format:**

```jsonc
{
  "kind": "dauligor.class-spell-list.v1",
  "schemaVersion": 1,
  "classId": "0db5d98Gj95jUet5gypC",
  "classIdentifier": "wizard",
  "classSourceId": "...",
  "spells": [
    /* Foundry-ready spell item shells — same shape as the
     * legacy `classSpellItems` array. The Foundry importer's
     * `runSpellSelectionStep` and embed phase read `.flags.
     * dauligor-pairing.level / school / sourceId / ...` from
     * each entry. */
  ],
  "generatedAt": 1715800000000
}
```

**Cache strategy:** `Cache-Control: public, max-age=60` (no `s-maxage`, no R2 layer). Each request runs two D1 queries — one for the `class_spell_lists` membership rows, one for the matching `spells` rows. For typical pools (20-100 spells) the response builds in tens of milliseconds. Vercel function cold-start dominates; warm latency is negligible.

**Propagation paths:**

| Event | Old behavior | New behavior |
|---|---|---|
| Admin curates a spell into the list (`SpellListManager`) | Stale until class rebake | Visible on next Foundry import (≤60s cache) |
| Admin edits a spell's tags / level / school | Stale on every class with an applied rule touching those tags | `upsertSpell` recomputes affected rule-driven `class_spell_lists` rows synchronously; next Foundry import sees the new pool |
| Admin applies / unapplies a rule to a class (`spell_rule_applications`) | Stale until class rebake | The next spell-save recompute or a manual "Rebuild Stale" clears it; or trigger `recomputeAppliedRulesForSpell` once per affected spell |
| Class metadata changes (level scaling, hit die, name) | Class rebake (unchanged) | Class rebake — the spell-list endpoint is independent and unaffected |

**Implementation:**
- Builder: [`api/_lib/_classSpellList.ts`](../../api/_lib/_classSpellList.ts) (`buildClassSpellListBundle`, `buildClassSpellListByIdentifier`)
- Route: [`api/module.ts`](../../api/module.ts) — the `pathParts.length === 4 && pathParts[3] === "spells.json"` branch
- Tag-driven recompute: [`src/lib/spellRules.ts`](../../src/lib/spellRules.ts) (`recomputeAppliedRulesForSpell`) — called from `upsertSpell` in [`src/lib/compendium.ts`](../../src/lib/compendium.ts) on every individual spell save
- Foundry-side fetch: [`module/dauligor-pairing/scripts/class-import-service.js`](../../module/dauligor-pairing/scripts/class-import-service.js) (`fetchClassSpellList`) — invoked in parallel with the class bundle fetch inside `_ensureVariantPayload` (`importer-app.js`)

**What stays bundled in the class export:** spellcasting scaling tables (`spellsKnownScalings`), pact magic scaling (`alternativeSpellcastingScalings`), spell-rule allowlists (`spellRuleAllowlists`), rule display names (`spellRuleNameById`). These all change much less frequently than the per-class curated spell list and the class rebake cascade picks them up.

**What doesn't auto-propagate:** `upsertSpellBatch` (used by the spell import workbench) does NOT call `recomputeAppliedRulesForSpell` per entry — a bulk import of 500 spells would fan out to thousands of D1 round-trips. After a batch import, the `SpellListManager`'s stale-detection indicator catches affected classes (any class whose applied rule sees a changed `updated_at` in the rule's matching spells is marked stale until rebuilt). The admin can hit "Rebuild Stale" to flush them.

## Actor bundle export

Triggered from the character builder's "Export to Foundry" button. Produces a single JSON object: `dauligor.actor-bundle.v1`.

```json
{
  "kind": "dauligor.actor-bundle.v1",
  "schemaVersion": 1,
  "actor": {
    "name": "...",
    "system": { ... },                  // ability scores, vitals, biography, traits
    "flags": {
      "dauligor-pairing": {
        "primaryClassId": "...",
        "primarySubclassId": "...",
        "progressionClassIds": [...],
        "progressionSubclassIds": [...],
        "characterId": "..."
      }
    }
  },
  "items": [
    /* class items (one per active class entry) */
    /* subclass items */
    /* owned feature feat items */
    /* selected option-item feat items (Metamagic, Invocation, etc.) */
  ]
}
```

### What the actor bundle does well
- **Class advancement values** come from package-backed `progressionState.classPackages.advancementSelections`, not the legacy single-class shortcut.
- **Owned features** export as `feat` items with the right Foundry metadata (`flags.dauligor-pairing.sourceId`, `flags.dauligor-pairing.featureTypeValue`, etc.).
- **Selected option items** also export as `feat` items with subtype derived from the option-group name.
- **Multiclass export** uses `primaryClassId` / `primarySubclassId` plus `progressionClassIds` / `progressionSubclassIds` (not misleading singular `classId`/`subclassId`).
- **HP max** is omitted unless there's an explicit override — so Foundry derives it from class advancements.
- **Spellcasting** — `progression: "none"` is exported when spellcasting is disabled, instead of leaking active-looking defaults.
- **Primary abilities** are flattened to lowercase strings like `["wis"]` (not `[["WIS"]]`).

### What's not in the bundle yet
- Broader **inventory / equipment** beyond owned-feature feats — needs a formal import contract before items end up in the actor bundle.
- **`ownedSpells`** is a reserved field; spell ownership isn't yet a canonical builder layer.

Source: [src/lib/characterExport.ts](../../src/lib/characterExport.ts).

## Activity contract

Activities (Attack, Save, Heal, Damage, Utility, Spell, Enchant, Forward, Cast, Summon, Transform, Check) are stored as JSON on `features.activities`, `feats.activities`, `items.activities`, and `spells.activities`.

The semantic shape (used in storage and exports):

| Field | Type | Notes |
|---|---|---|
| `name` | string | VTT display |
| `kind` | enum | `attack`, `save`, `check`, `heal`, `damage`, `utility`, `spell`, `enchant`, `forward`, `cast`, `summon`, `transform` |
| `activation` | object | Cost (Action, Bonus Action, …) |
| `target` | object | Range and shape |
| `consumption` | object | Scaling and usage costs (`activityUses`, `itemUses`, `material`, `hitDice`, `spellSlots`, `attribute`) |
| `visibility` | object | Min level, etc. |
| `dc.calculation` | enum | `spellcasting`, `flat`, `initial`, or an ability slug |
| `dc.formula` | string | e.g., `8 + @abilities.int.mod + @prof` |
| `damage.parts[]` | array | `number`, `denomination`, `bonus`, `types[]`, optional `scaling`, optional `custom.formula` |

The Foundry pairing module:
1. Parses the semantic activity.
2. Maps `kind` to the Foundry activity type (`dnd5e.activity.attack`, etc.).
3. Translates Dauligor `@`-references to Foundry data paths (see [../architecture/reference-syntax.md](../architecture/reference-syntax.md)).
4. Applies `visibility` rules to the character sheet.

Activity-type coverage in the editor (and in captured Foundry reference windows): attack, cast (with and without override), check, damage, enchant, forward, heal, summon, transform, utility. Save activity capture pending.

## Active Effect contract

Effects are JSON on `features.effects`, `feats.effects`, `items.effects`, and `spells.effects`. Shape mirrors Foundry's `ActiveEffectConfig`:

```json
{
  "_id": "...",
  "name": "...",
  "icon": "icons/...",
  "tint": "#ffffff",
  "description": "...",
  "disabled": false,
  "transfer": true,
  "duration": { "seconds": null, "rounds": null, "turns": null, "startTime": null, "startRound": null, "startTurn": null, "combat": null },
  "changes": [
    { "key": "system.bonuses.weapon.attack", "mode": 2, "value": "+1", "priority": 20 }
  ]
}
```

`mode` values: 0 Custom, 1 Multiply, 2 Add, 3 Downgrade, 4 Upgrade, 5 Override.

## Description handling on import

The Foundry module accepts:
- HTML as-is
- BBCode (converted to Foundry-friendly HTML)
- Simple markdown-like prose (converted to HTML)

App side: BBCode is the preferred rich-text transport for export. The module converts BBCode → HTML during import.

## Foundry "corpus" reference files

Per major data type exported, the module's `corpus/` directory holds two reference files:
- An **empty** schema with placeholder/null values
- An **example** schema fully populated to demonstrate field mapping

Path: `module/dauligor-pairing/corpus/<entity>/`. For example:
- `corpus/classes/export-class.json` (empty), `corpus/classes/export-class-example.json` (filled)
- `corpus/subclasses/export-subclass.json`, `corpus/subclasses/export-subclass-example.json`

This lets a pairing-module developer model their import logic against concrete examples.

## Common tasks

### Export an entire source's classes for Foundry
- Sources page → Export Full Library → ZIP downloads → extract into `FoundryVTT/Data/modules/dauligor-pairing`.

### Export one class for testing
- `/compendium/classes/<id>` → "Export Semantic JSON" → save → drop into Foundry.

### Re-export a character to Foundry
- Character Builder → Export to Foundry → JSON download → import via the pairing module's actor importer.

### Export a Foundry spell folder back to Dauligor (round-trip)
- See [compendium-spells.md](compendium-spells.md) — the importer accepts Foundry's "Export Spell Folder" payload.

## Related docs

- [../architecture/foundry-integration.md](../architecture/foundry-integration.md) — pairing module philosophy, dual-state functionality
- [../architecture/reference-syntax.md](../architecture/reference-syntax.md) — Dauligor-to-Foundry reference translation
- [compendium-classes.md](compendium-classes.md) — class authoring side
- [character-builder.md](character-builder.md) — actor bundle producer
- [compendium-spells.md](compendium-spells.md) — Foundry spell folder import
- [../_archive/foundry-item-activity-effects-authoring-plan.md](../_archive/foundry-item-activity-effects-authoring-plan.md) — design notes
- [../_archive/foundry-dnd5e-character-reference-sheet.md](../_archive/foundry-dnd5e-character-reference-sheet.md) — reference research
- `module/dauligor-pairing/docs/` — module-side documentation
