// Deterministic class-text parser — the class analogue of `spellParse.ts`.
//
// Two jobs, both PURE:
//   1. `parseClassText`  — the identity / proficiency / equipment block →
//      the class descriptor's fields (name, hit die, saving throws, equipment,
//      description, spellcasting ability hint).
//   2. `splitClassSections` — the features section → a list of SECTIONS, each
//      ROUTED to one of: a feature row, the class spellcasting config, the
//      `asi_levels` field, the subclass choice, or a sub-header that folds into
//      the feature above it. Levels come from the opening prose, not a field.
//
// Catalog-bound proficiencies (armor/weapons/skills → row ids) can't be
// resolved here (no catalog in a pure parser); the proficiency lines are
// surfaced verbatim as leftovers so the grid (which now emits correct row ids)
// can be filled, and a catalog-aware resolver can consume them later.
//
// Nothing here is deep automation — feature mechanics stay as description text,
// exactly like spell activities.

import type { ParseResult, ParsedField } from './types';

const ABILITY_NAMES: Record<string, string> = {
  str: 'STR', strength: 'STR',
  dex: 'DEX', dexterity: 'DEX',
  con: 'CON', constitution: 'CON',
  int: 'INT', intelligence: 'INT',
  wis: 'WIS', wisdom: 'WIS',
  cha: 'CHA', charisma: 'CHA',
};

const hi = (value: unknown, span?: { start: number; end: number }): ParsedField =>
  ({ value, confidence: 'high', ...(span ? { span } : {}) });
const lo = (value: unknown, note?: string, span?: { start: number; end: number }): ParsedField =>
  ({ value, confidence: 'low', ...(note ? { note } : {}), ...(span ? { span } : {}) });

/** Title-Case every word at the start (matches the class editor's display). */
export function normalizeClassName(raw: string): string {
  return raw
    .replace(/\[[^\]\n]*\]/g, '') // strip any bbcode
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** "Hit Dice: 1d6 per …" / "Hit Die: d8" → the die size (6/8/10/12). */
export function classifyHitDie(text: string): number | null {
  const m = text.match(/hit\s*di(?:c?e|ce)\s*:?\s*\d*\s*d\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** A "Label: value" line's value (single line; tolerant of wrapping until the
 * next label / blank / section). */
function grabLabel(text: string, label: RegExp): { value: string; span?: { start: number; end: number } } | null {
  const re = new RegExp(`(${label.source})\\s*:?\\s*`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  // value runs to the next blank line OR a line that begins a new "Label:" /
  // section header (a short Capitalized line).
  const rest = text.slice(start);
  const stop = rest.search(/\n\s*\n|\n(?:Armor|Weapons|Tools|Skills|Saving\s+Throws|Equipment|Proficiencies|Hit\s+Points|Spellcasting)\b|\n[A-Z][a-z’'A-Za-z ]{1,40}\n/);
  const value = (stop === -1 ? rest : rest.slice(0, stop)).replace(/\s+/g, ' ').trim();
  return { value, span: { start, end: start + (stop === -1 ? rest.length : stop) } };
}

/** Free ability text → codes (["CON","INT"]). */
function abilityCodes(text: string): string[] {
  return Array.from(new Set(
    text.split(/[,/&]|\band\b|\bor\b/i).map((p) => ABILITY_NAMES[p.trim().toLowerCase()]).filter(Boolean),
  ));
}

// ───────────────────────────── Feature splitter ─────────────────────────────

export type ClassSectionKind = 'feature' | 'spellcasting' | 'asi' | 'subclass' | 'subheader' | 'identity' | 'meta';

/** One editable feature draft in the import workspace's Features panel. The user
 * can merge several into one, edit name/level, or re-route `kind` (a feature row
 * vs. the class spellcasting config / asi_levels / subclass choice / skip). */
export interface FeatureDraft {
  id: string;
  kind: 'feature' | 'spellcasting' | 'asi' | 'subclass' | 'skip';
  name: string;
  level: number | null;
  levels: number[];
  body: string;
  /** Source span when the draft came from a manual "Feature" mark — drives the
   * left-panel highlight; absent for auto-parsed drafts. */
  span?: { start: number; end: number };
}

export interface ClassSection {
  kind: ClassSectionKind;
  /** The header line, normalized. */
  name: string;
  /** First level cue found in the body (null if none). */
  level: number | null;
  /** All "Nth level" numbers in the body (used by asi/subclass). */
  levels: number[];
  /** The body text (everything under the header up to the next header). */
  body: string;
  /** Char offsets of the whole section (header + body) in the source. */
  start: number;
  end: number;
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'or', 'a', 'an', 'to', 'in', 'for', 'with', 'on', 'at']);

// Spellcasting sub-sections — they carry level cues ("At 1st level, you know…")
// but are NOT features; they fold into the Spellcasting block.
const SPELLCASTING_SUB = /^(cantrips|spell slots|spells known|spellcasting ability|ritual casting|spellcasting focus|preparing and casting|learning spells|bonus cantrips|expanded spell list|spellcasting modifier)\b/i;

/** Is this line a section header? Short, Title-ish, no sentence/label punctuation. */
function looksLikeHeader(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 48) return false;
  if (/[.:=•,;()]/.test(t)) return false;            // sentences / labels / bullets
  if (/[“"]/.test(t)) return false;
  if (!/^[A-Z]/.test(t)) return false;               // must start capitalized
  const words = t.split(/\s+/);
  if (words.length > 6) return false;                // headers are short
  if (/\d/.test(t) && !/^[A-Z]/.test(t)) return false;
  // Every non-small word must be capitalized (Title Case).
  return words.every((w) => SMALL_WORDS.has(w.toLowerCase()) || /^[A-Z0-9]/.test(w));
}

export function firstLevel(body: string): number | null {
  const m = body.match(/\b(?:starting at|beginning at|when you reach|also at|also beginning at|at)\s+(\d+)(?:st|nd|rd|th)\s+level/i);
  return m ? Number(m[1]) : null;
}

export function allLevels(body: string): number[] {
  // Lenient — captures every ordinal (used only for asi/subclass bodies, which
  // are level lists like "at 4th level, and again at 8th, 12th, 16th, and 19th
  // level" where only the first/last ordinal is followed by the word "level").
  return Array.from(new Set(
    (body.match(/\b(\d+)(?:st|nd|rd|th)\b/gi) || [])
      .map((s) => Number((s.match(/\d+/) || [])[0]))
      .filter((n) => n >= 1 && n <= 20),
  )).sort((a, b) => a - b);
}

/** Route a header+body to its kind. */
function classifyKind(name: string, body: string, hasLevel: boolean): ClassSectionKind {
  if (/^class features$/i.test(name)) return 'meta';
  if (/^(hit points|hit dice)$/i.test(name)) return 'identity';
  if (/^proficiencies$/i.test(name)) return 'identity';
  if (/^equipment$/i.test(name)) return 'identity';
  if (/^spellcasting$/i.test(name)) return 'spellcasting';
  if (SPELLCASTING_SUB.test(name)) return 'subheader';
  if (/^ability score improvements?$/i.test(name)) return 'asi';
  // Subclass choice: "Choose a <X>, detailed at the end… grants you features at…"
  if (/grants you (?:\w+\s+)?features at|detailed at the end of the class/i.test(body)) return 'subclass';
  return hasLevel ? 'feature' : 'subheader';
}

/**
 * Split a class write-up into routed sections. The window groups them: identity/
 * meta are ignored (handled by parseClassText), sub-headers fold into the
 * feature above, spellcasting/asi/subclass drive class fields, and the rest are
 * feature rows. Best-effort — the workspace lets the user merge/split/re-route.
 */
export function splitClassSections(text: string): ClassSection[] {
  const lines = text.split('\n');
  // char offset of the start of each line
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) { offsets.push(acc); acc += l.length + 1; }

  const headerIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeHeader(lines[i])) headerIdx.push(i);
  }
  if (headerIdx.length === 0) return [];

  const sections: ClassSection[] = [];
  for (let h = 0; h < headerIdx.length; h++) {
    const i = headerIdx[h];
    const nextHeaderLine = headerIdx[h + 1] ?? lines.length;
    const body = lines.slice(i + 1, nextHeaderLine).join('\n').trim();
    const name = normalizeClassName(lines[i]);
    const lvl = firstLevel(body);
    const kind = classifyKind(name, body, lvl != null);
    sections.push({
      kind,
      name,
      level: lvl,
      levels: kind === 'asi' || kind === 'subclass' ? allLevels(body) : (lvl != null ? [lvl] : []),
      body,
      start: offsets[i],
      end: nextHeaderLine < lines.length ? offsets[nextHeaderLine] : text.length,
    });
  }
  return sections;
}

/** The feature-ish sections, with sub-headers folded into the feature above. */
export function groupClassFeatures(sections: ClassSection[]): ClassSection[] {
  const out: ClassSection[] = [];
  for (const s of sections) {
    if (s.kind === 'identity' || s.kind === 'meta') continue;
    const prev = out[out.length - 1];
    // A sub-header folds into the feature OR spellcasting block above it.
    if (s.kind === 'subheader' && prev && (prev.kind === 'feature' || prev.kind === 'spellcasting')) {
      prev.body = `${prev.body}\n\n[b]${s.name}[/b]\n${s.body}`.trim();
      prev.end = s.end;
      continue;
    }
    // An orphan sub-header (nothing to fold into) becomes its own feature.
    out.push({ ...s, kind: s.kind === 'subheader' ? 'feature' : s.kind });
  }
  return out;
}

// ───────────────────────────── Identity assembler ───────────────────────────

export function parseClassText(text: string): ParseResult {
  const fields: Record<string, ParsedField> = {};
  const leftovers: string[] = [];

  // Name — "As a necromancer, you have the following class features."
  const nameM = text.match(/\bas an?\s+([A-Za-z][A-Za-z'’ \-]{1,30}?),?\s+you\s+(?:have|gain|can)/i);
  if (nameM) {
    const span = { start: nameM.index! + nameM[0].indexOf(nameM[1]), end: nameM.index! + nameM[0].indexOf(nameM[1]) + nameM[1].length };
    fields.name = hi(normalizeClassName(nameM[1]), span);
  }

  // Hit die
  const hd = classifyHitDie(text);
  if (hd) {
    const m = text.match(/hit\s*di(?:c?e|ce)\s*:?\s*\d*\s*d\s*\d+/i);
    fields.hitDie = hi(String(hd), m ? { start: m.index!, end: m.index! + m[0].length } : undefined);
  }

  // Saving throws
  const saves = grabLabel(text, /Saving\s+Throws?/);
  if (saves) {
    const codes = abilityCodes(saves.value);
    if (codes.length) fields.savingThrows = hi(saves.value.replace(/\s*,\s*and\s+/i, ', ').replace(/\s+and\s+/i, ', '), saves.span);
  }

  // Equipment block — from the "Equipment" header / "You start with the
  // following equipment" to the next section.
  const eqM = text.match(/\n\s*Equipment\s*\n|You start with the following equipment[^\n]*/i);
  if (eqM) {
    const start = eqM.index! + eqM[0].length;
    const rest = text.slice(start);
    // Stop at the next section header (e.g. "Spellcasting" / a feature name) —
    // there are usually no blank lines between sections to rely on.
    let stop = -1, off = 0;
    for (const ln of rest.split('\n')) {
      if (off > 0 && looksLikeHeader(ln)) { stop = off; break; }
      off += ln.length + 1;
    }
    const eq = (stop === -1 ? rest : rest.slice(0, stop)).trim();
    if (eq) fields.startingEquipment = hi(eq, { start, end: start + (stop === -1 ? rest.length : stop) });
  }

  // Spellcasting ability → a primary-ability hint (low confidence; confirm).
  const abM = text.match(/\b([A-Z][a-z]+)\s+is\s+your\s+spellcasting\s+ability/);
  if (abM && ABILITY_NAMES[abM[1].toLowerCase()]) {
    fields.primaryAbility = lo(abM[1], 'Inferred from the spellcasting ability — confirm.');
  }

  // Proficiency lines (resolved into the grid by the window) + a feature summary
  // are surfaced as review NOTES — everything here WAS placed; the note just
  // says where to double-check. (NOT "couldn't place" leftovers.)
  const notes: string[] = [];
  for (const [label, re] of [['Armor', /Armor/], ['Weapons', /Weapons/], ['Tools', /Tools/], ['Skills', /Skills?/]] as [string, RegExp][]) {
    const g = grabLabel(text, re);
    if (g && g.value && !/^none$/i.test(g.value)) notes.push(`${label}: “${g.value.replace(/\s+/g, ' ').trim()}” → filled into the proficiency grid — review.`);
  }

  // Features → the organizer panel (merge / edit / re-route there).
  const sections = groupClassFeatures(splitClassSections(text));
  if (sections.length) {
    const drafts: FeatureDraft[] = sections.map((s, i) => ({
      id: `sec-${i}`,
      kind: (s.kind === 'subheader' || s.kind === 'identity' || s.kind === 'meta' ? 'feature' : s.kind) as FeatureDraft['kind'],
      name: s.name,
      level: s.level,
      levels: s.levels,
      body: s.body,
    }));
    fields._features = hi(drafts);
    const counts = drafts.reduce((m, d) => { m[d.kind] = (m[d.kind] || 0) + 1; return m; }, {} as Record<string, number>);
    const featCount = counts.feature || 0;
    const routeLabels: Record<string, string> = { spellcasting: 'Spellcasting', asi: 'ASI', subclass: 'Subclass' };
    const routings = ['spellcasting', 'asi', 'subclass'].filter((k) => counts[k]).map((k) => routeLabels[k]);
    const summary = [`${featCount} feature${featCount === 1 ? '' : 's'}`].concat(routings.length ? [routings.join(' + ')] : []).join(' + ');
    notes.push(`Parsed ${drafts.length} section${drafts.length === 1 ? '' : 's'} (${summary}) — organize them in the Features panel below.`);
  }

  return { fields, leftovers, notes };
}

/** Parse ONE manually-marked span into a single feature draft: first non-empty
 * line = name, the rest = body, level sniffed from the prose. Backs the "Feature"
 * section mark — mark span A then span B and you get two separate features. */
export function parseFeatureSpan(text: string): { kind: 'feature'; name: string; level: number; body: string } {
  const raw = String(text || '');
  const lines = raw.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim());
  const name = firstIdx >= 0 ? lines[firstIdx].trim() : '';
  const rest = firstIdx >= 0 ? lines.slice(firstIdx + 1).join('\n').trim() : '';
  return { kind: 'feature', name, level: firstLevel(raw) ?? 1, body: rest || name };
}

// ───────────────────────── Proficiency resolver ─────────────────────────────
// Catalog-aware (but otherwise pure): resolve the parsed proficiency LINES into
// the grid's {choiceCount, fixedIds, optionIds, categoryIds} shape. Skills →
// row IDs (how the importer + views key them); armor/weapons/tools/languages →
// categoryIds (category names like "Simple weapons") + fixedIds (item names).
// The window calls this after Interpret — it holds the loaded catalogs.

export interface ResolveCatalogs {
  allSkills: any[];
  allArmor: any[]; allArmorCategories: any[];
  allWeapons: any[]; allWeaponCategories: any[];
  allTools: any[]; allToolCategories: any[];
  allLanguages: any[]; allLanguageCategories: any[];
}

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function extractProficiencyLines(text: string) {
  const g = (re: RegExp) => grabLabel(text, re)?.value ?? '';
  return { armor: g(/Armor/), weapons: g(/Weapons/), tools: g(/Tools/), languages: g(/Languages/), skills: g(/Skills?/) };
}

// "Choose two from A, B" / "Choose any two skills from A, B" → { choose: 2, list }
function parseChoose(text: string): { choose: number | null; list: string } {
  const m = text.match(/choose\s+(?:any\s+)?([a-z]+)\b\s*(?:skills?\s+)?(?:from\s+|of\s+)?(.*)/i);
  if (m && WORD_NUM[m[1].toLowerCase()] != null) return { choose: WORD_NUM[m[1].toLowerCase()], list: m[2] };
  return { choose: null, list: text };
}

function splitTerms(list: string): string[] {
  return list
    .replace(/\b(and|or)\b/gi, ',')
    .split(',')
    .map((t) => t.replace(/[.;:]/g, '').replace(/^(the|a|an|any|your)\s+/i, '').trim())
    .filter(Boolean);
}

// Loose name key: lowercase, drop apostrophes + trailing plural 's' (on both the
// term and the catalog name) so "Simple weapons" matches the "Simple Weapon"
// category and "Athletics" matches the "Athletics" skill.
function normName(s: string): string {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/s\b/g, '').replace(/\s+/g, ' ').trim();
}

function matchByName(term: string, items: any[]): any | null {
  const t = normName(term);
  if (t.length < 2) return null;
  return items.find((i) => normName(i?.name) === t)
    || items.find((i) => { const n = normName(i?.name); return n.length > 2 && (n.startsWith(t) || t.startsWith(n)); })
    || null;
}

const uniq = (a: string[]): string[] => Array.from(new Set(a));

function resolveFlat(text: string, items: any[]) {
  if (!text || /^none\b/i.test(text.trim())) return { choiceCount: 0, optionIds: [] as string[], fixedIds: [] as string[] };
  const { choose, list } = parseChoose(text);
  const ids = uniq(splitTerms(list).map((t) => matchByName(t, items)).filter(Boolean).map((i: any) => String(i.id)));
  return choose ? { choiceCount: choose, optionIds: ids, fixedIds: [] } : { choiceCount: 0, optionIds: [], fixedIds: ids };
}

function resolveGrouped(text: string, items: any[], categories: any[]) {
  if (!text || /^none\b/i.test(text.trim())) return { choiceCount: 0, optionIds: [] as string[], fixedIds: [] as string[], categoryIds: [] as string[] };
  const { choose, list } = parseChoose(text);
  const fixed: string[] = [], cats: string[] = [], opts: string[] = [];
  // Grant a whole category the way the editor's category checkbox does: drop
  // EVERY member item id into the target list. The grid keys a category's
  // checked state off whether its item ids are present (NOT off categoryIds),
  // so emitting categoryIds alone left the grant invisible — that was the
  // "weapons weren't marked" bug. We still record the category id for the
  // class export's whole-category note.
  const grantCategory = (cat: any) => {
    const memberIds = items.filter((i) => String(i?.categoryId) === String(cat?.id)).map((i) => String(i.id));
    if (choose) opts.push(...memberIds);
    else { fixed.push(...memberIds); cats.push(String(cat?.id)); }
  };
  for (const term of splitTerms(list)) {
    // "All armor" / "all weapons" → every category of this kind.
    if (/^all\b/i.test(term)) { categories.forEach(grantCategory); continue; }
    const cat = matchByName(term, categories);
    if (cat) { grantCategory(cat); continue; }
    const item = matchByName(term, items);
    if (item) (choose ? opts : fixed).push(String(item.id));
  }
  return choose
    ? { choiceCount: choose, optionIds: uniq(opts), fixedIds: [], categoryIds: [] }
    : { choiceCount: 0, optionIds: [], fixedIds: uniq(fixed), categoryIds: uniq(cats) };
}

/** Resolve the pasted proficiency lines into the class proficiency grid object.
 * Saving throws are filled from the dedicated text field, not here. */
export function resolveClassProficiencies(text: string, cat: ResolveCatalogs) {
  const p = extractProficiencyLines(text);
  return {
    armor: resolveGrouped(p.armor, cat.allArmor || [], cat.allArmorCategories || []),
    weapons: resolveGrouped(p.weapons, cat.allWeapons || [], cat.allWeaponCategories || []),
    tools: resolveGrouped(p.tools, cat.allTools || [], cat.allToolCategories || []),
    skills: resolveFlat(p.skills, cat.allSkills || []),
    languages: resolveGrouped(p.languages, cat.allLanguages || [], cat.allLanguageCategories || []),
    savingThrows: { choiceCount: 0, optionIds: [] as string[], fixedIds: [] as string[] },
    armorDisplayName: '', weaponsDisplayName: '', toolsDisplayName: '', skillsDisplayName: '',
  };
}
