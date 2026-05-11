/**
 * Requirement trees describe compound prerequisites on option-group items
 * and feats. They replace the old flat `requires_option_ids` array (which
 * only modeled "must have picked all of these sibling options") with an
 * arbitrarily-nested boolean composition of typed leaves.
 *
 * The tree shape mirrors the case-block pattern used elsewhere in the
 * compendium (activities, effects) — every node is either a *group* that
 * combines children with And/Or/Xor semantics, or a *leaf* that asserts
 * one concrete fact about the character (class, level, picked option,
 * known spell, ability score, proficiency, etc.).
 *
 * Storage
 * -------
 * Serialized as JSON in the `requirements_tree` column on
 * `unique_option_items` and `feats`. `null` means "no compound
 * requirement" — flat columns like `level_prerequisite` and
 * `string_prerequisite` still carry their own gates alongside the tree.
 *
 * Foundry export
 * --------------
 * `formatRequirementText(tree)` produces a human-readable string used as
 * dnd5e's `system.requirements` on the embedded item. The module also
 * receives the structured tree so it can mark unmet requirements in the
 * option-picker dialog (see future importer pass).
 */

// ─── Leaves ──────────────────────────────────────────────────────────────

/**
 * The kind of fact a leaf asserts. New leaf types should be added here +
 * in `RequirementLeafByType` + in the `formatLeaf` switch in this file.
 */
export type RequirementLeafType =
  /** Character must have N levels in a specific class (e.g. Warlock 5). */
  | 'levelInClass'
  /** Character must have any levels in a specific class (subclass tag). */
  | 'class'
  /** Character must have a specific subclass (implies the parent class). */
  | 'subclass'
  /**
   * Character must have previously picked a specific option-group item in
   * this or a previous advancement (e.g. Pact of the Blade for invocations
   * gated on it). `groupId` is optional — the editor can resolve it from
   * the item — but exporting / module-side rendering may set it for
   * convenience.
   */
  | 'optionItem'
  /** Character must have a specific class feature already granted. */
  | 'feature'
  /** Character must know / have prepared a specific spell. */
  | 'spell'
  /**
   * Character must know any spell matching a Spell Rule. Useful for
   * "knows a 1st-level evocation" style gates without enumerating every
   * matching spell by id.
   */
  | 'spellRule'
  /** Character's ability score for a given ability is at least min. */
  | 'abilityScore'
  /**
   * Character has a specific proficiency. `category` narrows the surface
   * (weapon / armor / tool / skill / language) and `identifier` names it.
   * `identifier` is free-text today (e.g. "longsword", "Elvish") rather
   * than an entity id — proficiencies aren't a first-class table yet.
   * (Field is `category`, not `kind`, because `kind` is the Requirement
   * discriminator and would shadow it inside the intersection type.)
   */
  | 'proficiency'
  /**
   * Numeric level gate, used inside the tree (the flat
   * `level_prerequisite` column covers the common case on option items;
   * this leaf exists so feats — which lack the flat column — can express
   * level gates structurally, and so trees with mixed-scope gates can
   * use `isTotal: false` at one branch and `isTotal: true` at another).
   */
  | 'level';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type ProficiencyKind =
  | 'weapon'
  | 'armor'
  | 'tool'
  | 'skill'
  | 'language';

/**
 * Per-type leaf payloads. Keep the kept type narrow — every payload
 * carries exactly the data the leaf needs to round-trip and to display.
 * Reference fields hold entity IDs (not denormalized names) so renames
 * upstream don't strand the leaf.
 */
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

/** A leaf node. `type` switches on the payload shape via `RequirementLeafByType`. */
export type RequirementLeaf = {
  [K in RequirementLeafType]: { kind: 'leaf'; type: K } & RequirementLeafByType[K];
}[RequirementLeafType];

// ─── Groups ──────────────────────────────────────────────────────────────

/**
 * Boolean combinator for a group node:
 *   - all : every child must pass (And)
 *   - any : at least one child must pass (Or)
 *   - one : exactly one child must pass (Xor — rare; e.g. "pick this OR
 *           that but not both" archetype gates)
 */
export type RequirementGroupKind = 'all' | 'any' | 'one';

export interface RequirementGroup {
  kind: RequirementGroupKind;
  children: Requirement[];
}

// ─── Root ────────────────────────────────────────────────────────────────

export type Requirement = RequirementGroup | RequirementLeaf;

/** Top-level empty tree — the shape stored when there are no requirements. */
export const EMPTY_REQUIREMENT_TREE: Requirement | null = null;

/**
 * Type guard. Useful in recursive renderers where the union widens to
 * `Requirement` and TypeScript can't narrow on `kind` alone (group kinds
 * overlap shape-wise with the leaf discriminator at the top level).
 */
export function isGroup(req: Requirement): req is RequirementGroup {
  return req.kind === 'all' || req.kind === 'any' || req.kind === 'one';
}

export function isLeaf(req: Requirement): req is RequirementLeaf {
  return req.kind === 'leaf';
}

// ─── JSON round-trip ─────────────────────────────────────────────────────

/**
 * Safely parse the value stored in `requirements_tree`. Returns `null` for
 * empty / missing / malformed input — the column is nullable and existing
 * rows haven't been backfilled, so callers should be defensive.
 */
export function parseRequirementTree(raw: unknown): Requirement | null {
  if (raw == null || raw === '') return null;
  // Some D1 helpers auto-parse known JSON columns; others pass through the
  // string. Accept both so callers don't have to know which path they're on.
  if (typeof raw === 'object') return normalizeRequirement(raw as any);
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeRequirement(parsed);
  } catch {
    return null;
  }
}

/**
 * Defensive normalization — drops unknown leaf types and unknown group
 * kinds, ensures children arrays exist, and bails on shape mismatches.
 * Used as the boundary between untrusted JSON and typed code.
 */
function normalizeRequirement(input: any): Requirement | null {
  if (!input || typeof input !== 'object') return null;
  if (input.kind === 'leaf') {
    if (typeof input.type !== 'string') return null;
    if (!isKnownLeafType(input.type)) return null;
    // Trust the per-type payload — the editor and migration produce well-
    // shaped data; this only guards against truly corrupt rows.
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

/**
 * Serialize a tree back to a JSON string for D1. Returns `null` so the
 * caller can pass it straight into the column (D1 accepts JSON or null;
 * the helpers in d1.ts JSON.stringify objects automatically, but trees
 * are nested enough that we prefer to be explicit).
 */
export function serializeRequirementTree(tree: Requirement | null | undefined): string | null {
  if (!tree) return null;
  return JSON.stringify(tree);
}

// ─── Human-readable text (Foundry export) ────────────────────────────────

/**
 * Lookup tables the formatter needs to render entity-id leaves as names.
 * All fields optional — missing names render as `<unknown class>` style
 * placeholders so a broken reference is visible rather than silent.
 */
export interface RequirementFormatLookup {
  classNameById?: Record<string, string>;
  subclassNameById?: Record<string, string>;
  optionItemNameById?: Record<string, string>;
  featureNameById?: Record<string, string>;
  spellNameById?: Record<string, string>;
  spellRuleNameById?: Record<string, string>;
}

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

const PROFICIENCY_LABEL: Record<ProficiencyKind, string> = {
  weapon: 'Weapon proficiency',
  armor: 'Armor proficiency',
  tool: 'Tool proficiency',
  skill: 'Skill proficiency',
  language: 'Language',
};

/**
 * Render a single leaf to text. Naming style follows the conventions used
 * by PHB / Tasha's feat prerequisites ("Strength 13 or higher",
 * "5th level"). Plain ASCII so the output works inside dnd5e's
 * `system.requirements` field (which surfaces in the item card).
 */
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
    case 'class': {
      const name = lookup.classNameById?.[leaf.classId] ?? '<unknown class>';
      return name;
    }
    case 'subclass': {
      const name = lookup.subclassNameById?.[leaf.subclassId] ?? '<unknown subclass>';
      return name;
    }
    case 'optionItem': {
      const name = lookup.optionItemNameById?.[leaf.itemId] ?? '<unknown option>';
      return name;
    }
    case 'feature': {
      const name = lookup.featureNameById?.[leaf.featureId] ?? '<unknown feature>';
      return name;
    }
    case 'spell': {
      const name = lookup.spellNameById?.[leaf.spellId] ?? '<unknown spell>';
      return `Knows ${name}`;
    }
    case 'spellRule': {
      const name = lookup.spellRuleNameById?.[leaf.spellRuleId] ?? '<unknown spell rule>';
      return `Knows a spell matching “${name}”`;
    }
    case 'abilityScore':
      return `${ABILITY_LABEL[leaf.ability]} ${leaf.min} or higher`;
    case 'proficiency':
      return `${PROFICIENCY_LABEL[leaf.category]}: ${leaf.identifier}`;
  }
}

/**
 * Recursively render a tree to readable text. Groups are joined with
 * " and " / " or " / " (exactly one of) " depending on the combinator;
 * nested groups are wrapped in parentheses unless the entire tree is the
 * top-level group (avoids the noisy outer parens in the common case).
 *
 * Examples
 * --------
 *   all { level=5, optionItem=PactOfTheBlade }
 *     → "Level 5+ and Pact of the Blade"
 *   all { optionItem=PactOfTheBlade, any { invocation=A, invocation=B } }
 *     → "Pact of the Blade and (Invocation A or Invocation B)"
 */
export function formatRequirementText(
  tree: Requirement | null | undefined,
  lookup: RequirementFormatLookup = {},
  /** Internal: are we inside a nested group? */
  _nested = false,
): string {
  if (!tree) return '';
  if (isLeaf(tree)) return formatLeaf(tree, lookup);

  const joinerByKind: Record<RequirementGroupKind, string> = {
    all: ' and ',
    any: ' or ',
    one: ' xor ', // rare; we still emit something readable
  };
  const labelByKind: Record<RequirementGroupKind, string> = {
    all: 'all of',
    any: 'any of',
    one: 'exactly one of',
  };

  const children = tree.children.filter(Boolean) as Requirement[];
  if (children.length === 0) return '';
  if (children.length === 1) return formatRequirementText(children[0], lookup, _nested);

  // "exactly one of (A, B, C)" reads better than "A xor B xor C" for >2
  // children, so we explicitly switch to the labelled form there.
  if (tree.kind === 'one' && children.length > 2) {
    const parts = children.map(c => formatRequirementText(c, lookup, true));
    return `${labelByKind.one} (${parts.join(', ')})`;
  }

  const parts = children.map(c => formatRequirementText(c, lookup, true));
  const joined = parts.join(joinerByKind[tree.kind]);
  return _nested ? `(${joined})` : joined;
}

// ─── Factory helpers ─────────────────────────────────────────────────────

/** Construct an empty group of the given kind — handy for editor "Add Group". */
export function emptyGroup(kind: RequirementGroupKind = 'all'): RequirementGroup {
  return { kind, children: [] };
}

// ─── PK → source-id remap (export pipeline) ──────────────────────────────
//
// Editor stores leaf references as PKs; the Foundry module consumes
// canonical source-id strings. The exporter walks the tree and rewrites
// references in place. Mirrored in `api/_lib/_requirements.ts` — keep
// these helpers identical across the pair.

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

/**
 * Construct a default leaf for the given type with sensible empty fields.
 * The editor uses this to seed a new leaf row when the type dropdown
 * changes — the author then fills in the entity / number.
 */
export function emptyLeaf(type: RequirementLeafType): RequirementLeaf {
  switch (type) {
    case 'level': return { kind: 'leaf', type, minLevel: 1, isTotal: false };
    case 'levelInClass': return { kind: 'leaf', type, classId: '', minLevel: 1 };
    case 'class': return { kind: 'leaf', type, classId: '' };
    case 'subclass': return { kind: 'leaf', type, subclassId: '' };
    case 'optionItem': return { kind: 'leaf', type, itemId: '' };
    case 'feature': return { kind: 'leaf', type, featureId: '' };
    case 'spell': return { kind: 'leaf', type, spellId: '' };
    case 'spellRule': return { kind: 'leaf', type, spellRuleId: '' };
    case 'abilityScore': return { kind: 'leaf', type, ability: 'str', min: 13 };
    case 'proficiency': return { kind: 'leaf', type, category: 'weapon', identifier: '' };
  }
}
