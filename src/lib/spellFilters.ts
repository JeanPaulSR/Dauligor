/**
 * Shared spell-filter vocabulary used by the public SpellList browser, the admin
 * SpellListManager, and (eventually) the character-side Spellbook Manager. Buckets
 * collapse the open-ended Foundry shape (system.activation/range/duration) into
 * a small set of UI chips that match 5etools/Plutonium conventions.
 *
 * Follow-ups (richer chips, activity-derived filters like damage type / save
 * ability) are tracked in docs/features/spellbook-manager.md.
 */

export type ActivationBucket = 'action' | 'bonus' | 'reaction' | 'minute' | 'hour' | 'special';
export type RangeBucket = 'self' | 'touch' | '5ft' | '30ft' | '60ft' | '120ft' | 'long' | 'other';
export type DurationBucket = 'inst' | 'round' | 'minute' | 'hour' | 'day' | 'perm' | 'special';
export type PropertyFilter = 'concentration' | 'ritual' | 'vocal' | 'somatic' | 'material';

export const ACTIVATION_LABELS: Record<ActivationBucket, string> = {
  action: 'Action',
  bonus: 'Bonus Action',
  reaction: 'Reaction',
  minute: 'Minute',
  hour: 'Hour',
  special: 'Special',
};

export const RANGE_LABELS: Record<RangeBucket, string> = {
  self: 'Self',
  touch: 'Touch',
  '5ft': '5 ft',
  '30ft': '30 ft',
  '60ft': '60 ft',
  '120ft': '120 ft',
  long: 'Long (150+ ft)',
  other: 'Other',
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

export const ACTIVATION_ORDER: ActivationBucket[] = ['action', 'bonus', 'reaction', 'minute', 'hour', 'special'];
export const RANGE_ORDER: RangeBucket[] = ['self', 'touch', '5ft', '30ft', '60ft', '120ft', 'long', 'other'];
export const DURATION_ORDER: DurationBucket[] = ['inst', 'round', 'minute', 'hour', 'day', 'perm', 'special'];
export const PROPERTY_ORDER: PropertyFilter[] = ['concentration', 'ritual', 'vocal', 'somatic', 'material'];

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
 * Range bucket. Common discrete ft values get their own chip; >120 ft and unbounded
 * units (mi / any / unlimited) collapse into "Long". Anything else (10/15/90 ft,
 * sight, special) lands in "Other".
 */
export function bucketRange(range: any): RangeBucket {
  const units = String(range?.units ?? '').trim();
  const value = Number(range?.value ?? 0);
  if (units === 'self') return 'self';
  if (units === 'touch') return 'touch';
  if (units === 'ft') {
    if (value === 5) return '5ft';
    if (value === 30) return '30ft';
    if (value === 60) return '60ft';
    if (value === 120) return '120ft';
    if (value > 120) return 'long';
    return 'other';
  }
  if (units === 'mi' || units === 'any' || units === 'unlimited') return 'long';
  return 'other';
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
 */
export function matchSpellAgainstRule(spell: SpellMatchInput, query: RuleQuery): boolean {
  if (query.sourceFilterIds?.length && !query.sourceFilterIds.includes(String(spell.source_id ?? ''))) return false;
  if (query.levelFilters?.length && !query.levelFilters.includes(String(spell.level))) return false;
  if (query.schoolFilters?.length && !query.schoolFilters.includes(spell.school)) return false;
  if (query.tagFilterIds?.length && !query.tagFilterIds.every(t => spell.tags.includes(t))) return false;
  if (query.activationFilters?.length && !query.activationFilters.includes(spell.activationBucket)) return false;
  if (query.rangeFilters?.length && !query.rangeFilters.includes(spell.rangeBucket)) return false;
  if (query.durationFilters?.length && !query.durationFilters.includes(spell.durationBucket)) return false;
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
    + (query.propertyFilters?.length ?? 0));
}
