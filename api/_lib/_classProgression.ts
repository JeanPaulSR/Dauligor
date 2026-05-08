function trimString(value: any) {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: any[] = []) {
  return Array.from(new Set(values.map((value) => trimString(value)).filter(Boolean)));
}

function sortAdvancementsByLevelThenType(a: any, b: any) {
  const levelA = Number(a?.level || 0) || 0;
  const levelB = Number(b?.level || 0) || 0;
  if (levelA !== levelB) return levelA - levelB;
  return trimString(a?.type).localeCompare(trimString(b?.type));
}

export function buildCanonicalBaseClassAdvancements({
  advancements,
  hitDie,
  proficiencies,
  savingThrows,
  subclassTitle,
  subclassFeatureLevels,
  asiLevels
}: {
  advancements: any[];
  hitDie: number;
  proficiencies: any;
  savingThrows?: string[];
  subclassTitle: string;
  subclassFeatureLevels: number[];
  asiLevels: number[];
}) {
  const existingById = new Map(asArray(advancements).map((adv: any) => [adv._id, adv]));
  const baseItems = existingById.get('base-items');
  const baseSubclass = existingById.get('base-subclass');
  const normalizedSavingThrows = Array.from(new Set(
    asArray(proficiencies?.savingThrows?.fixedIds).length
      ? asArray(proficiencies?.savingThrows?.fixedIds)
      : asArray(savingThrows)
  ));
  const subclassLevel = Number(subclassFeatureLevels?.[0] || baseSubclass?.level || 3) || 3;

  const defaults = [
    {
      _id: 'base-hp',
      type: 'HitPoints',
      level: 1,
      title: 'Hit Points',
      isBase: true,
      configuration: { hitDie: hitDie || 8 }
    },
    {
      _id: 'base-saves',
      type: 'Trait',
      level: 1,
      title: 'Saving Throw Proficiencies',
      isBase: true,
      configuration: {
        type: 'saves',
        fixed: normalizedSavingThrows,
        options: asArray(proficiencies?.savingThrows?.optionIds),
        choiceCount: Number(proficiencies?.savingThrows?.choiceCount || 0) || 0,
        mode: 'default'
      }
    },
    {
      _id: 'base-armor',
      type: 'Trait',
      level: 1,
      title: 'Armor Proficiencies',
      isBase: true,
      configuration: {
        type: 'armor',
        fixed: asArray(proficiencies?.armor?.fixedIds),
        options: asArray(proficiencies?.armor?.optionIds),
        choiceCount: Number(proficiencies?.armor?.choiceCount || 0) || 0,
        categoryIds: asArray(proficiencies?.armor?.categoryIds),
        mode: 'default'
      }
    },
    {
      _id: 'base-weapons',
      type: 'Trait',
      level: 1,
      title: 'Weapon Proficiencies',
      isBase: true,
      configuration: {
        type: 'weapons',
        fixed: asArray(proficiencies?.weapons?.fixedIds),
        options: asArray(proficiencies?.weapons?.optionIds),
        choiceCount: Number(proficiencies?.weapons?.choiceCount || 0) || 0,
        categoryIds: asArray(proficiencies?.weapons?.categoryIds),
        mode: 'default'
      }
    },
    {
      _id: 'base-skills',
      type: 'Trait',
      level: 1,
      title: 'Skill Proficiencies',
      isBase: true,
      configuration: {
        type: 'skills',
        fixed: asArray(proficiencies?.skills?.fixedIds),
        options: asArray(proficiencies?.skills?.optionIds),
        choiceCount: Number(proficiencies?.skills?.choiceCount || 0) || 0,
        mode: 'default'
      }
    },
    {
      _id: 'base-tools',
      type: 'Trait',
      level: 1,
      title: 'Tool Proficiencies',
      isBase: true,
      configuration: {
        type: 'tools',
        fixed: asArray(proficiencies?.tools?.fixedIds),
        options: asArray(proficiencies?.tools?.optionIds),
        choiceCount: Number(proficiencies?.tools?.choiceCount || 0) || 0,
        categoryIds: asArray(proficiencies?.tools?.categoryIds),
        mode: 'default'
      }
    },
    {
      _id: 'base-languages',
      type: 'Trait',
      level: 1,
      title: 'Languages',
      isBase: true,
      configuration: {
        type: 'languages',
        fixed: asArray(proficiencies?.languages?.fixedIds),
        options: asArray(proficiencies?.languages?.optionIds),
        choiceCount: Number(proficiencies?.languages?.choiceCount || 0) || 0,
        categoryIds: asArray(proficiencies?.languages?.categoryIds),
        mode: 'default'
      }
    },
    {
      _id: 'base-items',
      type: 'ItemChoice',
      level: 1,
      title: baseItems?.title || 'Starting Equipment Choices',
      isBase: true,
      configuration: {
        ...(baseItems?.configuration || {}),
        choiceType: baseItems?.configuration?.choiceType || 'item',
        pool: asArray(baseItems?.configuration?.pool),
        count: Number(baseItems?.configuration?.count || 1) || 1
      }
    },
    {
      _id: 'base-subclass',
      type: 'Subclass',
      level: subclassLevel,
      title: trimString(subclassTitle) || baseSubclass?.title || 'Select Subclass',
      isBase: true,
      configuration: {
        ...(baseSubclass?.configuration || {})
      }
    }
  ];

  asArray(asiLevels)
    .map((level) => Number(level))
    .filter(Boolean)
    .forEach((level, index) => {
      defaults.push({
        _id: `base-asi-${index}`,
        type: 'AbilityScoreImprovement',
        level,
        title: 'Ability Score Improvement',
        isBase: true,
        configuration: {
          points: 2,
          featAllowed: true
        }
      });
    });

  const customAdvancements = asArray(advancements).filter((advancement: any) => isCustomClassAdvancement(advancement));

  const syncedBaseAdvancements = defaults.map((baseAdvancement) => {
    const existing = existingById.get(baseAdvancement._id);
    if (!existing) return baseAdvancement;
    return {
      ...existing,
      ...baseAdvancement,
      configuration: {
        ...(existing.configuration || {}),
        ...(baseAdvancement.configuration || {})
      }
    };
  });

  return [...syncedBaseAdvancements, ...customAdvancements].sort(sortAdvancementsByLevelThenType);
}

export function isCustomClassAdvancement(advancement: any) {
  const id = trimString(advancement?._id);
  if (!id) return true;
  if (id === 'base-items') return false;
  if (id.startsWith('base-')) return false;
  if (id.startsWith('implicit-class-features-')) return false;
  return true;
}

export function isCustomSubclassAdvancement(advancement: any) {
  const id = trimString(advancement?._id);
  if (!id) return true;
  if (id.startsWith('inherent-subclass-feature-grant-')) return false;
  if (id.startsWith('implicit-subclass-features-')) return false;
  return true;
}

export function collectExplicitGrantedFeatureRefs(advancements: any[] = []) {
  const granted = new Set<string>();

  advancements.forEach((advancement) => {
    if (trimString(advancement?.type) !== 'ItemGrant') return;
    if (trimString(advancement?.featureId)) granted.add(trimString(advancement.featureId));
    if (trimString(advancement?.featureSourceId)) granted.add(trimString(advancement.featureSourceId));

    asArray(advancement?.configuration?.pool).forEach((entry: any) => granted.add(trimString(entry)));
    asArray(advancement?.configuration?.optionalPool).forEach((entry: any) => granted.add(trimString(entry)));
    asArray(advancement?.configuration?.items).forEach((entry: any) => {
      const sourceId = trimString(entry?.sourceId);
      const uuid = trimString(entry?.uuid);
      if (sourceId) granted.add(sourceId);
      if (uuid) granted.add(uuid);
    });
  });

  return granted;
}

export function buildInherentFeatureGrantAdvancements(features: any[] = [], existingAdvancements: any[] = [], prefix: string) {
  const explicitlyGranted = collectExplicitGrantedFeatureRefs(existingAdvancements);

  return asArray(features)
    .filter((feature) => !explicitlyGranted.has(feature.id) && !explicitlyGranted.has(feature.sourceId))
    .map((feature) => ({
      _id: `${prefix}-${feature.identifier || feature.id}`,
      type: 'ItemGrant',
      level: Number(feature.level || 1) || 1,
      title: feature.name || 'Grant Feature',
      featureId: feature.id,
      configuration: {
        choiceType: 'feature',
        optional: false,
        items: [{ uuid: feature.id, optional: false }]
      }
    }));
}

export function buildCanonicalClassProgression({
  advancements,
  hitDie,
  proficiencies,
  savingThrows,
  subclassTitle,
  subclassFeatureLevels,
  asiLevels,
  features = [],
  implicitGrantPrefix = 'implicit-class-features',
  includeImplicitFeatureGrants = false
}: {
  advancements: any[];
  hitDie: number;
  proficiencies: any;
  savingThrows?: string[];
  subclassTitle: string;
  subclassFeatureLevels: number[];
  asiLevels: number[];
  features?: any[];
  implicitGrantPrefix?: string;
  includeImplicitFeatureGrants?: boolean;
}) {
  const baseAndCustomAdvancements = buildCanonicalBaseClassAdvancements({
    advancements,
    hitDie,
    proficiencies,
    savingThrows,
    subclassTitle,
    subclassFeatureLevels,
    asiLevels
  });

  const baseAdvancements = baseAndCustomAdvancements.filter((advancement: any) => advancement?.isBase);
  const customAdvancements = baseAndCustomAdvancements.filter((advancement: any) => !advancement?.isBase);
  const implicitFeatureGrants = includeImplicitFeatureGrants
    ? buildInherentFeatureGrantAdvancements(features, advancements, implicitGrantPrefix)
    : [];

  const combinedAdvancements = [...baseAdvancements, ...implicitFeatureGrants, ...customAdvancements].sort(sortAdvancementsByLevelThenType);

  return {
    baseAdvancements,
    customAdvancements,
    implicitFeatureGrants,
    combinedAdvancements
  };
}

export function buildCanonicalSubclassProgression({
  advancements,
  features = [],
  implicitGrantPrefix = 'inherent-subclass-feature-grant',
  includeImplicitFeatureGrants = false
}: {
  advancements: any[];
  features?: any[];
  implicitGrantPrefix?: string;
  includeImplicitFeatureGrants?: boolean;
}) {
  const customAdvancements = asArray(advancements)
    .filter((advancement: any) => isCustomSubclassAdvancement(advancement))
    .sort(sortAdvancementsByLevelThenType);

  const implicitFeatureGrants = includeImplicitFeatureGrants
    ? buildInherentFeatureGrantAdvancements(features, advancements, implicitGrantPrefix).sort(sortAdvancementsByLevelThenType)
    : [];

  const combinedAdvancements = [...implicitFeatureGrants, ...customAdvancements].sort(sortAdvancementsByLevelThenType);

  return {
    customAdvancements,
    implicitFeatureGrants,
    combinedAdvancements
  };
}
