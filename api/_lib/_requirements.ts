// =============================================================================
// SERVER COPY of src/lib/requirements.ts — the type definitions and
// formatRequirementText() are needed inside `_classExport.ts` so the Vercel
// `/api/module/<class>.json` endpoint can serialize requirement trees onto
// exported option items without crossing the folder boundary into
// `src/lib/`. See project_vercel_module_endpoint.md.
//
// Differences from the client copy:
//   - Drops the editor factory helpers (emptyGroup / emptyLeaf) — those are
//     only used by `<RequirementsEditor>`.
//   - Adds `remapRequirementTree` — used by the exporter to translate PK
//     references in leaves (e.g. optionItem.itemId is an editor PK) into
//     the canonical source-id strings the module consumes.
//
// DRIFT WARNING: this file mirrors `src/lib/requirements.ts`. When you
// touch the Requirement shape, the leaf vocabulary, the JSON parse rules,
// or the format-to-text logic, update both files.
// =============================================================================

export type RequirementLeafType =
  | 'levelInClass'
  | 'class'
  | 'subclass'
  | 'optionItem'
  | 'feature'
  | 'spell'
  | 'spellRule'
  | 'abilityScore'
  | 'proficiency'
  | 'level';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ProficiencyKind = 'weapon' | 'armor' | 'tool' | 'skill' | 'language';

export interface RequirementLeafByType {
  levelInClass: { classId: string; minLevel: number };
  class: { classId: string };
  subclass: { subclassId: string };
  optionItem: { itemId: string; groupId?: string };
  feature: { featureId: string };
  spell: { spellId: string };
  spellRule: { spellRuleId: string };
  abilityScore: { ability: AbilityKey; min: number };
  proficiency: { category: ProficiencyKind; identifier: string };
  level: { minLevel: number; isTotal: boolean };
}

export type RequirementLeaf = {
  [K in RequirementLeafType]: { kind: 'leaf'; type: K } & RequirementLeafByType[K];
}[RequirementLeafType];

export type RequirementGroupKind = 'all' | 'any' | 'one';

export interface RequirementGroup {
  kind: RequirementGroupKind;
  children: Requirement[];
}

export type Requirement = RequirementGroup | RequirementLeaf;

export function isGroup(req: Requirement): req is RequirementGroup {
  return req.kind === 'all' || req.kind === 'any' || req.kind === 'one';
}

export function isLeaf(req: Requirement): req is RequirementLeaf {
  return req.kind === 'leaf';
}

export function parseRequirementTree(raw: unknown): Requirement | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return normalizeRequirement(raw as any);
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeRequirement(parsed);
  } catch {
    return null;
  }
}

function normalizeRequirement(input: any): Requirement | null {
  if (!input || typeof input !== 'object') return null;
  if (input.kind === 'leaf') {
    if (typeof input.type !== 'string') return null;
    if (!isKnownLeafType(input.type)) return null;
    return input as RequirementLeaf;
  }
  if (input.kind === 'all' || input.kind === 'any' || input.kind === 'one') {
    const children = Array.isArray(input.children) ? input.children : [];
    return {
      kind: input.kind,
      children: children.map(normalizeRequirement).filter(Boolean) as Requirement[],
    };
  }
  return null;
}

function isKnownLeafType(s: string): s is RequirementLeafType {
  return [
    'levelInClass', 'class', 'subclass', 'optionItem',
    'feature', 'spell', 'spellRule',
    'abilityScore', 'proficiency', 'level',
  ].includes(s);
}

export interface RequirementFormatLookup {
  classNameById?: Record<string, string>;
  subclassNameById?: Record<string, string>;
  optionItemNameById?: Record<string, string>;
  featureNameById?: Record<string, string>;
  spellNameById?: Record<string, string>;
  spellRuleNameById?: Record<string, string>;
}

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const PROFICIENCY_LABEL: Record<ProficiencyKind, string> = {
  weapon: 'Weapon proficiency', armor: 'Armor proficiency',
  tool: 'Tool proficiency', skill: 'Skill proficiency', language: 'Language',
};

function formatLeaf(leaf: RequirementLeaf, lookup: RequirementFormatLookup): string {
  switch (leaf.type) {
    case 'level':
      return leaf.isTotal
        ? `Level ${leaf.minLevel}+ (character level)`
        : `Level ${leaf.minLevel}+`;
    case 'levelInClass': {
      const name = lookup.classNameById?.[leaf.classId] ?? '<unknown class>';
      return `${name} ${leaf.minLevel}+`;
    }
    case 'class':
      return lookup.classNameById?.[leaf.classId] ?? '<unknown class>';
    case 'subclass':
      return lookup.subclassNameById?.[leaf.subclassId] ?? '<unknown subclass>';
    case 'optionItem':
      return lookup.optionItemNameById?.[leaf.itemId] ?? '<unknown option>';
    case 'feature':
      return lookup.featureNameById?.[leaf.featureId] ?? '<unknown feature>';
    case 'spell':
      return `Knows ${lookup.spellNameById?.[leaf.spellId] ?? '<unknown spell>'}`;
    case 'spellRule':
      return `Knows a spell matching “${lookup.spellRuleNameById?.[leaf.spellRuleId] ?? '<unknown spell rule>'}”`;
    case 'abilityScore':
      return `${ABILITY_LABEL[leaf.ability]} ${leaf.min} or higher`;
    case 'proficiency':
      return `${PROFICIENCY_LABEL[leaf.category]}: ${leaf.identifier}`;
  }
}

export function formatRequirementText(
  tree: Requirement | null | undefined,
  lookup: RequirementFormatLookup = {},
  _nested = false,
): string {
  if (!tree) return '';
  if (isLeaf(tree)) return formatLeaf(tree, lookup);

  const joinerByKind: Record<RequirementGroupKind, string> = {
    all: ' and ', any: ' or ', one: ' xor ',
  };
  const labelByKind: Record<RequirementGroupKind, string> = {
    all: 'all of', any: 'any of', one: 'exactly one of',
  };

  const children = tree.children.filter(Boolean) as Requirement[];
  if (children.length === 0) return '';
  if (children.length === 1) return formatRequirementText(children[0], lookup, _nested);

  if (tree.kind === 'one' && children.length > 2) {
    const parts = children.map(c => formatRequirementText(c, lookup, true));
    return `${labelByKind.one} (${parts.join(', ')})`;
  }

  const parts = children.map(c => formatRequirementText(c, lookup, true));
  const joined = parts.join(joinerByKind[tree.kind]);
  return _nested ? `(${joined})` : joined;
}

// ─── Server-only: PK → source-id remap ──────────────────────────────────
//
// The editor stores leaf references as PKs (e.g. `optionItem.itemId =
// '01HXR…'`). The module consumes canonical source-id strings instead
// (e.g. `'class-option-pact-of-the-blade'`). On export we walk the tree
// and rewrite the leaf refs in place.
//
// `idMaps` accepts one map per entity kind. Missing keys mean "no
// remap" — the leaf passes through unchanged. Unresolvable refs (a PK
// the editor used but that doesn't appear in the map) also pass through
// so the module-side display can show "<unknown option>" rather than
// silently dropping the leaf.

export interface RequirementIdMaps {
  optionItemSourceIdById?: Record<string, string>;
  classSourceIdById?: Record<string, string>;
  subclassSourceIdById?: Record<string, string>;
  featureSourceIdById?: Record<string, string>;
  spellSourceIdById?: Record<string, string>;
  spellRuleSourceIdById?: Record<string, string>;
}

export function remapRequirementTree(
  tree: Requirement | null | undefined,
  idMaps: RequirementIdMaps,
): Requirement | null {
  if (!tree) return null;
  if (isLeaf(tree)) return remapLeaf(tree, idMaps);
  return {
    kind: tree.kind,
    children: tree.children
      .map(c => remapRequirementTree(c, idMaps))
      .filter(Boolean) as Requirement[],
  };
}

function remapLeaf(leaf: RequirementLeaf, m: RequirementIdMaps): RequirementLeaf {
  switch (leaf.type) {
    case 'optionItem':
      return { ...leaf, itemId: m.optionItemSourceIdById?.[leaf.itemId] ?? leaf.itemId };
    case 'class':
      return { ...leaf, classId: m.classSourceIdById?.[leaf.classId] ?? leaf.classId };
    case 'levelInClass':
      return { ...leaf, classId: m.classSourceIdById?.[leaf.classId] ?? leaf.classId };
    case 'subclass':
      return { ...leaf, subclassId: m.subclassSourceIdById?.[leaf.subclassId] ?? leaf.subclassId };
    case 'feature':
      return { ...leaf, featureId: m.featureSourceIdById?.[leaf.featureId] ?? leaf.featureId };
    case 'spell':
      return { ...leaf, spellId: m.spellSourceIdById?.[leaf.spellId] ?? leaf.spellId };
    case 'spellRule':
      return { ...leaf, spellRuleId: m.spellRuleSourceIdById?.[leaf.spellRuleId] ?? leaf.spellRuleId };
    case 'abilityScore':
    case 'proficiency':
    case 'level':
      return leaf;
  }
}
