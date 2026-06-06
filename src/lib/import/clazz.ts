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
import { queueRebake } from '../moduleExport';
import { slugify } from '../utils';
import { sanitizeProficiencySelection } from '../proficiencySelection';
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

// The empty, sanitized proficiency collection a brand-new class saves — byte
// for byte the output of ClassEditor's `sanitizeProficiencyCollection({})`,
// with the captured saving throws seeded into `savingThrows.fixedIds` (the
// editor keeps the top-level `saving_throws` column and this list in sync).
function emptyProficiencyCollection(savingThrowIds: string[] = []) {
  return {
    armor: sanitizeProficiencySelection({}, { includeCategories: true }),
    weapons: sanitizeProficiencySelection({}, { includeCategories: true, includeWeaponTypeFilters: true }),
    tools: sanitizeProficiencySelection({}, { includeCategories: true }),
    skills: sanitizeProficiencySelection({}, { includeCategories: false }),
    savingThrows: sanitizeProficiencySelection({ fixedIds: savingThrowIds }, { uppercase: true, includeCategories: false }),
    languages: sanitizeProficiencySelection({}, { includeCategories: true }),
    armorDisplayName: '',
    weaponsDisplayName: '',
    toolsDisplayName: '',
    skillsDisplayName: '',
  };
}

// Mirrors ClassImageEditor's DEFAULT_DISPLAY (replicated to keep the import core
// free of component imports).
const DEFAULT_DISPLAY = { x: 50, y: 50, scale: 1 };

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
    { key: 'description', label: 'Description', kind: 'textarea', group: 'Text', placeholder: 'BBCode — the class overview' },
    { key: 'preview', label: 'Preview blurb', kind: 'textarea', group: 'Text', placeholder: 'A short one-liner for cards/listings' },
    { key: 'lore', label: 'Lore', kind: 'textarea', group: 'Text', placeholder: 'BBCode — flavour / in-world lore' },
    { key: 'startingEquipment', label: 'Starting Equipment', kind: 'textarea', group: 'Details', placeholder: 'BBCode — starting gear' },
    { key: 'wealth', label: 'Starting Wealth', kind: 'text', group: 'Details', placeholder: 'e.g. 3d4 × 10 gp' },
    { key: 'multiclassing', label: 'Multiclassing', kind: 'textarea', group: 'Details', placeholder: 'BBCode — multiclass prerequisites & proficiencies' },
    { key: 'subclassTitle', label: 'Subclass Title', kind: 'text', default: 'Subclass', group: 'Details', placeholder: 'e.g. Sorcerous Origin' },
  ],

  buildPayload(f: Record<string, any>, ctx: ImportContext) {
    const now = ctx.now ?? new Date().toISOString();
    const name = String(f.name ?? '').trim();
    const identifier = String(f.identifier ?? '').trim() || slugify(name);

    // primary_ability is stored lowercase; saving throws uppercase (the editor's
    // `normalizePrimaryAbilityListForSave` / sanitized savingThrows convention).
    const primaryAbility = parseAbilities(f.primaryAbility);
    const savingThrows = parseAbilities(f.savingThrows).map((a) => a.toUpperCase());

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
      proficiencies: emptyProficiencyCollection(savingThrows),
      starting_equipment: String(f.startingEquipment ?? ''),
      primary_ability: primaryAbility,
      primary_ability_choice: [] as string[],
      wealth: String(f.wealth ?? ''),
      multiclassing: String(f.multiclassing ?? ''),
      multiclass_proficiencies: emptyProficiencyCollection(),
      excluded_option_ids: {} as Record<string, string[]>,
      tag_ids: [] as string[],
      subclass_title: String(f.subclassTitle ?? 'Subclass') || 'Subclass',
      subclass_feature_levels: [] as number[],
      asi_levels: [4, 8, 12, 16, 19],
      advancements: [] as unknown[],
      image_url: f.imageUrl || '',
      image_display: DEFAULT_DISPLAY,
      card_image_url: '',
      card_display: DEFAULT_DISPLAY,
      preview_image_url: '',
      preview_display: DEFAULT_DISPLAY,
      spellcasting: null,
      updated_at: now,
    };
  },

  async commit(id: string, payload: Record<string, any>) {
    // The real write call — identical to ClassEditor's admin direct-save branch:
    // generic upsert into `classes`, then schedule the debounced R2 rebake.
    await upsertDocument('classes', id, payload);
    await queueRebake('class', id);
  },

  // No `parseText` / `assignTargets` / `splitBlocks` yet — the class importer is
  // manual-entry for now (the window gracefully hides the Interpret panel,
  // select-to-assign, and batch division for parser-less types). A
  // `classParse.ts` can be added later to interpret pasted class text; see the
  // recipe in docs/architecture/import-system.md.
};
