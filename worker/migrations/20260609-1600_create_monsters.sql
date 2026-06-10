-- Create the `monsters` table — the dedicated home for D&D 5e creature stat
-- blocks (Foundry `npc` actors), powering the public Monster Browser at
-- /compendium/monsters. Greenfield: monsters are Foundry **Actor** documents, a
-- different shape than `Item`-based items/feats/spells, so they get their own
-- first-class table (the "new table for new functionality" principle) rather
-- than a discriminator on an existing one.
--
-- SHAPE STUDY: docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html
-- pins every column against the real 1001-creature Foundry export
-- (dauligor.foundry-creature-folder-export.v1) and the 5etools render target.
--
-- DERIVED VALUES: the creature exporter (foundry-module, commit 84424a2) now
-- emits Foundry's *prepared* values, so `ac` / `proficiencyBonus` / `saves` /
-- `skills` / `passivePerception` / spell DC are EXACT — the importer copies them
-- (no fragile app-side recompute, no `ac_unverified` flag). The slug-keyed
-- spell list resolves into the existing `spells` catalog by identifier (no spell
-- duplication).
--
-- CAMELCASE COLUMNS: per the post-2026-05-27 convention (species/backgrounds),
-- new compendium tables use camelCase column names from day one — the d1 data
-- layer (src/lib/d1.ts) is column-name-agnostic, so camelCase round-trips
-- WITHOUT a compendium.ts snake<->camel mapping. The JSON columns below are
-- registered in queryD1's auto-parse `jsonFields` list (src/lib/d1.ts) + the
-- server mirror (api/_lib/d1-fetchers-server.ts) so reads come back parsed.
--
-- ARRAY SHAPES (adversarially verified): `spellcasting` is a JSON **array** (38
-- creatures carry two spellcasting blocks); each entry in `actions` /
-- `legendaryActions` / etc. carries an `activities[]` **array** (332+ weapons
-- have >=2 activities). See the schema doc for the JSON shapes.
--
-- This table starts EMPTY. Content arrives via a Foundry-export importer (Phase
-- 3) — the schema lands first to be validated before the bulk load.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically and
-- rejects those at the wrangler exec layer.

CREATE TABLE IF NOT EXISTS monsters (
    -- ─── identity + catalog ──────────────────────────────────────────────
    id                       TEXT PRIMARY KEY,            -- Foundry actor id (names are NOT unique: 1001 rows, ~871 names)
    name                     TEXT NOT NULL,               -- display name (sourceDocument.name)
    identifier               TEXT NOT NULL,               -- slug + disambiguator on collision; unique within source (index below)
    sourceId                 TEXT REFERENCES sources(id), -- → sources.id; resolved from system.source.book ("MM'14"/"MPMM"/"VGM")
    page                     TEXT,                        -- system.source.page
    sourceBook               TEXT,                        -- raw system.source.book slug, kept verbatim for re-resolution
    sourceRules              TEXT,                        -- "2014" / "2024"
    imageUrl                 TEXT,                        -- sourceDocument.img (cdn.5e.tools hotlink → plan R2 mirror)
    tokenImageUrl            TEXT,                        -- prototypeToken.texture.src (local asset)
    tags                     TEXT DEFAULT '[]',           -- JSON: tag id array (filter axis; empty at import)

    -- ─── stat-block header scalars (list display / filter / sort) ────────
    cr                       REAL,                        -- system.details.cr (fractions 0.125/0.25/0.5; nullable — Sacred Statue)
    xp                       INTEGER,                     -- derived from cr (standard table); null when cr null
    creatureType             TEXT,                        -- system.details.type.value enum (beast/dragon/…) — FILTER AXIS, scalar string
    typeSubtype              TEXT,                        -- system.details.type.subtype (comma-multi; display)
    swarmSize                TEXT,                        -- system.details.type.swarm (14 swarms → "Swarm of Tiny beasts")
    size                     TEXT,                        -- system.traits.size (tiny/sm/med/lg/huge/grg) — FILTER AXIS
    alignment                TEXT,                        -- system.details.alignment (FREE TEXT, store verbatim)
    ac                       INTEGER,                     -- RESOLVED ac.value from the enriched export (exact for all 1001)
    acNote                   TEXT,                        -- parenthetical: "natural armor", armor name, or ''
    acFormula                TEXT,                        -- system.attributes.ac.formula (custom-calc creatures)
    hp                       INTEGER,                     -- system.attributes.hp.max (printed average)
    hpFormula                TEXT,                        -- system.attributes.hp.formula ("17d12 + 85")
    proficiencyBonus         INTEGER,                     -- enriched export (real PB; was 0 in raw)
    passivePerception        INTEGER,                     -- enriched export (10 + Perception bonus)
    hasLegendary             INTEGER DEFAULT 0,           -- bool: legact.max > 0 (filter axis)
    hasLair                  INTEGER DEFAULT 0,           -- bool: lair.value or any lair action (filter axis)
    hasSpellcasting          INTEGER DEFAULT 0,           -- bool: any spell item / spellcasting feat (filter axis)
    legendaryActionCount     INTEGER,                     -- resources.legact.max (drives the legendary preamble count)
    legendaryResistanceCount INTEGER,                     -- resources.legres.max ("Legendary Resistance (N/Day)")
    lairInitiative           INTEGER,                     -- resources.lair.initiative (lair preamble "On initiative count 20…")
    legendaryActionsPreamble TEXT,                        -- exact 2024 preamble prose, extracted from the wrapper feat

    -- ─── structured JSON columns (detail-only; auto-parsed by d1.ts) ─────
    movement                 TEXT DEFAULT '{}',           -- JSON: {walk,fly,swim,climb,burrow,hover,units,special} (reuses species shape)
    abilities                TEXT DEFAULT '{}',           -- JSON: {str,dex,con,int,wis,cha: number}
    saves                    TEXT DEFAULT '{}',           -- JSON: sparse {ability: bonus} (precomputed; only proficient saves)
    skills                   TEXT DEFAULT '{}',           -- JSON: sparse {slug: {bonus, expertise}} (value 2 = doubled prof)
    senses                   TEXT DEFAULT '{}',           -- JSON: {blindsight,darkvision,tremorsense,truesight,units,special} (reuses species shape)
    damageResistances        TEXT DEFAULT '{}',           -- JSON: {value[], bypasses[], custom?} — bypasses (mgc/sil/ada) MUST be kept
    damageImmunities         TEXT DEFAULT '{}',           -- JSON: same shape
    damageVulnerabilities    TEXT DEFAULT '{}',           -- JSON: same shape
    conditionImmunities      TEXT DEFAULT '{}',           -- JSON: {value[], custom?}
    languages                TEXT DEFAULT '{}',           -- JSON: {value[], custom?, telepathy?} (telepathy SEPARATE)
    habitat                  TEXT DEFAULT '{}',           -- JSON: {value[], custom?} — the 5etools "Environment:" line
    traits                   TEXT DEFAULT '[]',           -- JSON Trait[]   — unnamed pre-Actions section
    actions                  TEXT DEFAULT '[]',           -- JSON Action[]  — each entry carries activities[]
    bonusActions             TEXT DEFAULT '[]',           -- JSON Action[]
    reactions                TEXT DEFAULT '[]',           -- JSON Action[]
    legendaryActions         TEXT DEFAULT '[]',           -- JSON Action[]  (count = legendaryActionCount; preamble = legendaryActionsPreamble)
    lairActions              TEXT DEFAULT '[]',           -- JSON Action[]  (per-entry sourceBook splits MM base vs FTD additions)
    regionalEffects          TEXT DEFAULT '[]',           -- JSON {name?,description,sourceBook?}[]
    spellcasting             TEXT DEFAULT '[]',           -- JSON Spellcasting[] (ARRAY — up to 2 blocks; spells resolve to `spells` by identifier)
    variantBlocks            TEXT DEFAULT '[]',           -- JSON {title,sourceBook?,sourcePage?,description}[] (FTD inset boxes)
    foundryData              TEXT,                        -- JSON: slim round-trip blob {source, resources, spells, _dauligorImport}
    biography                TEXT,                        -- full flavor prose (BBCode)
    description              TEXT,                        -- short teaser (first paragraph)

    -- ─── meta ────────────────────────────────────────────────────────────
    contentHash              TEXT,                        -- SHA-256 of canonical content (re-import update detection); NULL until hashed
    createdAt                DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt                DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Filter / sort axes (mirror the items index pattern).
CREATE INDEX IF NOT EXISTS idx_monsters_cr     ON monsters(cr);
CREATE INDEX IF NOT EXISTS idx_monsters_type   ON monsters(creatureType);
CREATE INDEX IF NOT EXISTS idx_monsters_size   ON monsters(size);
CREATE INDEX IF NOT EXISTS idx_monsters_source ON monsters(sourceId);

-- Source-scoped uniqueness (same pattern as feats/items/backgrounds): two
-- sources may both ship "goblin"; one source may not ship it twice. COALESCE
-- collapses NULL sourceIds into one bucket (SQLite treats each NULL as distinct
-- otherwise).
CREATE UNIQUE INDEX IF NOT EXISTS monsters_source_identifier_uniq
    ON monsters(COALESCE(sourceId, ''), identifier);
