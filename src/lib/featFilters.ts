/**
 * Shared feat-filter vocabulary used by the public FeatList browser and
 * (in time) any character-side feat-picker. Buckets the various feat
 * authoring fields into a compact set of UI chips matching the rhythm
 * of `lib/spellFilters.ts`.
 *
 * Property filters are a lightweight five-checkbox grid that lets a
 * player narrow to "feats with activities" or "feats with prereqs"
 * without having to scroll through the full list — the most common
 * browse intent based on observed authoring patterns.
 */

export type FeatTypeValue =
  | 'feat'
  | 'class'
  | 'subclass'
  | 'race'
  | 'background'
  | 'monster';

export type FeatPropertyFilter =
  | 'repeatable'
  | 'hasUses'
  | 'hasActivities'
  | 'hasEffects'
  | 'hasPrereqs';

export const FEAT_TYPE_LABELS: Record<FeatTypeValue, string> = {
  feat: 'Feat',
  class: 'Class Feature',
  subclass: 'Subclass Feature',
  race: 'Racial Feature',
  background: 'Background Feature',
  monster: 'Monster Feature',
};

export const FEAT_TYPE_ORDER: FeatTypeValue[] = [
  'feat',
  'class',
  'subclass',
  'race',
  'background',
  'monster',
];

export const FEAT_PROPERTY_LABELS: Record<FeatPropertyFilter, string> = {
  repeatable: 'Repeatable',
  hasUses: 'Has Uses',
  hasActivities: 'Has Activities',
  hasEffects: 'Has Effects',
  hasPrereqs: 'Has Prereqs',
};

export const FEAT_PROPERTY_ORDER: FeatPropertyFilter[] = [
  'repeatable',
  'hasUses',
  'hasActivities',
  'hasEffects',
  'hasPrereqs',
];

/**
 * Derive boolean property facets off a feat row. Computed once per row
 * at load time and read by the filter chips + the FilterBar checkbox
 * grid. Keeps filtering O(1) per row instead of re-evaluating these
 * conditions on every keystroke.
 *
 * Tolerates both snake_case (raw D1 row) and camelCase (denormalized)
 * shapes since the FeatList page reads slightly-mapped rows but
 * underlying schema lives in snake_case columns.
 */
export function deriveFeatPropertyFlags(row: any): Record<FeatPropertyFilter, boolean> {
  const repeatable = !!(row?.repeatable);

  const usesMax = String(row?.uses_max ?? row?.usesMax ?? '').trim();
  const hasUses = usesMax.length > 0;

  const activities = row?.activities;
  const hasActivities = Array.isArray(activities)
    ? activities.length > 0
    : typeof activities === 'string'
      ? activities !== '' && activities !== '[]'
      : !!(activities && Object.keys(activities).length);

  const effects = row?.effects;
  const hasEffects = Array.isArray(effects)
    ? effects.length > 0
    : typeof effects === 'string'
      ? effects !== '' && effects !== '[]'
      : !!(effects && Object.keys(effects).length);

  const reqText = String(row?.requirements ?? '').trim();
  const reqTree = row?.requirements_tree ?? row?.requirementsTree;
  const hasReqTree =
    reqTree !== null
    && reqTree !== undefined
    && reqTree !== ''
    && reqTree !== '"null"';
  const hasPrereqs = reqText.length > 0 || hasReqTree;

  return { repeatable, hasUses, hasActivities, hasEffects, hasPrereqs };
}
