# Advancement Contract

> Part of the [Class Import Contract](../class-import-contract.md).

## Advancement Contract

### Storage Shape

Preferred incoming shape:

- `classItem.system.advancement` is an object keyed by stable advancement ids

Example:

```json
{
  "sorcererHitPoints": {
    "_id": "sorcererHitPoints",
    "type": "HitPoints",
    "configuration": {},
    "value": {
      "1": "max"
    },
    "flags": {},
    "hint": ""
  }
}
```

Rules:

- the object key and `_id` should match
- `_id` should be stable across exports
- `_id` should be semantic and importer-safe
- do not generate random Foundry ids in Dauligor when a stable semantic id is available
- do not encode advancement identity from timestamps
- the module is responsible for translating semantic ids into actor-safe Foundry ids

The importer may also accept an array of advancement objects for convenience, but the preferred contract is the object form above because it matches the current Foundry export shape in this project.

### Supported Advancement Types for `v1`

Currently supported and expected:

- `HitPoints`
- `Trait`
- `ScaleValue`
- `ItemGrant`
- `ItemChoice` — author-supplied `ItemChoice` rows are normalized when present in a semantic export.
  (The module does **not** yet *synthesize* a native `ItemChoice` from option groups — those stay
  wizard-driven and stored in `flags.dauligor-pairing.optionGroups`. See the TODO.)
- `AbilityScoreImprovement` — normalized; resolved on actor import via the custom Dauligor ASI app
  (see the ASI section above).

Not yet part of the contract for production imports:

- subclass selection advancement (subclass choice is handled by the importer wizard's subclass
  step, not a native `Subclass` advancement row)
- unverified proficiency/equipment choice structures (skill/tool/trait choices *are* handled;
  *starting equipment* choice structures are not)

### `HitPoints`

Expected shape:

```json
{
  "_id": "sorcererHitPoints",
  "type": "HitPoints",
  "configuration": {},
  "value": {
    "1": "max"
  },
  "flags": {},
  "hint": ""
}
```

### `Trait`

Use `Trait` for simple granted traits that are already known at export time.

Verified example:

```json
{
  "_id": "sorcererSavingThrows",
  "type": "Trait",
  "level": 1,
  "title": "Saving Throws",
  "configuration": {
    "mode": "default",
    "allowReplacements": false,
    "grants": [
      "saves:cha",
      "saves:con"
    ],
    "choices": []
  },
  "value": {
    "chosen": [
      "saves:cha",
      "saves:con"
    ]
  },
  "flags": {},
  "hint": ""
}
```

#### Weapon trait — category-level grant arrays (post 20260526)

When `configuration.type === 'weapons'`, the export may carry three additional
category-level grant arrays alongside the per-weapon `fixed[]` / `options[]` /
`replacements[]` lists. They express whole-category grants and the 2024 Melee /
Ranged split:

```json
{
  "_id": "fighterWeaponProficiencies",
  "type": "Trait",
  "level": 1,
  "configuration": {
    "type": "weapons",
    "mode": "default",
    "allowReplacements": false,
    "fixed": [],
    "options": [],
    "replacements": [],
    "categoryIds": ["simple", "martial"],
    "categoryMeleeIds": [],
    "categoryRangedIds": []
  }
}
```

Module-side expansion rules (`normalizeSemanticFeatureTraitAdvancement` →
`expandWeaponCategoryGrants` in `class-import-service.js`):

| Source array | Expansion |
|---|---|
| `categoryIds: ["simple"]` | `["weapon:simpleM", "weapon:simpleR"]` (both halves — whole category) |
| `categoryMeleeIds: ["simple"]` | `["weapon:simpleM"]` (Melee half only) |
| `categoryRangedIds: ["simple"]` | `["weapon:simpleR"]` (Ranged half only) |
| `categoryIds: ["natural"]` | `["weapon:natural"]` (non-splitting categories use the bare slug) |

The module probes `CONFIG.DND5E.weaponTypes` at runtime to decide which scheme
applies. dnd5e 2024 splits Simple / Martial into Melee + Ranged variants
(`simpleM` / `simpleR` / `martialM` / `martialR`); Natural / Improvised / Siege
stay whole (`natural` / `improv` / `siege`). Whole-category grants over
non-splitting categories fall back to the bare slug.

These arrays expand INTO `configuration.grants[]` at module-bridge time — they
are NOT preserved on the embedded actor advancement. After expansion, the
resulting advancement has the standard `grants: ["weapon:simpleM", ...]` shape
the rest of the import pipeline already understands.

The same expansion rules apply to the class-level proficiency profile blocks
(`class.proficiencies.weapons` and `class.multiclassProficiencies.weapons`).
Both paths share `expandWeaponCategorySlugs(block)` exported from
`class-import-service.js`:

- The **multiclass apply path** (`applyActorTraitProfile` →
  `buildTraitKeysFromProfileBlock`) consumes it for the runtime trait writes,
  producing `weapon:simpleM` / `weapon:simpleR` keys instead of the bare
  `weapon:simple` that dnd5e v5 doesn't recognize.
- The **wizard's multiclass overlay** (`baseClassHandler` in
  `importer-base-features.js`) consumes it for the prompt loop, producing
  `weapons:simpleM` / `weapons:simpleR` (plural prefix — `stripTypePrefix`
  removes it downstream before writing).

If you author a `multiclassProficiencies.weapons` block with `categoryIds:
['simple']`, both paths will expand it to both halves; the half arrays
restrict to one half each.

#### Weapon trait — character proficiency rows

A class trait advancement with weapon grants produces matching
`character_proficiencies` rows on the actor's Dauligor character record. The
schema mirrors the trait shape:

| Trait grant | character_proficiencies row |
|---|---|
| `categoryIds: ["simple"]` | `entity_type='weapon_category', entity_id=<simple>, weapon_type_filter=NULL` |
| `categoryMeleeIds: ["simple"]` | `entity_type='weapon_category', entity_id=<simple>, weapon_type_filter='Melee'` |
| `categoryRangedIds: ["simple"]` | `entity_type='weapon_category', entity_id=<simple>, weapon_type_filter='Ranged'` |
| `fixed: ["greatsword-id"]` | `entity_type='weapon', entity_id=<greatsword-id>` |
| `options: [...]` | (no row — options are per-choice grants, set when the user picks) |

The `source_entity_type='class'` / `source_entity_id=<class-id>` columns on
each row attribute the grant to the class for tooltip display and clean
deletion on re-import. See
[`docs/database/structure/character_proficiencies.md`](../../../docs/database/structure/character_proficiencies.md)
and [`docs/architecture/proficiency-resolution.md`](../../../docs/architecture/proficiency-resolution.md)
for the full app-side schema + resolver walk.

### `ScaleValue`

> **Owner scope** — `ScaleValue` advancements are no longer class-only.
> Phase A/B of the "advancements outside classes" track (shipped May 2026)
> generalized the underlying `scaling_columns` table to a polymorphic
> `(parent_id, parent_type)` shape. Valid `parent_type` values today:
> `class`, `subclass`, `feat`, `race`, `background`, `item`. The Foundry-
> ready output shape is identical regardless of owner — the difference is
> which entity the advancement lives on app-side. See
> [docs/features/compendium-scaling.md](../../../docs/features/compendium-scaling.md)
> for the app-side authoring model. The module-side importer must accept
> `ScaleValue` on any advancement-carrying item type the dnd5e system
> exposes (feats, races, backgrounds, items), not just on `type: "class"`.

Use `ScaleValue` for class progression tracks such as:

- cantrips known
- spells known
- sorcery points
- metamagic known

Expected shape:

```json
{
  "_id": "sorcererCantripsKnown",
  "type": "ScaleValue",
  "title": "Cantrips Known",
  "configuration": {
    "identifier": "cantrips-known",
    "type": "number",
    "distance": {
      "units": ""
    },
    "scale": {
      "1": { "value": 4 },
      "4": { "value": 5 },
      "10": { "value": 6 }
    }
  },
  "value": {},
  "flags": {},
  "hint": ""
}
```

### `ItemGrant`

Use `ItemGrant` to grant class features.

Important rule:

- Dauligor should send `sourceId` references, not world UUIDs

Preferred incoming shape:

```json
{
  "_id": "sorcererGrantFontOfMagic",
  "type": "ItemGrant",
  "level": 2,
  "title": "Features",
  "configuration": {
    "items": [
      {
        "sourceId": "class-feature-font-of-magic",
        "optional": false
      }
    ],
    "optional": false,
    "spell": {
      "ability": [""],
      "uses": {
        "max": "",
        "per": "",
        "requireSlot": false
      },
      "prepared": 0
    }
  },
  "value": {},
  "flags": {},
  "hint": ""
}
```

The module is responsible for:

1. importing/upserting each `classFeatures[]` item into the world
2. resolving `configuration.items[].sourceId` to the created world item UUID
3. writing the final Foundry class item with resolved `uuid` values
4. preserving actor-side advancement identity when embedding a class on an actor

Accepted but not preferred:

- `configuration.items[].uuid`

That legacy shape is supported only so the importer can still read raw Foundry-style research exports.

