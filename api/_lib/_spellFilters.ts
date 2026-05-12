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

export function bucketActivation(activation: any): ActivationBucket {
  const type = String(activation?.type ?? '').trim();
  if (type === 'action') return 'action';
  if (type === 'bonus') return 'bonus';
  if (type === 'reaction') return 'reaction';
  if (type === 'minute') return 'minute';
  if (type === 'hour') return 'hour';
  return 'special';
}

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

export type SpellMatchInput = SpellFilterFacets & {
  level: number;
  school: string;
  source_id: string | null;
  tags: string[];
};

export function matchSpellAgainstRule(spell: SpellMatchInput, query: RuleQuery): boolean {
  if (query.sourceFilterIds?.length && !query.sourceFilterIds.includes(String(spell.source_id ?? ''))) return false;
  if (query.levelFilters?.length && !query.levelFilters.includes(String(spell.level))) return false;
  if (query.schoolFilters?.length && !query.schoolFilters.includes(spell.school)) return false;
  if (query.tagFilterIds?.length && !query.tagFilterIds.every(t => spell.tags.includes(t))) return false;
  if (query.activationFilters?.length && !query.activationFilters.includes(spell.activationBucket)) return false;
  if (query.rangeFilters?.length && !query.rangeFilters.includes(spell.rangeBucket)) return false;
  if (query.durationFilters?.length && !query.durationFilters.includes(spell.durationBucket)) return false;
  if (query.propertyFilters?.length && !query.propertyFilters.every(p => Boolean((spell as any)[p]))) return false;
  return true;
}
