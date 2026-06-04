/**
 * Structured background proficiencies — on the SHARED class proficiency model.
 * ───────────────────────────────────────────────────────────────────────────
 * Backgrounds grant skill / tool / language proficiencies. These are stored in
 * the `proficiencies` column using the SAME per-kind selection shape the class
 * editor uses (`{choiceCount, fixedIds, optionIds, categoryIds}`, ids = table
 * ROW ids), so the shared `ProficienciesEditor` picker and `proficiencySelection`
 * helpers work unchanged and the export mirrors the class path.
 *
 * Populated once at import (best-effort prose → selection), edited via the
 * shared picker, and rendered from structure (no per-render prose parsing).
 * The background EXPORT maps the stored row ids → trait identifiers and emits
 * dnd5e Trait advancements.
 *
 * (2024-only ability-score increases + origin feat are intentionally NOT
 * modelled here — the catalog is 2014-focused.)
 */

import { parseBackgroundDetails } from './backgroundDetails';
import {
  type ProficiencySelection,
  sanitizeProficiencySelection,
  buildGroupedProficiencyDisplayName,
  normalizeChoiceCount,
} from './proficiencySelection';

export type { ProficiencySelection } from './proficiencySelection';

export type BackgroundProficiencies = {
  skills: ProficiencySelection;
  tools: ProficiencySelection;
  languages: ProficiencySelection;
};

export type ProficiencyTraitKind = 'skills' | 'tools' | 'languages';

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function emptySelection(): ProficiencySelection {
  return { choiceCount: 0, fixedIds: [], optionIds: [], categoryIds: [] };
}

export function emptyProficiencies(): BackgroundProficiencies {
  return { skills: emptySelection(), tools: emptySelection(), languages: emptySelection() };
}

export function normalizeProficiencies(raw: any): BackgroundProficiencies {
  if (!raw || typeof raw !== 'object') return emptyProficiencies();
  return {
    skills: sanitizeProficiencySelection(raw.skills, { includeCategories: false }),
    tools: sanitizeProficiencySelection(raw.tools, { includeCategories: true }),
    languages: sanitizeProficiencySelection(raw.languages, { includeCategories: true }),
  };
}

function selectionHasContent(s: ProficiencySelection): boolean {
  return (s.fixedIds?.length || 0) > 0 || (s.optionIds?.length || 0) > 0 || (s.choiceCount || 0) > 0;
}

export function hasAnyProficiencies(p: BackgroundProficiencies | null | undefined): boolean {
  if (!p) return false;
  return selectionHasContent(p.skills) || selectionHasContent(p.tools) || selectionHasContent(p.languages);
}

// ── name ↔ row-id resolution ───────────────────────────────────────

function normName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
}

export type NameToId = Record<string, string>;

/** name (normalised) → table ROW id, from a skills/tools/languages collection.
 *  Also indexes the identifier so already-keyed values resolve. */
export function buildNameToId(rows: Array<{ id?: string; identifier?: string; name?: string }>): NameToId {
  const map: NameToId = {};
  for (const r of rows || []) {
    const id = String(r?.id ?? '').trim();
    if (!id) continue;
    const name = normName(String(r?.name ?? ''));
    if (name) map[name] = id;
    const ident = normName(String(r?.identifier ?? ''));
    if (ident) map[ident] = id;
  }
  return map;
}

export type ProficiencyLookups = { skills: NameToId; tools: NameToId; languages: NameToId };

/** Item lists used to render selections back into readable phrases. */
export type ProficiencyVocab = {
  skills: Array<{ id: string; name: string; categoryId?: string }>;
  tools: Array<{ id: string; name: string; categoryId?: string }>;
  languages: Array<{ id: string; name: string; categoryId?: string }>;
  toolCategories?: Array<{ id: string; name: string }>;
  languageCategories?: Array<{ id: string; name: string }>;
};

// ── import: prose value → class-shape selection ────────────────────

function plainify(value: string): string {
  return String(value ?? '')
    .replace(/\[url(?:=[^\]]*)?\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/[@&](?:amp;)?[a-z][a-z0-9-]*\[[^\]]*\](?:\{([^}]*)\})?/gi, (_m, d) => d || '')
    .replace(/[A-Za-z][A-Za-z0-9]*\{([^{}]+)\}/g, '$1')
    .replace(/\[\/?[a-z][^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordToCount(token: string): number {
  const t = token.trim().toLowerCase();
  if (NUMBER_WORDS[t]) return NUMBER_WORDS[t];
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function splitOptions(s: string): string[] {
  return String(s ?? '')
    .replace(/\band\b/gi, ',')
    .replace(/\bor\b/gi, ',')
    .split(/[,;]+/)
    .map((p) => p.replace(/^\s*(?:a|an|one|two|three|four|five|the)\s+/i, '').trim())
    .filter(Boolean);
}

export function parseProficiencyValue(
  value: string,
  nameToId: NameToId,
): { selection: ProficiencySelection; unresolved: string[] } {
  const selection = emptySelection();
  const unresolved: string[] = [];
  const text = plainify(value);
  if (!text) return { selection, unresolved };

  const resolve = (name: string): string | null => nameToId[normName(name)] ?? null;
  const resolveList = (raw: string): string[] =>
    splitOptions(raw).map((p) => {
      const id = resolve(p);
      if (!id) unresolved.push(p);
      return id;
    }).filter(Boolean) as string[];

  const ofChoice = /\b(\d+|one|two|three|four|five|six|a|an|any|your)\b[^,;.]*?\bof your choice\b/i.exec(text);
  const chooseFrom = /\bchoose\s+(\d+|one|two|three|four|five|six)\b\s+(?:from(?:\s+among)?|of)\s+(.+)$/i.exec(text);

  if (chooseFrom) {
    selection.choiceCount = wordToCount(chooseFrom[1]);
    selection.optionIds = resolveList(chooseFrom[2]);
    return { selection, unresolved };
  }
  if (ofChoice && !/\bor\b/i.test(text)) {
    const tok = ofChoice[1];
    selection.choiceCount = /^(a|an|any|your)$/i.test(tok) ? 1 : wordToCount(tok);
    selection.optionIds = [];
    return { selection, unresolved };
  }
  if (/\bor\b/i.test(text) && !/of your choice/i.test(text)) {
    const pool = resolveList(text);
    if (pool.length) {
      selection.choiceCount = 1;
      selection.optionIds = pool;
      return { selection, unresolved };
    }
  }
  for (const part of splitOptions(text)) {
    if (/of your choice/i.test(part)) { selection.choiceCount = Math.max(selection.choiceCount, 1); continue; }
    const id = resolve(part);
    if (id) selection.fixedIds.push(id);
    else if (part.trim()) unresolved.push(part.trim());
  }
  return { selection, unresolved };
}

function mergeSelection(into: ProficiencySelection, from: ProficiencySelection) {
  for (const id of from.fixedIds) if (!into.fixedIds.includes(id)) into.fixedIds.push(id);
  for (const id of from.optionIds) if (!into.optionIds.includes(id)) into.optionIds.push(id);
  into.choiceCount = Math.max(into.choiceCount, from.choiceCount);
}

export function proficienciesFromEntries(
  entries: Array<{ key: string; value: string }>,
  lookups: ProficiencyLookups,
): { proficiencies: BackgroundProficiencies; unresolved: string[] } {
  const prof = emptyProficiencies();
  const unresolved: string[] = [];
  const apply = (kind: ProficiencyTraitKind, value: string, look: NameToId, tag: string) => {
    const r = parseProficiencyValue(value, look);
    mergeSelection(prof[kind], r.selection);
    unresolved.push(...r.unresolved.map((u) => `${tag}: ${u}`));
  };
  for (const entry of entries) {
    switch (entry.key) {
      case 'skills': apply('skills', entry.value, lookups.skills, 'skill'); break;
      case 'tools': apply('tools', entry.value, lookups.tools, 'tool'); break;
      case 'languages': apply('languages', entry.value, lookups.languages, 'language'); break;
      case 'languagesTools':
        apply('languages', entry.value, lookups.languages, 'language');
        apply('tools', entry.value, lookups.tools, 'tool');
        break;
      // 'abilityScores' / 'feat' (2024) are deliberately not modelled.
      default: break;
    }
  }
  return { proficiencies: prof, unresolved };
}

// ── display: selection → readable lines ────────────────────────────

const TRAIT_LABELS: Record<ProficiencyTraitKind, string> = {
  skills: 'Skill Proficiencies',
  tools: 'Tool Proficiencies',
  languages: 'Languages',
};

/** Build the ordered display lines for a background's proficiency section,
 *  reusing the class display formatter. */
export function proficiencyDisplayLines(
  prof: BackgroundProficiencies,
  vocab: ProficiencyVocab,
): Array<{ key: string; label: string; value: string }> {
  const lines: Array<{ key: string; label: string; value: string }> = [];
  const groups: Array<[ProficiencyTraitKind, Array<{ id: string; name: string; categoryId?: string }>, Array<{ id: string; name: string }>]> = [
    ['skills', vocab.skills, []],
    ['tools', vocab.tools, vocab.toolCategories || []],
    ['languages', vocab.languages, vocab.languageCategories || []],
  ];
  for (const [kind, items, cats] of groups) {
    if (!selectionHasContent(prof[kind])) continue;
    const value = buildGroupedProficiencyDisplayName(prof[kind], items, cats) || fallbackSelectionText(prof[kind], kind);
    if (value) lines.push({ key: kind, label: TRAIT_LABELS[kind], value });
  }
  return lines;
}

/** Last-resort phrasing when the vocab isn't loaded (ids can't resolve to names). */
function fallbackSelectionText(s: ProficiencySelection, kind: ProficiencyTraitKind): string {
  const n = Math.max(1, normalizeChoiceCount(s.choiceCount) || 1);
  const noun = kind === 'languages' ? 'language' : kind === 'tools' ? 'tool' : 'skill';
  if (s.choiceCount > 0 && !s.optionIds.length) return `${n} ${noun}${n === 1 ? '' : 's'} of your choice`;
  return '';
}

/**
 * Resolve a background's proficiency lines + description body for display.
 * Prefers the STRUCTURED `proficiencies` field; falls back to parsing the
 * description's `[ul]` block for rows imported before the structured column.
 */
export function resolveBackgroundDisplay(
  source: { description?: string | null; proficiencies?: any },
  vocab: ProficiencyVocab,
): { lines: Array<{ key: string; label: string; value: string }>; body: string } {
  const prof = normalizeProficiencies(source?.proficiencies);
  if (hasAnyProficiencies(prof)) {
    return { lines: proficiencyDisplayLines(prof, vocab), body: String(source?.description ?? '') };
  }
  const parsed = parseBackgroundDetails(String(source?.description ?? ''));
  return { lines: parsed.entries, body: parsed.body };
}
