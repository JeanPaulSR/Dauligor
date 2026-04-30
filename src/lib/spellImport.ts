import { slugify } from './utils';
import { htmlToBbcode } from './bbcode';

const IMAGE_CDN_BASE = 'https://images.dauligor.com';

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  slug?: string;
  rules?: string;
  [key: string]: any;
};

type ExistingSpellRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  [key: string]: any;
};

export type FoundrySpellExportEntry = {
  id: string;
  uuid?: string;
  name: string;
  type: string;
  folderId?: string | null;
  folderPath?: string;
  relativeFolderPath?: string;
  source?: {
    book?: string;
    page?: string | number | null;
    rules?: string;
  };
  spellSummary?: Record<string, any>;
  sourceDocument: any;
};

export type FoundrySpellFolderExport = {
  kind: string;
  schemaVersion?: number;
  exportedAt?: string;
  moduleId?: string;
  game?: Record<string, any>;
  folder?: Record<string, any>;
  summary?: Record<string, any>;
  spells?: FoundrySpellExportEntry[];
};

export type SpellImportCandidate = {
  candidateId: string;
  batchId: string;
  batchLabel: string;
  name: string;
  identifier: string;
  level: number;
  school: string;
  schoolLabel: string;
  method: string;
  methodLabel: string;
  sourceBook: string;
  sourcePage: string;
  rules: string;
  imageUrl: string;
  descriptionHtml: string;
  properties: string[];
  componentsLabel: string;
  ritual: boolean;
  concentration: boolean;
  activationLabel: string;
  rangeLabel: string;
  durationLabel: string;
  targetLabel: string;
  materialLabel: string;
  sourceDocument: any;
  matchedSourceId: string;
  matchedSourceLabel: string;
  sourceResolved: boolean;
  existingEntryId: string;
  existingEntryName: string;
  importWarnings: string[];
  activities: any[];
  effects: any[];
  savePayload: Record<string, any>;
};

export const SCHOOL_LABELS: Record<string, string> = {
  abj: 'Abjuration',
  con: 'Conjuration',
  div: 'Divination',
  enc: 'Enchantment',
  evo: 'Evocation',
  ill: 'Illusion',
  nec: 'Necromancy',
  trs: 'Transmutation'
};

export const METHOD_LABELS: Record<string, string> = {
  spell: 'Spell',
  always: 'Always',
  atwill: 'At-Will',
  innate: 'Innate',
  pact: 'Pact'
};

function toCleanUpper(value: string) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeRules(value: string) {
  const numeric = String(value ?? '').replace(/[^0-9]/g, '');
  if (numeric === '2014' || numeric === '14') return '2014';
  if (numeric === '2024' || numeric === '24') return '2024';
  return String(value ?? '').trim();
}

function resolveFoundryImageUrl(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//iu.test(raw)) return raw;
  if (raw.startsWith('/')) return `${IMAGE_CDN_BASE}${raw}`;
  if (/^(icons|systems|modules)\//iu.test(raw)) return `${IMAGE_CDN_BASE}/${raw}`;
  return raw;
}

function toDisplayTokenLabel(value: string) {
  return String(value ?? '')
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
      const candidates = [
        source.abbreviation,
        source.shortName,
        source.slug,
        source.name
      ]
        .map((value) => toCleanUpper(String(value ?? '')))
        .filter(Boolean);

      let score = 0;
      for (const variant of variants) {
        if (!variant) continue;
        if (candidates.includes(variant)) score = Math.max(score, 3);
        else if (candidates.some((candidate) => candidate.startsWith(variant) || variant.startsWith(candidate))) {
          score = Math.max(score, 2);
        }
      }

      const sourceRules = normalizeRules(String(source.rules ?? ''));
      if (score > 0 && normalizedRules && sourceRules && normalizedRules === sourceRules) score += 1;

      return { source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.source ?? null;
}

function extractTemplateLabel(template: any) {
  if (!template || !template.type) return '';
  const size = String(template.size ?? '').trim();
  const units = String(template.units ?? '').trim();
  const width = String(template.width ?? '').trim();
  const height = String(template.height ?? '').trim();

  if (size) return `${size}${units ? ` ${units}` : ''} ${template.type}`.trim();
  if (width || height) return `${width || height}${units ? ` ${units}` : ''} ${template.type}`.trim();
  return String(template.type ?? '').trim();
}

export function formatTargetLabel(target: any) {
  if (!target) return 'Special';
  const affects = target.affects ?? {};
  const template = target.template ?? {};
  const targetType = String(affects.type ?? '').trim();
  const count = String(affects.count ?? '').trim();
  const special = String(affects.special ?? '').trim();
  const templateLabel = extractTemplateLabel(template);

  if (special) return special;
  if (targetType === 'self') return 'Self';
  if (count && targetType) return `${count} ${targetType}${count === '1' ? '' : 's'}`;
  if (targetType) return targetType[0].toUpperCase() + targetType.slice(1);
  if (templateLabel) return templateLabel;
  return 'Special';
}

export function formatActivationLabel(activation: any) {
  if (!activation) return 'Special';
  const type = String(activation.type ?? '').trim();
  const value = String(activation.value ?? '').trim();
  const condition = String(activation.condition ?? '').trim();
  const parts = [];
  if (value && type) parts.push(`${value} ${type}`);
  else if (type) parts.push(type);
  else if (value) parts.push(value);
  if (condition) parts.push(condition);
  return parts.join(', ') || 'Special';
}

export function formatRangeLabel(range: any) {
  if (!range) return 'Special';
  const value = String(range.value ?? '').trim();
  const units = String(range.units ?? '').trim();
  const special = String(range.special ?? '').trim();
  if (special) return special;
  if (units === 'self') return 'Self';
  if (value && units) return `${value} ${units}`;
  if (value) return value;
  if (units) return units;
  return 'Special';
}

export function formatDurationLabel(duration: any) {
  if (!duration) return 'Special';
  const value = String(duration.value ?? '').trim();
  const units = String(duration.units ?? '').trim();
  if (units === 'inst') return 'Instantaneous';
  if (value && units) return `${value} ${units}`;
  if (units) return units;
  if (value) return value;
  return 'Special';
}

export function formatComponentsLabel(properties: string[], materials: any) {
  const flags = [];
  if (properties.includes('vocal')) flags.push('V');
  if (properties.includes('somatic')) flags.push('S');
  if (properties.includes('material')) flags.push('M');
  const materialText = String(materials?.value ?? '').trim();
  return materialText && flags.includes('M')
    ? `${flags.join(', ')} (${materialText})`
    : flags.join(', ') || 'None';
}

export function formatFoundrySpellDescriptionForDisplay(html: string) {
  return String(html ?? '')
    .replace(/\[\[\/r\s+([^\]]+?)\]\]/giu, '$1')
    .replace(/\[\[\/damage\s+([^\]\s]+)\s+type=([a-z-]+)(?:[^\]]*)\]\]/giu, '$1 $2')
    .replace(/\[\[\/damage\s+([^\]]+?)\]\]/giu, '$1')
    .replace(/@[^[]+\[([^|\]]+)(?:\|\|([^\]]+))?\]/giu, (_match, raw, display) => display || toDisplayTokenLabel(raw))
    .replace(/\sdata-[a-z0-9-]+="[^"]*"/giu, '')
    .replace(/\sclass="[^"]*"/giu, '')
    .replace(/<p>\s*<\/p>/giu, '')
    .trim();
}

function sanitizeFoundrySpellHtmlForStorage(html: string) {
  return String(html ?? '')
    .replace(/\sdata-[a-z0-9-]+="[^"]*"/giu, '')
    .replace(/\sclass="[^"]*"/giu, '')
    .replace(/<p>\s*<\/p>/giu, '')
    .trim();
}

function convertFoundrySpellHtmlToBbcode(html: string) {
  return htmlToBbcode(sanitizeFoundrySpellHtmlForStorage(html));
}

function buildImportWarnings(entry: FoundrySpellExportEntry, matchedSource: SourceRecord | null) {
  const warnings: string[] = [];
  const sourceDocument = entry.sourceDocument ?? {};
  if (!matchedSource) warnings.push(`Source "${entry.source?.book || 'Unknown'}" could not be matched to a Dauligor source.`);
  if (!sourceDocument?.system?.activities || Object.keys(sourceDocument.system.activities).length === 0) {
    warnings.push('No native Foundry activities were found on this spell.');
  }
  if (!sourceDocument?.system?.description?.value) warnings.push('Spell description is empty.');
  return warnings;
}

function buildSavePayload(entry: FoundrySpellFolderExport, spell: FoundrySpellExportEntry, matchedSource: SourceRecord | null) {
  const sourceDocument = spell.sourceDocument ?? {};
  const system = sourceDocument.system ?? {};
  const properties = Array.from(system.properties ?? []).map((value) => String(value));
  const materials = system.materials ?? {};
  const effects = Array.isArray(sourceDocument.effects) ? sourceDocument.effects : [];
  const method = String(system.method ?? 'spell').trim() || 'spell';
  const identifier = slugify(spell.name || sourceDocument.name || 'spell');
  const sourceBook = String(spell.source?.book ?? system.source?.book ?? '').trim();
  const rules = String(spell.source?.rules ?? system.source?.rules ?? '').trim();

  return {
    name: spell.name || sourceDocument.name || 'Spell',
    identifier,
    sourceId: matchedSource?.id || '',
    imageUrl: resolveFoundryImageUrl(sourceDocument.img || ''),
    description: convertFoundrySpellHtmlToBbcode(String(system.description?.value ?? '')),
    activities: Object.values(system.activities ?? {}),
    effectsStr: JSON.stringify(effects, null, 2),
    foundryImport: {
      kind: entry.kind,
      exportedAt: entry.exportedAt || '',
      moduleId: entry.moduleId || '',
      folderPath: String(spell.folderPath ?? ''),
      relativeFolderPath: String(spell.relativeFolderPath ?? ''),
      sourceBook,
      sourcePage: String(spell.source?.page ?? ''),
      rules,
      foundryItemId: spell.id,
      foundryUuid: spell.uuid || '',
      sourceResolved: Boolean(matchedSource)
    },
    foundryDocument: sourceDocument,
    level: Number(system.level ?? 0),
    school: String(system.school ?? 'evo'),
    preparationMode: method,
    ritual: properties.includes('ritual'),
    concentration: properties.includes('concentration'),
    components: {
      vocal: properties.includes('vocal'),
      somatic: properties.includes('somatic'),
      material: properties.includes('material'),
      materialText: String(materials.value ?? ''),
      consumed: Boolean(materials.consumed),
      cost: materials.cost ? String(materials.cost) : ''
    },
    foundryShell: {
      ability: String(system.ability ?? ''),
      method,
      prepared: Number(system.prepared ?? 0),
      sourceItem: String(system.sourceItem ?? ''),
      activation: system.activation ?? {},
      range: system.range ?? {},
      target: system.target ?? {},
      duration: system.duration ?? {},
      materials: {
        value: String(materials.value ?? ''),
        consumed: Boolean(materials.consumed),
        cost: Number(materials.cost ?? 0),
        supply: Number(materials.supply ?? 0)
      },
      properties,
      uses: system.uses ?? {}
    },
    sourceType: 'spell',
    type: 'spell',
    status: 'development'
  };
}

export function buildSpellImportCandidates(
  entry: FoundrySpellFolderExport,
  batchLabel: string,
  sources: SourceRecord[],
  existingEntries: ExistingSpellRecord[]
): SpellImportCandidate[] {
  const spells = Array.isArray(entry.spells) ? entry.spells : [];

  return spells.map((spell, index) => {
    const sourceDocument = spell.sourceDocument ?? {};
    const system = sourceDocument.system ?? {};
    const properties = Array.from(system.properties ?? []).map((value) => String(value));
    const matchedSource = matchSourceRecord(
      String(spell.source?.book ?? system.source?.book ?? ''),
      String(spell.source?.rules ?? system.source?.rules ?? ''),
      sources
    );
    const identifier = slugify(spell.name || sourceDocument.name || `spell-${index + 1}`);
    const existingEntry = existingEntries.find((candidate) =>
      String(candidate.identifier ?? '') === identifier
      && String(candidate.sourceId ?? '') === String(matchedSource?.id ?? '')
    );
    const activities = Object.values(system.activities ?? {});
    const effects = Array.isArray(sourceDocument.effects) ? sourceDocument.effects : [];
    const materialLabel = String(system.materials?.value ?? '').trim();
    const savePayload = buildSavePayload(entry, spell, matchedSource);
    const sourceBook = String(spell.source?.book ?? system.source?.book ?? '').trim();
    const sourcePage = String(spell.source?.page ?? system.source?.page ?? '').trim();
    const rules = String(spell.source?.rules ?? system.source?.rules ?? '').trim();

    return {
      candidateId: `${batchLabel}::${spell.uuid || spell.id || identifier}`,
      batchId: batchLabel,
      batchLabel,
      name: spell.name || sourceDocument.name || 'Spell',
      identifier,
      level: Number(system.level ?? 0),
      school: String(system.school ?? ''),
      schoolLabel: SCHOOL_LABELS[String(system.school ?? '')] || String(system.school ?? '').toUpperCase(),
      method: String(system.method ?? 'spell'),
      methodLabel: METHOD_LABELS[String(system.method ?? 'spell')] || String(system.method ?? 'spell'),
      sourceBook,
      sourcePage,
      rules,
      imageUrl: resolveFoundryImageUrl(sourceDocument.img || ''),
      descriptionHtml: String(system.description?.value ?? ''),
      properties,
      componentsLabel: formatComponentsLabel(properties, system.materials),
      ritual: properties.includes('ritual'),
      concentration: properties.includes('concentration'),
      activationLabel: formatActivationLabel(system.activation),
      rangeLabel: formatRangeLabel(system.range),
      durationLabel: formatDurationLabel(system.duration),
      targetLabel: formatTargetLabel(system.target),
      materialLabel,
      sourceDocument,
      matchedSourceId: matchedSource?.id || '',
      matchedSourceLabel: matchedSource?.name || matchedSource?.abbreviation || '',
      sourceResolved: Boolean(matchedSource),
      existingEntryId: existingEntry?.id || '',
      existingEntryName: existingEntry?.name || '',
      importWarnings: buildImportWarnings(spell, matchedSource),
      activities,
      effects,
      savePayload
    };
  });
}
