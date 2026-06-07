// Class import descriptor — the second worked type (manual-entry skeleton).
//
// Named `clazz` to dodge the `class` reserved word.
//
// FIDELITY — unlike spells, classes have no dedicated `upsertSpell`-style
// wrapper. `ClassEditor.handleSave` builds the snake_case `d1Data` row INLINE
// and calls the GENERIC `upsertDocument('classes', id, d1Data)` (+ a debounced
// `queueRebake('class', id)`). So this descriptor's `buildPayload` is a faithful
// mirror of that `d1Data` object (snake_case column keys, the same JSON shapes),
// and `commit` makes the exact same two calls. A class created here is therefore
// byte-identical to one saved from the editor with the same field values.
//
// SCOPE (like spells skip activities) — the importer captures the class
// SKELETON: identity + simple/textual fields. It does NOT author the deep
// structure: the advancement tree, the armor/weapon/tool/skill/language
// proficiency grids, spellcasting config, features, or subclasses all stay in
// the class editor. Those slots are written as the same EMPTY-DEFAULT shapes a
// pristine new class saves (so the editor re-opens cleanly and downstream
// consumers — the R2 rebake, the character builder — see the expected shapes),
// and `advancements` is left `[]`: the editor synthesizes the canonical base
// (HP/saves/subclass/ASI) on first save or via "Initialize Base Advancements".
//
// Component guide + recipe: docs/architecture/import-system.md

import { upsertDocument } from '../d1';
import { upsertFeature } from '../compendium';
import { queueRebake } from '../moduleExport';
import { slugify } from '../utils';
import { sanitizeProficiencySelection } from '../proficiencySelection';
import { parseClassText, classifyHitDie, normalizeClassName, parseFeatureSpan, type FeatureDraft } from './classParse';
import type { ImportDescriptor, ImportContext, ImportFieldOption } from './types';

const toOptions = (pairs: [string, string][]): ImportFieldOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

// d6 / d8 / d10 / d12 — the only valid 5e class hit dice.
const HIT_DIE_OPTIONS = toOptions([
  ['6', 'd6'], ['8', 'd8'], ['10', 'd10'], ['12', 'd12'],
]);
// Matches ClassEditor's `category` union ('core' | 'alternate' | 'new').
const CATEGORY_OPTIONS = toOptions([
  ['core', 'Core'], ['alternate', 'Alternate'], ['new', 'New'],
]);

const asNum = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Free-text → canonical 3-letter ability keys. Accepts full names or
// abbreviations, separated by comma / slash / ampersand / "and" / "or"
// ("Strength or Dexterity", "CON, CHA"). De-duped, order-preserving.
const ABILITY_KEYS: Record<string, string> = {
  str: 'str', strength: 'str',
  dex: 'dex', dexterity: 'dex',
  con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int',
  wis: 'wis', wisdom: 'wis',
  cha: 'cha', charisma: 'cha',
};
function parseAbilities(text: unknown): string[] {
  return Array.from(new Set(
    String(text ?? '')
      .split(/[,/&]|\bor\b|\band\b/i)
      .map((part) => ABILITY_KEYS[part.trim().toLowerCase()])
      .filter(Boolean),
  ));
}

// 3-letter ability key → full name, for the saving-throw / primary-ability TEXT
// fields (which display "Constitution, Intelligence").
const ABILITY_FULL: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
const abilitiesToNames = (text: unknown): string =>
  parseAbilities(text).map((c) => ABILITY_FULL[c]).filter(Boolean).join(', ');
// Drop a leading "Label:" prefix from a marked selection ("Saving Throws: …").
const stripLeadingLabel = (text: string): string =>
  String(text || '').replace(/^\s*(?:saving throws?|hit (?:dice|points)|armou?r|weapons?|tools?|skills?|languages?|equipment|primary abilit(?:y|ies))\b\s*:?\s*/i, '').trim();

// Sanitize a (possibly partial) proficiency collection into the EXACT shape
// ClassEditor's `sanitizeProficiencyCollection` produces — byte-identical, so an
// imported row matches a hand save. `raw` is the grid's value (empty for a fresh
// class or for multiclass profs); `savingThrowIds` (from the saves text field)
// win for the savingThrows section, which the grid doesn't render — the editor
// keeps the top-level `saving_throws` column and this list in sync.
function buildProficiencyCollection(raw: any = {}, savingThrowIds: string[] = []) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const saves = savingThrowIds.length ? savingThrowIds : (r.savingThrows?.fixedIds ?? []);
  return {
    armor: sanitizeProficiencySelection(r.armor, { includeCategories: true }),
    weapons: sanitizeProficiencySelection(r.weapons, { includeCategories: true, includeWeaponTypeFilters: true }),
    tools: sanitizeProficiencySelection(r.tools, { includeCategories: true }),
    skills: sanitizeProficiencySelection(r.skills, { includeCategories: false }),
    savingThrows: sanitizeProficiencySelection({ fixedIds: saves }, { uppercase: true, includeCategories: false }),
    languages: sanitizeProficiencySelection(r.languages, { includeCategories: true }),
    armorDisplayName: String(r.armorDisplayName || ''),
    weaponsDisplayName: String(r.weaponsDisplayName || ''),
    toolsDisplayName: String(r.toolsDisplayName || ''),
    skillsDisplayName: String(r.skillsDisplayName || ''),
  };
}

// Mirrors ClassImageEditor's DEFAULT_DISPLAY (replicated to keep the import core
// free of component imports).
const DEFAULT_DISPLAY = { x: 50, y: 50, scale: 1 };

// Build the class `spellcasting` JSON from a parsed Spellcasting section. The
// simple half is text-derivable; the slot/known scaling tables stay manual
// (empty ids — picked in the editor).
function buildSpellcastingConfig(d: FeatureDraft, primaryCode?: string) {
  const body = d.body || '';
  const abM = body.match(/([A-Za-z]+)\s+is\s+your\s+spellcasting\s+ability/i);
  const ability = (abM && ABILITY_KEYS[abM[1].toLowerCase()]) || primaryCode || 'int';
  const type = /spells?\s+known|you know\b/i.test(body) ? 'known' : (/prepare/i.test(body) ? 'prepared' : 'known');
  return {
    hasSpellcasting: true,
    isRitualCaster: /\brituals?\b/i.test(body),
    description: body,
    level: 1,
    ability: ability.toUpperCase(),
    type,
    progressionId: '',
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: '',
    startingSpellbookCount: 0,
    spellbookAdditionsPerLevel: 0,
  };
}

/** Route the Features-panel drafts into class-field overrides + the child
 * feature rows to write. Pure. */
function routeFeatures(drafts: FeatureDraft[], primaryCode?: string) {
  let asiLevels: number[] | null = null;
  let subclassTitle: string | null = null;
  let subclassLevels: number[] | null = null;
  let spellcasting: any = null;
  const features: { name: string; level: number; body: string }[] = [];
  for (const d of Array.isArray(drafts) ? drafts : []) {
    if (d.kind === 'asi') { if (d.levels?.length) asiLevels = d.levels; }
    else if (d.kind === 'subclass') { subclassTitle = d.name || subclassTitle; subclassLevels = d.levels || []; }
    else if (d.kind === 'spellcasting') { spellcasting = buildSpellcastingConfig(d, primaryCode); }
    else if (d.kind === 'feature') { features.push({ name: d.name, level: Number(d.level) || 1, body: String(d.body || '') }); }
    // 'skip' → dropped
  }
  return { asiLevels, subclassTitle, subclassLevels, spellcasting, features };
}

export const clazzDescriptor: ImportDescriptor = {
  type: 'class',
  label: 'Class',
  collection: 'classes',
  nameField: 'name',
  descriptionField: 'description',
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true, group: 'Identity', placeholder: 'Sorcerer' },
    { key: 'identifier', label: 'Identifier', kind: 'text', group: 'Identity', placeholder: 'auto from name (slug)' },
    { key: 'sourceId', label: 'Source', kind: 'source', group: 'Identity' },
    { key: 'category', label: 'Category', kind: 'select', default: 'core', options: CATEGORY_OPTIONS, group: 'Identity' },
    { key: 'hitDie', label: 'Hit Die', kind: 'select', default: '8', options: HIT_DIE_OPTIONS, group: 'Mechanics' },
    { key: 'primaryAbility', label: 'Primary Ability', kind: 'text', group: 'Mechanics', placeholder: 'Charisma — or "Strength or Dexterity"', help: 'Full names or abbreviations; "or"/"and"/commas accepted.' },
    { key: 'savingThrows', label: 'Saving Throw Proficiencies', kind: 'text', group: 'Mechanics', placeholder: 'Constitution, Charisma', help: 'The two save proficiencies the class grants at level 1.' },
    { key: 'proficiencies', label: 'Proficiencies', kind: 'proficiencies', group: 'Proficiencies', default: buildProficiencyCollection(), proficiencyTypes: ['armor', 'weapons', 'skills', 'tools', 'languages'], help: 'Armor / weapons / tools / skills / languages — authored through the same grid as the class editor. (Saving throws are set above.) Tweak freely.' },
    { key: 'description', label: 'Description', kind: 'textarea', group: 'Text', placeholder: 'BBCode — the class overview' },
    { key: 'preview', label: 'Preview blurb', kind: 'textarea', group: 'Text', placeholder: 'A short one-liner for cards/listings' },
    { key: 'lore', label: 'Lore', kind: 'textarea', group: 'Text', placeholder: 'BBCode — flavour / in-world lore' },
    { key: 'startingEquipment', label: 'Starting Equipment', kind: 'textarea', group: 'Details', placeholder: 'BBCode — starting gear' },
    { key: 'wealth', label: 'Starting Wealth', kind: 'text', group: 'Details', placeholder: 'e.g. 3d4 × 10 gp' },
    { key: 'multiclassing', label: 'Multiclassing', kind: 'textarea', group: 'Details', placeholder: 'BBCode — multiclass prerequisites & proficiencies' },
    { key: 'subclassTitle', label: 'Subclass Title', kind: 'text', default: 'Subclass', group: 'Details', placeholder: 'e.g. Sorcerous Origin' },
    { key: '_features', label: 'Features', kind: 'features', default: [], group: 'Features', help: 'Parsed sections — tick several and Merge to fold them into one feature, edit names/levels, or re-route a row (feature / spellcasting / ASI / subclass / skip). Each “feature” row is created as a child feature; spellcasting/ASI/subclass feed the class fields.' },
  ],

  buildPayload(f: Record<string, any>, ctx: ImportContext) {
    const now = ctx.now ?? new Date().toISOString();
    const name = String(f.name ?? '').trim();
    const identifier = String(f.identifier ?? '').trim() || slugify(name);

    // primary_ability is stored lowercase; saving throws uppercase (the editor's
    // `normalizePrimaryAbilityListForSave` / sanitized savingThrows convention).
    const primaryAbility = parseAbilities(f.primaryAbility);
    const savingThrows = parseAbilities(f.savingThrows).map((a) => a.toUpperCase());

    // Features-panel routing → class-field overrides + child feature rows.
    const routed = routeFeatures(f._features, primaryAbility[0]);

    // Snake_case row — a faithful mirror of ClassEditor.handleSave's `d1Data`.
    // Object/array values are JSON-stringified by upsertDocument. `created_at`
    // is intentionally omitted (DB CURRENT_TIMESTAMP default, same as the editor
    // which never sends it). The empty-default structures below are the
    // un-authored slots (proficiencies grids, advancement tree, spellcasting,
    // images) — authored later in the class editor.
    return {
      name,
      identifier,
      preview: String(f.preview ?? ''),
      description: String(f.description ?? ''),
      lore: String(f.lore ?? ''),
      source_id: f.sourceId || '',
      category: String(f.category ?? 'core'),
      hit_die: asNum(f.hitDie, 8),
      saving_throws: savingThrows,
      proficiencies: buildProficiencyCollection(f.proficiencies, savingThrows),
      starting_equipment: String(f.startingEquipment ?? ''),
      primary_ability: primaryAbility,
      primary_ability_choice: [] as string[],
      wealth: String(f.wealth ?? ''),
      multiclassing: String(f.multiclassing ?? ''),
      multiclass_proficiencies: buildProficiencyCollection(),
      excluded_option_ids: {} as Record<string, string[]>,
      tag_ids: [] as string[],
      subclass_title: routed.subclassTitle || (String(f.subclassTitle ?? 'Subclass') || 'Subclass'),
      subclass_feature_levels: routed.subclassLevels ?? ([] as number[]),
      asi_levels: routed.asiLevels ?? [4, 8, 12, 16, 19],
      advancements: [] as unknown[],
      image_url: f.imageUrl || '',
      image_display: DEFAULT_DISPLAY,
      card_image_url: '',
      card_display: DEFAULT_DISPLAY,
      preview_image_url: '',
      preview_display: DEFAULT_DISPLAY,
      spellcasting: routed.spellcasting,
      updated_at: now,
      // Carried to commit (NOT a `classes` column) — written as child feature rows.
      __features: routed.features,
    };
  },

  async commit(id: string, payload: Record<string, any>) {
    // Strip the carry-only `__features` before the class write — it is not a
    // `classes` column.
    const { __features = [], ...classData } = payload;
    // The real write call — identical to ClassEditor's admin direct-save branch:
    // generic upsert into `classes`, then schedule the debounced R2 rebake.
    await upsertDocument('classes', id, classData);
    await queueRebake('class', id);
    // Child feature rows — through the editor's REAL `upsertFeature`
    // (normalizeFeatureData inside), parented to this class. Name + level +
    // description only; automation/activities stay for the editor.
    const now = classData.updated_at ?? new Date().toISOString();
    for (const feat of __features as { name: string; level: number; body: string }[]) {
      const featureName = String(feat.name ?? '').trim();
      if (!featureName) continue;
      const fid = crypto.randomUUID();
      await upsertFeature(fid, {
        name: featureName,
        identifier: slugify(featureName),
        parentId: id,
        parentType: 'class',
        featureType: 'class',
        level: Number(feat.level) || 1,
        description: String(feat.body ?? ''),
        createdAt: now,
        updatedAt: now,
      });
      await queueRebake('feature', fid);
    }
  },

  // Interpret a pasted class write-up into the identity fields (name, hit die,
  // saving throws, equipment, + a primary-ability hint). Proficiency lines and a
  // parsed-feature summary are surfaced as review NOTES; the features themselves
  // are organized in the workspace's features panel. No automation is parsed.
  parseText: parseClassText,

  // Mark-up panel: select any span of the pasted write-up and assign it to a
  // field. Block fields (description/lore/equipment/multiclassing) ACCUMULATE
  // across selections (several flavour blocks all feed Lore); atomic fields
  // replace. Assigning a span also DECOUPLES it from whatever field held it (the
  // window re-derives the loser from what's left) — so "this paragraph is Lore,
  // not the overview" is one click.
  assignTargets: [
    { key: 'name', label: 'Name', fieldKeys: ['name'] },
    { key: 'hitDie', label: 'Hit Die', fieldKeys: ['hitDie'] },
    { key: 'savingThrows', label: 'Saving Throws', fieldKeys: ['savingThrows'] },
    { key: 'primaryAbility', label: 'Primary Ability', fieldKeys: ['primaryAbility'] },
    { key: 'description', label: 'Description', fieldKeys: ['description'] },
    { key: 'lore', label: 'Lore / Flavour', fieldKeys: ['lore'] },
    { key: 'startingEquipment', label: 'Equipment', fieldKeys: ['startingEquipment'] },
    { key: 'multiclassing', label: 'Multiclassing', fieldKeys: ['multiclassing'] },
    { key: 'feature', label: 'Feature (＋ add)', fieldKeys: ['_features'], mode: 'append' },
  ],

  assignField(target: string, text: string): Record<string, unknown> {
    const clean = String(text ?? '').trim();
    // Collapse the blank-line gaps left when a middle span is peeled out of a
    // block field (the window joins the remaining pieces with newlines).
    const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    switch (target) {
      case 'name': return clean ? { name: normalizeClassName(clean) } : {};
      case 'hitDie': { const n = classifyHitDie(clean); return n != null ? { hitDie: String(n) } : {}; }
      case 'savingThrows': { const s = abilitiesToNames(stripLeadingLabel(clean)); return s ? { savingThrows: s } : {}; }
      case 'primaryAbility': { const s = abilitiesToNames(stripLeadingLabel(clean)); return clean ? { primaryAbility: s || stripLeadingLabel(clean) } : {}; }
      case 'description': return clean ? { description: tidy(clean) } : {};
      case 'lore': return clean ? { lore: tidy(clean) } : {};
      case 'startingEquipment': { const s = stripLeadingLabel(clean); return s ? { startingEquipment: tidy(s) } : {}; }
      case 'multiclassing': return clean ? { multiclassing: tidy(clean) } : {};
      default: return {};
    }
  },

  // "Feature" section mark: each selected span becomes ONE feature draft appended
  // to the Features panel (first line = name, rest = body, level sniffed). Mark
  // span A then span B → two separate features.
  assignAppend(target: string, text: string): Record<string, unknown> | null {
    if (target !== 'feature') return null;
    const d = parseFeatureSpan(text);
    if (!d.name) return null;
    return { id: crypto.randomUUID(), kind: d.kind, name: d.name, level: d.level, body: d.body };
  },
};
