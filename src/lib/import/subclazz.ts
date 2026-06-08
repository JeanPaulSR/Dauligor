// Subclass import descriptor — the third worked type, sibling to `clazz.ts`.
//
// Named `subclazz` to match `clazz` (and dodge keyword collisions).
//
// FIDELITY — like classes, subclasses have no dedicated write wrapper.
// `SubclassEditor.handleSave` builds the snake_case `d1Data` row INLINE and calls
// the GENERIC `upsertDocument('subclasses', id, d1Data)` (+ `queueRebake('subclass',
// id)`). So this descriptor's `buildPayload` is a faithful mirror of that `d1Data`
// (snake_case columns, same JSON shapes), and `commit` makes the same two calls.
// A subclass created here is byte-identical to one saved from the editor.
//
// PARENT CLASS — the one structural difference from a class: a subclass MUST
// belong to a parent class. The `classRef` field (kind 'parentClass') captures
// the chosen class as { id, identifier, name }; the payload's `class_id` /
// `class_identifier` come straight from it. It is required — a parentless
// subclass would be an orphan row hidden from its class.
//
// SCOPE (like the class importer) — identity + prose + child features. The deep
// structure (advancement tree, unique-option exclusions, scaling columns, images)
// stays in the subclass editor, written as the same empty-default shapes a fresh
// subclass saves, with `advancements: []` (the editor synthesizes the canonical
// subclass progression on first save). A "Spellcasting" feature section routes
// into the subclass spellcasting config (the text-derivable half — the slot /
// known scaling tables stay manual).
//
// Component guide + recipe: docs/architecture/import-system.md

import { upsertDocument } from '../d1';
import { upsertFeature } from '../compendium';
import { queueRebake } from '../moduleExport';
import { slugify } from '../utils';
import { parseSubclassText, parseFeatureSpan, splitFeatures, reflowText, firstLevel, stripBbcodeTags, type FeatureDraft } from './classParse';
import type { ImportDescriptor, ImportContext } from './types';

// Mirrors ClassImageEditor's DEFAULT_DISPLAY (replicated to keep the import core
// free of component imports), same as the class importer.
const DEFAULT_DISPLAY = { x: 50, y: 50, scale: 1 };

const ABILITY_KEYS: Record<string, string> = {
  str: 'str', strength: 'str',
  dex: 'dex', dexterity: 'dex',
  con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int',
  wis: 'wis', wisdom: 'wis',
  cha: 'cha', charisma: 'cha',
};

// Light name normalize — strip bbcode + collapse whitespace, but DON'T force
// Title Case (subclass names carry small words: "College of Lore", "Path of the
// Berserker"). The class importer Title-Cases because class names are single
// words; subclass names aren't.
const cleanName = (raw: string): string =>
  String(raw || '').replace(/\[[^\]\n]*\]/g, '').replace(/\s+/g, ' ').trim();

// Collapse the blank-line gaps left when a middle span is peeled out of a block
// field, then reflow PDF-wrapped prose into paragraphs.
const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Build the SUBCLASS spellcasting JSON from a routed Spellcasting section. The
// shape mirrors SubclassEditor's `normalizeSubclassSpellcastingForSave` output
// (note: `progression` + `level: 3` default — distinct from the CLASS shape).
// We capture the text-derivable half; the progression / known-scaling tables
// stay manual (picked in the editor's dropdowns).
function buildSubclassSpellcastingConfig(d: FeatureDraft): any {
  const body = d.body || '';
  const abM = body.match(/([A-Za-z]+)\s+is\s+your\s+spellcasting\s+ability/i);
  const ability = (abM && ABILITY_KEYS[abM[1].toLowerCase()]) || 'int';
  const type = /prepare/i.test(body) ? 'prepared' : (/spells?\s+known|you know\b/i.test(body) ? 'known' : 'prepared');
  return {
    hasSpellcasting: true,
    description: body,
    level: (d.levels && d.levels[0]) || firstLevel(body) || 3,
    ability: ability.toUpperCase(),
    type,
    progression: 'none',
    progressionId: '',
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: '',
    isRitualCaster: /\brituals?\b/i.test(body),
  };
}

/** Route the Features-panel drafts → the subclass spellcasting config + the
 * child feature rows to write. A subclass has no ASI / nested-subclass choice,
 * so those kinds (if the auto-classifier ever emits them) fall back to plain
 * feature rows — nothing is dropped. Pure. */
function routeSubclassFeatures(drafts: FeatureDraft[]) {
  let spellcasting: any = null;
  const features: { name: string; level: number; body: string }[] = [];
  for (const d of Array.isArray(drafts) ? drafts : []) {
    if (d.kind === 'spellcasting') { spellcasting = buildSubclassSpellcastingConfig(d); }
    else if (d.kind === 'skip') { /* dropped */ }
    else features.push({ name: d.name, level: Number(d.level) || (d.levels && d.levels[0]) || 1, body: String(d.body || '') });
  }
  return { spellcasting, features };
}

export const subclazzDescriptor: ImportDescriptor = {
  type: 'subclass',
  label: 'Subclass',
  collection: 'subclasses',
  nameField: 'name',
  descriptionField: 'description',
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true, group: 'Identity', placeholder: 'Battle Master' },
    { key: 'identifier', label: 'Identifier', kind: 'text', group: 'Identity', placeholder: 'auto from name (slug)' },
    { key: 'classRef', label: 'Parent Class', kind: 'parentClass', required: true, default: { id: '', identifier: '', name: '' }, group: 'Identity', help: 'The class this subclass belongs to — its features inherit the parent’s progression. Required.' },
    { key: 'sourceId', label: 'Source', kind: 'source', group: 'Identity' },
    { key: 'description', label: 'Description', kind: 'markdown', group: 'Text', placeholder: 'A brief thematic overview (grid view)' },
    { key: 'preview', label: 'Preview blurb', kind: 'textarea', group: 'Text', placeholder: 'A short teaser for cards / hover previews' },
    { key: 'lore', label: 'Lore', kind: 'markdown', group: 'Text', placeholder: 'Flavour / setting details' },
    { key: '_features', label: 'Features', kind: 'features', default: [], group: 'Features', help: 'Parsed sections — tick several and Merge to fold them into one feature, edit names/levels, or re-route a row (feature / spellcasting / skip). Each “feature” row is created as a child feature of this subclass; a Spellcasting row feeds the subclass spellcasting config.' },
  ],

  buildPayload(f: Record<string, any>, ctx: ImportContext) {
    const now = ctx.now ?? new Date().toISOString();
    const name = cleanName(String(f.name ?? ''));
    const identifier = String(f.identifier ?? '').trim() || slugify(name);

    // Parent class — { id, identifier, name } from the picker. class_identifier
    // falls back to a slug of the class name (matches SubclassEditor's
    // `parentClass?.identifier || slugify(parentClass?.name || '')`).
    const classRef = (f.classRef && typeof f.classRef === 'object') ? f.classRef : {};
    const classId = String(classRef.id ?? '');
    const classIdentifier = String(classRef.identifier ?? '') || slugify(String(classRef.name ?? ''));

    // Features-panel routing → subclass spellcasting + child feature rows.
    const routed = routeSubclassFeatures(f._features);

    // Snake_case row — a faithful mirror of SubclassEditor.handleSave's `d1Data`.
    // Object/array values are JSON-stringified by upsertDocument. `advancements`
    // is `[]` (the editor synthesizes the canonical subclass progression on first
    // save); `spellcasting` is null unless a Spellcasting section was routed
    // (matches `normalizeSubclassSpellcastingForSave` returning null when off).
    return {
      name,
      identifier,
      class_identifier: classIdentifier,
      class_id: classId,
      source_id: f.sourceId || '',
      description: String(f.description ?? ''),
      preview: String(f.preview ?? ''),
      lore: String(f.lore ?? ''),
      image_url: '',
      image_display: DEFAULT_DISPLAY,
      card_image_url: '',
      card_display: DEFAULT_DISPLAY,
      preview_image_url: '',
      preview_display: DEFAULT_DISPLAY,
      tag_ids: [] as string[],
      excluded_option_ids: {} as Record<string, string[]>,
      advancements: [] as unknown[],
      spellcasting: routed.spellcasting,
      updated_at: now,
      // Carried to commit (NOT a `subclasses` column) — written as child feature rows.
      __features: routed.features,
    };
  },

  async commit(id: string, payload: Record<string, any>) {
    // Strip the carry-only `__features` before the subclass write — not a column.
    const { __features = [], ...subclassData } = payload;
    // The real write call — identical to SubclassEditor's admin direct-save
    // branch: generic upsert into `subclasses`, then the debounced rebake (which
    // rebuilds the PARENT class's bundle, since subclasses nest inside it).
    await upsertDocument('subclasses', id, subclassData);
    await queueRebake('subclass', id);
    // Child feature rows — through the editor's REAL `upsertFeature`
    // (normalizeFeatureData inside), parented to this SUBCLASS. Name + level +
    // description only; automation/activities stay for the editor.
    const now = subclassData.updated_at ?? new Date().toISOString();
    for (const feat of __features as { name: string; level: number; body: string }[]) {
      const featureName = stripBbcodeTags(String(feat.name ?? ''));
      if (!featureName) continue;
      const fid = crypto.randomUUID();
      await upsertFeature(fid, {
        name: featureName,
        identifier: slugify(featureName),
        parentId: id,
        parentType: 'subclass',
        featureType: 'class',
        level: Number(feat.level) || 1,
        description: String(feat.body ?? ''),
        createdAt: now,
        updatedAt: now,
      });
      await queueRebake('feature', fid);
    }
  },

  // Interpret a pasted subclass write-up → route its sections into the Features
  // panel. No identity stat block (it's all inherited from the parent class);
  // name + parent class are set in the form.
  parseText: parseSubclassText,

  // Mark-up / Paste-by-section: the subclass blocks. No Proficiencies / Equipment
  // / Multiclassing groups (those are class-only) — just Name, Description,
  // Flavour, and the Feature repeater.
  assignTargets: [
    { key: 'name', label: 'Name', fieldKeys: ['name'], group: 'Blocks' },
    { key: 'description', label: 'Description', fieldKeys: ['description'], group: 'Blocks' },
    { key: 'lore', label: 'Flavour', fieldKeys: ['lore'], group: 'Blocks' },
    { key: 'feature', label: 'Feature (＋ add)', fieldKeys: ['_features'], group: 'Blocks', mode: 'append' },
  ],

  assignField(target: string, text: string): Record<string, unknown> {
    const clean = String(text ?? '').trim();
    switch (target) {
      case 'name': { const n = cleanName(clean); return n ? { name: n } : {}; }
      case 'description': return clean ? { description: tidy(reflowText(clean)) } : {};
      case 'lore': return clean ? { lore: tidy(reflowText(clean)) } : {};
      default: return {};
    }
  },

  // "Feature" section mark: each selected span becomes ONE feature draft (first
  // line = name, rest = body, level sniffed). Mark span A then span B → two
  // separate features. Same pipeline as the class importer.
  assignAppend(target: string, text: string): Record<string, unknown> | null {
    if (target !== 'feature') return null;
    const d = parseFeatureSpan(text);
    if (!d.name) return null;
    return { id: crypto.randomUUID(), kind: d.kind, name: d.name, level: d.level, body: d.body };
  },

  // Bulk: paste ALL the feature text → one draft per heading (Spellcasting
  // auto-detected → the subclass spellcasting config). Fix up in the Features
  // panel (merge) or via the "Mark text" Feature mark.
  assignAppendMany(target: string, text: string): Record<string, unknown>[] {
    if (target !== 'feature') return [];
    return splitFeatures(text)
      .filter((d) => String(d.name || '').trim())
      .map((d) => ({ id: crypto.randomUUID(), kind: d.kind, name: d.name, level: d.level, levels: d.levels, body: d.body }));
  },
};
