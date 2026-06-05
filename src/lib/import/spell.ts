// Spell import descriptor — the proof-of-concept type.
//
// `buildPayload` is a faithful mirror of `SpellsEditor.handleSave` (the payload
// it hands to `upsertSpell`): the same camelCase form shape, the same
// `automation`/`foundry_data` assembly, and the same identifier idiom. `commit`
// then calls the REAL `upsertSpell`, so a spell created here is byte-identical
// to one saved from the editor — including the materialized filter-bucket
// columns that `prepareSpellPayloadForWrite` derives from `foundry_data`.

import { upsertSpell } from '../compendium';
import { slugify } from '../utils';
import { bbcodeToHtml } from '../bbcode';
import { SCHOOL_LABELS } from '../spellImport';
import {
  parseSpellText,
  splitSpellBlocks,
  normalizeSpellName,
  reflowDescription,
  classifyLevel,
  classifySchool,
  classifyCastingTime,
  classifyRange,
  classifyComponents,
  classifyDuration,
} from './spellParse';
import type { ImportDescriptor, ImportContext, ImportFieldOption } from './types';

const toOptions = (pairs: [string, string][]): ImportFieldOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

// School options reuse the canonical abbreviation→label map (abj/con/…/trs).
const SCHOOL_OPTIONS: ImportFieldOption[] = Object.entries(SCHOOL_LABELS).map(
  ([value, label]) => ({ value, label: String(label) }),
);

// These mirror SpellsEditor's ACTIVATION_TYPES / RANGE_UNITS / DURATION_UNITS so
// the coded values feed `computeSpellBuckets` correctly.
const ACTIVATION_OPTIONS = toOptions([
  ['action', 'Action'], ['bonus', 'Bonus Action'], ['reaction', 'Reaction'],
  ['minute', 'Minute(s)'], ['hour', 'Hour(s)'], ['special', 'Special'],
]);
const RANGE_OPTIONS = toOptions([
  ['self', 'Self'], ['touch', 'Touch'], ['ft', 'Feet'],
  ['mi', 'Miles'], ['spec', 'Special'], ['any', 'Unlimited'],
]);
const DURATION_OPTIONS = toOptions([
  ['inst', 'Instantaneous'], ['round', 'Round(s)'], ['minute', 'Minute(s)'],
  ['hour', 'Hour(s)'], ['day', 'Day(s)'], ['perm', 'Permanent'], ['spec', 'Special'],
]);
const LEVEL_OPTIONS = toOptions(
  ['0 (Cantrip)', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(
    (l, i) => [String(i), l] as [string, string],
  ),
);

const asNum = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const asBool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

export const spellDescriptor: ImportDescriptor = {
  type: 'spell',
  label: 'Spell',
  collection: 'spells',
  nameField: 'name',
  descriptionField: 'description',
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true, group: 'Identity', placeholder: 'Bramble Snare' },
    { key: 'identifier', label: 'Identifier', kind: 'text', group: 'Identity', placeholder: 'auto from name (slug)' },
    { key: 'sourceId', label: 'Source', kind: 'source', group: 'Identity' },
    { key: 'level', label: 'Level', kind: 'select', default: '0', options: LEVEL_OPTIONS, group: 'Mechanics' },
    { key: 'school', label: 'School', kind: 'select', default: 'evo', options: SCHOOL_OPTIONS, group: 'Mechanics' },
    { key: 'ritual', label: 'Ritual', kind: 'boolean', default: false, group: 'Mechanics' },
    { key: 'concentration', label: 'Concentration', kind: 'boolean', default: false, group: 'Mechanics' },
    { key: 'componentsVocal', label: 'Verbal (V)', kind: 'boolean', default: true, group: 'Components' },
    { key: 'componentsSomatic', label: 'Somatic (S)', kind: 'boolean', default: true, group: 'Components' },
    { key: 'componentsMaterial', label: 'Material (M)', kind: 'boolean', default: false, group: 'Components' },
    { key: 'componentsMaterialText', label: 'Material text', kind: 'text', group: 'Components', placeholder: 'a sprig of bramble' },
    { key: 'activationType', label: 'Casting time', kind: 'select', default: 'action', options: ACTIVATION_OPTIONS, group: 'Casting' },
    { key: 'activationValue', label: 'Casting time value', kind: 'number', default: 1, group: 'Casting', help: 'e.g. 1 action, 10 minutes' },
    { key: 'rangeUnits', label: 'Range', kind: 'select', default: 'self', options: RANGE_OPTIONS, group: 'Casting' },
    { key: 'rangeValue', label: 'Range value', kind: 'number', default: 0, group: 'Casting', help: 'feet/miles when applicable' },
    { key: 'durationUnits', label: 'Duration', kind: 'select', default: 'inst', options: DURATION_OPTIONS, group: 'Casting' },
    { key: 'durationValue', label: 'Duration value', kind: 'number', default: 0, group: 'Casting', help: 'e.g. 1 minute, 8 hours' },
    { key: 'description', label: 'Description', kind: 'textarea', group: 'Text', placeholder: 'BBCode — the spell text' },
  ],

  buildPayload(f: Record<string, any>, ctx: ImportContext) {
    const now = ctx.now ?? new Date().toISOString();
    const name = String(f.name ?? '').trim();
    const identifier = String(f.identifier ?? '').trim() || slugify(name);
    const description = String(f.description ?? '');

    // Reassemble the nested form shapes SpellsEditor keeps in state.
    const components = {
      vocal: asBool(f.componentsVocal ?? true),
      somatic: asBool(f.componentsSomatic ?? true),
      material: asBool(f.componentsMaterial ?? false),
      materialText: String(f.componentsMaterialText ?? ''),
      consumed: false,
      cost: '',
    };
    const activation = { type: String(f.activationType ?? 'action'), value: asNum(f.activationValue, 1), condition: '' };
    const range = { value: asNum(f.rangeValue, 0), long: '', units: String(f.rangeUnits ?? 'self'), special: '' };
    const duration = { value: asNum(f.durationValue, 0), units: String(f.durationUnits ?? 'inst') };
    const target = {
      template: { type: '', size: '', width: '', height: '', units: 'ft' },
      affects: { type: '', count: '', choice: false, special: '' },
    };

    // Mirror SpellsEditor's `mergedFoundryData` (existingSystem is {} on create).
    // The four filter-bucket columns are derived from this by upsertSpell →
    // prepareSpellPayloadForWrite → computeSpellBuckets.
    const foundry_data = {
      description: { value: bbcodeToHtml(description) },
      activation,
      range,
      duration,
      target,
      uses: { max: '', recovery: [] as unknown[] },
    };

    // Mirror SpellsEditor's `payload` (post-fold): camelCase form keys + the
    // augmentations. `automation` is unwrapped to activities/effects and
    // `status`/`type`/`sourceType` are stripped by normalizeCompendiumData.
    return {
      name,
      identifier,
      sourceId: f.sourceId || '',
      imageUrl: f.imageUrl || '',
      description,
      level: asNum(f.level, 0),
      school: String(f.school ?? 'evo'),
      preparationMode: String(f.preparationMode ?? 'spell'),
      ritual: asBool(f.ritual),
      concentration: asBool(f.concentration),
      components,
      tags: Array.isArray(f.tags) ? f.tags : [],
      requiredTags: [],
      prerequisiteText: '',
      automation: { activities: [], effects: [] },
      status: 'development',
      sourceType: 'spell',
      type: 'spell',
      foundry_data,
      createdAt: now,
      updatedAt: now,
    };
  },

  async commit(id: string, payload: Record<string, any>) {
    // The real write call — identical to SpellsEditor's direct-save branch.
    await upsertSpell(id, payload);
  },

  // Interpret a pasted 5e stat block into these fields (activities stay manual).
  parseText: parseSpellText,

  // Split a multi-spell paste into per-spell blocks (batch import).
  splitBlocks: splitSpellBlocks,

  // Mark-up panel: which targets a selected span can be re-assigned to, and how
  // each ingests the text. Every target re-runs the SAME classifier the parser
  // uses, so a manual re-assignment is as smart as the first pass.
  assignTargets: [
    { key: 'name', label: 'Name', fieldKeys: ['name'] },
    { key: 'level', label: 'Level', fieldKeys: ['level'] },
    { key: 'school', label: 'School', fieldKeys: ['school'] },
    { key: 'castingTime', label: 'Casting Time', fieldKeys: ['activationType', 'activationValue'] },
    { key: 'range', label: 'Range', fieldKeys: ['rangeUnits', 'rangeValue'] },
    { key: 'components', label: 'Components', fieldKeys: ['componentsVocal', 'componentsSomatic', 'componentsMaterial', 'componentsMaterialText'] },
    { key: 'duration', label: 'Duration', fieldKeys: ['durationUnits', 'durationValue', 'concentration'] },
    { key: 'description', label: 'Description', fieldKeys: ['description'] },
  ],

  assignField(target: string, text: string): Record<string, unknown> {
    switch (target) {
      case 'name':
        return { name: normalizeSpellName(text) };
      case 'description':
        return { description: reflowDescription(text) };
      case 'level': {
        const lvl = classifyLevel(text);
        return lvl != null ? { level: lvl } : {};
      }
      case 'school': {
        const school = classifySchool(text);
        return school ? { school } : {};
      }
      case 'castingTime': {
        const c = classifyCastingTime(text);
        return { activationType: c.type, activationValue: c.value };
      }
      case 'range': {
        const r = classifyRange(text);
        return { rangeUnits: r.units, rangeValue: r.value };
      }
      case 'components': {
        const c = classifyComponents(text);
        return {
          componentsVocal: c.v,
          componentsSomatic: c.s,
          componentsMaterial: c.m,
          componentsMaterialText: c.materialText,
        };
      }
      case 'duration': {
        const d = classifyDuration(text);
        return { durationUnits: d.units, durationValue: d.value, concentration: d.concentration };
      }
      default:
        return {};
    }
  },
};
