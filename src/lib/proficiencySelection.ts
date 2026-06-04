/**
 * Shared proficiency-selection model + helpers.
 * ─────────────────────────────────────────────
 * The class editor models granted/choosable proficiencies as, per kind:
 *
 *   { choiceCount, fixedIds[], optionIds[], categoryIds[] }
 *
 * — `fixedIds` are always granted, `optionIds` form the "choose N" pool
 * (`choiceCount`), and `categoryIds` records whole-category grants for display.
 * The identifiers are the skills/tools/languages/armor/weapons table ids (the
 * dnd5e-aligned keys). The class export (`_classExport`) normalizes these.
 *
 * These helpers were lifted verbatim out of ClassEditor so the shared
 * `ProficienciesEditor` component (and the background editor) operate on the
 * exact same model and the export stays identical. ClassEditor will migrate to
 * import from here in a follow-up; until then the two copies are intentionally
 * identical.
 */

export type ProficiencySelection = {
  choiceCount: number;
  fixedIds: string[];
  optionIds: string[];
  categoryIds?: string[];
  categoryMeleeIds?: string[];
  categoryRangedIds?: string[];
};

export type GroupedProficiencyType = 'armor' | 'weapons' | 'tools' | 'languages';

export function normalizeChoiceCount(value: any): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function uniqueNormalizedIds(
  values: any[] = [],
  { uppercase = false }: { uppercase?: boolean } = {},
): string[] {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => {
        const normalized = String(value ?? '').trim();
        if (!normalized) return '';
        return uppercase ? normalized.toUpperCase() : normalized;
      })
      .filter(Boolean),
  ));
}

export function sanitizeProficiencySelection(
  selection: any,
  {
    uppercase = false,
    includeCategories = true,
    includeWeaponTypeFilters = false,
  }: { uppercase?: boolean; includeCategories?: boolean; includeWeaponTypeFilters?: boolean } = {},
): ProficiencySelection {
  const fixedIds = uniqueNormalizedIds(selection?.fixedIds || [], { uppercase });
  const fixedSet = new Set(fixedIds);
  const optionIds = uniqueNormalizedIds(selection?.optionIds || [], { uppercase }).filter((id) => !fixedSet.has(id));
  const normalized: ProficiencySelection = {
    choiceCount: normalizeChoiceCount(selection?.choiceCount),
    optionIds,
    fixedIds,
  };
  if (includeCategories) {
    normalized.categoryIds = uniqueNormalizedIds(selection?.categoryIds || []);
  }
  if (includeWeaponTypeFilters) {
    normalized.categoryMeleeIds = uniqueNormalizedIds(selection?.categoryMeleeIds || []);
    normalized.categoryRangedIds = uniqueNormalizedIds(selection?.categoryRangedIds || []);
  }
  return normalized;
}

/**
 * Toggle a whole group of items (a category, or any list) on/off in a
 * fixed/option target, returning the next collection. Mirrors the class
 * editor's `toggleGroup` behaviour exactly (overlap allowed; category id
 * tracked for display).
 */
export function buildNextGroupedProficiencyCollection(
  collection: any,
  items: any[],
  type: string,
  target: 'fixedIds' | 'optionIds',
  categoryId?: string,
): any {
  const section = collection?.[type] || {};
  const currentIds = new Set<string>((section[target] || []) as string[]);
  const itemIds = (items || []).map((item) => item.id).filter(Boolean) as string[];
  const allExist = itemIds.every((itemId) => currentIds.has(itemId));

  let nextIds: string[];
  if (allExist) {
    nextIds = Array.from(currentIds).filter((id) => !itemIds.includes(id));
  } else {
    nextIds = Array.from(new Set([...Array.from(currentIds), ...itemIds]));
  }

  const otherTarget = target === 'fixedIds' ? 'optionIds' : 'fixedIds';
  const nextOtherIds = (section[otherTarget] || []) as string[];

  const currentCatIds = (section.categoryIds || []) as string[];
  let nextCatIds = currentCatIds;
  if (categoryId) {
    nextCatIds = allExist
      ? currentCatIds.filter((id: string) => id !== categoryId)
      : Array.from(new Set([...currentCatIds, categoryId]));
  }

  const nextSection: any = {
    ...section,
    [target]: nextIds,
    [otherTarget]: nextOtherIds,
    categoryIds: nextCatIds,
  };

  if (type === 'weapons' && categoryId && !allExist) {
    nextSection.categoryMeleeIds = (section.categoryMeleeIds || []).filter((id: string) => id !== categoryId);
    nextSection.categoryRangedIds = (section.categoryRangedIds || []).filter((id: string) => id !== categoryId);
  }

  return { ...collection, [type]: nextSection };
}

function joinDisplaySegments(fixedSegments: string[], choiceSegments: string[]): string {
  const fixedText = fixedSegments.filter(Boolean).join(', ');
  const choiceText = choiceSegments.filter(Boolean).join('; and ');
  if (fixedText && choiceText) return `${fixedText}; and ${choiceText}`;
  return fixedText || choiceText;
}

/**
 * Build the readable "Athletics, History; and 1 of your choice from …" phrase
 * for a selection. Used for the display-name Sync button (class) and the
 * read-only proficiency lines (background view/preview).
 */
export function buildGroupedProficiencyDisplayName(
  selection: any,
  items: any[] = [],
  categories: any[] = [],
): string {
  const fixedIds = new Set(selection?.fixedIds || []);
  const optionIds = new Set(selection?.optionIds || []);
  const choiceCount = Math.max(normalizeChoiceCount(selection?.choiceCount), 1);
  const categoryList = Array.isArray(categories) ? categories : [];
  const itemList = Array.isArray(items) ? items : [];
  const itemsByCategory = new Map<string, any[]>();

  for (const item of itemList) {
    const categoryId = String(item?.categoryId || '').trim();
    if (!categoryId) continue;
    if (!itemsByCategory.has(categoryId)) itemsByCategory.set(categoryId, []);
    itemsByCategory.get(categoryId)?.push(item);
  }

  const fixedCategoryIds = new Set<string>();
  const optionCategoryIds = new Set<string>();
  for (const category of categoryList) {
    const categoryId = String(category?.id || '').trim();
    if (!categoryId) continue;
    const categoryItems = itemsByCategory.get(categoryId) || [];
    if (categoryItems.length === 0) continue;
    if (categoryItems.every((item) => fixedIds.has(item.id))) { fixedCategoryIds.add(categoryId); continue; }
    if (categoryItems.every((item) => optionIds.has(item.id))) optionCategoryIds.add(categoryId);
  }

  const fixedSegments = categoryList
    .filter((category) => fixedCategoryIds.has(String(category?.id || '')))
    .map((category) => String(category?.name || '').trim())
    .filter(Boolean);
  const fixedItemSegments = itemList
    .filter((item) => fixedIds.has(item.id) && !fixedCategoryIds.has(String(item?.categoryId || '')))
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);
  const optionEntries = [
    ...categoryList
      .filter((category) => optionCategoryIds.has(String(category?.id || '')))
      .map((category) => String(category?.name || '').trim())
      .filter(Boolean),
    ...itemList
      .filter((item) => optionIds.has(item.id) && !fixedIds.has(item.id) && !optionCategoryIds.has(String(item?.categoryId || '')))
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean),
  ];

  const choiceSegments = optionEntries.length === 0
    ? []
    : optionEntries.length === 1
      ? [`${choiceCount} ${optionEntries[0]} of your choice`]
      : [`${choiceCount} of your choice from ${optionEntries.join(', ')}`];

  return joinDisplaySegments([...fixedSegments, ...fixedItemSegments], choiceSegments);
}
