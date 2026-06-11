// Monster importer — transforms a Foundry `npc` actor entry from a
// `dauligor.foundry-creature-folder-export.v1` export into a `monsters` table
// row. Mirrors the pattern of `itemImport.ts` / `spellImport.ts`: a pure
// transform (entry + lookups → row) that a seed script or a future import
// workbench can consume.
//
// Design + provenance: docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html
// and docs/database/structure/monsters.md.
//
// The export's `creatureSummary` now carries Foundry's DERIVED values (resolved
// ac.value, real proficiencyBonus, abilities.<a>.save+.mod, skills.<s>.total,
// passivePerception, spellcasting.{dc,attack,level}) — so those are copied
// EXACT, no recompute. Authored-only data (damage-trait bypasses/custom,
// languages telepathy/custom, habitat, full biography, resources, embedded
// items) is read from `sourceDocument.system.*`.

import { slugify } from './utils';
import { htmlToBbcode } from './bbcode';
import { foundryActivityToSemantic } from './foundryActivities';

// ─── lookups passed in by the runner ────────────────────────────────────────
export interface MonsterImportContext {
  /** abbreviation (UPPER, year-suffix stripped) → sources.id */
  sourcesByAbbrev: Map<string, string>;
  /** the set of spell `identifier` slugs present in the spells catalog */
  spellIdents: Set<string>;
  /** identifiers already taken (for collision disambiguation); mutated as we go */
  takenIdentifiers: Set<string>;
}

export interface MonsterImportResult {
  row: Record<string, any>;
  warnings: string[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

function abilityMod(score: number): number {
  return Math.floor((Number(score) - 10) / 2);
}

/** Strip a "'14"/"’24" year suffix and upper-case for source matching. */
function normalizeBook(book: string): string {
  return String(book || '').replace(/['’]\d{2}$/, '').trim().toUpperCase();
}

/** The 2 D&D spell names with a "/" — our slugify drops it, Foundry keeps "-". */
function normalizeSpellIdentifier(name: string, foundryId?: string): string {
  // Resolve against OUR catalog the way it was keyed: slugify(name).
  return slugify(name || foundryId || '');
}

/** Parse a Foundry movement block (string speeds) into nullable ints. */
function parseMovement(mv: any): Record<string, any> {
  if (!mv || typeof mv !== 'object') return {};
  const out: Record<string, any> = { units: mv.units || 'ft' };
  for (const k of ['walk', 'fly', 'swim', 'climb', 'burrow']) {
    const v = mv[k];
    if (v === '' || v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) out[k] = n; // walk "0"/absent → omitted
  }
  if (mv.hover) out.hover = true;
  if (mv.special) out.special = String(mv.special);
  return out;
}

/** Standard 5e CR → XP table. */
const CR_XP: Record<string, number> = {
  '0': 10, '0.125': 25, '0.25': 50, '0.5': 100, '1': 200, '2': 450, '3': 700,
  '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000,
  '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000,
  '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000,
  '29': 135000, '30': 155000,
};
function crToXp(cr: number | null): number | null {
  if (cr == null) return null;
  const key = Number.isInteger(cr) ? String(cr) : String(cr);
  return CR_XP[key] ?? null;
}

function buildUses(item: any) {
  const uses = item?.system?.uses;
  if (!uses) return undefined;
  const recovery = Array.isArray(uses.recovery)
    ? uses.recovery.map((r: any) => ({ period: r.period, formula: r.formula, type: r.type })).filter((r: any) => r.period)
    : [];
  if (!uses.max && recovery.length === 0) return undefined;
  return { max: uses.max ? String(uses.max) : undefined, recovery };
}

function buildAction(item: any, _abilities: Record<string, number>, _pb: number, pageBucket: string) {
  const acts = item?.system?.activities;
  // Convert each Foundry activity to the shared SemanticActivity shape — formulas
  // (@mod, dc.formula, dice components) PRESERVED. This is the same converter
  // items/feats/spells use, so monster activities ride the existing Foundry-export
  // pipeline (the module's normalizeSemanticActivityCollection) and re-export as
  // functional attack/save/damage activities instead of inert display numbers.
  const activities = acts && typeof acts === 'object'
    ? Object.values(acts).filter((a: any) => a && typeof a === 'object').map((a: any, i: number) => foundryActivityToSemantic(a, i))
    : [];
  const action: any = {
    name: item.name || '',
    description: htmlToBbcode(item?.system?.description?.value || ''),
    pageBucket,
    order: Number(item.sort) || 0,
    activities,
  };
  const sb = item?.system?.source?.book;
  if (sb) action.source_book = sb;
  const uses = buildUses(item);
  if (uses) action.uses = uses;
  // legendary "(Costs N Actions)" — activation.value on the (single) activity
  const firstAct: any = acts ? Object.values(acts)[0] : null;
  const cost = Number(firstAct?.activation?.value);
  if (!Number.isNaN(cost) && cost > 1) action.costs = cost;
  // MM lair/regional bullets have no real name — Plutonium truncates the full
  // sentence into the name (ends in "…"/"..."). Render them as unnamed bullets.
  if ((pageBucket === 'monsterLairActions' || pageBucket === 'monsterRegionalEffects')
      && /(\.\.\.|…)\s*$/.test(action.name)) {
    action.name = '';
  }
  return action;
}

const PAGE_TO_SECTION: Record<string, string> = {
  monsterTrait: 'traits',
  monsterAction: 'actions',
  monsterBonus: 'bonusActions',
  monsterReaction: 'reactions',
  monsterLegendary: 'legendaryActions',
  monsterLairActions: 'lairActions',
  monsterRegionalEffects: 'regionalEffects',
};

// ─── the transform ────────────────────────────────────────────────────────────
export function creatureEntryToMonsterRow(entry: any, ctx: MonsterImportContext): MonsterImportResult {
  const warnings: string[] = [];
  const doc = entry.sourceDocument ?? {};
  const sys = doc.system ?? {};
  const sum = entry.creatureSummary ?? {};
  const items: any[] = Array.isArray(doc.items) ? doc.items : [];

  // identity
  const name = String(doc.name || entry.name || 'Unknown');
  let identifier = slugify(name) || 'monster';
  if (ctx.takenIdentifiers.has(identifier)) {
    let n = 2;
    while (ctx.takenIdentifiers.has(`${identifier}-${n}`)) n++;
    identifier = `${identifier}-${n}`;
  }
  ctx.takenIdentifiers.add(identifier);

  const book = sys.source?.book || '';
  const sourceId = ctx.sourcesByAbbrev.get(normalizeBook(book)) ?? null;
  if (book && !sourceId) warnings.push(`source "${book}" unresolved`);

  // abilities (scores) + derived saves/skills from the ENRICHED summary
  const abilities: Record<string, number> = {};
  for (const a of ABILITIES) abilities[a] = Number(sum.abilities?.[a]?.value ?? sys.abilities?.[a]?.value ?? 10) || 10;
  const pb = Number(sum.proficiencyBonus ?? 0) || 0;

  const saves: Record<string, number> = {};
  for (const a of ABILITIES) {
    if (sum.abilities?.[a]?.proficient) saves[a] = Number(sum.abilities[a].save ?? (abilityMod(abilities[a]) + pb));
  }
  const skills: Record<string, any> = {};
  for (const [slug, v] of Object.entries(sum.skills ?? {})) {
    const sv: any = v;
    if (Number(sv?.value) > 0) skills[slug] = { bonus: Number(sv.total ?? 0), expertise: Number(sv.value) === 2 };
  }

  // damage / condition / language traits — authored (summary lacks bypasses/custom)
  const dmgTrait = (t: any) => ({
    value: Array.from(t?.value ?? []),
    bypasses: Array.from(t?.bypasses ?? []),
    ...(t?.custom ? { custom: String(t.custom) } : {}),
  });
  const cr = sum.cr ?? sys.details?.cr ?? null;

  // ─── body: bucket embedded items into sections ───────────────────────────
  const sections: Record<string, any[]> = {
    traits: [], actions: [], bonusActions: [], reactions: [],
    legendaryActions: [], lairActions: [], regionalEffects: [],
  };
  const spellItems: any[] = [];
  const spellcastingFeats: any[] = [];
  let legendaryPreamble = '';

  for (const it of items) {
    const t = it.type;
    if (t === 'spell') { spellItems.push(it); continue; }
    if (t === 'equipment') continue; // worn gear — informs AC only
    const page = it.flags?.plutonium?.page ?? null;
    const hasActs = it.system?.activities && Object.keys(it.system.activities).length > 0;

    if (page === 'monsterSpellcasting') { spellcastingFeats.push(it); continue; }
    if (page == null && !hasActs) {
      // the "Legendary Actions" wrapper header — extract its preamble, drop it
      if (/legendary action/i.test(it.name || '')) legendaryPreamble = htmlToBbcode(it.system?.description?.value || '');
      else sections.traits.push(buildAction(it, abilities, pb, 'monsterTrait'));
      continue;
    }
    let section = PAGE_TO_SECTION[page] ?? (t === 'weapon' ? 'actions' : 'traits');
    // The monsterTrait bucket is heterogeneous — 97 bonus-activation features are
    // flagged monsterTrait (not monsterBonus), so refine by the activity's
    // activation type: e.g. Goblin's Nimble Escape (page monsterTrait, activation
    // bonus) must render under Bonus Actions, not Traits. (All reaction features
    // are already monsterReaction; this is belt-and-suspenders.)
    if (page === 'monsterTrait' && hasActs) {
      const activations = Object.values(it.system.activities)
        .map((a: any) => a?.activation?.type).filter(Boolean);
      if (activations.includes('bonus')) section = 'bonusActions';
      else if (activations.includes('reaction')) section = 'reactions';
    }
    sections[section].push(buildAction(it, abilities, pb, page || (t === 'weapon' ? 'monsterAction' : 'monsterTrait')));
  }
  // preserve authored order within each section
  for (const k of Object.keys(sections)) sections[k].sort((a, b) => a.order - b.order);

  // ─── spellcasting blocks ──────────────────────────────────────────────────
  const spellcasting: any[] = [];
  if (spellItems.length || spellcastingFeats.length) {
    // The export ships each spell as TWO items (distinct _id, same name/level/
    // method) — dedup on (identifier, level, method) so the list isn't doubled.
    const seenSpell = new Set<string>();
    const linkedSpells = spellItems.map((it) => {
      const ident = normalizeSpellIdentifier(it.name, it.system?.identifier);
      const u = buildUses(it);
      return {
        identifier: ident,
        name: it.name,
        level: Number(it.system?.level ?? 0),
        method: it.system?.method || 'spell',
        ...(u ? { uses: u } : {}),
      };
    }).filter((s) => {
      const key = `${s.identifier}|${s.level}|${s.method}`;
      if (seenSpell.has(key)) return false;
      seenSpell.add(key);
      if (!ctx.spellIdents.has(s.identifier)) warnings.push(`spell "${s.name}" (${s.identifier}) not in catalog`);
      return true;
    });
    const dominantMethod = (() => {
      const c: Record<string, number> = {};
      for (const s of linkedSpells) c[s.method] = (c[s.method] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'spell';
    })();
    const feats = spellcastingFeats.length ? spellcastingFeats : [null];
    feats.forEach((feat, idx) => {
      spellcasting.push({
        ability: sum.spellcasting?.ability || sys.attributes?.spellcasting || '',
        level: Number(sum.spellcasting?.level ?? sys.attributes?.spell?.level ?? 0),
        saveDc: Number(sum.spellcasting?.dc ?? 0) || undefined,
        attackBonus: Number(sum.spellcasting?.attack ?? 0) || undefined,
        method: dominantMethod,
        slots: Object.fromEntries(
          Object.entries(sum.spellcasting?.slots ?? {})
            .map(([k, v]: any) => [k, Number(v?.value ?? 0)])
            .filter(([, n]) => n > 0),
        ),
        prose: feat ? htmlToBbcode(feat.system?.description?.value || '') : '',
        // attach all linked spells to the first block (per-feat association is a follow-up)
        spells: idx === 0 ? linkedSpells : [],
      });
    });
  }

  // ─── assemble row ──────────────────────────────────────────────────────────
  const biographyHtml = sys.details?.biography?.value || '';
  const biography = htmlToBbcode(biographyHtml);
  const description = biography.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

  const legactMax = Number(sys.resources?.legact?.max ?? 0) || 0;
  const legresMax = Number(sys.resources?.legres?.max ?? 0) || 0;
  const lairVal = sys.resources?.lair?.value;

  const acCalc = sum.ac?.calc || '';
  const acNote = acCalc === 'natural' ? 'natural armor' : '';

  const row: Record<string, any> = {
    id: entry.id || doc._id,
    name,
    identifier,
    sourceId,
    page: sys.source?.page != null ? String(sys.source.page) : null,
    sourceBook: book || null,
    sourceRules: sys.source?.rules || null,
    imageUrl: doc.img || null,
    tokenImageUrl: doc.prototypeToken?.texture?.src || null,
    tags: [],

    cr,
    xp: crToXp(cr),
    creatureType: sys.details?.type?.value || sum.creatureType?.value || null,
    typeSubtype: sys.details?.type?.subtype || null,
    swarmSize: sys.details?.type?.swarm || null,
    size: sys.traits?.size || sum.size || null,
    alignment: sys.details?.alignment || sum.alignment || null,
    ac: Number(sum.ac?.value ?? 0) || null,
    acNote,
    acFormula: sum.ac?.formula || null,
    hp: Number(sum.hp?.max ?? sys.attributes?.hp?.max ?? 0) || null,
    hpFormula: sum.hp?.formula || sys.attributes?.hp?.formula || null,
    proficiencyBonus: pb || null,
    passivePerception: Number(sum.passivePerception ?? 0) || null,
    hasLegendary: legactMax > 0 ? 1 : 0,
    hasLair: (lairVal || sections.lairActions.length > 0) ? 1 : 0,
    hasSpellcasting: spellcasting.length > 0 ? 1 : 0,
    legendaryActionCount: legactMax || null,
    legendaryResistanceCount: legresMax || null,
    lairInitiative: Number(sys.resources?.lair?.initiative ?? 0) || null,
    legendaryActionsPreamble: legendaryPreamble || null,

    movement: parseMovement(sum.movement ?? sys.attributes?.movement),
    abilities,
    saves,
    skills,
    senses: {
      ...Object.fromEntries(
        Object.entries(sum.senses?.ranges ?? {}).filter(([, v]: any) => Number(v) > 0).map(([k, v]: any) => [k, Number(v)]),
      ),
      units: sum.senses?.units || 'ft',
      ...(sum.senses?.special ? { special: String(sum.senses.special) } : {}),
    },
    damageResistances: dmgTrait(sys.traits?.dr),
    damageImmunities: dmgTrait(sys.traits?.di),
    damageVulnerabilities: dmgTrait(sys.traits?.dv),
    conditionImmunities: {
      value: Array.from(sys.traits?.ci?.value ?? []),
      ...(sys.traits?.ci?.custom ? { custom: String(sys.traits.ci.custom) } : {}),
    },
    languages: {
      value: Array.from(sys.traits?.languages?.value ?? []),
      ...(sys.traits?.languages?.custom ? { custom: String(sys.traits.languages.custom) } : {}),
      ...(sys.traits?.languages?.communication?.telepathy?.value
        ? { telepathy: Number(sys.traits.languages.communication.telepathy.value) }
        : {}),
    },
    habitat: {
      value: Array.isArray(sys.details?.habitat?.value)
        ? sys.details.habitat.value.map((h: any) => h?.type).filter(Boolean)
        : [],
      ...(sys.details?.habitat?.custom ? { custom: String(sys.details.habitat.custom) } : {}),
    },
    traits: sections.traits,
    actions: sections.actions,
    bonusActions: sections.bonusActions,
    reactions: sections.reactions,
    legendaryActions: sections.legendaryActions,
    lairActions: sections.lairActions,
    regionalEffects: sections.regionalEffects,
    spellcasting,
    variantBlocks: [], // FTD inset extraction deferred; insets survive in `biography`
    foundryData: {
      source: sys.source ?? null,
      resources: sys.resources ?? null,
      spells: sys.spells ?? null,
      _dauligorImport: { uuid: entry.uuid, exportKind: 'creature-folder-export.v1' },
    },
    biography,
    description,
  };

  return { row, warnings };
}

/** The monsters-table column order (also drives the seed INSERT). */
export const MONSTER_COLUMNS = [
  'id', 'name', 'identifier', 'sourceId', 'page', 'sourceBook', 'sourceRules',
  'imageUrl', 'tokenImageUrl', 'tags', 'cr', 'xp', 'creatureType', 'typeSubtype',
  'swarmSize', 'size', 'alignment', 'ac', 'acNote', 'acFormula', 'hp', 'hpFormula',
  'proficiencyBonus', 'passivePerception', 'hasLegendary', 'hasLair', 'hasSpellcasting',
  'legendaryActionCount', 'legendaryResistanceCount', 'lairInitiative', 'legendaryActionsPreamble',
  'movement', 'abilities', 'saves', 'skills', 'senses', 'damageResistances', 'damageImmunities',
  'damageVulnerabilities', 'conditionImmunities', 'languages', 'habitat', 'traits', 'actions',
  'bonusActions', 'reactions', 'legendaryActions', 'lairActions', 'regionalEffects',
  'spellcasting', 'variantBlocks', 'foundryData', 'biography', 'description',
] as const;

/** Columns that hold JSON (object/array) values — stringified on write. */
export const MONSTER_JSON_COLUMNS = new Set([
  'tags', 'movement', 'abilities', 'saves', 'skills', 'senses', 'damageResistances',
  'damageImmunities', 'damageVulnerabilities', 'conditionImmunities', 'languages',
  'habitat', 'traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions',
  'lairActions', 'regionalEffects', 'spellcasting', 'variantBlocks', 'foundryData',
]);
