// Mark & Build — the manual-upload / import window.
//
// Paste one or many entities. The interpreter fills structured fields; every
// value is highlighted back onto the source text in the gold accent and can be
// re-mapped by selecting text (the EntityWorkspace). When a paste holds several
// entities it switches to BATCH mode: a division editor on the left (auto-split,
// with add/remove controls for misfires) and a candidate list on the right;
// Review opens any candidate in the same workspace, then Create N bulk-commits.
//
// Styling follows docs/ui/style-guide.md — theme tokens only (gold = accent /
// highlight, ink = text, blood = warnings) and the documented component classes.
// No raw palette colours.
//
// Create writes through the import registry's `commit()` → the editor's real
// write call (spell → `upsertSpell`), so entities made here are byte-identical
// to ones saved from the hand editor. Activities/automation are NOT parsed.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { AlertTriangle, ChevronUp, FileText, Library, ListChecks, Pencil, ScanText, Scissors, Sparkles, Wand2 } from 'lucide-react';
import { fetchCollection } from '../../lib/d1';
import { denormalizeCompendiumData } from '../../lib/compendium';
import { slugify } from '../../lib/utils';
import { htmlToBbcode } from '../../lib/bbcode';
import { cleanFoundryHtml } from '../../lib/foundryHtmlCleanup';
import { reportClientError, OperationType } from '../../lib/firebase';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import ClassPreviewPane from '../../components/compendium/ClassPreviewPane';
import ProficienciesEditor, { type ProficiencyType } from '../../components/compendium/ProficienciesEditor';
import {
  listImportDescriptors,
  getImportDescriptor,
  resolveEntity,
  commitEntity,
  canParseText,
  parseEntityText,
  getAssignTargets,
  assignFieldText,
  assignAppendItem,
  assignAppendManyItems,
  assignResolveFields,
  splitEntityBlocks,
  resolveClassProficiencies,
  type ImportDescriptor,
  type ImportFieldDef,
  type ImportAssignTarget,
  type FeatureDraft,
} from '../../lib/import';

type SourceRow = { id: string; name?: string; abbreviation?: string };
type FieldFlag = { confidence: 'low' | 'none'; note?: string };
type Span = { start: number; end: number };
type ActiveSelection = { start: number; end: number; text: string; top: number; selTop: number; left: number };
/** The editable state of one entity in the workspace. */
type EntityState = { values: Record<string, any>; spans: Record<string, Span[]>; provenance: Record<string, FieldFlag>; leftovers: string[]; notes: string[] };

/** Proficiency catalogs (skills/armor/weapons/tools/languages + their category
 * tables + grouped-by-category maps) loaded once and shared with any
 * `proficiencies` field's embedded ProficienciesEditor via context. */
type ProfCatalogs = {
  allSkills: any[];
  allArmor: any[]; allArmorCategories: any[]; groupedArmor: Record<string, any[]>;
  allWeapons: any[]; allWeaponCategories: any[]; groupedWeapons: Record<string, any[]>;
  allTools: any[]; allToolCategories: any[]; groupedTools: Record<string, any[]>;
  allLanguages: any[]; allLanguageCategories: any[]; groupedLanguages: Record<string, any[]>;
};
const ImportCatalogsContext = createContext<ProfCatalogs | null>(null);

// Group catalog items by their category NAME — the shape ClassEditor builds and
// the ProficienciesEditor consumes. Weapons append the melee/ranged type to the
// category name the same way the editor does.
function groupByCategory(items: any[], cats: any[], weaponType = false): Record<string, any[]> {
  return (items || []).reduce((acc: Record<string, any[]>, item: any) => {
    let cat = cats.find((c) => c.id === item.categoryId)?.name || item.category || 'Other';
    if (weaponType && item.weaponType) cat = String(cat).replace(/ Weapons?/i, '') + ` ${item.weaponType}`;
    (acc[cat] = acc[cat] || []).push(item);
    return acc;
  }, {});
}

const PLACEHOLDER =
  'Fireball\n3rd-level evocation\nCasting Time: 1 action\nRange: 150 feet\n' +
  'Components: V, S, M (a tiny ball of bat guano and sulfur)\nDuration: Instantaneous\n\n' +
  'A bright streak flashes from your pointing finger…\n\n' +
  'Paste several stat blocks at once for batch import.';

// Seed a fresh entity (all fields at their descriptor default).
function emptyState(descriptor?: ImportDescriptor): EntityState {
  const values: Record<string, any> = {};
  for (const f of descriptor?.fields ?? []) {
    if (f.kind === 'source') continue;
    values[f.key] = f.default ?? (f.kind === 'boolean' ? false : '');
  }
  return { values, spans: {}, provenance: {}, leftovers: [], notes: [] };
}

// ── Format templates ────────────────────────────────────────────────────────
// A format template remembers, per source, which LINE each section sits on
// (relative to the block's first content line) so a non-standard layout parses
// right without re-marking every spell. Captured from one marked-up example and
// applied over the heuristic parse (user layout wins). Keyed by type + source.
type FormatTemplate = Record<string, number>; // assign-target key → relative line index
const FORMAT_LS_PREFIX = 'dauligor:importFormat:';
const formatKey = (type: string, sourceId: string) => `${FORMAT_LS_PREFIX}${type}:${sourceId || 'default'}`;
function loadFormat(type: string, sourceId: string): FormatTemplate | null {
  try { const raw = localStorage.getItem(formatKey(type, sourceId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveFormatLS(type: string, sourceId: string, tpl: FormatTemplate) {
  try { localStorage.setItem(formatKey(type, sourceId), JSON.stringify(tpl)); } catch { /* quota / private mode */ }
}
function clearFormatLS(type: string, sourceId: string) {
  try { localStorage.removeItem(formatKey(type, sourceId)); } catch { /* ignore */ }
}

function lineStartsOf(text: string): number[] { const s: number[] = []; let o = 0; for (const l of text.split('\n')) { s.push(o); o += l.length + 1; } return s; }
function lineOfOffset(starts: number[], offset: number): number { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= offset) i++; return i; }
function firstContentLineIndex(lines: string[]): number { const i = lines.findIndex((l) => l.trim() !== ''); return i < 0 ? 0 : i; }

// ── source-text interval partition (mark-up panel) ─────────────────────────
// Each field owns a set of non-overlapping [start,end) spans. Assigning a span
// to one field subtracts it from the others, so text belongs to exactly ONE
// field and re-assignments decouple cleanly instead of silently overlapping.
function subtractInterval(a: Span, b: Span): Span[] {
  if (b.end <= a.start || b.start >= a.end) return [a];            // disjoint
  const out: Span[] = [];
  if (b.start > a.start) out.push({ start: a.start, end: b.start });
  if (b.end < a.end) out.push({ start: b.end, end: a.end });
  return out;                                                       // [] when b covers a
}
function mergeSpans(list: Span[]): Span[] {
  const sorted = [...list].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}
function sameSpanList(x: Span[], y: Span[]): boolean {
  return x.length === y.length && x.every((s, i) => s.start === y[i].start && s.end === y[i].end);
}

// Capture target → relative line index from the current spans (skips description,
// which is the multi-line tail the heuristic always owns).
function buildFormatTemplate(type: string, text: string, spans: Record<string, Span[]>): FormatTemplate {
  const lines = text.split('\n');
  const starts = lineStartsOf(text);
  const base = firstContentLineIndex(lines);
  const tpl: FormatTemplate = {};
  for (const t of getAssignTargets(type)) {
    if (t.key === 'description') continue;
    const fk = t.fieldKeys.find((k) => spans[k]?.length);
    if (!fk) continue;
    const rel = lineOfOffset(starts, spans[fk][0].start) - base;
    if (rel >= 0) tpl[t.key] = rel;
  }
  return tpl;
}

// Override a parsed state from a saved template: read each target's templated
// line, re-run the target's classifier, and treat the result as user-confirmed.
function applyFormatTemplate(state: EntityState, type: string, text: string, tpl: FormatTemplate) {
  const lines = text.split('\n');
  const starts = lineStartsOf(text);
  const base = firstContentLineIndex(lines);
  for (const [targetKey, rel] of Object.entries(tpl)) {
    const lineIdx = base + rel;
    const line = lines[lineIdx];
    if (line == null || !line.trim()) continue;
    const result = assignFieldText(type, targetKey, line.trim());
    for (const [fk, v] of Object.entries(result)) {
      state.values[fk] = v;
      delete state.provenance[fk]; // user-defined layout → confident, no flag
      state.spans[fk] = [{ start: starts[lineIdx], end: starts[lineIdx] + line.length }];
    }
  }
}

// Interpret a block of text into an entity state (defaults + parsed overrides +
// optional format template + auto-slugged identifier). Shared by single mode and
// every batch candidate.
function parseToState(type: string, text: string, template?: FormatTemplate | null): EntityState {
  const descriptor = getImportDescriptor(type);
  const state = emptyState(descriptor);
  const result = parseEntityText(type, text);
  if (result) {
    for (const [key, pf] of Object.entries(result.fields)) {
      state.values[key] = pf.value;
      if (pf.confidence !== 'high') state.provenance[key] = { confidence: pf.confidence, note: pf.note };
      if (pf.span) state.spans[key] = [pf.span];
    }
    state.leftovers = result.leftovers;
    state.notes = result.notes ?? [];
  }
  if (template) applyFormatTemplate(state, type, text, template);
  if (descriptor && 'identifier' in state.values) {
    state.values.identifier = slugify(String(state.values[descriptor.nameField] ?? ''));
  }
  return state;
}

function firstContentOffset(text: string): number {
  const m = /\S/.exec(text);
  return m ? m.index : 0;
}

// HTML paste (a spell from a web page, a Foundry feature description) → the
// site's stored BBCode, via the SAME canonical path every importer uses
// (cleanFoundryHtml strips enricher tokens, htmlToBbcode maps tags → BBCode).
const looksLikeHtml = (s: string) => /<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(s);

function renameEl(el: Element, tag: string) {
  const n = el.ownerDocument!.createElement(tag);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
}

// Normalise a parsed clipboard DOM the way TipTap's schema does on paste, so the
// downstream htmlToBbcode (which only maps clean, attribute-free semantic tags)
// produces tidy BBCode regardless of the source (web page, Google Docs, Word):
//   • promote inline-style formatting (font-style:italic, font-weight:bold,
//     underline) to <em>/<strong>/<u> — TipTap's marks do this via parseHTML;
//   • drop Office namespace tags (<o:p> …);
//   • rename <b>/<i> → <strong>/<em> (htmlToBbcode's <b>/<strong> matchers are
//     attribute-free, and its <i> handler is buggy);
//   • strip noise attributes (style/class/mso-*), keeping href so links survive;
//   • unwrap <font> wrappers.
function normalizeClipboardDom(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const s = el.getAttribute('style') || '';
    const wrap = (tag: string) => { const w = el.ownerDocument!.createElement(tag); while (el.firstChild) w.appendChild(el.firstChild); el.appendChild(w); };
    if (/font-style:\s*italic/i.test(s)) wrap('em');
    if (/font-weight:\s*(?:bold|[6-9]00)/i.test(s)) wrap('strong');
    if (/text-decoration:[^;]*underline/i.test(s)) wrap('u');
  });
  body.querySelectorAll('*').forEach((el) => { if (el.tagName.includes(':')) el.remove(); });
  body.querySelectorAll('b').forEach((el) => renameEl(el, 'strong'));
  body.querySelectorAll('i').forEach((el) => renameEl(el, 'em'));
  body.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) if (a.name !== 'href') el.removeAttribute(a.name);
  });
  body.querySelectorAll('font').forEach((el) => el.replaceWith(...Array.from(el.childNodes)));
}

/**
 * HTML → the site's stored BBCode, the way the rich editor (MarkdownEditor →
 * TipTap) does it: parse with the REAL browser DOM (DOMParser) so any document
 * structure — full `<html><head><style>…` clipboard payloads, comments, messy
 * Word/Docs markup — is handled correctly, normalise it to clean semantic HTML,
 * then run the canonical `htmlToBbcode(cleanFoundryHtml)`.
 */
function htmlToSiteBbcode(html: string): string {
  let body = html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style, script, meta, link, title').forEach((el) => el.remove());
    const it = doc.createNodeIterator(doc.body, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    for (let n = it.nextNode(); n; n = it.nextNode()) comments.push(n);
    comments.forEach((n) => n.parentNode?.removeChild(n));
    normalizeClipboardDom(doc.body);
    body = doc.body.innerHTML;
  } catch { /* non-browser / parse failure → fall back to the raw string */ }
  return htmlToBbcode(cleanFoundryHtml(body));
}

function normalizeInput(text: string): string {
  const t = text.replace(/\r\n?/g, '\n');
  return looksLikeHtml(t) ? htmlToSiteBbcode(t) : t;
}

// Adapt the editor-shape spell payload into the raw row SpellDetailPanel renders
// (its `spellData` path). buildPayload's `foundry_data` carries activation/range/
// duration but not the `properties[]` / `materials` the panel reads for the
// Components line — derive those from `components` + the ritual/concentration
// flags so the preview matches a saved spell exactly.
function buildSpellPreviewRow(payload: Record<string, any>): Record<string, any> {
  const c = payload.components || {};
  const properties: string[] = [];
  if (c.vocal) properties.push('vocal');
  if (c.somatic) properties.push('somatic');
  if (c.material) properties.push('material');
  if (payload.concentration) properties.push('concentration');
  if (payload.ritual) properties.push('ritual');
  return {
    name: payload.name,
    level: payload.level,
    school: payload.school,
    source_id: payload.sourceId || '',
    image_url: payload.imageUrl || '',
    description: payload.description || '',
    page: payload.page || '',
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    required_tags: [],
    prerequisite_text: payload.prerequisiteText || '',
    foundry_data: { ...(payload.foundry_data || {}), properties, materials: { value: c.materialText || '' } },
  };
}

function groupFields(fields: ImportFieldDef[]): { name: string; fields: ImportFieldDef[] }[] {
  const groups: { name: string; fields: ImportFieldDef[] }[] = [];
  for (const field of fields) {
    if (field.kind === 'source') continue;
    const name = field.group ?? 'Fields';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, fields: [] }; groups.push(g); }
    g.fields.push(field);
  }
  return groups;
}

export default function ImportMarkWindow({ userProfile }: { userProfile: any }) {
  const descriptors = useMemo(() => listImportDescriptors(), []);
  const [type, setType] = useState<string>(descriptors[0]?.type ?? 'spell');
  const descriptor = getImportDescriptor(type);

  const [sourceId, setSourceId] = useState(''); // persists across creates + type changes
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [saving, setSaving] = useState(false);
  // Proficiency catalogs — loaded lazily only when a descriptor has a
  // `proficiencies` field (skipped for spell-only sessions).
  const [rawCatalogs, setRawCatalogs] = useState<{
    skills: any[]; armor: any[]; armorCats: any[]; weapons: any[]; weaponCats: any[];
    tools: any[]; toolCats: any[]; languages: any[]; languageCats: any[];
  } | null>(null);

  // Workspace
  const [rawText, setRawText] = useState('');
  const [phase, setPhase] = useState<'input' | 'single' | 'batch'>('input');
  const [single, setSingle] = useState<EntityState>(() => emptyState(descriptor));
  // Batch
  const [boundaries, setBoundaries] = useState<number[]>([]);
  const [edits, setEdits] = useState<Record<number, EntityState>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  // Per-source format template (target → line index), loaded from localStorage.
  const [formatTemplate, setFormatTemplate] = useState<FormatTemplate | null>(null);

  const hasParser = useMemo(() => canParseText(type), [type]);
  const assignTargets = useMemo(() => getAssignTargets(type), [type]);
  const hasSections = useMemo(() => assignTargets.some((t) => t.group === 'Blocks'), [assignTargets]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const sourceKey = useMemo(() => descriptor?.fields.find((f) => f.kind === 'source')?.key, [descriptor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<SourceRow>('sources', { orderBy: 'name ASC' });
        if (!cancelled) setSources(rows);
      } catch (err) { console.error('[ImportMarkWindow] failed to load sources:', err); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load the proficiency catalogs the moment any registered type needs them
  // (class does). Mirrors ClassEditor's foundation fetch + denormalize.
  const needsProficiencyCatalogs = useMemo(
    () => descriptors.some((d) => d.fields.some((f) => f.kind === 'proficiencies')),
    [descriptors],
  );
  useEffect(() => {
    if (!needsProficiencyCatalogs || rawCatalogs) return;
    let cancelled = false;
    (async () => {
      try {
        const [skills, armor, armorCats, weapons, weaponCats, tools, toolCats, languages, languageCats] = await Promise.all([
          fetchCollection('skills', { orderBy: 'name ASC' }),
          fetchCollection('armor', { orderBy: 'name ASC' }),
          fetchCollection('armorCategories', { orderBy: 'name ASC' }),
          fetchCollection('weapons', { orderBy: 'name ASC' }),
          fetchCollection('weaponCategories', { orderBy: 'name ASC' }),
          fetchCollection('tools', { orderBy: 'name ASC' }),
          fetchCollection('toolCategories', { orderBy: 'name ASC' }),
          fetchCollection('languages', { orderBy: 'name ASC' }),
          fetchCollection('languageCategories', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;
        const d = (rows: any[]) => (rows || []).map((r) => denormalizeCompendiumData(r));
        // Skills (a flat column) are keyed by the FULL row id everywhere they're
        // READ — ClassView and ClassPreviewPane both resolve `allSkills.find(s =>
        // s.id === id)`, and real classes store the row id (Barbarian) sometimes
        // alongside redundant codes (Ranger). The grid's `idOf` prefers an item's
        // `identifier` when present, which would emit unresolvable codes ("ath").
        // Drop `identifier` from the skills catalog so the grid emits row ids,
        // matching how classes actually store skills. (Grouped kinds use item.id
        // directly, so they're unaffected; saving throws aren't rendered here.)
        const dSkills = (rows: any[]) => (rows || []).map((r) => {
          const { identifier, ...rest } = denormalizeCompendiumData(r) as any;
          return rest;
        });
        setRawCatalogs({
          skills: dSkills(skills), armor: d(armor), armorCats: d(armorCats),
          weapons: d(weapons), weaponCats: d(weaponCats),
          tools: d(tools), toolCats: d(toolCats),
          languages: d(languages), languageCats: d(languageCats),
        });
      } catch (err) { console.error('[ImportMarkWindow] proficiency catalogs load failed:', err); }
    })();
    return () => { cancelled = true; };
  }, [needsProficiencyCatalogs, rawCatalogs]);

  // Derive the grouped-by-category maps the ProficienciesEditor consumes.
  const catalogsValue = useMemo<ProfCatalogs | null>(() => {
    if (!rawCatalogs) return null;
    const c = rawCatalogs;
    return {
      allSkills: c.skills,
      allArmor: c.armor, allArmorCategories: c.armorCats, groupedArmor: groupByCategory(c.armor, c.armorCats),
      allWeapons: c.weapons, allWeaponCategories: c.weaponCats, groupedWeapons: groupByCategory(c.weapons, c.weaponCats, true),
      allTools: c.tools, allToolCategories: c.toolCats, groupedTools: groupByCategory(c.tools, c.toolCats),
      allLanguages: c.languages, allLanguageCategories: c.languageCats, groupedLanguages: groupByCategory(c.languages, c.languageCats),
    };
  }, [rawCatalogs]);

  const sourceOptions = useMemo(
    () => sources.map((s) => ({ id: s.id, name: (s.abbreviation ? `${s.abbreviation} — ` : '') + (s.name || s.id) })),
    [sources],
  );

  // Reset the workspace on a type switch (source persists).
  useEffect(() => {
    setRawText(''); setPhase('input');
    setSingle(emptyState(descriptor));
    setBoundaries([]); setEdits({}); setSelected(new Set()); setReviewIndex(null);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the saved format template whenever the type or source changes.
  useEffect(() => { setFormatTemplate(loadFormat(type, sourceId)); }, [type, sourceId]);

  // ── Batch candidates (auto-parsed baseline; per-index edits override) ───────
  const blocks = useMemo(
    () => boundaries.map((b, i) => ({ start: b, end: boundaries[i + 1] ?? rawText.length })),
    [boundaries, rawText],
  );
  const candidates = useMemo(
    () => blocks.map((b) => { const text = rawText.slice(b.start, b.end); return { text, state: parseToState(type, text, formatTemplate) }; }),
    [blocks, rawText, type, formatTemplate],
  );
  const stateFor = (i: number): EntityState => edits[i] ?? candidates[i]?.state ?? emptyState(descriptor);
  const blockNames = useMemo(() => candidates.map((c, i) => String((edits[i] ?? c.state).values.name ?? '')), [candidates, edits]);

  // ── Interpret: split → single or batch ─────────────────────────────────────
  const handleInterpret = () => {
    const text = normalizeInput(rawText); // HTML → BBCode if needed
    if (!text.trim()) return;
    if (text !== rawText) setRawText(text);
    const b = hasParser ? splitEntityBlocks(type, text) : [];
    if (b.length > 1) {
      setBoundaries(b); setEdits({}); setSelected(new Set(b.map((_, i) => i))); setReviewIndex(null);
      setPhase('batch');
    } else {
      let st = parseToState(type, text, formatTemplate);
      // Class proficiency lines are catalog-bound (names → ids), so they're
      // resolved here in the window (which holds the catalogs) rather than in
      // the pure parser. Fills the grid; the user reviews/tweaks.
      if (type === 'class' && catalogsValue) {
        st = { ...st, values: { ...st.values, proficiencies: resolveClassProficiencies(text, catalogsValue) } };
      }
      setSingle(st);
      setPhase('single');
    }
  };

  // Parser-less (manual-entry) types have no Interpret step — jump straight to
  // the structured form. Any pasted reference text is still normalized
  // (HTML→BBCode) and kept beside the fields in the workspace for reference.
  const handleManualEntry = () => {
    const text = normalizeInput(rawText);
    if (text !== rawText) setRawText(text);
    setSingle(parseToState(type, text, formatTemplate));
    setPhase('single');
  };

  // A <textarea> only receives the clipboard's `text/plain` flavour, so copying
  // RENDERED formatted text (a spell off a web page) loses its <em>/<strong>
  // before we'd ever see it. Intercept the paste, grab the `text/html` flavour
  // when present, and convert it to BBCode via the site's canonical path so the
  // formatting survives. Falls through to the normal plain-text paste otherwise.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData || (e.nativeEvent as any)?.clipboardData;
    const html = cd?.getData?.('text/html') || '';
    if (!html || !looksLikeHtml(html)) return; // no rich HTML → let the plain paste run
    e.preventDefault();
    const bbcode = htmlToSiteBbcode(html);
    const el = e.currentTarget;
    const start = el.selectionStart ?? rawText.length;
    const end = el.selectionEnd ?? rawText.length;
    setRawText(rawText.slice(0, start) + bbcode + rawText.slice(end));
    toast.success('Captured HTML formatting');
  };

  // Manually enter batch from single (splitter under-detected → user divides).
  const enterBatch = () => {
    const text = normalizeInput(rawText); // HTML → BBCode if needed
    if (text !== rawText) setRawText(text);
    let b = splitEntityBlocks(type, text);
    if (b.length < 1) b = [firstContentOffset(text)];
    setBoundaries(b); setEdits({}); setSelected(new Set(b.map((_, i) => i))); setReviewIndex(null);
    setPhase('batch');
  };

  const applyBoundaries = (next: number[]) => {
    const sorted = [...new Set(next)].sort((a, b) => a - b);
    if (sorted.length <= 1) { setSingle(parseToState(type, rawText, formatTemplate)); setBoundaries(sorted); setPhase('single'); return; }
    setBoundaries(sorted); setEdits({}); setSelected(new Set(sorted.map((_, i) => i))); setReviewIndex(null);
  };
  const addDivision = (offset: number) => applyBoundaries([...boundaries, offset]);
  const removeDivision = (offset: number) => applyBoundaries(boundaries.filter((o) => o !== offset));
  const toggleSelected = (i: number) => setSelected((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  // ── Create ─────────────────────────────────────────────────────────────────
  const commitState = async (st: EntityState) => {
    const fields = sourceKey ? { ...st.values, [sourceKey]: sourceId } : st.values;
    const resolved = resolveEntity(type, fields);
    if (resolved.errors.length) throw new Error(resolved.errors[0]);
    await commitEntity(resolved);
    return resolved.displayName;
  };

  const handleCreateSingle = async () => {
    if (!descriptor) return;
    setSaving(true);
    try {
      const name = await commitState(single);
      toast.success(`${descriptor.label} “${name}” created`);
      setRawText(''); setSingle(emptyState(descriptor)); setPhase('input');
    } catch (err: any) {
      toast.error(err?.message || `Failed to create ${descriptor.label.toLowerCase()}.`);
      reportClientError(err, OperationType.CREATE, `import/${type}`);
    } finally { setSaving(false); }
  };

  const handleCreateBatch = async () => {
    if (!descriptor) return;
    setSaving(true);
    let ok = 0; const failed: string[] = [];
    for (const i of [...selected].sort((a, b) => a - b)) {
      try { await commitState(stateFor(i)); ok++; }
      catch (err: any) { failed.push(`#${i + 1}: ${err?.message ?? 'error'}`); console.error('[batch create]', err); }
    }
    setSaving(false);
    if (failed.length) toast.error(`Created ${ok}; ${failed.length} failed — ${failed[0]}`);
    else { toast.success(`Created ${ok} ${descriptor.label.toLowerCase()}${ok === 1 ? '' : 's'}`); setRawText(''); setPhase('input'); setBoundaries([]); }
  };

  if (!userProfile) return <div className="px-6 py-12 text-center text-ink/50">Sign in to use the import window.</div>;

  const sourceLabel = sourceId ? (sourceOptions.find((o) => o.id === sourceId)?.name ?? sourceId) : '— none —';
  const singleResolved = (() => {
    try { return resolveEntity(type, sourceKey ? { ...single.values, [sourceKey]: sourceId } : single.values); }
    catch { return null; }
  })();

  // Live "how it will render" preview using the compendium's real detail pane.
  // Spell-specific for now; future types wire their own here. Builds the resolved
  // payload and adapts it to the panel's raw-row shape.
  const renderPreview: ((state: EntityState) => React.ReactNode) | undefined =
    type === 'spell'
      ? (state) => {
          try {
            const fields = sourceKey ? { ...state.values, [sourceKey]: sourceId } : state.values;
            const payload = resolveEntity(type, fields).payload;
            return <SpellDetailPanel spellId="import-preview" spellData={buildSpellPreviewRow(payload)} size="compact" emptyMessage="" />;
          } catch { return null; }
        }
      : undefined;

  // Save the current marked-up layout as the source's format template, then
  // re-parse the batch with it. Clear removes it.
  const handleSaveFormat = (state: EntityState, text: string) => {
    const tpl = buildFormatTemplate(type, text, state.spans);
    if (!Object.keys(tpl).length) { toast.error('Assign some fields first, then save the format.'); return; }
    saveFormatLS(type, sourceId, tpl);
    setFormatTemplate(tpl);
    setEdits({});
    toast.success(`Format saved for ${sourceLabel}`);
  };
  const handleClearFormat = () => {
    clearFormatLS(type, sourceId);
    setFormatTemplate(null);
    setEdits({});
    toast.success('Format cleared');
  };

  return (
    <ImportCatalogsContext.Provider value={catalogsValue}>
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Wand2 className="h-5 w-5 text-gold" />
          <div>
            <h1 className="h3-title">Mark &amp; Build</h1>
            <p className="muted-text text-xs">Paste one or many stat blocks; map them onto the fields, re-assign by selecting text, then create — through the editor’s real save path.</p>
          </div>
        </div>
        <label className="flex items-center gap-2">
          <span className="field-label">Type</span>
          <select className="field-input px-2" value={type} onChange={(e) => setType(e.target.value)}>
            {descriptors.map((d) => (<option key={d.type} value={d.type}>{d.label}</option>))}
          </select>
        </label>
      </div>

      {/* Source — persistent */}
      {sourceKey ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold/15 bg-gold/5 px-4 py-2.5">
          <div className="flex items-center gap-2"><Library className="h-4 w-4 text-gold" /><span className="field-label">Source</span></div>
          <div className="w-64">
            <SingleSelectSearch value={sourceId} onChange={setSourceId} options={sourceOptions} placeholder="— none —" noEntitiesText="No sources found." triggerClassName="field-input w-full text-sm" />
          </div>
          {!sourceId ? (
            <span className="inline-flex items-center gap-1 rounded border border-blood/30 bg-blood/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-blood">
              <AlertTriangle className="h-3 w-3" /> No source — hidden from the browser
            </span>
          ) : null}
          {formatTemplate ? (
            <span className="inline-flex items-center gap-1 rounded border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-gold" title="A saved field layout is auto-applied on interpret for this source">
              Format saved
              <button type="button" onClick={handleClearFormat} className="ml-0.5 text-gold/70 hover:text-blood" title="Clear the saved format">✕</button>
            </span>
          ) : null}
          <span className="ml-auto field-hint">Applies to every entity you create — set it once per book.</span>
        </div>
      ) : null}

      {/* ── INPUT ───────────────────────────────────────────────────────────── */}
      {phase === 'input' ? (
        <div className="compendium-card flex flex-col p-3">
          <div className="mb-2 flex items-center gap-2"><ScanText className="h-4 w-4 text-gold" /><span className="section-label">Source text</span></div>
          <textarea
            className="field-input min-h-[24rem] w-full flex-1 p-2 font-mono text-xs leading-relaxed"
            rows={20}
            placeholder={PLACEHOLDER}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onPaste={handlePaste}
          />
          <div className="mt-2 flex items-center gap-2">
            {hasSections ? (
              <>
                <button type="button" className="btn-gold-solid h-9 px-4" onClick={handleManualEntry}>Enter by section →</button>
                <button type="button" className="btn-gold h-9 px-4 disabled:opacity-50" disabled={!rawText.trim()} onClick={handleInterpret}>Interpret pasted text</button>
              </>
            ) : hasParser ? (
              <button type="button" className="btn-gold-solid h-9 px-4 disabled:opacity-50" disabled={!rawText.trim()} onClick={handleInterpret}>Interpret</button>
            ) : (
              <button type="button" className="btn-gold-solid h-9 px-4" onClick={handleManualEntry}>Enter details →</button>
            )}
            <span className="field-hint">{hasSections ? 'Start blank and drop each block into its own box — or Interpret a full write-up to mark it up by hand.' : hasParser ? 'Paste plain text or HTML; multiple stat blocks auto-split into a batch. Activities aren’t parsed — add them in the editor.' : 'Manual-entry type — paste reference text to keep beside the form (optional), then enter the details.'}</span>
          </div>
        </div>
      ) : null}

      {/* ── SINGLE ──────────────────────────────────────────────────────────── */}
      {phase === 'single' && descriptor ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold/25 bg-card/40 px-4 py-2.5">
            <Sparkles className="h-4 w-4 text-gold" />
            <div className="min-w-0">
              <span className="font-serif text-base font-bold text-ink">{singleResolved?.displayName || '(unnamed)'}</span>
              <span className="ml-2 font-mono text-[10px] text-ink/45">{singleResolved?.identifier || '—'} · {sourceLabel}</span>
            </div>
            {singleResolved && singleResolved.errors.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded border border-blood/30 bg-blood/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-blood">{singleResolved.errors[0]}</span>
            ) : Object.keys(single.provenance).length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded border border-blood/30 bg-blood/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-blood"><AlertTriangle className="h-3 w-3" /> {Object.keys(single.provenance).length} to check</span>
            ) : (<span className="label-text text-gold">Ready to create</span>)}
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className="btn-gold inline-flex h-9 items-center gap-1 px-3 text-[11px]" onClick={() => setPhase('input')}><Pencil className="h-3 w-3" /> Edit text</button>
              {hasParser ? (
                <button type="button" className="btn-gold inline-flex h-9 items-center gap-1 px-3 text-[11px]" onClick={enterBatch}><Scissors className="h-3 w-3" /> Divide</button>
              ) : null}
              {hasSections ? (
                <button type="button" className="btn-gold inline-flex h-9 items-center gap-1 px-3 text-[11px] disabled:opacity-50" disabled={!singleResolved} onClick={() => setPreviewOpen(true)}><FileText className="h-3 w-3" /> Preview</button>
              ) : null}
              <button type="button" className="btn-gold-solid h-9 px-5 disabled:opacity-50" disabled={saving || !singleResolved || singleResolved.errors.length > 0} onClick={handleCreateSingle}>{saving ? 'Creating…' : `Create ${descriptor.label}`}</button>
            </div>
          </div>
          <EntityWorkspace type={type} descriptor={descriptor} rawText={rawText} state={single} onChange={setSingle} assignTargets={assignTargets} renderPreview={renderPreview} onSaveFormat={hasParser ? handleSaveFormat : undefined} />
          {singleResolved ? <ResolvedPayload payload={singleResolved.payload} /> : null}
          {previewOpen && singleResolved ? (() => {
            const row: any = { ...singleResolved.payload }; delete row.__features;
            return <ClassPreviewPane classData={{ ...denormalizeCompendiumData(row), id: 'import-preview' }} open onClose={() => setPreviewOpen(false)} />;
          })() : null}
        </>
      ) : null}

      {/* ── BATCH ───────────────────────────────────────────────────────────── */}
      {phase === 'batch' && descriptor && reviewIndex == null ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold/25 bg-card/40 px-4 py-2.5">
            <ListChecks className="h-4 w-4 text-gold" />
            <span className="font-serif text-base font-bold text-ink">Batch import</span>
            <span className="field-hint">{candidates.length} {descriptor.label.toLowerCase()}s detected · {selected.size} selected</span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className="btn-gold inline-flex h-9 items-center gap-1 px-3 text-[11px]" onClick={() => setPhase('input')}><Pencil className="h-3 w-3" /> Edit text</button>
              <button type="button" className="btn-gold-solid h-9 px-5 disabled:opacity-50" disabled={saving || selected.size === 0} onClick={handleCreateBatch}>{saving ? 'Creating…' : `Create ${selected.size} ${descriptor.label}${selected.size === 1 ? '' : 's'}`}</button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Division editor */}
            <div className="compendium-card flex flex-col p-3">
              <div className="mb-2 flex items-center gap-2"><Scissors className="h-4 w-4 text-gold" /><span className="section-label">Divisions</span><span className="ml-auto field-hint">＋ split · ✕ merge</span></div>
              <DivisionEditor rawText={rawText} boundaries={boundaries} names={blockNames} onAdd={addDivision} onRemove={removeDivision} />
            </div>
            {/* Candidate list */}
            <div className="space-y-2">
              {candidates.map((c, i) => {
                const st = stateFor(i);
                const flags = Object.keys(st.provenance).length;
                return (
                  <div key={i} className="compendium-card flex items-center gap-2 p-2">
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelected(i)} className="h-4 w-4 accent-[var(--gold)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-ink">{i + 1}. {st.values.name || '(unnamed)'}</div>
                      <div className="field-hint">{flags ? `${flags} to check` : 'parsed cleanly'}{st.leftovers.length ? ` · ${st.leftovers.length} note${st.leftovers.length === 1 ? '' : 's'}` : ''}{edits[i] ? ' · edited' : ''}</div>
                    </div>
                    {flags > 0 ? <span className="rounded border border-blood/30 bg-blood/10 px-1.5 py-0.5 text-[10px] font-black text-blood">{flags}</span> : null}
                    <button type="button" className="btn-gold h-7 px-2 text-[11px]" onClick={() => setReviewIndex(i)}>Review</button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* ── BATCH · review one candidate ────────────────────────────────────── */}
      {phase === 'batch' && descriptor && reviewIndex != null && candidates[reviewIndex] ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold/25 bg-card/40 px-4 py-2.5">
            <button type="button" className="btn-gold h-9 px-3 text-[11px]" onClick={() => setReviewIndex(null)}>← Candidates</button>
            <span className="font-serif text-base font-bold text-ink">{stateFor(reviewIndex).values.name || '(unnamed)'}</span>
            <span className="field-hint">Reviewing {reviewIndex + 1} of {candidates.length}</span>
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-ink/80">
              <input type="checkbox" checked={selected.has(reviewIndex)} onChange={() => toggleSelected(reviewIndex)} className="h-4 w-4 accent-[var(--gold)]" /> Include in import
            </label>
          </div>
          <EntityWorkspace
            type={type}
            descriptor={descriptor}
            rawText={candidates[reviewIndex].text}
            state={stateFor(reviewIndex)}
            onChange={(updater) => setEdits((prev) => ({ ...prev, [reviewIndex]: updater(stateFor(reviewIndex)) }))}
            assignTargets={assignTargets}
            renderPreview={renderPreview}
            onSaveFormat={hasParser ? handleSaveFormat : undefined}
          />
        </>
      ) : null}
    </div>
    </ImportCatalogsContext.Provider>
  );
}

// ───────────────────────────── Division editor ──────────────────────────────
function DivisionEditor({
  rawText, boundaries, names, onAdd, onRemove,
}: {
  rawText: string;
  boundaries: number[];
  names: string[];
  onAdd: (offset: number) => void;
  onRemove: (offset: number) => void;
}) {
  const lines = useMemo(() => rawText.split('\n'), [rawText]);
  const lineStarts = useMemo(() => { const s: number[] = []; let o = 0; for (const l of lines) { s.push(o); o += l.length + 1; } return s; }, [lines]);
  const bset = useMemo(() => new Set(boundaries), [boundaries]);
  let block = -1;
  return (
    <div className="min-h-[24rem] flex-1 overflow-auto rounded border border-gold/10 bg-background/30 p-2 font-mono text-xs leading-relaxed text-ink/90">
      {lines.map((ln, i) => {
        const start = lineStarts[i];
        const isBoundary = bset.has(start);
        if (isBoundary) block++;
        const canSplit = ln.trim() !== '' && !isBoundary;
        return (
          <React.Fragment key={i}>
            {isBoundary ? (
              <div className={`-mx-2 flex items-center justify-between gap-2 border-y border-gold/30 bg-gold/10 px-2 py-1 ${block === 0 ? 'mt-0' : 'mt-3'}`}>
                <span className="label-text text-gold">Spell {block + 1} · {names[block] || '(unnamed)'}</span>
                {block > 0 ? (
                  <button type="button" onClick={() => onRemove(start)} className="btn-gold inline-flex items-center gap-1 px-2 py-0.5 text-[10px]" title="Merge this spell into the one above">
                    <ChevronUp className="h-3 w-3" /> Merge up
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="group flex items-start">
              <button
                type="button"
                disabled={!canSplit}
                onClick={() => onAdd(start)}
                title={canSplit ? 'Split a new entity here' : ''}
                className={`mr-1 w-4 shrink-0 select-none text-center ${canSplit ? 'text-transparent group-hover:text-gold hover:!text-gold' : 'text-transparent'}`}
              >＋</button>
              <span className="whitespace-pre-wrap break-words">{ln || ' '}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Resolved payload ───────────────────────────────
function ResolvedPayload({ payload }: { payload: Record<string, any> }) {
  return (
    <details className="compendium-card mt-4 p-3">
      <summary className="section-label flex cursor-pointer items-center gap-2 text-ink/60"><FileText className="h-3.5 w-3.5" /> Resolved payload — what will be written</summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded bg-ink/90 p-2 text-[10px] leading-relaxed text-parchment">{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}

// ───────────────────────── Per-entity mark-up editor ────────────────────────
function EntityWorkspace({
  type, descriptor, rawText, state, onChange, assignTargets, renderPreview, onSaveFormat,
}: {
  type: string;
  descriptor: ImportDescriptor;
  rawText: string;
  state: EntityState;
  onChange: (updater: (prev: EntityState) => EntityState) => void;
  assignTargets: ImportAssignTarget[];
  renderPreview?: (state: EntityState) => React.ReactNode;
  onSaveFormat?: (state: EntityState, rawText: string) => void;
}) {
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [identifierDirty, setIdentifierDirty] = useState(false);
  const [rightTab, setRightTab] = useState<'fields' | 'preview'>('fields');
  const leftRef = useRef<HTMLDivElement>(null);
  const catalogs = useContext(ImportCatalogsContext);
  // Types with Block-group assign targets (classes) get the "Paste by section"
  // drop-zones as the DEFAULT input; "Mark text" is the secondary refinement.
  const hasSections = useMemo(() => assignTargets.some((t) => t.group === 'Blocks'), [assignTargets]);
  const [leftMode, setLeftMode] = useState<'sections' | 'mark'>(assignTargets.some((t) => t.group === 'Blocks') ? 'sections' : 'mark');

  const fieldTarget = useMemo(() => {
    const map: Record<string, { key: string; label: string }> = {};
    for (const t of assignTargets) for (const fk of t.fieldKeys) map[fk] = { key: t.key, label: t.label };
    return map;
  }, [assignTargets]);

  const setField = (key: string, value: any) => {
    onChange((prev) => {
      const values = { ...prev.values, [key]: value };
      if (key === descriptor.nameField && !identifierDirty && 'identifier' in prev.values) values.identifier = slugify(String(value));
      const provenance = { ...prev.provenance }; delete provenance[key];
      return { ...prev, values, provenance };
    });
    if (key === 'identifier') setIdentifierDirty(true);
  };

  const offsetOf = (node: Node, offset: number): number | null => {
    const el = node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
    const seg = el?.closest('[data-start]');
    return seg ? Number(seg.getAttribute('data-start')) + offset : null;
  };
  const onMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const c = leftRef.current;
    if (!c || !c.contains(range.startContainer) || !c.contains(range.endContainer)) return;
    const a = offsetOf(range.startContainer, range.startOffset);
    const b = offsetOf(range.endContainer, range.endOffset);
    if (a == null || b == null) return;
    const start = Math.min(a, b), end = Math.max(a, b);
    if (end <= start) return;
    const rect = range.getBoundingClientRect();
    setSelection({ start, end, text: rawText.slice(start, end), top: rect.bottom, selTop: rect.top, left: rect.left });
  };
  const onHighlightClick = (e: React.MouseEvent, start: number, end: number) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSelection({ start, end, text: rawText.slice(start, end), top: rect.bottom, selTop: rect.top, left: rect.left });
  };
  // Carve [iv] out of every assign target NOT in `keep`, re-deriving each
  // trimmed target's value from the text that REMAINS. This is what makes a
  // re-assignment actually DECOUPLE: peel a line out of Description and the rest
  // of Description reflows; the peeled text is now free to belong elsewhere.
  const repartition = (
    prev: EntityState,
    values: Record<string, any>,
    spans: Record<string, Span[]>,
    provenance: Record<string, FieldFlag>,
    iv: Span,
    keep: Set<string>,
  ) => {
    for (const u of assignTargets) {
      if (keep.has(u.key)) continue;
      if (u.mode === 'append') continue; // feature spans live on the list items, not here
      let cur: Span[] | undefined;
      for (const fk of u.fieldKeys) if (prev.spans[fk]?.length) { cur = prev.spans[fk]; break; }
      if (!cur) continue;
      const trimmed = cur.flatMap((s) => subtractInterval(s, iv));
      if (sameSpanList(trimmed, cur)) continue; // this target didn't overlap iv
      // Resolve targets (Proficiencies block / sub-sections): trim the HIGHLIGHT
      // only — their grid value isn't text-derivable, so marking a sub-section
      // inside the block just carves the block's highlight, leaving its grid.
      if (u.mode !== 'resolve') {
        const remaining = trimmed.map((s) => rawText.slice(s.start, s.end)).join('\n').trim();
        if (remaining) {
          const re = assignFieldText(type, u.key, remaining);
          for (const [k, v] of Object.entries(re)) { values[k] = v; delete provenance[k]; }
        }
      }
      for (const fk of u.fieldKeys) { if (trimmed.length) spans[fk] = trimmed; else delete spans[fk]; }
    }
  };
  // A "block" target (all textarea fields) ACCUMULATES selections; an atomic
  // target REPLACES — so several flavour paragraphs all feed Lore, but
  // re-marking the Name just swaps it.
  const isBlockTarget = (t?: ImportAssignTarget) =>
    !!t && t.fieldKeys.length > 0 && t.fieldKeys.every((fk) => descriptor.fields.find((f) => f.key === fk)?.kind === 'textarea');
  const handleAssign = (targetKey: string) => {
    if (!selection) return;
    const target = assignTargets.find((t) => t.key === targetKey);
    const iv: Span = { start: selection.start, end: selection.end };
    // Append-mode target (e.g. class Feature): each selection adds ONE list item,
    // so marking several spans yields several features. Still decouples the span
    // from the other fields.
    if (target?.mode === 'append') {
      const item = assignAppendItem(type, targetKey, selection.text);
      if (!item) { toast.error('Nothing to add from that selection.'); return; }
      const fk = target.fieldKeys[0];
      onChange((prev) => {
        const values = { ...prev.values };
        const spans = { ...prev.spans };
        const provenance = { ...prev.provenance };
        repartition(prev, values, spans, provenance, iv, new Set([targetKey]));
        const arr = Array.isArray(values[fk]) ? [...values[fk]] : [];
        arr.push({ ...item, span: iv });
        values[fk] = arr;
        return { ...prev, values, spans, provenance };
      });
      setSelection(null); window.getSelection()?.removeAllRanges();
      toast.success(`Added ${target.label}`);
      return;
    }
    // Resolve-mode target (catalog-aware): the Proficiencies block resolves the
    // whole grid + hit die/saves/primary from the region; a sub-section resolves
    // just that one kind into the grid. Needs the loaded catalogs.
    if (target?.mode === 'resolve') {
      if (!catalogs) { toast.error('Catalogs still loading — try again in a moment.'); return; }
      const probe = assignResolveFields(type, targetKey, selection.text, catalogs, state.values);
      if (!probe || !Object.keys(probe).length) { toast.error('Nothing to resolve from that selection.'); return; }
      onChange((prev) => {
        const values = { ...prev.values };
        const spans = { ...prev.spans };
        const provenance = { ...prev.provenance };
        repartition(prev, values, spans, provenance, iv, new Set([targetKey]));
        const patch = assignResolveFields(type, targetKey, selection.text, catalogs, prev.values);
        for (const [k, v] of Object.entries(patch)) { values[k] = v; delete provenance[k]; }
        for (const fk of target.fieldKeys) spans[fk] = [iv];
        return { ...prev, values, spans, provenance };
      });
      setSelection(null); window.getSelection()?.removeAllRanges();
      toast.success(`Resolved ${target.label}`);
      return;
    }
    const probe = assignFieldText(type, targetKey, selection.text);
    if (!Object.keys(probe).length) { toast.error('Nothing to assign from that selection.'); return; }
    const keys = target?.fieldKeys ?? Object.keys(probe);
    onChange((prev) => {
      const values = { ...prev.values };
      const spans = { ...prev.spans };
      const provenance = { ...prev.provenance };
      // 1. decouple iv from every OTHER target (re-derives the losers)
      repartition(prev, values, spans, provenance, iv, new Set([targetKey]));
      // 2. union (block) or replace (atomic) iv into this target, then re-derive
      let prior: Span[] = [];
      if (isBlockTarget(target)) for (const fk of keys) if (prev.spans[fk]?.length) { prior = prev.spans[fk]; break; }
      const list = mergeSpans([...prior, iv]);
      const text = list.map((s) => rawText.slice(s.start, s.end)).join('\n').trim();
      const result = assignFieldText(type, targetKey, text);
      for (const [k, v] of Object.entries(result)) { values[k] = v; delete provenance[k]; }
      for (const fk of keys) spans[fk] = list;
      return { ...prev, values, spans, provenance };
    });
    setSelection(null); window.getSelection()?.removeAllRanges();
    toast.success(`Assigned to ${target?.label ?? targetKey}`);
  };
  // "This text isn't any field" — carve the selection out of everything.
  const handleClearSelection = () => {
    if (!selection) return;
    const iv: Span = { start: selection.start, end: selection.end };
    onChange((prev) => {
      const values = { ...prev.values };
      const spans = { ...prev.spans };
      const provenance = { ...prev.provenance };
      repartition(prev, values, spans, provenance, iv, new Set());
      return { ...prev, values, spans, provenance };
    });
    setSelection(null); window.getSelection()?.removeAllRanges();
    toast.success('Cleared that selection');
  };
  const dismissSelection = () => { setSelection(null); window.getSelection()?.removeAllRanges(); };

  // Annotated segments
  const targetSpans = useMemo(() => {
    const out: { key: string; label: string; start: number; end: number }[] = [];
    for (const t of assignTargets) {
      let list: Span[] | undefined;
      if (t.mode === 'append') {
        // append targets (Features) carry their span on each list item
        const items = state.values[t.fieldKeys[0]];
        if (Array.isArray(items)) list = items.map((it: any) => it?.span).filter(Boolean) as Span[];
      } else {
        for (const fk of t.fieldKeys) if (state.spans[fk]?.length) { list = state.spans[fk]; break; }
      }
      if (list) for (const s of list) out.push({ key: t.key, label: t.label, start: s.start, end: s.end });
    }
    return out.sort((a, b) => a.start - b.start);
  }, [assignTargets, state.spans, state.values]);
  const segments = useMemo(() => {
    const segs: { start: number; end: number; target?: string; label?: string }[] = [];
    let pos = 0;
    for (const sp of targetSpans) {
      if (sp.start < pos) continue;
      if (sp.start > pos) segs.push({ start: pos, end: sp.start });
      segs.push({ start: sp.start, end: sp.end, target: sp.key, label: sp.label });
      pos = sp.end;
    }
    if (pos < rawText.length) segs.push({ start: pos, end: rawText.length });
    return segs;
  }, [targetSpans, rawText]);

  // Group the assign targets for the popover: full "Blocks" first, then refining
  // sub-sections ("Within Proficiencies"). Single-group types render flat.
  const assignGroups = useMemo(() => {
    const groups: { name: string; items: ImportAssignTarget[] }[] = [];
    for (const t of assignTargets) {
      const g = t.group || 'Fields';
      let bucket = groups.find((x) => x.name === g);
      if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
      bucket.items.push(t);
    }
    return groups;
  }, [assignTargets]);

  const grouped = groupFields(descriptor.fields);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* LEFT — annotated source */}
      <div className="compendium-card flex flex-col p-3">
        <div className="mb-2 flex items-center gap-2">
          <ScanText className="h-4 w-4 text-gold" />
          {hasSections ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setLeftMode('sections')} className={`filter-tag ${leftMode === 'sections' ? 'btn-gold-solid' : 'btn-gold'}`}>Sections</button>
              <button type="button" onClick={() => setLeftMode('mark')} className={`filter-tag ${leftMode === 'mark' ? 'btn-gold-solid' : 'btn-gold'}`}>Mark text</button>
            </div>
          ) : (<span className="section-label">Source text</span>)}
        </div>
        {hasSections && leftMode === 'sections' ? (
          <SectionsPanel type={type} state={state} onChange={onChange} catalogs={catalogs} />
        ) : (
          <>
            <div ref={leftRef} onMouseUp={onMouseUp} className="min-h-[20rem] flex-1 cursor-text overflow-auto whitespace-pre-wrap rounded border border-gold/10 bg-background/30 p-3 font-mono text-xs leading-relaxed text-ink/90 selection:bg-gold/30">
              {segments.map((seg, i) => {
                const txt = rawText.slice(seg.start, seg.end);
                if (!seg.target) return <span key={i} data-start={seg.start}>{txt}</span>;
                const active = activeTarget === seg.target;
                return (
                  <span key={i} data-start={seg.start} title={`${seg.label} — click to re-assign`}
                    onMouseEnter={() => setActiveTarget(seg.target ?? null)} onMouseLeave={() => setActiveTarget(null)}
                    onClick={(e) => onHighlightClick(e, seg.start, seg.end)}
                    className={`cursor-pointer ${active ? 'bg-gold/35 ring-1 ring-gold/60' : 'bg-gold/15 hover:bg-gold/30'}`}>{txt}</span>
                );
              })}
            </div>
            <p className="mt-2 field-hint">Select text (or click a highlight) to assign it to a field. Hover to see which field it feeds.</p>
            {state.leftovers.length > 0 ? (
              <div className="mt-2 rounded border border-blood/30 bg-blood/10 p-2 text-blood">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest"><AlertTriangle className="h-3 w-3" /> Couldn’t place — carry these over in the editor</div>
                <ul className="space-y-0.5 pl-1 text-xs">{state.leftovers.map((l, i) => (<li key={i}>• {l}</li>))}</ul>
              </div>
            ) : null}
            {state.notes.length > 0 ? (
              <div className="mt-2 rounded border border-gold/20 bg-gold/5 p-2 text-ink/70">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gold/60"><Sparkles className="h-3 w-3" /> Auto-filled — review</div>
                <ul className="space-y-0.5 pl-1 text-xs">{state.notes.map((l, i) => (<li key={i}>• {l}</li>))}</ul>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* RIGHT — fields / live preview */}
      <div className="space-y-3">
        {(renderPreview || onSaveFormat) ? (
          <div className="flex items-center gap-1">
            {renderPreview ? (
              <>
                <button type="button" onClick={() => setRightTab('fields')} className={`filter-tag ${rightTab === 'fields' ? 'btn-gold-solid' : 'btn-gold'}`}>Edit fields</button>
                <button type="button" onClick={() => setRightTab('preview')} className={`filter-tag ${rightTab === 'preview' ? 'btn-gold-solid' : 'btn-gold'}`}>Preview</button>
              </>
            ) : null}
            {onSaveFormat ? (
              <button type="button" onClick={() => onSaveFormat(state, rawText)} className="btn-gold ml-auto inline-flex h-7 items-center gap-1 px-2 text-[10px]" title="Remember this field layout for the source — auto-applied to future spells of this source">
                Save as format
              </button>
            ) : null}
          </div>
        ) : null}
        {rightTab === 'preview' && renderPreview ? (
          <div className="compendium-card min-h-[32rem] overflow-auto">{renderPreview(state)}</div>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <fieldset key={group.name} className="config-fieldset">
                <legend className="section-label text-gold/60 px-1">{group.name}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.fields.map((field) => {
                    const tgt = fieldTarget[field.key];
                    return (
                      <FieldControl key={field.key} field={field} value={state.values[field.key]} onChange={(v) => setField(field.key, v)}
                        flag={state.provenance[field.key]} highlighted={!!tgt && activeTarget === tgt.key} onHover={(on) => setActiveTarget(on && tgt ? tgt.key : null)} />
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </div>

      {/* Assign popover */}
      {selection && assignTargets.length > 0 ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onMouseDown={dismissSelection} />
          <div className="fixed z-50 w-60 overflow-y-auto rounded-lg border border-gold/30 bg-popover p-2 shadow-xl" style={(() => {
            // Keep the popover fully on-screen: anchor below the selection when
            // there's room, else flip above; cap the height to the available
            // space (it scrolls internally) so the long grouped list is reachable.
            const left = Math.min(Math.max(8, selection.left), window.innerWidth - 250);
            const spaceBelow = window.innerHeight - selection.top - 12;
            const spaceAbove = selection.selTop - 12;
            const above = spaceBelow < 240 && spaceAbove > spaceBelow;
            return above
              ? { left, bottom: Math.max(8, window.innerHeight - selection.selTop + 6), maxHeight: Math.max(140, spaceAbove) }
              : { left, top: Math.max(8, selection.top + 6), maxHeight: Math.max(140, spaceBelow) };
          })() as React.CSSProperties}>
            <div className="mb-1 flex items-center justify-between">
              <span className="section-label text-ink/50">Assign selection to</span>
              <button type="button" className="text-ink/40 hover:text-ink" onMouseDown={(e) => e.preventDefault()} onClick={dismissSelection}>✕</button>
            </div>
            <div className="mb-1 max-h-12 overflow-hidden truncate rounded bg-ink/5 px-1.5 py-1 font-mono text-[10px] text-ink/55">“{selection.text.slice(0, 80)}{selection.text.length > 80 ? '…' : ''}”</div>
            <div className="space-y-1.5">
              {assignGroups.map((g) => (
                <div key={g.name}>
                  {assignGroups.length > 1 ? (
                    <div className="mb-0.5 text-[9px] font-black uppercase tracking-widest text-ink/35">{g.name}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    {g.items.map((t) => (
                      <button key={t.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleAssign(t.key)} className="filter-tag btn-gold">{t.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleClearSelection} className="mt-1.5 w-full rounded border border-gold/10 py-0.5 text-[10px] uppercase tracking-widest text-ink/40 hover:text-blood" title="Decouple this text — belongs to no field">Clear — not a field</button>
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  );
}

// ── "Paste by section" drop-zones (default class input) ────────────────────
// One labeled box per Block-group assign target. Pasting + blurring runs the
// SAME interpreter the mark-up popover uses (assignField / assignResolve), so
// the user separates the text deterministically instead of relying on the
// parser to find boundaries. The Feature block is a repeater (one box → one
// feature, add as many as needed).

const SECTION_INPUT_CLS = 'w-full rounded border border-gold/15 bg-background/40 p-2 font-mono text-xs leading-relaxed text-ink/90 focus:border-gold/40 focus:outline-none';

function BlockDropZone({ target, rows, onApply }: { target: ImportAssignTarget; rows: number; onApply: (t: ImportAssignTarget, text: string) => void }) {
  const [text, setText] = useState('');
  const [applied, setApplied] = useState(false);
  return (
    <div>
      <label className="field-label flex items-center gap-2">{target.label}{applied ? <span className="text-[9px] font-bold uppercase tracking-widest text-gold/70">✓ applied</span> : null}</label>
      <textarea
        value={text} rows={rows}
        onChange={(e) => { setText(e.target.value); setApplied(false); }}
        onBlur={() => { if (text.trim()) { onApply(target, text); setApplied(true); } }}
        placeholder={`Paste the ${target.label.toLowerCase()} text…`}
        className={SECTION_INPUT_CLS}
      />
    </div>
  );
}

function FeatureDropZone({ target, count, onAdd }: { target: ImportAssignTarget; count: number; onAdd: (t: ImportAssignTarget, text: string, clear: () => void) => void }) {
  const [text, setText] = useState('');
  return (
    <div>
      <label className="field-label">{target.label.replace(/\s*\(.*\)/, '')} <span className="text-ink/40">— {count} added</span></label>
      <textarea value={text} rows={6} onChange={(e) => setText(e.target.value)} placeholder="Paste ALL the feature text — split into one feature per heading. (Spellcasting / ASI / subclass auto-detected.)" className={SECTION_INPUT_CLS} />
      <button type="button" onClick={() => onAdd(target, text, () => setText(''))} className="btn-gold mt-1 inline-flex h-7 items-center gap-1 px-2 text-[10px]">＋ Add features (auto-split)</button>
      <p className="field-hint mt-0.5">Over-split? Merge in the Features panel. Need exact boundaries? Use “Mark text” and mark each Feature.</p>
    </div>
  );
}

function SectionsPanel({ type, state, onChange, catalogs }: { type: string; state: EntityState; onChange: (u: (p: EntityState) => EntityState) => void; catalogs: ProfCatalogs | null }) {
  const blocks = useMemo(() => getAssignTargets(type).filter((t) => t.group === 'Blocks'), [type]);
  const applyText = (t: ImportAssignTarget, text: string) => {
    const clean = text.trim(); if (!clean) return;
    onChange((prev) => {
      const values = { ...prev.values };
      const provenance = { ...prev.provenance };
      const patch = t.mode === 'resolve'
        ? assignResolveFields(type, t.key, clean, catalogs, prev.values)
        : assignFieldText(type, t.key, clean);
      for (const [k, v] of Object.entries(patch)) { values[k] = v; delete provenance[k]; }
      return { ...prev, values, provenance };
    });
  };
  const addFeatures = (t: ImportAssignTarget, text: string, clear: () => void) => {
    const clean = text.trim(); if (!clean) return;
    // Bulk split first (one feature per heading); fall back to single if the
    // text has no detectable headings.
    let items = assignAppendManyItems(type, t.key, clean);
    if (!items.length) { const one = assignAppendItem(type, t.key, clean); items = one ? [one] : []; }
    if (!items.length) { toast.error('Nothing to add from that text.'); return; }
    const fk = t.fieldKeys[0];
    onChange((prev) => ({ ...prev, values: { ...prev.values, [fk]: [...(Array.isArray(prev.values[fk]) ? prev.values[fk] : []), ...items] } }));
    clear();
    toast.success(`Added ${items.length} feature${items.length === 1 ? '' : 's'}`);
  };
  return (
    <div className="flex-1 space-y-3 overflow-auto">
      <p className="field-hint">Drop each block's text into its box — no guessing where boundaries are. <span className="text-gold/70">Proficiencies</span> resolves the whole grid + hit die / saves / primary at once.</p>
      {blocks.map((t) => t.mode === 'append'
        ? <FeatureDropZone key={t.key} target={t} count={Array.isArray(state.values[t.fieldKeys[0]]) ? state.values[t.fieldKeys[0]].length : 0} onAdd={addFeatures} />
        : <BlockDropZone key={t.key} target={t} rows={t.fieldKeys[0] === 'name' ? 1 : 4} onApply={applyText} />)}
    </div>
  );
}

const FEATURE_KINDS: { value: FeatureDraft['kind']; label: string }[] = [
  { value: 'feature', label: 'Feature' },
  { value: 'spellcasting', label: 'Spellcasting' },
  { value: 'asi', label: 'ASI' },
  { value: 'subclass', label: 'Subclass' },
  { value: 'skip', label: 'Skip' },
];

// The class Features organizer: parsed sections you can MERGE (tick several →
// fold into one feature), edit (name/level), re-route (kind), or drop. Feature
// rows become child feature records; spellcasting/asi/subclass feed class fields.
function FeaturesPanel({ value, onChange }: { value: FeatureDraft[]; onChange: (v: FeatureDraft[]) => void }) {
  const drafts = Array.isArray(value) ? value : [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const update = (id: string, patch: Partial<FeatureDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => { onChange(drafts.filter((d) => d.id !== id)); setSel((p) => { const n = new Set(p); n.delete(id); return n; }); };
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const mergeSelected = () => {
    const idxs = drafts.map((d, i) => [d.id, i] as const).filter(([id]) => sel.has(id)).map(([, i]) => i).sort((a, b) => a - b);
    if (idxs.length < 2) return;
    const first = drafts[idxs[0]];
    const body = idxs.map((i, k) => (k === 0 ? drafts[i].body : `[b]${drafts[i].name}[/b]\n${drafts[i].body}`)).join('\n\n').trim();
    const drop = new Set(idxs.slice(1).map((i) => drafts[i].id));
    onChange(drafts.filter((d) => !drop.has(d.id)).map((d) => (d.id === first.id ? { ...d, body } : d)));
    setSel(new Set());
  };
  const addBlank = () => onChange([...drafts, { id: crypto.randomUUID(), kind: 'feature', name: 'New Feature', level: 1, levels: [], body: '' }]);
  const featCount = drafts.filter((d) => d.kind === 'feature').length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="section-label">{featCount} feature{featCount === 1 ? '' : 's'} · {drafts.length} section{drafts.length === 1 ? '' : 's'}</span>
        <button type="button" disabled={sel.size < 2} onClick={mergeSelected} className="btn-gold h-7 px-2 text-[11px] disabled:opacity-40">Merge selected ({sel.size})</button>
        <button type="button" onClick={addBlank} className="btn-gold h-7 px-2 text-[11px]">＋ Add</button>
      </div>
      <div className="space-y-1">
        {drafts.length === 0 ? <p className="field-hint">No features parsed — paste a class write-up and Interpret, or ＋ Add one.</p> : null}
        {drafts.map((d) => (
          <div key={d.id} className={`compendium-card p-2 ${d.kind === 'skip' ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} className="h-4 w-4 accent-[var(--gold)]" title="Select for merge" />
              <select value={d.kind} onChange={(e) => update(d.id, { kind: e.target.value as FeatureDraft['kind'] })} className="field-input w-28 px-1 text-[11px]">
                {FEATURE_KINDS.map((k) => (<option key={k.value} value={k.value}>{k.label}</option>))}
              </select>
              <input value={d.name} onChange={(e) => update(d.id, { name: e.target.value })} className="field-input flex-1 px-2 text-sm" placeholder="Feature name" />
              {d.kind === 'feature' ? (
                <input type="number" min={1} max={20} value={d.level ?? ''} onChange={(e) => update(d.id, { level: e.target.value ? Number(e.target.value) : null })} className="field-input w-14 px-1 text-sm" title="Level" />
              ) : d.kind === 'asi' || d.kind === 'subclass' ? (
                <span className="font-mono text-[10px] text-ink/45" title="Levels">[{d.levels.join(',')}]</span>
              ) : null}
              <button type="button" onClick={() => remove(d.id)} className="px-1 text-ink/40 hover:text-blood" title="Remove">✕</button>
            </div>
            {d.body ? <div className="mt-1 line-clamp-2 pl-6 text-[11px] text-ink/50">{d.body.replace(/\[\/?b\]/g, '')}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldControl({
  field, value, onChange, flag, highlighted, onHover,
}: {
  field: ImportFieldDef;
  value: any;
  onChange: (value: any) => void;
  flag?: FieldFlag;
  highlighted?: boolean;
  onHover?: (on: boolean) => void;
}) {
  const catalogs = useContext(ImportCatalogsContext);
  const id = `imp-${field.key}`;
  const stateRing = flag ? ' ring-1 ring-blood/50 border-blood/40' : highlighted ? ' ring-1 ring-gold/60' : '';
  const flagNote = flag ? (flag.note ?? (flag.confidence === 'none' ? 'Not found — please set this.' : 'Best guess — confirm.')) : '';
  const hover = { onMouseEnter: () => onHover?.(true), onMouseLeave: () => onHover?.(false) };

  if (field.kind === 'boolean') {
    return (
      <label {...hover} className={`flex items-center gap-2 self-end pb-2 text-sm ${flag ? 'text-blood' : 'text-ink/80'}`}>
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className={`h-4 w-4 accent-[var(--gold)]${flag ? ' ring-1 ring-blood/50' : ''}`} />
        {field.label}
      </label>
    );
  }

  if (field.kind === 'proficiencies') {
    const types = (field.proficiencyTypes as ProficiencyType[] | undefined) ?? ['armor', 'weapons', 'skills', 'tools', 'languages'];
    const prof = value && typeof value === 'object' ? value : {};
    return (
      <div className="sm:col-span-2" {...hover}>
        <label className="field-label mb-1 block">{field.label}</label>
        {catalogs ? (
          <div className="rounded border border-gold/10 bg-background/30 p-3">
            <ProficienciesEditor
              proficiencies={prof}
              setProficiencies={onChange}
              types={types}
              showDisplayNames={true}
              allSkills={catalogs.allSkills}
              allArmor={catalogs.allArmor} allArmorCategories={catalogs.allArmorCategories} groupedArmor={catalogs.groupedArmor}
              allWeapons={catalogs.allWeapons} allWeaponCategories={catalogs.allWeaponCategories} groupedWeapons={catalogs.groupedWeapons}
              allTools={catalogs.allTools} allToolCategories={catalogs.allToolCategories} groupedTools={catalogs.groupedTools}
              allLanguages={catalogs.allLanguages} allLanguageCategories={catalogs.allLanguageCategories} groupedLanguages={catalogs.groupedLanguages}
            />
          </div>
        ) : (
          <p className="field-hint">Loading proficiency catalogs…</p>
        )}
        {field.help ? <p className="field-hint mt-0.5">{field.help}</p> : null}
      </div>
    );
  }

  if (field.kind === 'features') {
    return (
      <div className="sm:col-span-2" {...hover}>
        <label className="field-label mb-1 block">{field.label}</label>
        <FeaturesPanel value={Array.isArray(value) ? value : []} onChange={onChange} />
        {field.help ? <p className="field-hint mt-1">{field.help}</p> : null}
      </div>
    );
  }

  const wrapClass = field.kind === 'textarea' ? 'sm:col-span-2' : '';
  return (
    <div className={wrapClass} {...hover}>
      <label htmlFor={id} className="field-label mb-1 block">{field.label}{field.required ? <span className="ml-1 text-blood">*</span> : null}</label>
      {field.kind === 'textarea' ? (
        <textarea id={id} className={`field-input min-h-24 w-full p-2${stateRing}`} rows={5} placeholder={field.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === 'select' ? (
        <select id={id} className={`field-input w-full px-2${stateRing}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      ) : (
        <input id={id} type={field.kind === 'number' ? 'number' : 'text'} className={`field-input w-full px-2${stateRing}`} placeholder={field.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {flag ? <p className="mt-0.5 text-[10px] text-blood/80">{flagNote}</p> : field.help ? <p className="field-hint mt-0.5">{field.help}</p> : null}
    </div>
  );
}
