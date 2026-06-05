// Spell stat-block text interpreter — the first concrete `parseText` for the
// import system.
//
// Takes pasted 5e spell text (an SRD/PDF/homebrew stat block) and produces
// best-effort field values plus a per-field CONFIDENCE, so the Mark & Build
// window can pre-fill the form and flag only what a human needs to check.
//
// No two stat blocks are alike, so this is built MODULARLY: one small, pure
// classifier per concern (level/school, casting time, range, components,
// duration), a name normalizer, and a description re-flow. `parseSpellText`
// just wires them together. To teach the parser a new dialect, adjust the one
// module that owns that line — nothing else needs to move.
//
// Deterministic and PURE: no I/O, no LLM. It deliberately does NOT parse
// activities/automation (damage rolls, saves, scaling math) — that stays manual
// in the spell editor. Anything it recognizes but has no field for (a class
// list, a reaction trigger, an area template) is returned as a `leftover`.

import { SCHOOL_LABELS } from '../spellImport';
import type { ParseResult, ParsedField } from './types';

// full school name (lowercased) → abbreviation, e.g. "evocation" → "evo".
const SCHOOL_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(SCHOOL_LABELS).map(([abbr, label]) => [String(label).toLowerCase(), abbr]),
);

const high = (value: unknown, sourceText?: string): ParsedField => ({ value, confidence: 'high', sourceText });
const low = (value: unknown, note: string, sourceText?: string): ParsedField => ({ value, confidence: 'low', note, sourceText });
const none = (value: unknown, note: string): ParsedField => ({ value, confidence: 'none', note });

// ───────────────────────── name normalizer ──────────────────────────────────
/** Capitalize the first letter of every word — "Capitals At The Start" (no
 * small-word exceptions). Applied to every spell name so casing is consistent
 * whether the source was lower, Title, or ALL CAPS. Exported so re-assigning a
 * selection to Name in the mark-up panel uses the same rule. */
export function normalizeSpellName(raw: string): string {
  return raw
    .replace(/\[[^\]\n]+\]/g, '') // strip inline BBCode tags (HTML→BBCode bolds the name)
    .trim()
    .replace(/^[^A-Za-z0-9]+/, '') // strip leading PDF junk (a stray ".", bullet)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ─────────────────────── description re-flow ─────────────────────────────────
const ENDS_PARAGRAPH = /[.!?]["'”’)\]]*$/; // sentence-final punctuation at line end
/**
 * Rebuild paragraphs from PDF-wrapped text. Lines are joined into one paragraph;
 * a line that ENDS in sentence punctuation closes the paragraph (the rule that
 * undoes column-wrapping), a blank line forces a break, and a line ending in "-"
 * joins the next without a space so a split compound ("10-" + "foot") rejoins as
 * "10-foot". Already-clean prose passes through unchanged. Exported so other
 * text parsers (feats/items) can reuse it.
 */
export function reflowDescription(raw: string): string {
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  const paragraphs: string[] = [];
  let cur = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      if (cur) { paragraphs.push(cur); cur = ''; }
      continue;
    }
    if (cur === '') cur = line;
    else if (cur.endsWith('-')) cur += line; // rejoin split compound, keep hyphen
    else cur += ' ' + line;
    if (ENDS_PARAGRAPH.test(line)) { paragraphs.push(cur); cur = ''; }
  }
  if (cur) paragraphs.push(cur);
  return paragraphs.join('\n\n');
}

// ──────────────────────── per-line classifiers ──────────────────────────────
// Each is pure: raw label text → coded value(s) + a `matched` flag the caller
// turns into confidence. Keeping them separate is what makes the parser modular.
// All exported so the mark-up panel can re-run the right one when a human
// re-assigns a selected span to a field.

export function classifyCastingTime(raw: string): { type: string; value: string; matched: boolean } {
  const lower = raw.toLowerCase();
  const value = /(\d+)/.exec(lower)?.[1] ?? '1';
  let type = '';
  if (/bonus action/.test(lower)) type = 'bonus';
  else if (/reaction/.test(lower)) type = 'reaction';
  else if (/\baction\b/.test(lower)) type = 'action';
  else if (/minute/.test(lower)) type = 'minute';
  else if (/hour/.test(lower)) type = 'hour';
  return { type: type || 'special', value, matched: !!type };
}

export function classifyRange(raw: string): { units: string; value: string; matched: boolean; area?: string } {
  const lower = raw.toLowerCase();
  const ft = /(\d+)\s*(?:feet|foot|ft)\b/.exec(lower);
  const mi = /(\d+)\s*(?:miles?|mi)\b/.exec(lower);
  const area = /\(([^)]*\b(?:radius|cone|cube|line|sphere|cylinder)[^)]*)\)/i.exec(raw)?.[1]?.trim();
  if (/^self\b/.test(lower)) return { units: 'self', value: '0', matched: true, area };
  if (/^touch\b/.test(lower)) return { units: 'touch', value: '0', matched: true, area };
  if (ft) return { units: 'ft', value: ft[1], matched: true, area };
  if (mi) return { units: 'mi', value: mi[1], matched: true, area };
  if (/sight|unlimited/.test(lower)) return { units: 'any', value: '0', matched: true, area };
  if (/special/.test(lower)) return { units: 'spec', value: '0', matched: true, area };
  return { units: 'self', value: '0', matched: false, area };
}

export function classifyComponents(raw: string): { v: boolean; s: boolean; m: boolean; materialText: string; materialMissing: boolean } {
  // Read flags from the part BEFORE any "(…)" so material text never produces a
  // stray V/S/M (e.g. "(a Silver mirror)" must not set S).
  const flags = (raw.split('(')[0] || '').toUpperCase();
  const v = /\bV\b/.test(flags);
  const s = /\bS\b/.test(flags);
  const m = /\bM\b/.test(flags);
  const mat = /\(([^)]*)\)/.exec(raw)?.[1]?.trim() ?? '';
  return { v, s, m, materialText: mat, materialMissing: m && !mat };
}

export function classifyDuration(raw: string): { units: string; value: string; concentration: boolean; matched: boolean } {
  const lower = raw.toLowerCase();
  const concentration = /concentration/.test(lower);
  // Strip a "Concentration, up to" / "up to" lead-in before classifying.
  const rest = lower.replace(/^\s*(concentration\s*,?\s*)?(up to\s+)?/, '').trim();
  const value = /(\d+)/.exec(rest)?.[1] ?? '0';
  if (/instantaneous/.test(rest)) return { units: 'inst', value: '0', concentration, matched: true };
  if (/round/.test(rest)) return { units: 'round', value, concentration, matched: true };
  if (/minute/.test(rest)) return { units: 'minute', value, concentration, matched: true };
  if (/hour/.test(rest)) return { units: 'hour', value, concentration, matched: true };
  if (/day/.test(rest)) return { units: 'day', value, concentration, matched: true };
  if (/until dispelled|permanent/.test(rest)) return { units: 'perm', value: '0', concentration, matched: true };
  if (/special/.test(rest)) return { units: 'spec', value: '0', concentration, matched: true };
  return { units: 'inst', value: '0', concentration, matched: false };
}

// Level/school line, tolerant of trailing parentheticals: "(ritual)" and/or a
// class-availability list — "8th-level transmutation (Druid, Sorcerer, …)". The
// `$` anchor (after the optional parens) keeps it from matching a description
// sentence that merely starts "2nd-level …".
// `d` flag → match `.indices`, so we can hand back SEPARATE spans for the level
// digits and the school word (they highlight independently in the mark-up panel).
// The named `cantrip` group lets us highlight that word as the level for cantrips
// (which have no digit).
// The leading/trailing `(?:\[[^\]\n]+\][ \t]*)*` are NON-capturing, so they
// tolerate inline BBCode tags ("[b]3rd-level evocation[/b]") without shifting the
// numbered/named capture groups the spans rely on.
const LEVEL_SCHOOL_RE = /^[ \t]*(?:\[[^\]\n]+\][ \t]*)*(?:(\d+)(?:st|nd|rd|th)[-\s]*level[ \t]+([A-Za-z]+)|([A-Za-z]+)[ \t]+(?<cantrip>cantrip))[ \t]*(?<tail>(?:\([^)]*\)[ \t]*)*)(?:\[[^\]\n]+\][ \t]*)*$/dim;

type OffsetSpan = { start: number; end: number };

/** Parse a level/school line on its own (exported for re-assignment). Returns
 * coded level + school abbreviation, the ritual flag, any class list, the whole
 * matched span, and SEPARATE spans for the level digits and the school word.
 * `matched` is false when the text holds no level/school line. */
export function parseLevelSchool(text: string): {
  matched: boolean;
  level: string;
  schoolAbbr?: string;
  schoolWord?: string;
  ritual: boolean;
  classList?: string;
  span?: OffsetSpan;
  levelSpan?: OffsetSpan;
  schoolSpan?: OffsetSpan;
} {
  const m = LEVEL_SCHOOL_RE.exec(text);
  if (!m) return { matched: false, level: '0', ritual: false };
  const indices: any = (m as any).indices; // RegExp match `.indices` (the `d` flag); incl. `.groups`
  const toSpan = (g?: [number, number]): OffsetSpan | undefined => (g ? { start: g[0], end: g[1] } : undefined);
  const schoolGroup = m[2] != null ? 2 : 3; // "Nth-level <school>" vs "<school> cantrip"
  const schoolWord = m[2] ?? m[3];
  const parens = [...((m.groups?.tail ?? '')).matchAll(/\(([^)]*)\)/g)].map((x) => x[1].trim()).filter(Boolean);
  return {
    matched: true,
    level: m[1] ? String(Number(m[1])) : '0',
    schoolAbbr: SCHOOL_BY_NAME[schoolWord.toLowerCase()],
    schoolWord,
    ritual: parens.some((p) => /^ritual$/i.test(p)),
    classList: parens.find((p) => !/^ritual$/i.test(p)),
    span: { start: m.index, end: m.index + m[0].length },
    // Level highlights the digit(s) for leveled spells, or the word "cantrip" for cantrips.
    levelSpan: m[1] ? toSpan(indices?.[1]) : toSpan(indices?.groups?.cantrip),
    schoolSpan: toSpan(indices?.[schoolGroup]),
  };
}

/** Extract just a spell level from a free selection (re-assigning Level). */
export function classifyLevel(raw: string): string | null {
  const t = raw.toLowerCase();
  if (/\bcantrip\b/.test(t)) return '0';
  const m = /(\d+)(?:st|nd|rd|th)?[-\s]*level/.exec(t)
    || /\blevel\b\s*:?\s*(\d+)/.exec(t)
    || /(\d+)(?:st|nd|rd|th)\b/.exec(t)
    || /^\s*(\d)\s*$/.exec(t);
  if (m) { const n = Number(m[1]); if (n >= 0 && n <= 9) return String(n); }
  return null;
}

/** Extract just a school abbreviation from a free selection (re-assigning School). */
export function classifySchool(raw: string): string | null {
  const t = raw.toLowerCase();
  for (const name of Object.keys(SCHOOL_BY_NAME)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) return SCHOOL_BY_NAME[name];
  }
  const m = /\b(abj|con|div|enc|evo|ill|nec|trs)\b/.exec(t);
  return m ? m[1] : null;
}

// Match "Label: rest-of-line" anywhere in the block (case-insensitive). Returns
// the value plus the full matched line's span, so the caller can highlight it.
// Tolerates inline BBCode tags around the label / colon (HTML→BBCode emits
// "[b]Casting Time:[/b] 1 action") and strips any tags from the captured value.
function grabLabel(text: string, label: string): { value: string; start: number; end: number } | null {
  const lbl = label.replace(/ /g, '[ \\t]+');
  const re = new RegExp(`^[ \\t]*(?:\\[[^\\]\\n]+\\][ \\t]*)*${lbl}(?:[ \\t]*\\[[^\\]\\n]+\\])*[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im');
  const m = re.exec(text);
  if (!m) return null;
  const value = m[1].replace(/\[[^\]\n]+\]/g, '').trim();
  return { value, start: m.index, end: m.index + m[0].length };
}

// Lines that begin a labeled stat-line or a level/school line — i.e. NOT a name.
// Leading `(?:\[[^\]\n]+\]\s*)*` tolerates inline BBCode tags (HTML→BBCode bolds
// these), e.g. "[b]Casting Time:[/b] …".
const STAT_LABEL_RE = /^(?:\[[^\]\n]+\]\s*)*(casting time|range|components|duration|at higher levels)\b/i;
const LEVEL_SCHOOL_LINE_RE = /^(?:\[[^\]\n]+\]\s*)*(?:\d+(?:st|nd|rd|th)[-\s]*level\s+[A-Za-z]+|[A-Za-z]+\s+cantrip)\b/i;

/**
 * Split a multi-spell paste into per-spell blocks. Returns the offset of each
 * spell's NAME line. The boundary signal is robust and rarely false-positives:
 * a non-label line immediately followed (next non-empty line) by a level/school
 * line. `[]` / one offset ⇒ a single spell. Exported for batch import; the
 * window lets the user add/remove these boundaries by hand when it misfires.
 */
export function splitSpellBlocks(input: string): number[] {
  const text = String(input ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const starts: number[] = [];
  let off = 0;
  for (const ln of lines) { starts.push(off); off += ln.length + 1; }

  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || STAT_LABEL_RE.test(line) || LEVEL_SCHOOL_LINE_RE.test(line)) continue;
    // A name line must be followed (next non-empty line) by a level/school line.
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length && LEVEL_SCHOOL_LINE_RE.test(lines[j].trim())) boundaries.push(starts[i]);
  }
  return boundaries;
}

// Attach a source span to a just-built field (so the mark-up panel can
// highlight where the value came from). No-op on the rare undefined.
function at(pf: ParsedField, start: number, end: number): ParsedField {
  pf.span = { start, end };
  return pf;
}

// ───────────────────────────── assembler ────────────────────────────────────
export function parseSpellText(input: string): ParseResult {
  const text = String(input ?? '').replace(/\r\n?/g, '\n');
  const fields: Record<string, ParsedField> = {};
  const leftovers: string[] = [];
  let ritualFound = false;

  // Furthest offset consumed by a structured (non-description) element; the
  // description is everything after it.
  let structuredEnd = 0;
  const consume = (end: number) => { if (end > structuredEnd) structuredEnd = end; };

  const lines = text.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');

  // ── Level + School (+ ritual, + class list) ───────────────────────────────
  const ls = parseLevelSchool(text);
  if (ls.matched && ls.span) {
    consume(ls.span.end);
    // Level + School get SEPARATE spans so each highlights / re-assigns on its own.
    fields.level = ls.levelSpan ? at(high(ls.level), ls.levelSpan.start, ls.levelSpan.end) : high(ls.level);
    const schoolPf = ls.schoolAbbr ? high(ls.schoolAbbr) : none('evo', `Unrecognized school “${ls.schoolWord}” — pick one.`);
    fields.school = ls.schoolSpan ? at(schoolPf, ls.schoolSpan.start, ls.schoolSpan.end) : schoolPf;
    if (ls.ritual) ritualFound = true;
    if (ls.classList) leftovers.push(`Classes: ${ls.classList} — assign via spell lists / tags in Dauligor.`);
  } else {
    fields.level = none('0', 'No “Nth-level …” / “… cantrip” line found — set the level.');
    fields.school = none('evo', 'School not found — pick one.');
  }

  // ── Name ──────────────────────────────────────────────────────────────────
  // First non-empty line, unless that line is itself the level/school line. The
  // name survives BBCode wrapping ("[b]Acid Splash[/b]", "[h2]…[/h2]"):
  // normalizeSpellName strips the tags from the VALUE, and the span below skips
  // the leading/trailing tags so the highlight lands on the actual name text.
  if (firstIdx >= 0) {
    const lineText = lines[firstIdx];
    const candidate = lineText.trim();
    const levelLineText = ls.span ? text.slice(ls.span.start, ls.span.end).trim() : '';
    if (candidate && candidate !== levelLineText) {
      let lineStart = 0;
      for (let i = 0; i < firstIdx; i++) lineStart += lines[i].length + 1;
      consume(lineStart + lineText.length);
      const lead = (/^(\s*(?:\[[^\]\n]+\]\s*)*)/.exec(lineText)?.[1] ?? '').length;
      const trail = (/((?:\s*\[[^\]\n]+\])*\s*)$/.exec(lineText)?.[1] ?? '').length;
      const nameStart = lineStart + lead;
      const nameEnd = Math.max(nameStart, lineStart + lineText.length - trail);
      const name = normalizeSpellName(candidate);
      fields.name = at(
        ls.matched ? high(name) : low(name, 'No stat-block lines found — confirm this is the spell name.'),
        nameStart, nameEnd,
      );
    }
  }

  // ── Casting Time → activationType / activationValue (+ ritual, + trigger) ──
  const ct = grabLabel(text, 'Casting Time');
  if (ct) {
    consume(ct.end);
    const c = classifyCastingTime(ct.value);
    fields.activationType = at(c.matched ? high(c.type) : low('special', `Couldn't classify casting time “${ct.value}”.`), ct.start, ct.end);
    fields.activationValue = at(c.matched ? high(c.value) : low(c.value, 'Defaulted.'), ct.start, ct.end);
    if (/\britual\b/i.test(ct.value)) ritualFound = true;
    const trigger = /reaction[,\s]+(which you take when[^.]*\.?|when[^.]*\.?)/i.exec(ct.value);
    if (trigger) leftovers.push(`Reaction trigger: “${trigger[1].trim()}” — set the casting condition in the spell editor.`);
  } else {
    fields.activationType = none('action', 'No “Casting Time:” line found.');
    fields.activationValue = none('1', 'No “Casting Time:” line found.');
  }

  // ── Range → rangeUnits / rangeValue (+ area template → leftover) ──────────
  const rng = grabLabel(text, 'Range');
  if (rng) {
    consume(rng.end);
    const r = classifyRange(rng.value);
    fields.rangeUnits = at(r.matched ? high(r.units) : low('self', `Couldn't classify range “${rng.value}”.`), rng.start, rng.end);
    fields.rangeValue = at(r.matched ? high(r.value) : low('0', 'Defaulted.'), rng.start, rng.end);
    if (r.area) leftovers.push(`Area/target: ${r.area} — set the template in the spell editor.`);
  } else {
    fields.rangeUnits = none('self', 'No “Range:” line found.');
    fields.rangeValue = none('0', 'No “Range:” line found.');
  }

  // ── Components → V / S / M booleans + material text ───────────────────────
  const comp = grabLabel(text, 'Components');
  if (comp) {
    consume(comp.end);
    const c = classifyComponents(comp.value);
    fields.componentsVocal = at(high(c.v), comp.start, comp.end);
    fields.componentsSomatic = at(high(c.s), comp.start, comp.end);
    fields.componentsMaterial = at(high(c.m), comp.start, comp.end);
    if (c.m && c.materialText) fields.componentsMaterialText = at(high(c.materialText), comp.start, comp.end);
    else if (c.materialMissing) fields.componentsMaterialText = at(low('', 'Material (M) flagged but no “(…)” text found.'), comp.start, comp.end);
    else fields.componentsMaterialText = high(''); // no material → clear any stale text
  } else {
    fields.componentsVocal = none(true, 'No “Components:” line found.');
    fields.componentsSomatic = none(true, 'No “Components:” line found.');
    fields.componentsMaterial = none(false, 'No “Components:” line found.');
  }

  // ── Duration → durationUnits / durationValue (+ concentration) ────────────
  const dur = grabLabel(text, 'Duration');
  if (dur) {
    consume(dur.end);
    const d = classifyDuration(dur.value);
    fields.concentration = at(high(d.concentration), dur.start, dur.end); // explicit true/false — no stale carry-over
    fields.durationUnits = at(d.matched ? high(d.units) : low('inst', `Couldn't classify duration “${dur.value}”.`), dur.start, dur.end);
    fields.durationValue = at(d.matched ? high(d.value) : low('0', 'Defaulted.'), dur.start, dur.end);
  } else {
    fields.concentration = high(false); // no Duration line → default non-concentration (the duration flag covers it)
    fields.durationUnits = none('inst', 'No “Duration:” line found.');
    fields.durationValue = none('0', 'No “Duration:” line found.');
  }

  // Ritual is definitive once the structured lines are read (its markers live on
  // the level line or the casting-time line) — set it explicitly every run so a
  // re-interpret never inherits a stale `true` from a previously parsed spell.
  fields.ritual = ls.span ? at(high(ritualFound), ls.span.start, ls.span.end) : high(ritualFound);

  // ── Description = re-flowed text after the structured block ────────────────
  const tail = text.slice(structuredEnd);
  const body = reflowDescription(tail);
  if (body) {
    const descStart = structuredEnd + (tail.length - tail.replace(/^\s+/, '').length);
    fields.description = at(high(body), descStart, text.replace(/\s+$/, '').length);
  } else {
    fields.description = none('', 'No description text found after the stat block.');
  }

  return { fields, leftovers };
}
