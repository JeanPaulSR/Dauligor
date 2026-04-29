export type CanonicalAdvancementType =
  | 'AbilityScoreImprovement'
  | 'HitPoints'
  | 'ItemChoice'
  | 'ItemGrant'
  | 'ScaleValue'
  | 'Size'
  | 'Trait'
  | 'Subclass';

export interface CanonicalTraitChoiceEntry {
  id: string;
  count: number;
  type: string;
  pool: string[];
  categoryIds?: string[];
}

function uniqueStringEntries(values: any[] = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )
  );
}

export function resolveAdvancementDefaultHitDie(defaultHitDie: number) {
  return [6, 8, 10, 12].includes(Number(defaultHitDie)) ? Number(defaultHitDie) : 8;
}

export function buildDefaultAdvancementConfiguration(type: string, defaultHitDie: number) {
  switch (type as CanonicalAdvancementType) {
    case 'AbilityScoreImprovement':
      return { fixed: {}, locked: {} };
    case 'HitPoints':
      return { hitDie: defaultHitDie };
    case 'ItemChoice':
      return { pool: [], count: 1, excludedOptionIds: [], choiceType: 'option-group', countSource: 'fixed' };
    case 'ItemGrant':
      return { pool: [], optional: false, optionalPool: [], excludedOptionIds: [], choiceType: 'option-group', countSource: 'fixed' };
    case 'ScaleValue':
      return { identifier: '', type: 'number', values: {} };
    case 'Size':
      return { sizes: { med: true } };
    case 'Trait':
      return {
        type: 'skills',
        mode: 'default',
        allowReplacements: false,
        choiceSource: 'fixed',
        choiceCount: 0,
        fixed: [],
        options: [],
        replacements: [],
        categoryIds: []
      };
    case 'Subclass':
      return {};
    default:
      return {};
  }
}

function normalizeSizeConfiguration(configuration: any = {}) {
  const selectedSizeIds = uniqueStringEntries([
    ...Object.entries(configuration?.sizes || {})
      .filter(([, isSelected]) => Boolean(isSelected))
      .map(([sizeId]) => sizeId),
    configuration?.size
  ]);

  return {
    ...configuration,
    sizes: Object.fromEntries(selectedSizeIds.map((sizeId) => [sizeId, true]))
  };
}

export function normalizeAdvancementForEditor<T extends { type?: string; configuration?: any; level?: any; title?: any }>(
  value: T,
  {
    defaultLevel,
    defaultHitDie
  }: {
    defaultLevel: number;
    defaultHitDie: number;
  }
): T {
  if (!value || typeof value !== 'object') return { configuration: {} } as T;

  const nextAdvancement = JSON.parse(JSON.stringify(value)) as T;
  const type = String(nextAdvancement.type || '').trim();
  if (!type) {
    (nextAdvancement as any).configuration = { ...((nextAdvancement as any).configuration || {}) };
    return nextAdvancement;
  }

  const resolvedHitDie = resolveAdvancementDefaultHitDie(defaultHitDie);
  let configuration = {
    ...buildDefaultAdvancementConfiguration(type, resolvedHitDie),
    ...((nextAdvancement as any).configuration || {})
  };

  if (type === 'AbilityScoreImprovement') {
    configuration.fixed = configuration.fixed && typeof configuration.fixed === 'object' && !Array.isArray(configuration.fixed)
      ? configuration.fixed
      : {};
    configuration.locked = configuration.locked && typeof configuration.locked === 'object' && !Array.isArray(configuration.locked)
      ? configuration.locked
      : {};
  }

  if (type === 'HitPoints') {
    configuration.hitDie = [6, 8, 10, 12].includes(Number(configuration.hitDie))
      ? Number(configuration.hitDie)
      : resolvedHitDie;
  }

  if (type === 'ItemChoice' || type === 'ItemGrant') {
    const countSource = configuration.countSource === 'scaling' ? 'scaling' : 'fixed';
    const pool = uniqueStringEntries(configuration.pool);

    configuration = {
      ...configuration,
      choiceType: String(configuration.choiceType || 'option-group'),
      countSource,
      count: type === 'ItemChoice'
        ? Math.max(1, Number(configuration.count || 1) || 1)
        : Math.max(0, Number(configuration.count || 0) || 0),
      pool,
      optionalPool: uniqueStringEntries(configuration.optionalPool).filter((entry) => pool.includes(entry)),
      excludedOptionIds: uniqueStringEntries(configuration.excludedOptionIds),
      optional: Boolean(configuration.optional)
    };

    if (countSource !== 'scaling') {
      delete configuration.scalingColumnId;
    }
  }

  if (type === 'ScaleValue') {
    configuration.identifier = String(configuration.identifier || '');
    configuration.type = String(configuration.type || 'number');
    configuration.values = configuration.values && typeof configuration.values === 'object' ? configuration.values : {};
  }

  if (type === 'Size') {
    configuration = normalizeSizeConfiguration(configuration);
    delete configuration.size;
  }

  if (type === 'Trait') {
    const currentTraitType = String(configuration.type || 'skills');
    const currentMode = String(configuration.mode || 'default');
    const traitModeEnabledTypes = new Set(['skills', 'saves', 'tools']);

    configuration = {
      ...configuration,
      type: currentTraitType,
      mode: traitModeEnabledTypes.has(currentTraitType) ? currentMode : 'default',
      allowReplacements: Boolean(configuration.allowReplacements ?? configuration.allowReplacement),
      choiceSource: configuration.choiceSource === 'scaling' ? 'scaling' : 'fixed',
      choiceCount: Math.max(0, Number(configuration.choiceCount || 0) || 0),
      fixed: uniqueStringEntries(configuration.fixed),
      options: uniqueStringEntries(configuration.options),
      replacements: uniqueStringEntries(configuration.replacements),
      categoryIds: uniqueStringEntries(configuration.categoryIds)
    };

    delete configuration.allowReplacement;

    if (configuration.choiceSource !== 'scaling') {
      delete configuration.scalingColumnId;
    }
  }

  (nextAdvancement as any).level = Math.max(1, Number((nextAdvancement as any).level || defaultLevel || 1) || 1);
  (nextAdvancement as any).title = typeof (nextAdvancement as any).title === 'string' ? (nextAdvancement as any).title : '';
  (nextAdvancement as any).configuration = configuration;
  return nextAdvancement;
}

export function normalizeAdvancementListForEditor<T extends { type?: string; configuration?: any; level?: any; title?: any }>(
  values: T[] = [],
  options: {
    defaultLevel: number;
    defaultHitDie: number;
  }
) {
  return (Array.isArray(values) ? values : []).map((value) => normalizeAdvancementForEditor(value, options));
}

export function getCanonicalTraitChoiceEntries(configuration: any = {}): CanonicalTraitChoiceEntry[] {
  const legacyEntries = Array.isArray(configuration?.choices)
    ? configuration.choices
        .map((entry: any, index: number) => ({
          id: String(entry?.id || `legacy-${index}`),
          count: Math.max(0, Number(entry?.count || 0) || 0),
          type: String(entry?.type || configuration?.type || 'skills'),
          pool: uniqueStringEntries(entry?.pool || []),
          categoryIds: uniqueStringEntries(entry?.categoryIds || [])
        }))
        .filter((entry: CanonicalTraitChoiceEntry) => entry.count > 0 && (entry.pool.length > 0 || (entry.categoryIds?.length || 0) > 0))
    : [];

  if (legacyEntries.length > 0) return legacyEntries;

  const optionPool = uniqueStringEntries(configuration?.options || []);
  const categoryIds = uniqueStringEntries(configuration?.categoryIds || []);
  const choiceCount = Math.max(0, Number(configuration?.choiceCount || 0) || 0);
  if ((optionPool.length === 0 && categoryIds.length === 0) || choiceCount <= 0) return [];

  return [
    {
      id: String(configuration?.type || 'skills'),
      count: choiceCount,
      type: String(configuration?.type || 'skills'),
      pool: optionPool,
      categoryIds
    }
  ];
}
