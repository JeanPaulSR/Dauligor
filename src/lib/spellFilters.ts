/**
 * Shared spell-filter vocabulary used by the public SpellList browser, the admin
 * SpellListManager, and (eventually) the character-side Spellbook Manager. Buckets
 * collapse the open-ended Foundry shape (system.activation/range/duration) into
 * a small set of UI chips that match 5etools/Plutonium conventions.
 *
 * Follow-ups (richer chips, activity-derived filters like damage type / save
 * ability) are tracked in docs/features/spellbook-manager.md.
 */

import { expandTagsWithAncestors } from './tagHierarchy';

export type ActivationBucket = 'action' | 'bonus' | 'reaction' | 'minute' | 'hour' | 'special';
// Bucket VALUES kept as `5ft`/`30ft`/`60ft`/`120ft`/`long`/`other` for
// back-compat with saved spell-rule queries that reference them by
// string. Labels (below) are conceptual — "Close", "Short", "Medium",
// "Long", "Far" — because the original exact-value labels were
// misleading: a 25ft spell looks like it should be in "30ft" but the
// pre-fix bucketRange (exact-value match) dropped it into "Other".
// The fix lives in bucketRange itself, which now bands ranges instead
// of requiring exact-value matches.
export type RangeBucket = 'self' | 'touch' | '5ft' | '30ft' | '60ft' | '120ft' | 'long' | 'other';
export type DurationBucket = 'inst' | 'round' | 'minute' | 'hour' | 'day' | 'perm' | 'special';
export type PropertyFilter = 'concentration' | 'ritual' | 'vocal' | 'somatic' | 'material';
// Template shape from Foundry's `system.target.template.type`. "None"
// catches spells with no template (point-target or self-only).
export type ShapeBucket = 'cone' | 'cube' | 'cylinder' | 'line' | 'radius' | 'sphere' | 'square' | 'wall' | 'none';

export const ACTIVATION_LABELS: Record<ActivationBucket, string> = {
  action: 'Action',
  bonus: 'Bonus Action',
  reaction: 'Reaction',
  minute: 'Minute',
  hour: 'Hour',
  special: 'Special',
};

// Conceptual labels — see the RangeBucket type comment for why values
// stay as exact-distance strings (back-compat) while labels read as
// distance bands.
export const RANGE_LABELS: Record<RangeBucket, string> = {
  self: 'Self',
  touch: 'Touch',
  '5ft': 'Close (≤5 ft)',
  '30ft': 'Short (6–30 ft)',
  '60ft': 'Medium (31–60 ft)',
  '120ft': 'Long (61–120 ft)',
  long: 'Far (>120 ft / sight)',
  other: 'Special',
};

export const DURATION_LABELS: Record<DurationBucket, string> = {
  inst: 'Instantaneous',
  round: 'Round',
  minute: 'Minute',
  hour: 'Hour',
  day: 'Day',
  perm: 'Permanent',
  special: 'Special',
};

export const PROPERTY_LABELS: Record<PropertyFilter, string> = {
  concentration: 'Concentration',
  ritual: 'Ritual',
  vocal: 'V',
  somatic: 'S',
  material: 'M',
};

export const SHAPE_LABELS: Record<ShapeBucket, string> = {
  cone:     'Cone',
  cube:     'Cube',
  cylinder: 'Cylinder',
  line:     'Line',
  radius:   'Radius',
  sphere:   'Sphere',
  square:   'Square',
  wall:     'Wall',
  none:     'None',
};

export const ACTIVATION_ORDER: ActivationBucket[] = ['action', 'bonus', 'reaction', 'minute', 'hour', 'special'];
export const RANGE_ORDER: RangeBucket[] = ['self', 'touch', '5ft', '30ft', '60ft', '120ft', 'long', 'other'];
export const DURATION_ORDER: DurationBucket[] = ['inst', 'round', 'minute', 'hour', 'day', 'perm', 'special'];
export const PROPERTY_ORDER: PropertyFilter[] = ['concentration', 'ritual', 'vocal', 'somatic', 'material'];
export const SHAPE_ORDER: ShapeBucket[] = ['cone', 'cube', 'cylinder', 'line', 'radius', 'sphere', 'square', 'wall', 'none'];

/** Casting-time bucket from `system.activation.type`. */
export function bucketActivation(activation: any): ActivationBucket {
  const type = String(activation?.type ?? '').trim();
  if (type === 'action') return 'action';
  if (type === 'bonus') return 'bonus';
  if (type === 'reaction') return 'reaction';
  if (type === 'minute') return 'minute';
  if (type === 'hour') return 'hour';
  return 'special';
}

/**
 * Range bucket. Distance bands rather than exact-value match — a 25-ft
 * spell now lands in the same bucket as 30 ft (both "Short"), a 90-ft
 * spell lands with 120 ft (both "Long"), etc. The earlier exact-value
 * implementation dropped every off-canonical distance into "Other",
 * which was the root of the user-visible bug.
 *
 * Bucket values keep their original strings (`5ft`/`30ft`/…) for
 * back-compat with stored spell-rule queries — the only thing that
 * changed is what input values map into each bucket, and the user-
 * facing labels. See RANGE_LABELS for the band cutoffs as documented
 * in the UI.
 *
 * `mi`, `any`, `unlimited` units collapse into the "Far" bucket
 * regardless of value. `self` / `touch` remain their own buckets.
 * Empty / unrecognized units fall to "Special".
 */
export function bucketRange(range: any): RangeBucket {
  const units = String(range?.units ?? '').trim();
  const value = Number(range?.value ?? 0);
  if (units === 'self') return 'self';
  if (units === 'touch') return 'touch';
  if (units === 'ft') {
    if (value <= 5)   return '5ft';   // Close
    if (value <= 30)  return '30ft';  // Short
    if (value <= 60)  return '60ft';  // Medium
    if (value <= 120) return '120ft'; // Long
    return 'long';                    // Far (>120)
  }
  if (units === 'mi' || units === 'any' || units === 'unlimited') return 'long';
  return 'other';
}

/**
 * Template-shape bucket from `system.target.template.type`. Returns
 * `none` when the spell has no template (point target / self-only).
 * Foundry values that don't match a known bucket also fall to `none`.
 */
export function bucketShape(target: any): ShapeBucket {
  const type = String(target?.template?.type ?? '').trim();
  switch (type) {
    case 'cone':     return 'cone';
    case 'cube':     return 'cube';
    case 'cylinder': return 'cylinder';
    case 'line':     return 'line';
    case 'radius':   return 'radius';
    case 'sphere':   return 'sphere';
    case 'square':   return 'square';
    case 'wall':     return 'wall';
    default:         return 'none';
  }
}

/** Duration bucket from `system.duration.units`. Ignores the value. */
export function bucketDuration(duration: any): DurationBucket {
  const units = String(duration?.units ?? '').trim();
  if (units === 'inst') return 'inst';
  if (units === 'round') return 'round';
  if (units === 'minute') return 'minute';
  if (units === 'hour') return 'hour';
  if (units === 'day') return 'day';
  if (units === 'perm') return 'perm';
  return 'special';
}

/** Parse the spells row's `foundry_data` column whether it's stringified JSON or already an object. */
export function parseFoundrySystem(raw: any): any {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

/** Convenience: derive every filter-relevant field at once from a spell row. */
export type SpellFilterFacets = {
  activationBucket: ActivationBucket;
  rangeBucket: RangeBucket;
  durationBucket: DurationBucket;
  shapeBucket: ShapeBucket;
  concentration: boolean;
  ritual: boolean;
  vocal: boolean;
  somatic: boolean;
  material: boolean;
};

export function deriveSpellFilterFacets(row: any): SpellFilterFacets {
  const system = parseFoundrySystem(row?.foundry_data);
  const properties: string[] = Array.isArray(system?.properties) ? system.properties.map(String) : [];
  return {
    activationBucket: bucketActivation(system?.activation),
    rangeBucket: bucketRange(system?.range),
    durationBucket: bucketDuration(system?.duration),
    shapeBucket: bucketShape(system?.target),
    concentration: properties.includes('concentration') || Boolean(row?.concentration),
    ritual: properties.includes('ritual') || Boolean(row?.ritual),
    vocal: properties.includes('vocal') || Boolean(row?.components_vocal),
    somatic: properties.includes('somatic') || Boolean(row?.components_somatic),
    material: properties.includes('material') || Boolean(row?.components_material),
  };
}

/**
 * Saved tag-query rule shape. All fields are optional / include-only — empty arrays
 * mean "match anything" for that section, exactly mirroring how the live filter UI
 * behaves. AND semantics across sections.
 */
export type RuleQuery = {
  sourceFilterIds?: string[];
  levelFilters?: string[];
  schoolFilters?: string[];
  tagFilterIds?: string[];
  activationFilters?: ActivationBucket[];
  rangeFilters?: RangeBucket[];
  durationFilters?: DurationBucket[];
  shapeFilters?: ShapeBucket[];
  propertyFilters?: PropertyFilter[];
};

/** Shape needed by `matchSpellAgainstRule` — superset of facets + sortable shell columns. */
export type SpellMatchInput = SpellFilterFacets & {
  level: number;
  school: string;
  source_id: string | null;
  tags: string[];
};

/**
 * Pure check: does this spell match the rule's saved filter state? Used by the
 * rebuild path (re-populating class_spell_lists from rules) and could power a
 * "preview matches" UI later.
 *
 * Tag matching is HIERARCHICAL when `parentByTagId` is supplied. A spell
 * tagged `Conjure.Manifest` (a subtag of `Conjure`) is treated as also
 * carrying its ancestor tags, so a rule for `Conjure` matches it. Rules
 * remain specific in the OTHER direction: a rule for `Conjure.Manifest`
 * does NOT match a spell tagged only with `Conjure` or with the sibling
 * `Conjure.Summon`. See `docs/database/structure/tags.md` for the
 * tagging model.
 *
 * Callers without access to the hierarchy map (legacy or self-contained
 * scenarios) can omit `parentByTagId`; the matcher falls back to flat
 * `.includes()` against the spell's stored tags.
 */
export function matchSpellAgainstRule(
  spell: SpellMatchInput,
  query: RuleQuery,
  parentByTagId?: Map<string, string | null>,
): boolean {
  if (query.sourceFilterIds?.length && !query.sourceFilterIds.includes(String(spell.source_id ?? ''))) return false;
  if (query.levelFilters?.length && !query.levelFilters.includes(String(spell.level))) return false;
  if (query.schoolFilters?.length && !query.schoolFilters.includes(spell.school)) return false;
  if (query.tagFilterIds?.length) {
    const effective = parentByTagId
      ? new Set(expandTagsWithAncestors(spell.tags, parentByTagId))
      : new Set(spell.tags);
    if (!query.tagFilterIds.every(t => effective.has(t))) return false;
  }
  if (query.activationFilters?.length && !query.activationFilters.includes(spell.activationBucket)) return false;
  if (query.rangeFilters?.length && !query.rangeFilters.includes(spell.rangeBucket)) return false;
  if (query.durationFilters?.length && !query.durationFilters.includes(spell.durationBucket)) return false;
  if (query.shapeFilters?.length && !query.shapeFilters.includes(spell.shapeBucket)) return false;
  if (query.propertyFilters?.length && !query.propertyFilters.every(p => Boolean(spell[p]))) return false;
  return true;
}

/** True if the rule has no filter clauses set — would match every spell (probably a misconfiguration). */
export function isRuleEmpty(query: RuleQuery): boolean {
  return !((query.sourceFilterIds?.length ?? 0)
    + (query.levelFilters?.length ?? 0)
    + (query.schoolFilters?.length ?? 0)
    + (query.tagFilterIds?.length ?? 0)
    + (query.activationFilters?.length ?? 0)
    + (query.rangeFilters?.length ?? 0)
    + (query.durationFilters?.length ?? 0)
    + (query.shapeFilters?.length ?? 0)
    + (query.propertyFilters?.length ?? 0));
}
