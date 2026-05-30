# Property Mapping Contract — App ↔ Foundry

The app-side `items.properties` column and Foundry's `system.properties` set
share the same slug vocabulary. This doc is the authoritative reference for
which slugs are 1:1 with dnd5e, which are Dauligor-specific extensions, and how
both sides handle slugs they don't recognize.

> **Module-side status (2026-05-30): the "Module behavior" runtime interpretation described in
> this doc is the _intended_ design, NOT yet implemented.** Today the module passes
> `system.properties` through verbatim with no per-slug interpreter — the custom slugs
> (`lance` / `net` / `range` / `improvised-weapons`) and homebrew slugs are not decorated or
> registered with display names at runtime. The target is a runtime resolver that maps every slug
> (standard + custom + homebrew) to a proper display label via `CONFIG.DND5E.itemProperties`,
> registering custom/new ones so they render correctly even as new properties are added. Tracked in
> [../TODO.md](../TODO.md). Read the "Module behavior" notes below as the spec for that resolver.

Schema baseline: migration `20260526-1700` renamed the 11 standard 5e
`weapon_properties.identifier` values to match dnd5e's `CONFIG.DND5E.itemProperties`
codes (commit `cd3257a`).

## Standard 5e properties (1:1 with Foundry)

These slugs are identical in both directions — no translation needed. Stored in
both `items.properties` (the per-item array) and `weapon_properties.identifier`
(the proficiency-definition row).

| Slug | Property | Notes |
|---|---|---|
| `fin` | Finesse | |
| `hvy` | Heavy | |
| `lgt` | Light | |
| `lod` | Loading | |
| `two` | Two-Handed | |
| `ver` | Versatile | Damage in versatile form on the weapon row |
| `thr` | Thrown | |
| `rch` | Reach | |
| `amm` | Ammunition | |
| `spc` | Special | |
| `sil` | Silvered | |

dnd5e v5 also defines property slugs used elsewhere (not always on weapons):

| Slug | Property | Where Used |
|---|---|---|
| `mgc` | Magical | items.magical bool also true when set |
| `stealthDisadvantage` | Stealth Disadvantage | armor — replaces the legacy `items.stealth` column dropped in 20260526-1700 |
| `concentration` | Concentration | spells (not items, but appears in the same vocabulary) |
| `vocal` / `somatic` / `material` | Spell components | spells (informational on items but doesn't drive rules) |
| `ritual` | Ritual | spells |
| `consumed` | Consumed (material) | spells |

## Dauligor-custom slugs (app-defined)

These were authored before the Foundry alignment and stay as Dauligor extensions.
They DO ship to Foundry on export — the module is responsible for interpreting
them (or letting Foundry leave them as harmless unknown slugs).

| Slug | Origin | App behavior | Module behavior |
|---|---|---|---|
| `lance` | App-custom | Treated as a normal weapon property — UI surfaces "must use 2 hands when mounted" hint | Module decorates the weapon with the same hint at runtime |
| `net` | App-custom | UI surfaces "restrains on hit" hint | Module reads and treats as a special-rules weapon |
| `range` | App-custom | UI surfaces "has a range" hint (used on melee weapons that gain reach via property) | Module decorates as a generic range hint |
| `improvised-weapons` | App-custom | UI surfaces "treated as improvised" hint | Module marks affected weapons as improvised |

The slug vocabulary is open — adding a new app-custom slug requires:
1. Inserting a row into `weapon_properties` (admin UI at `/admin/proficiencies`).
2. Optionally: extending the editor's render hint (purely cosmetic).
3. Optionally: extending the module's per-slug interpreter (if the slug needs
   runtime behavior in Foundry).

## Foundry-custom slugs (module-defined)

Slugs that originate in Foundry-side homebrew but the app passes through.

| Slug | Origin | App behavior | Module behavior |
|---|---|---|---|
| `superHeavy` | Foundry homebrew (Zweihänder) | Pass-through — app stores the slug verbatim, no UI hint | Module reads and applies the homebrew's heavier-than-heavy mechanics |
| (anything else) | Pass-through | Stored verbatim | Module decides — if registered, applied; if not, ignored |

## Contract — slug handling rules

### App-side: write path
- Editor: properties multiselect sources the catalog from the `weapon_properties`
  table. Adding a property to an item appends the row's `identifier` slug to the
  item's JSON `properties` array.
- Importer (Foundry → app): `itemImport.ts:buildUnifiedItemSavePayload` copies
  `system.properties` to `items.properties` verbatim. **It does not filter
  unknown slugs.** Unknown slugs survive the round-trip; the editor's multiselect
  preview shows them by their slug (no human-readable label) if they're not in
  the `weapon_properties` table.
- Export normalizer (`src/lib/classExport.ts` + per-entity export helpers): the
  `properties` array is passed through verbatim. No reverse-mapping of unknown
  Foundry slugs.

### Module-side: read path
- The module-side importer mirrors the app — pass through unknown slugs without
  filtering or renaming.
- The pre-existing module-side per-slug interpreters (e.g. the magical / silvered
  damage-type adjustment logic) check for the canonical 5e slugs first; unknown
  slugs fall through to "no special behavior", which is the safe default.

### Round-trip guarantee

A round-trip (app save → Foundry export → app re-import) preserves the
properties array exactly. The only translation that happens is the standard
5e slug rename that landed in 20260526-1700; that translation is one-time
data migration, not a runtime rewrite.

## When a new property is needed

**For a property that should be available across many homebrew weapons** (e.g.
"crit on 19+"), add it as an app-custom row in `weapon_properties`. The slug
goes through the standard pipe — editor authors it on items, export ships it,
module sees it. Document the slug here.

**For a property unique to one weapon's mechanics** — don't add a row to
`weapon_properties`. Instead, model the mechanic as an Active Effect or
Activity on the item directly. Single-weapon properties don't belong in the
shared vocabulary.

## Related docs

- App side: [`compendium-items.md`](../../../docs/features/compendium-items.md)
  (Custom properties contract section)
- Schema: [`proficiencies_weapons.md`](../../../docs/database/structure/proficiencies_weapons.md)
- Foundry side: dnd5e `CONFIG.DND5E.itemProperties` is the canonical 5e slug
  list this contract aligns with
