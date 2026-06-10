# Table Structure: `monsters`

The dedicated catalog of D&D 5e creature **stat blocks** (Foundry `npc` actors) —
beasts, dragons, fiends, NPCs — powering the public Monster Browser at
`/compendium/monsters`. Greenfield: monsters are Foundry **Actor** documents, a
fundamentally different shape than the `Item`-based items/feats/spells, so they get
their own first-class table (the "new table for new functionality" principle).

Schema baseline migration: `20260609-1600_create_monsters.sql`.

> **Design provenance.** Every column is pinned against the real 1001-creature
> Foundry export (`dauligor.foundry-creature-folder-export.v1`) and the 5etools
> render target — see the shape study
> [`docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html`](../../_drafts/monster-statblock-shapes-and-schema-2026-06-09.html).

## Conventions

- **camelCase columns** (post-2026-05-27 convention, like `species`/`backgrounds`):
  the d1 layer is column-name-agnostic, so camelCase round-trips through
  `src/lib/d1.ts` **without** a `compendium.ts` snake↔camel mapping. No alias table
  needed (contrast `items`).
- **Read `sourceDocument.system.*`, never `creatureSummary`** when importing
  authored data — but the **derived** values (`ac`, `proficiencyBonus`, `saves`,
  `skills`, `passivePerception`, spell DC) come from the *enriched* summary the
  exporter now emits (foundry-module `84424a2`), so they're exact and copied
  verbatim — no app-side recompute, no `ac_unverified` flag.
- JSON columns are stored as TEXT and auto-parsed on read by `d1.ts`'s `jsonFields`
  allowlist (+ the `api/_lib/d1-fetchers-server.ts` mirror).

## Layout Specs

### Identity + catalog
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | Foundry actor id (16-char). **PK is `id`, not `name`** — names are NOT unique (1001 rows ≈ 871 names; stat variants like Alhoon/Archmage repeat). |
| `name` | TEXT NOT NULL | Display name (`sourceDocument.name`). List column + search. |
| `identifier` | TEXT NOT NULL | Slug + disambiguator on collision (`goblin`, `goblin-2`). Source-scoped unique (index below). |
| `sourceId` | TEXT (FK) | → `sources.id`. Resolved from `system.source.book`. Filter axis. |
| `page` · `sourceBook` · `sourceRules` | TEXT | `system.source.{page,book,rules}`. `sourceBook` slug kept verbatim for re-resolution; `sourceRules` = `"2014"`/`"2024"`. |
| `imageUrl` · `tokenImageUrl` | TEXT | `img` / `prototypeToken.texture.src`. 967/1001 portraits hotlink `cdn.5e.tools` → plan an R2 mirror; token is local. |
| `tags` | JSON `string[]` | Tag-table FK array. Filter axis. Empty at import. |

### Stat-block header scalars (list display / filter / sort axes)
| Column | Type | Notes |
|---|---|---|
| `cr` | REAL | `system.details.cr`. **Primary sort + banded filter axis.** Fractions `0.125/0.25/0.5`; nullable (`Sacred Statue`). Render `0.25→"1/4"`. |
| `xp` | INTEGER | Derived from `cr` (standard table; CR 0→10, ⅛→25). Null when `cr` null. |
| `creatureType` | TEXT | `system.details.type.value` enum (beast/dragon/…). **Filter axis** + list column. *(Scalar string here — note `creatureType` is also a species JSON field in the auto-parse list; the parse safely skips a non-JSON string.)* |
| `typeSubtype` · `swarmSize` | TEXT | `type.subtype` (comma-multi, display) · `type.swarm` (14 swarms → "Swarm of Tiny beasts"). |
| `size` | TEXT | `system.traits.size` (`tiny/sm/med/lg/huge/grg`). **Filter axis.** |
| `alignment` | TEXT | `system.details.alignment`. **Free text, verbatim** (not a 9-cell enum). |
| `ac` · `acNote` · `acFormula` | INTEGER / TEXT / TEXT | **Resolved** `ac.value` from the enriched export (exact for all 1001, incl. the ~306 default-calc no-armor). `acNote` = "natural armor" / armor name / ''. `acFormula` kept for custom-calc. List column + sort. |
| `hp` · `hpFormula` | INTEGER / TEXT | `attributes.hp.{max,formula}`. List column + sort. |
| `proficiencyBonus` · `passivePerception` | INTEGER | From the enriched export (real values; raw summary had 0). |
| `hasLegendary` · `hasLair` · `hasSpellcasting` | INTEGER (bool) | **Filter axes.** Independent — don't gate one on another. |
| `legendaryActionCount` · `legendaryResistanceCount` · `lairInitiative` | INTEGER | `resources.legact.max` / `legres.max` / `lair.initiative`. Three orthogonal fields. |
| `legendaryActionsPreamble` | TEXT | Exact 2024 preamble prose, extracted from the "Legendary Actions" wrapper feat (not synthesized from the count). |

### Structured JSON columns (detail-only; not filter/sort axes)
| Column | Shape (TS-ish) |
|---|---|
| `movement` | `{walk?,fly?,swim?,climb?,burrow?:number, hover?:boolean, units, special?}` — nullable ints (Foundry stores strings; `walk:"0"` and missing-walk both mean "no walk"). Reuses the `species` movement shape. |
| `abilities` | `{str,dex,con,int,wis,cha: number}` — the six scores; mods derive `floor((v-10)/2)`. |
| `saves` | sparse `{ [ability]: number }` — only proficient saves; bonus from the enriched export (`abilities.<a>.save`). |
| `skills` | sparse `{ [slug]: { bonus: number, expertise: boolean } }` — only trained skills; `bonus` = enriched `skills.<s>.total` (expertise/doubled-prof already folded in); `expertise = (raw value === 2)`. Slug→name on render (`prc`=Perception, `prf`=Performance). |
| `senses` | `{blindsight?,darkvision?,tremorsense?,truesight?:number, units, special?}`. Passive Perception is the scalar column. Reuses the `species` senses shape. |
| `damageResistances` · `damageImmunities` · `damageVulnerabilities` | `{ value: string[], bypasses: string[], custom?: string }` — `bypasses` (`mgc`/`sil`/`ada`) MUST be kept (else "from nonmagical attacks" is lost). |
| `conditionImmunities` | `{ value: string[], custom?: string }` |
| `languages` | `{ value: string[], custom?: string, telepathy?: number }` — `telepathy` is SEPARATE; `custom` carries rules ("any four languages"). |
| `habitat` | `{ value: string[], custom?: string }` — `system.details.habitat`; renders the 5etools "Environment:" line. |
| `traits` | `Trait[]` — unnamed pre-Actions section. Legendary Resistance's "(N/Day)" comes from `legendaryResistanceCount`. |
| `actions` · `bonusActions` · `reactions` · `legendaryActions` · `lairActions` | `Action[]` — see shape below. |
| `regionalEffects` | `{ name?, description, sourceBook?, order }[]` |
| `spellcasting` | **`Spellcasting[]`** (array — 38 creatures have two blocks). See shape below. |
| `variantBlocks` | `{ title, sourceBook?, sourcePage?, description }[]` — FTD inset/variant boxes extracted from the biography. |
| `foundryData` | slim round-trip blob `{ source, resources, spells, _dauligorImport }` — NOT the full actor (the 109 MB export file is the archive). |
| `biography` · `description` | TEXT (BBCode) — full flavor + short teaser. |

### `Action` / `Trait` / `Spellcasting` JSON shapes
Adversarially verified: an `Action` carries an **array** of activity tuples (332+
weapons have ≥2 activities), and `spellcasting` is an **array** of blocks.

```ts
type Action = {
  name: string; description: string;        // prose (BBCode)
  pageBucket: string; order: number; sourceBook?: string;
  uses?: { max?: string; recovery?: Array<{period, formula?, type?}> };  // ITEM-level uses → "(Recharge 5–6)" / "(3/Day)"
  costs?: number;                            // legendary "(Costs N Actions)"
  activities: Array<{
    kind: 'attack'|'save'|'utility'|'heal'|'damage';
    activation: string;                      // action|bonus|reaction|legendary|lair|special|''
    attack?: { bonus: number; type: 'melee'|'ranged'; reach?: number; range?: number; long?: number; units };
    save?:   { abilities: string[]; dc: number; onSave?: 'half'|'none' };
    damageParts?: Array<{ average: number; formula: string; types: string[] }>;
  }>;
};
type Trait = { name; description; uses?; sourceBook?; order };
type Spellcasting = {                        // one per monsterSpellcasting feat
  ability: string; level: number; saveDc?: number; attackBonus?: number;
  method: 'spell'|'innate'|'pact'|'atwill';
  slots?: Record<string, number>; pactSlots?: { count; level };
  prose: string;                             // exact feat text (BBCode)
  spells: Array<{ identifier; name; level; method; uses? }>;  // resolve `identifier` → `spells` catalog (no duplication)
};
```

> **Spell linkage.** A creature's spell list is captured as embedded `spell` items
> (273 distinct, each with an `identifier` slug). Our `spells` catalog keys by the
> same `slugify(name)` identifier, so the monster's spells **link into the existing
> catalog by identifier** — no spell data is duplicated. Resolve via
> `slugify(name)` (normalizes the 2 `/`-name spells: Blindness/Deafness,
> Enlarge/Reduce). Edition-aligned (creature spells + our catalog both 2014).

### Meta
| Column | Type | Notes |
|---|---|---|
| `contentHash` | TEXT | SHA-256 of canonical content (re-import update detection). NULL until a hash-on-upsert path populates it. |
| `createdAt` · `updatedAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP; write paths bump `updatedAt`. |

## Indexes
- `idx_monsters_cr` ON (`cr`)
- `idx_monsters_type` ON (`creatureType`)
- `idx_monsters_size` ON (`size`)
- `idx_monsters_source` ON (`sourceId`)
- `monsters_source_identifier_uniq` UNIQUE ON (`COALESCE(sourceId,''), identifier`)

## JSON auto-parse registration
The JSON columns are registered in `src/lib/d1.ts`'s `jsonFields` list and the
mirror in `api/_lib/d1-fetchers-server.ts`. Reused from existing entries:
`spellcasting`, `senses`, `movement`, `tags`, `foundryData`. Added for monsters:
`abilities`, `saves`, `skills`, `damageResistances`, `damageImmunities`,
`damageVulnerabilities`, `conditionImmunities`, `languages`, `habitat`, `traits`,
`actions`, `bonusActions`, `reactions`, `legendaryActions`, `lairActions`,
`regionalEffects`, `variantBlocks`.

## Related docs
- Shape study + import algorithm: [`monster-statblock-shapes-and-schema-2026-06-09.html`](../../_drafts/monster-statblock-shapes-and-schema-2026-06-09.html)
- Branch kickoff: [`handoffs/monster-browser/2026-06-09-monster-browser-kickoff.md`](../../../handoffs/monster-browser/2026-06-09-monster-browser-kickoff.md)
- Export enrichment (derived values): [`handoffs/foundry-module/2026-06-09-reply-monster-browser-enrich-creature-export.md`](../../../handoffs/foundry-module/2026-06-09-reply-monster-browser-enrich-creature-export.md)
