// =============================================================================
// SERVER COPY of src/lib/spellFilters.ts — the shared spell-filter vocabulary
// (activation/range/duration buckets, property flags) plus the `RuleQuery`
// matcher. Used by `_classExport.ts` to pre-resolve `spellRule` requirement
// leaves to a spell-sourceId allowlist at bake time so the module-side
// requirements walker can check whether the importing actor knows any
// matching spell.
//
// DRIFT WARNING: mirror of `src/lib/spellFilters.ts`. Both must stay in sync.
// Pure module — no D1 / fetch dependencies — so it can live alongside
// `_classExport.ts` without dragging firebase/JSON config into the Vercel
// bundle.
// =============================================================================

export type ActivationBucket = 'action' | 'bonus' | 'reaction' | 'minute' | 'hour' | 'special';
export type RangeBucket = 'self' | 'touch' | '5ft' | '30ft' | '60ft' | '120ft' | 'long' | 'other';
export type DurationBucket = 'inst' | 'round' | 'minute' | 'hour' | 'day' | 'perm' | 'special';
export type PropertyFilter = 'concentration' | 'ritual' | 'vocal' | 'somatic' | 'material';
export type ShapeBucket = 'cone' | 'cube' | 'cylinder' | 'line' | 'radius' | 'sphere' | 'square' | 'wall' | 'none';

export function bucketActivation(activation: any): ActivationBucket {
  const type = String(activation?.type ?? '').trim();
  if (type === 'action') return 'action';
  if (type === 'bonus') return 'bonus';
  if (type === 'reaction') return 'reaction';
  if (type === 'minute') return 'minute';
  if (type === 'hour') return 'hour';
  return 'special';
}

// Distance-band bucketing. See src/lib/spellFilters.ts for the
// rationale — earlier exact-value match dropped off-canonical
// distances (10/25/90ft etc) into "Other"; bands fix it. Values stay
// as `5ft`/`30ft`/`60ft`/`120ft`/`long`/`other` for stored-rule
// back-compat; labels (UI-side) read as Close/Short/Medium/Long/Far.
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

export function parseFoundrySystem(raw: any): any {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

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

export type RuleQuery = {
  // Legacy include-only axis arrays — still honored on load for back-compat.
  sourceFilterIds?: string[];
  levelFilters?: string[];
  schoolFilters?: string[];
  tagFilterIds?: string[];
  activationFilters?: ActivationBucket[];
  rangeFilters?: RangeBucket[];
  durationFilters?: DurationBucket[];
  shapeFilters?: ShapeBucket[];
  propertyFilters?: PropertyFilter[];
  // Rich tag filter (per-group combinators).
  tagStates?: Record<string, number>;
  groupCombineModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  groupExclusionModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  // Rich per-axis filters. Take priority over legacy arrays when present.
  source?: AxisFilter;
  level?: AxisFilter;
  school?: AxisFilter;
  activation?: AxisFilter<ActivationBucket>;
  range?: AxisFilter<RangeBucket>;
  duration?: AxisFilter<DurationBucket>;
  shape?: AxisFilter<ShapeBucket>;
  property?: AxisFilter<PropertyFilter>;
};

export type TagIndex = {
  parentByTagId: Map<string, string | null>;
  groupByTagId: Map<string, string | null>;
  tagIdsByGroup: Map<string, string[]>;
};

// Rich per-axis filter — mirror of src/lib/spellFilters.ts. Keep in sync.
export type AxisFilter<V extends string = string> = {
  states?: Record<V, number>;
  combineMode?: 'AND' | 'OR' | 'XOR';
  exclusionMode?: 'AND' | 'OR' | 'XOR';
};

function matchesSingleAxisFilter<V extends string>(
  spellValue: V | null | undefined,
  axis: AxisFilter<V> | undefined,
): boolean {
  if (!axis) return true;
  const states = axis.states;
  if (!states || Object.keys(states).length === 0) return true;
  const value = spellValue ?? ('' as V);
  const includes: V[] = [];
  const excludes: V[] = [];
  for (const [v, state] of Object.entries(states) as [V, number][]) {
    if (state === 1) includes.push(v);
    else if (state === 2) excludes.push(v);
  }
  if (excludes.length > 0) {
    const matchCount = excludes.includes(value) ? 1 : 0;
    const mode = axis.exclusionMode || 'OR';
    let excluded = false;
    if (mode === 'OR') excluded = matchCount > 0;
    else if (mode === 'AND') excluded = matchCount === excludes.length;
    else excluded = matchCount === 1;
    if (excluded) return false;
  }
  if (includes.length > 0) {
    const matchCount = includes.includes(value) ? 1 : 0;
    const mode = axis.combineMode || 'OR';
    let included = false;
    if (mode === 'OR') included = matchCount > 0;
    else if (mode === 'AND') included = matchCount === includes.length;
    else included = matchCount === 1;
    if (!included) return false;
  }
  return true;
}

function matchesMultiAxisFilter<V extends string>(
  spellValues: ReadonlySet<V>,
  axis: AxisFilter<V> | undefined,
): boolean {
  if (!axis) return true;
  const states = axis.states;
  if (!states || Object.keys(states).length === 0) return true;
  const includes: V[] = [];
  const excludes: V[] = [];
  for (const [v, state] of Object.entries(states) as [V, number][]) {
    if (state === 1) includes.push(v);
    else if (state === 2) excludes.push(v);
  }
  if (excludes.length > 0) {
    const matchCount = excludes.filter(v => spellValues.has(v)).length;
    const mode = axis.exclusionMode || 'OR';
    let excluded = false;
    if (mode === 'OR') excluded = matchCount > 0;
    else if (mode === 'AND') excluded = matchCount === excludes.length;
    else excluded = matchCount === 1;
    if (excluded) return false;
  }
  if (includes.length > 0) {
    const matchCount = includes.filter(v => spellValues.has(v)).length;
    const mode = axis.combineMode || 'OR';
    let included = false;
    if (mode === 'OR') included = matchCount > 0;
    else if (mode === 'AND') included = matchCount === includes.length;
    else included = matchCount === 1;
    if (!included) return false;
  }
  return true;
}

export type SpellMatchInput = SpellFilterFacets & {
  level: number;
  school: string;
  source_id: string | null;
  tags: string[];
};

// Server-side mirror of `expandTagsWithAncestors` from
// `src/lib/tagHierarchy.ts`. Inlined here because Vercel bundling
// cannot reliably traverse cross-folder imports from `api/` into
// `src/lib/` — see docs/operations/deployment.md ("Vercel cross-folder
// bundling caveat"). DRIFT WARNING: if you change the algorithm in
// src/lib/tagHierarchy.ts, update this copy in the same commit.
function expandTagsWithAncestors(
  tagIds: readonly string[],
  parentByTagId: Map<string, string | null>,
): string[] {
  const out = new Set<string>();
  for (const tid of tagIds) {
    if (!tid) continue;
    let cursor: string | null = tid;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      out.add(cursor);
      cursor = parentByTagId.get(cursor) ?? null;
    }
  }
  return Array.from(out);
}

/**
 * Tag matching is HIERARCHICAL when `parentByTagId` is supplied: a
 * spell tagged with `Conjure.Manifest` is treated as also carrying
 * its ancestor tags, so a rule for `Conjure` matches it. Rules stay
 * specific in the OTHER direction: a rule for `Conjure.Manifest` does
 * NOT match a spell tagged only with `Conjure` or with the sibling
 * `Conjure.Summon`. Callers without the map fall back to flat
 * `.includes()` for back-compat.
 */
export function matchSpellAgainstRule(
  spell: SpellMatchInput,
  query: RuleQuery,
  parentByTagId?: Map<string, string | null>,
  tagIndex?: TagIndex,
): boolean {
  if (query.source) {
    if (!matchesSingleAxisFilter(String(spell.source_id ?? ''), query.source)) return false;
  } else if (query.sourceFilterIds?.length && !query.sourceFilterIds.includes(String(spell.source_id ?? ''))) {
    return false;
  }
  if (query.level) {
    if (!matchesSingleAxisFilter(String(spell.level), query.level)) return false;
  } else if (query.levelFilters?.length && !query.levelFilters.includes(String(spell.level))) {
    return false;
  }
  if (query.school) {
    if (!matchesSingleAxisFilter(spell.school, query.school)) return false;
  } else if (query.schoolFilters?.length && !query.schoolFilters.includes(spell.school)) {
    return false;
  }

  // Rich tag matching (see src/lib/spellFilters.ts for rationale + drift contract).
  const richTagStates = query.tagStates;
  const hasRichTags = richTagStates && Object.keys(richTagStates).length > 0;
  if (hasRichTags) {
    if (!tagIndex) return true; // defensive — see src twin comment
    const effective = parentByTagId
      ? new Set(expandTagsWithAncestors(spell.tags, parentByTagId))
      : new Set(spell.tags);
    if (!matchesRichTagStates(effective, richTagStates, query.groupCombineModes ?? {}, query.groupExclusionModes ?? {}, tagIndex)) {
      return false;
    }
  } else if (query.tagFilterIds?.length) {
    const effective = parentByTagId
      ? new Set(expandTagsWithAncestors(spell.tags, parentByTagId))
      : new Set(spell.tags);
    if (!query.tagFilterIds.every(t => effective.has(t))) return false;
  }

  if (query.activation) {
    if (!matchesSingleAxisFilter(spell.activationBucket, query.activation)) return false;
  } else if (query.activationFilters?.length && !query.activationFilters.includes(spell.activationBucket)) {
    return false;
  }
  if (query.range) {
    if (!matchesSingleAxisFilter(spell.rangeBucket, query.range)) return false;
  } else if (query.rangeFilters?.length && !query.rangeFilters.includes(spell.rangeBucket)) {
    return false;
  }
  if (query.duration) {
    if (!matchesSingleAxisFilter(spell.durationBucket, query.duration)) return false;
  } else if (query.durationFilters?.length && !query.durationFilters.includes(spell.durationBucket)) {
    return false;
  }
  if (query.shape) {
    if (!matchesSingleAxisFilter(spell.shapeBucket, query.shape)) return false;
  } else if (query.shapeFilters?.length && !query.shapeFilters.includes(spell.shapeBucket)) {
    return false;
  }
  if (query.property) {
    const have = new Set<PropertyFilter>();
    if ((spell as any).concentration) have.add('concentration');
    if ((spell as any).ritual) have.add('ritual');
    if ((spell as any).vocal) have.add('vocal');
    if ((spell as any).somatic) have.add('somatic');
    if ((spell as any).material) have.add('material');
    if (!matchesMultiAxisFilter(have, query.property)) return false;
  } else if (query.propertyFilters?.length && !query.propertyFilters.every(p => Boolean((spell as any)[p]))) {
    return false;
  }
  return true;
}

function matchesRichTagStates(
  effectiveTagIds: Set<string>,
  tagStates: Record<string, number>,
  groupCombineModes: Record<string, 'AND' | 'OR' | 'XOR'>,
  groupExclusionModes: Record<string, 'AND' | 'OR' | 'XOR'>,
  tagIndex: TagIndex,
): boolean {
  const includesByGroup = new Map<string, string[]>();
  const excludesByGroup = new Map<string, string[]>();
  for (const [tagId, state] of Object.entries(tagStates)) {
    if (state !== 1 && state !== 2) continue;
    const groupId = tagIndex.groupByTagId.get(tagId);
    if (!groupId) continue;
    const bucket = state === 1 ? includesByGroup : excludesByGroup;
    if (!bucket.has(groupId)) bucket.set(groupId, []);
    bucket.get(groupId)!.push(tagId);
  }
  if (includesByGroup.size === 0 && excludesByGroup.size === 0) return true;
  for (const [groupId, excludedIds] of excludesByGroup) {
    const matchCount = excludedIds.filter(tid => effectiveTagIds.has(tid)).length;
    const mode = groupExclusionModes[groupId] || 'OR';
    let excluded = false;
    if (mode === 'OR') excluded = matchCount > 0;
    else if (mode === 'AND') excluded = matchCount === excludedIds.length;
    else excluded = matchCount === 1;
    if (excluded) return false;
  }
  for (const [groupId, includedIds] of includesByGroup) {
    const matchCount = includedIds.filter(tid => effectiveTagIds.has(tid)).length;
    const mode = groupCombineModes[groupId] || 'OR';
    let included = false;
    if (mode === 'OR') included = matchCount > 0;
    else if (mode === 'AND') included = matchCount === includedIds.length;
    else included = matchCount === 1;
    if (!included) return false;
  }
  return true;
}
