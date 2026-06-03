// Foundry-export importer for the dedicated `species` + `backgrounds`
// tables (migration 20260601-1200). Parses the dauligor-pairing
// folder-export envelopes produced for Species (`races`) and Backgrounds
// (`backgrounds`) and maps each item to a camelCase row ready for
// `upsertDocument` — NO normalize/denormalize, because the columns are
// already camelCase.
//
// Image handling mirrors the SPELL importer (the working reference), not
// the historical feat path: `resolveFoundryImageUrl(sourceDocument.img)`
// → `imageUrl`. The new tables' image column IS `imageUrl`, so the
// resolved URL lands in the column with no snake↔camel mapping to fumble
// (that mapping gap was the class of bug that dropped feat/spell images).
// Species/background images are absolute `cdn.5e.tools` URLs, so they
// pass through `resolveFoundryImageUrl` unchanged.

import { slugify } from './utils';
import { htmlToBbcode } from './bbcode';
import { cleanFoundryHtml } from './foundryHtmlCleanup';
import { parseBackgroundDetails } from './backgroundDetails';
import { proficienciesFromEntries, type ProficiencyLookups } from './backgroundProficiencies';

export type SpeciesBackgroundImportKind = 'species' | 'background';

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  slug?: string;
  rules?: string;
  rules_version?: string;
  [key: string]: any;
};

type ExistingRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  tags?: string[];
  createdAt?: string;
  [key: string]: any;
};

type FoundryExportEntry = {
  id?: string;
  uuid?: string;
  name: string;
  type?: string;
  source?: { book?: string; page?: string | number | null; rules?: string };
  sourceDocument?: any;
};

export type FoundrySpeciesBackgroundExport = {
  kind?: string;
  schemaVersion?: number;
  exportedAt?: string;
  moduleId?: string;
  summary?: Record<string, any>;
  races?: FoundryExportEntry[];
  backgrounds?: FoundryExportEntry[];
};

export type SpeciesBackgroundImportCandidate = {
  candidateId: string;
  batchLabel: string;
  kind: SpeciesBackgroundImportKind;
  name: string;
  identifier: string;
  imageUrl: string;
  descriptionHtml: string; // cleaned HTML, for the detail preview
  sourceBook: string;
  sourcePage: string;
  rules: string;
  matchedSourceId: string;
  matchedSourceLabel: string;
  sourceResolved: boolean;
  existingEntryId: string;
  existingEntryName: string;
  advancementCount: number;
  /** One-line type-specific summary for the list/detail. */
  summary: string;
  /** Extra rows shown in the detail facts table. */
  facts: Array<[string, string]>;
  importWarnings: string[];
  savePayload: Record<string, any>;
};

/** The expected envelope `kind` + the array key, keyed by import kind. */
export const IMPORT_KIND_META: Record<SpeciesBackgroundImportKind, {
  expectedKind: string;
  arrayKey: 'races' | 'backgrounds';
  collection: string;
  singular: string;
  plural: string;
}> = {
  species: {
    expectedKind: 'dauligor.foundry-race-folder-export.v1',
    arrayKey: 'races',
    collection: 'species',
    singular: 'Species',
    plural: 'Species',
  },
  background: {
    expectedKind: 'dauligor.foundry-background-folder-export.v1',
    arrayKey: 'backgrounds',
    collection: 'backgrounds',
    singular: 'Background',
    plural: 'Backgrounds',
  },
};

// ── helpers (mirrored from spellImport.ts — same resolution rules) ──

function toCleanUpper(value: string) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeRules(value: string) {
  const numeric = String(value ?? '').replace(/[^0-9]/g, '');
  if (numeric === '2014' || numeric === '14') return '2014';
  if (numeric === '2024' || numeric === '24') return '2024';
  return String(value ?? '').trim();
}

function resolveFoundryImageUrl(value: string) {
  // Keep ONLY real (absolute) art. The 5etools-sourced species/background
  // data uses absolute cdn.5e.tools URLs for art; the only relative paths
  // here are the plutonium module's generic placeholders (e.g.
  // `modules/plutonium/media/icon/family-tree.svg`), which aren't served
  // from our R2 — prefixing them would render a broken <img>. Treat those
  // as "no image" so the UI shows a clean placeholder instead.
  const raw = String(value ?? '').trim();
  return /^https?:\/\//iu.test(raw) ? raw : '';
}

function matchSourceRecord(book: string, rules: string, sources: SourceRecord[]) {
  const normalizedBook = toCleanUpper(book);
  const normalizedRules = normalizeRules(rules);
  const variants = new Set<string>();
  if (normalizedBook) {
    variants.add(normalizedBook);
    variants.add(normalizedBook.replace(/(2014|2024|14|24)$/u, ''));
  }
  const scored = sources
    .map((source) => {
      const candidates = [source.abbreviation, source.shortName, source.slug, source.name]
        .map((value) => toCleanUpper(String(value ?? '')))
        .filter(Boolean);
      let score = 0;
      for (const variant of variants) {
        if (!variant) continue;
        if (candidates.includes(variant)) score = Math.max(score, 3);
      }
      const sourceRules = normalizeRules(String(source.rules ?? source.rules_version ?? ''));
      if (score > 0 && normalizedRules && sourceRules && normalizedRules === sourceRules) score += 1;
      return { source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.source ?? null;
}

function numOrNull(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function convertFoundryHtmlToBbcode(html: string) {
  // Clean Foundry/5etools enrichers (@feat[…], &Reference[…], [[/r …]],
  // ve-rd__ wrappers, etc.) BEFORE converting to BBCode, so raw tokens
  // don't survive as literal text. Same pipeline the spell importer uses.
  return htmlToBbcode(cleanFoundryHtml(html || ''));
}

// ── per-kind system → column mappers ────────────────────────────────

// Foundry race `system.movement` is flat ({walk,fly,swim,climb,burrow,
// units,hover}) with string speeds; coerce to clean numbers for our
// camelCase `movement` column (the editor + exporter both use this shape).
function mapMovement(movement: any) {
  const m = movement && typeof movement === 'object' ? movement : {};
  return {
    walk: numOrNull(m.walk),
    fly: numOrNull(m.fly),
    swim: numOrNull(m.swim),
    climb: numOrNull(m.climb),
    burrow: numOrNull(m.burrow),
    hover: !!m.hover,
    units: String(m.units || 'ft'),
  };
}

// Foundry race `system.senses` nests ranges under `.ranges`; FLATTEN to
// our `senses` column shape ({darkvision,…,units,special}). The exporter
// re-nests on the way back out to Foundry.
function mapSenses(senses: any) {
  const s = senses && typeof senses === 'object' ? senses : {};
  const ranges = s.ranges && typeof s.ranges === 'object' ? s.ranges : s;
  return {
    darkvision: numOrNull(ranges.darkvision),
    blindsight: numOrNull(ranges.blindsight),
    tremorsense: numOrNull(ranges.tremorsense),
    truesight: numOrNull(ranges.truesight),
    units: String(s.units || 'ft'),
    special: String(s.special || ''),
  };
}

function mapCreatureType(type: any) {
  const t = type && typeof type === 'object' ? type : {};
  return {
    value: String(t.value || 'humanoid'),
    subtype: String(t.subtype || ''),
    swarm: String(t.swarm || ''),
    custom: String(t.custom || ''),
  };
}

function advancementArray(advancement: any): any[] {
  if (Array.isArray(advancement)) return advancement;
  if (advancement && typeof advancement === 'object') return Object.values(advancement);
  return [];
}

// ── candidate builder ───────────────────────────────────────────────

export function buildSpeciesBackgroundCandidates(
  kind: SpeciesBackgroundImportKind,
  exportPayload: FoundrySpeciesBackgroundExport,
  batchLabel: string,
  sources: SourceRecord[],
  existingEntries: ExistingRecord[],
  /** Skill/tool/language name→id lookups — used to resolve the prose
   *  proficiency block into the structured `proficiencies` field (backgrounds
   *  only). Omit for species or when the vocab isn't loaded. */
  profLookups?: ProficiencyLookups,
): SpeciesBackgroundImportCandidate[] {
  const meta = IMPORT_KIND_META[kind];
  const entries = Array.isArray((exportPayload as any)?.[meta.arrayKey])
    ? ((exportPayload as any)[meta.arrayKey] as FoundryExportEntry[])
    : [];

  return entries.map((entry, index) => {
    const doc = entry.sourceDocument ?? {};
    const system = doc.system ?? {};
    const name = entry.name || doc.name || `${meta.singular} ${index + 1}`;
    const identifier = String(system.identifier || '').trim() || slugify(name);

    const book = String(entry.source?.book ?? system.source?.book ?? '').trim();
    const page = String(entry.source?.page ?? system.source?.page ?? '').trim();
    const rules = String(entry.source?.rules ?? system.source?.rules ?? '').trim();
    const matchedSource = matchSourceRecord(book, rules, sources);
    const matchedSourceId = matchedSource?.id || '';

    const existingEntry = existingEntries.find((candidate) =>
      String(candidate.identifier ?? '') === identifier
      && String(candidate.sourceId ?? '') === matchedSourceId
    );

    const advancements = advancementArray(system.advancement);
    const imageUrl = resolveFoundryImageUrl(doc.img || '');
    const rawHtml = String(system.description?.value ?? '');
    const description = convertFoundryHtmlToBbcode(rawHtml);
    const descriptionHtml = cleanFoundryHtml(rawHtml);
    const preservedTags = Array.isArray(existingEntry?.tags) ? existingEntry!.tags! : [];

    const warnings: string[] = [];
    if (!matchedSource) warnings.push(`Source "${book || 'Unknown'}" (${rules || '—'}) didn't match a Dauligor source — it'll import with no source set.`);
    if (!imageUrl) warnings.push('No image on the Foundry item.');
    if (!rawHtml) warnings.push('Description is empty.');

    // Shared payload (camelCase columns — written directly via upsertDocument).
    const savePayload: Record<string, any> = {
      name,
      identifier,
      sourceId: matchedSourceId,
      page: page || null,
      imageUrl: imageUrl || null,
      description,
      advancements,
      tags: preservedTags,
    };

    const facts: Array<[string, string]> = [];
    let summary = '';

    if (kind === 'species') {
      const movement = mapMovement(system.movement);
      const senses = mapSenses(system.senses);
      const creatureType = mapCreatureType(system.type);
      savePayload.movement = movement;
      savePayload.senses = senses;
      savePayload.creatureType = creatureType;

      const ct = creatureType.subtype ? `${creatureType.value} (${creatureType.subtype})` : creatureType.value;
      const speedParts: string[] = [];
      if (movement.walk != null) speedParts.push(`${movement.walk} ${movement.units}`);
      if (movement.fly != null) speedParts.push(`fly ${movement.fly}`);
      if (movement.swim != null) speedParts.push(`swim ${movement.swim}`);
      if (movement.climb != null) speedParts.push(`climb ${movement.climb}`);
      if (movement.burrow != null) speedParts.push(`burrow ${movement.burrow}`);
      if (movement.hover) speedParts.push('hover');
      const senseParts: string[] = [];
      for (const [k, label] of [['darkvision', 'darkvision'], ['blindsight', 'blindsight'], ['tremorsense', 'tremorsense'], ['truesight', 'truesight']] as const) {
        if ((senses as any)[k] != null) senseParts.push(`${label} ${(senses as any)[k]}`);
      }
      facts.push(['Type', ct]);
      if (speedParts.length) facts.push(['Speed', speedParts.join(', ')]);
      if (senseParts.length) facts.push(['Senses', senseParts.join(', ')]);
      summary = [ct, speedParts[0]].filter(Boolean).join(' · ');
    } else {
      const wealth = String(system.wealth || '').trim();
      const startingEquipment = Array.isArray(system.startingEquipment) ? system.startingEquipment : [];
      savePayload.wealth = wealth;
      savePayload.startingEquipment = startingEquipment;
      if (wealth) facts.push(['Wealth', wealth]);
      if (startingEquipment.length) facts.push(['Equipment', `${startingEquipment.length} entries`]);
      summary = wealth ? `Wealth ${wealth}` : 'Background';

      // Lift the prose `[ul]` proficiency block into the STRUCTURED
      // `proficiencies` field (resolving names → trait keys) and strip it from
      // the stored description, so the view renders from structure instead of
      // re-parsing prose. Best-effort: unresolved names are warned, not guessed.
      const parsed = parseBackgroundDetails(description);
      if (profLookups && parsed.entries.length > 0) {
        const { proficiencies, unresolved } = proficienciesFromEntries(parsed.entries, profLookups);
        savePayload.proficiencies = proficiencies;
        savePayload.description = parsed.body;
        const profCount = parsed.entries.filter((e) => !e.key.startsWith('x:')).length;
        if (profCount) facts.push(['Proficiencies', `${profCount} line${profCount === 1 ? '' : 's'}`]);
        if (unresolved.length) {
          warnings.push(
            `${unresolved.length} proficiency option${unresolved.length === 1 ? '' : 's'} couldn't be auto-matched (add them in the editor): ${unresolved.slice(0, 6).join(', ')}${unresolved.length > 6 ? '…' : ''}`,
          );
        }
      }
    }

    return {
      candidateId: `${batchLabel}::${entry.uuid || entry.id || identifier}`,
      batchLabel,
      kind,
      name,
      identifier,
      imageUrl,
      descriptionHtml,
      sourceBook: book,
      sourcePage: page,
      rules,
      matchedSourceId,
      matchedSourceLabel: matchedSource?.name || matchedSource?.abbreviation || '',
      sourceResolved: Boolean(matchedSource),
      existingEntryId: existingEntry?.id || '',
      existingEntryName: existingEntry?.name || '',
      advancementCount: advancements.length,
      summary,
      facts,
      importWarnings: warnings,
      savePayload,
    };
  });
}

export { resolveFoundryImageUrl };
