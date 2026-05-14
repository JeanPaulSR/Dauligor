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
 *
 * Two tag-filter shapes are supported simultaneously for back-compat:
 *
 * - `tagFilterIds` (legacy): flat array of "must have ALL these tags". Every rule
 *   authored before the rich-tag-filter rollout uses this shape. New saves never
 *   emit it.
 *
 * - `tagStates` + `groupCombineModes` + `groupExclusionModes` (rich): per-tag
 *   include/exclude state (1=include, 2=exclude) with per-group AND/OR/XOR
 *   combinators for both inclusion and exclusion chips. Matches the
 *   <TagGroupFilter> UX used in /compendium/classes, /compendium/spells, and
 *   /compendium/spell-rules.
 *
 * Migration semantics: when both shapes are present (e.g. a partially-migrated
 * rule), the rich state wins. Empty rich state defaults to legacy behavior.
 */
export type RuleQuery = {
  sourceFilterIds?: string[];
  levelFilters?: string[];
  schoolFilters?: string[];
  tagFilterIds?: string[];
  tagStates?: Record<string, number>;
  groupCombineModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  groupExclusionModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  activationFilters?: ActivationBucket[];
  rangeFilters?: RangeBucket[];
  durationFilters?: DurationBucket[];
  shapeFilters?: ShapeBucket[];
  propertyFilters?: PropertyFilter[];
};

/**
 * Index for the rich tag matching path — call sites that have the tag set
 * already in hand can pass it; otherwise the matcher accepts a leaner
 * function shape via parentByTagId only and falls back to legacy tagFilterIds.
 */
export type TagIndex = {
  /** parent_tag_id resolver for ancestor expansion. */
  parentByTagId: Map<string, string | null>;
  /** group_id lookup so the matcher can bucket include/exclude chips per group. */
  groupByTagId: Map<string, string | null>;
  /** group_id -> tag ids in that group (used by AND/XOR mode counts). */
  tagIdsByGroup: Map<string, string[]>;
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
  tagIndex?: TagIndex,
): boolean {
  if (query.sourceFilterIds?.length && !query.sourceFilterIds.includes(String(spell.source_id ?? ''))) return false;
  if (query.levelFilters?.length && !query.levelFilters.includes(String(spell.level))) return false;
  if (query.schoolFilters?.length && !query.schoolFilters.includes(spell.school)) return false;

  // Rich tag matching (new shape: tagStates + group combinators). Takes
  // priority when present so a rule migrated from the legacy shape can
  // gain include/exclude state without leaving the old `tagFilterIds`
  // also satisfied. tagIndex is required for the rich path because we
  // need to bucket include/exclude chips by their tag group.
  const richTagStates = query.tagStates;
  const hasRichTags = richTagStates && Object.keys(richTagStates).length > 0;
  if (hasRichTags) {
    if (!tagIndex) {
      // Defensive: callers that opted into rich rules must pass tagIndex.
      // Falling back to "pass" here rather than "fail" so a missing index
      // can't accidentally empty out a spell list.
      return true;
    }
    const effective = parentByTagId
      ? new Set(expandTagsWithAncestors(spell.tags, parentByTagId))
      : new Set(spell.tags);
    if (!matchesRichTagStates(effective, richTagStates, query.groupCombineModes ?? {}, query.groupExclusionModes ?? {}, tagIndex)) {
      return false;
    }
  } else if (query.tagFilterIds?.length) {
    // Legacy: flat AND-of-tags with ancestor expansion when available.
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

/**
 * Same rule as the runtime <TagGroupFilter> UI: each tag group accumulates an
 * inclusion + exclusion result, exclusion-match-anywhere short-circuits to
 * false, then every group that has include chips must pass its mode-specific
 * inclusion check (AND requires every include, OR any, XOR exactly one).
 *
 * Effective tag set should already be ancestor-expanded (caller's
 * responsibility) so subtag-tagged spells match parent-tag include chips.
 */
function matchesRichTagStates(
  effectiveTagIds: Set<string>,
  tagStates: Record<string, number>,
  groupCombineModes: Record<string, 'AND' | 'OR' | 'XOR'>,
  groupExclusionModes: Record<string, 'AND' | 'OR' | 'XOR'>,
  tagIndex: TagIndex,
): boolean {
  // Bucket active include / exclude chips per tag group.
  const includesByGroup = new Map<string, string[]>();
  const excludesByGroup = new Map<string, string[]>();
  for (const [tagId, state] of Object.entries(tagStates)) {
    if (state !== 1 && state !== 2) continue;
    const groupId = tagIndex.groupByTagId.get(tagId);
    if (!groupId) continue; // orphaned, skip
    const bucket = state === 1 ? includesByGroup : excludesByGroup;
    if (!bucket.has(groupId)) bucket.set(groupId, []);
    bucket.get(groupId)!.push(tagId);
  }

  if (includesByGroup.size === 0 && excludesByGroup.size === 0) return true;

  // Exclusion check first — any group matching its exclusion rule
  // immediately disqualifies the spell.
  for (const [groupId, excludedIds] of excludesByGroup) {
    const matchCount = excludedIds.filter(tid => effectiveTagIds.has(tid)).length;
    const mode = groupExclusionModes[groupId] || 'OR';
    let excluded = false;
    if (mode === 'OR') excluded = matchCount > 0;
    else if (mode === 'AND') excluded = matchCount === excludedIds.length;
    else excluded = matchCount === 1; // XOR
    if (excluded) return false;
  }

  // Inclusion check — every group with include chips must pass.
  for (const [groupId, includedIds] of includesByGroup) {
    const matchCount = includedIds.filter(tid => effectiveTagIds.has(tid)).length;
    const mode = groupCombineModes[groupId] || 'OR';
    let included = false;
    if (mode === 'OR') included = matchCount > 0;
    else if (mode === 'AND') included = matchCount === includedIds.length;
    else included = matchCount === 1; // XOR
    if (!included) return false;
  }
  return true;
}

/** True if the rule has no filter clauses set — would match every spell (probably a misconfiguration). */
export function isRuleEmpty(query: RuleQuery): boolean {
  return !((query.sourceFilterIds?.length ?? 0)
    + (query.levelFilters?.length ?? 0)
    + (query.schoolFilters?.length ?? 0)
    + (query.tagFilterIds?.length ?? 0)
    + Object.keys(query.tagStates ?? {}).length
    + (query.activationFilters?.length ?? 0)
    + (query.rangeFilters?.length ?? 0)
    + (query.durationFilters?.length ?? 0)
    + (query.shapeFilters?.length ?? 0)
    + (query.propertyFilters?.length ?? 0));
}
