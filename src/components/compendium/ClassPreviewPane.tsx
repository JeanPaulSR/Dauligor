import React, { useState, useEffect } from 'react';
import { Edit } from 'lucide-react';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import { calculateEffectiveCastingLevel, getSpellSlotsForLevel, buildPactDisplayTable } from '../../lib/spellcasting';
import { cn } from '../../lib/utils';
import { isColumnHidden, levelSeriesHasValue, formatKnownCell } from '../../lib/classTableColumns';
import { motion } from 'motion/react';
import BBCodeRenderer from '../BBCodeRenderer';
import FeaturesView from './FeaturesView';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent } from '../ui/dialog';
import { imageFocalStyle as ClassImageStyle, DEFAULT_DISPLAY } from '../ui/FocalImageEditor';

/**
 * Foundation lookups the preview pane needs to render proficiency / tag /
 * spellcasting detail. These are the same ~12 catalogue tables ClassList
 * already loads once; the pane can either receive them as a prop (DRY reuse
 * from a host that already has them) or load its own via `useClassPaneFoundation`.
 */
export interface ClassPaneFoundation {
  allTags: any[];
  allAttributes: any[];
  allSkills: any[];
  allTools: any[];
  allArmorCategories: any[];
  allWeaponCategories: any[];
  allToolCategories: any[];
  allArmor: any[];
  allWeapons: any[];
  sources: Record<string, any>;
  spellcastingTypes: any[];
  masterMulticlassChart: any | null;
  pactMasterChart: any | null;
}

const EMPTY_FOUNDATION: ClassPaneFoundation = {
  allTags: [],
  allAttributes: [],
  allSkills: [],
  allTools: [],
  allArmorCategories: [],
  allWeaponCategories: [],
  allToolCategories: [],
  allArmor: [],
  allWeapons: [],
  sources: {},
  spellcastingTypes: [],
  masterMulticlassChart: null,
  pactMasterChart: null,
};

/**
 * Loads the catalogue lookups the pane renders against. Used when the pane is
 * opened standalone (e.g. from a `@class[…]` reference click) and there is no
 * host that already holds this data. ClassList passes its own pre-loaded
 * foundation instead, so it doesn't double-fetch.
 *
 * `enabled` gates the fetch so a standalone caller can mount the pane closed
 * without paying the catalogue cost until it actually opens.
 */
export function useClassPaneFoundation(enabled: boolean = true): { foundation: ClassPaneFoundation; loading: boolean } {
  const [foundation, setFoundation] = useState<ClassPaneFoundation>(EMPTY_FOUNDATION);
  const [loading, setLoading] = useState(enabled);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const [
          sourcesData,
          tagsData,
          skillsData,
          toolsData,
          toolCatsData,
          weaponCatsData,
          armorCatsData,
          armorData,
          weaponsData,
          attrsData,
          typesData,
          masterChartData,
          pactChartData,
        ] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags'),
          fetchCollection<any>('skills'),
          fetchCollection<any>('tools'),
          fetchCollection<any>('toolCategories'),
          fetchCollection<any>('weaponCategories'),
          fetchCollection<any>('armorCategories'),
          fetchCollection<any>('armor'),
          fetchCollection<any>('weapons'),
          fetchCollection<any>('attributes'),
          fetchCollection<any>('spellcastingTypes'),
          fetchDocument<any>('standardMulticlassProgression', 'master'),
          fetchDocument<any>('pactMasterChart', 'pact'),
        ]);

        if (cancelled) return;

        const sourceMap: Record<string, any> = {};
        sourcesData.forEach((s: any) => (sourceMap[s.id] = s));

        const uniqueAttrsMap = new Map();
        attrsData.forEach((item: any) => {
          const key = (item.identifier || item.id).toUpperCase();
          if (!uniqueAttrsMap.has(key) || item.identifier) {
            uniqueAttrsMap.set(key, item);
          }
        });

        const chart = masterChartData
          ? {
              ...masterChartData,
              levels:
                typeof masterChartData.levels === 'string'
                  ? JSON.parse(masterChartData.levels)
                  : masterChartData.levels || [],
            }
          : null;

        const pactChart = pactChartData
          ? {
              ...pactChartData,
              levels:
                typeof pactChartData.levels === 'string'
                  ? JSON.parse(pactChartData.levels)
                  : pactChartData.levels || [],
            }
          : null;

        setFoundation({
          sources: sourceMap,
          allTags: tagsData,
          allSkills: skillsData,
          allTools: toolsData,
          allToolCategories: toolCatsData,
          allWeaponCategories: weaponCatsData,
          allArmorCategories: armorCatsData,
          allArmor: armorData,
          allWeapons: weaponsData.map((w: any) => ({
            ...w,
            propertyIds:
              typeof w.property_ids === 'string'
                ? JSON.parse(w.property_ids)
                : w.property_ids || w.propertyIds || [],
          })),
          allAttributes: Array.from(uniqueAttrsMap.values()),
          spellcastingTypes: typesData,
          masterMulticlassChart: chart,
          pactMasterChart: pactChart,
        });
        setLoaded(true);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading foundation data for ClassPreviewPane:', err);
        setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded]);

  return { foundation, loading };
}

/** Everything the pane render reads about the selected class. */
export interface ClassPreviewData {
  /** The hydrated (full) class row, or null until resolved. */
  classData: any | null;
  features: any[];
  scalings: any[];
  spellcasting: any;
  altSpellcasting: any;
  spellsKnown: any;
  optionGroups: any[];
  optionItems: any[];
  loading: boolean;
}

/**
 * Resolves the full class document (if only a thin row / id was supplied) and
 * loads the preview's features, scaling columns, spellcasting progressions and
 * unique-option data. Encapsulates the effect that previously lived inline in
 * ClassList so the pane can be opened from just a class id.
 *
 * @param classInput  A class id (string) OR a (possibly thin) class object.
 * @param spellcastingTypes  Catalogue of spellcasting types (for virtual slots).
 * @param masterMulticlassChart  Master multiclass chart (for virtual slots).
 * @param enabled  When false, nothing is fetched (pane closed).
 */
export function useClassPreviewData(
  classInput: any | string | null,
  spellcastingTypes: any[],
  masterMulticlassChart: any | null,
  pactMasterChart: any | null,
  enabled: boolean = true,
): ClassPreviewData {
  const [classData, setClassData] = useState<any | null>(
    typeof classInput === 'object' ? classInput : null,
  );
  const [features, setFeatures] = useState<any[]>([]);
  const [scalings, setScalings] = useState<any[]>([]);
  const [spellcasting, setSpellcasting] = useState<any>(null);
  const [altSpellcasting, setAltSpellcasting] = useState<any>(null);
  const [spellsKnown, setSpellsKnown] = useState<any>(null);
  const [optionGroups, setOptionGroups] = useState<any[]>([]);
  const [optionItems, setOptionItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Identity key — re-resolve when the target class changes (by id) or when
  // the caller hands us a different object reference (hydration step swaps the
  // thin row for the full one).
  const inputId =
    typeof classInput === 'string' ? classInput : classInput?.id ?? null;

  // Keep `classData` in step with an object input that the caller swapped
  // (e.g. a different card clicked). For a string id we resolve via fetch.
  useEffect(() => {
    if (typeof classInput === 'object') {
      setClassData(classInput);
    } else if (classInput == null) {
      setClassData(null);
    }
    // string ids are hydrated inside the loader effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classInput]);

  useEffect(() => {
    if (!enabled || !inputId) return;

    let cancelled = false;
    setLoading(true);

    const loadData = async () => {
      try {
        // 1. Resolve the full class document. We need the full row whenever the
        //    current object lacks `proficiencies` (thin grid row) or we were
        //    only handed an id.
        let currentClass: any =
          typeof classInput === 'object' ? classInput : classData;

        if (!currentClass || currentClass.id !== inputId || !currentClass.proficiencies) {
          const fullDoc = await fetchDocument<any>('classes', inputId);
          if (!fullDoc) {
            if (!cancelled) setLoading(false);
            return;
          }

          // Parse JSON columns and remap snake_case → camelCase
          currentClass = {
            ...fullDoc,
            sourceId: fullDoc.source_id,
            tagIds:
              typeof fullDoc.tag_ids === 'string'
                ? JSON.parse(fullDoc.tag_ids)
                : fullDoc.tag_ids ?? [],
            imageUrl: fullDoc.image_url,
            cardImageUrl: fullDoc.card_image_url,
            previewImageUrl: fullDoc.preview_image_url,
            cardDisplay:
              typeof fullDoc.card_display === 'string'
                ? JSON.parse(fullDoc.card_display)
                : fullDoc.card_display ?? null,
            imageDisplay:
              typeof fullDoc.image_display === 'string'
                ? JSON.parse(fullDoc.image_display)
                : fullDoc.image_display ?? null,
            previewDisplay:
              typeof fullDoc.preview_display === 'string'
                ? JSON.parse(fullDoc.preview_display)
                : fullDoc.preview_display ?? null,
            proficiencies:
              typeof fullDoc.proficiencies === 'string'
                ? JSON.parse(fullDoc.proficiencies)
                : fullDoc.proficiencies ?? {},
            spellcasting:
              typeof fullDoc.spellcasting === 'string'
                ? JSON.parse(fullDoc.spellcasting)
                : fullDoc.spellcasting ?? {},
            advancements:
              typeof fullDoc.advancements === 'string'
                ? JSON.parse(fullDoc.advancements)
                : fullDoc.advancements ?? [],
            primaryAbility:
              typeof fullDoc.primary_ability === 'string'
                ? JSON.parse(fullDoc.primary_ability)
                : fullDoc.primary_ability ?? [],
            primaryAbilityChoice:
              typeof fullDoc.primary_ability_choice === 'string'
                ? JSON.parse(fullDoc.primary_ability_choice)
                : fullDoc.primary_ability_choice ?? [],
            savingThrows:
              typeof fullDoc.saving_throws === 'string'
                ? JSON.parse(fullDoc.saving_throws)
                : fullDoc.saving_throws ?? [],
            subclassFeatureLevels:
              typeof fullDoc.subclass_feature_levels === 'string'
                ? JSON.parse(fullDoc.subclass_feature_levels)
                : fullDoc.subclass_feature_levels ?? [],
            subclassTitle: fullDoc.subclass_title || 'Subclass',
          };
          if (!cancelled) setClassData(currentClass);
        }

        // 2. Load Features & Scalings
        const featuresPromise = fetchCollection<any>('features', {
          where: 'parent_id = ? AND parent_type = ?',
          params: [currentClass.id, 'class'],
          orderBy: 'level ASC',
        });

        const scalingsPromise = fetchCollection<any>('scaling_columns', {
          where: 'parent_id = ? AND parent_type = ?',
          params: [currentClass.id, 'class'],
          orderBy: 'name ASC',
        });

        const [featuresData, scalingsData] = await Promise.all([
          featuresPromise,
          scalingsPromise,
        ]);

        if (cancelled) return;

        setFeatures(
          featuresData.map((row) => ({
            ...row,
            parentId: row.parent_id,
            parentType: row.parent_type,
            imageUrl: row.image_url,
            isSubclassFeature:
              row.parent_type === 'subclass' || row.is_subclass_feature === 1,
            advancements:
              typeof row.advancements === 'string'
                ? JSON.parse(row.advancements)
                : row.advancements ?? [],
          })),
        );

        setScalings(
          scalingsData.map((row) => ({
            ...row,
            parentId: row.parent_id,
            parentType: row.parent_type,
            values:
              typeof row.values === 'string' ? JSON.parse(row.values) : row.values ?? {},
          })),
        );

        // 3. Load Spellcasting progression data
        const allPromises: Promise<any>[] = [];
        setSpellcasting(null);
        setAltSpellcasting(null);
        setSpellsKnown(null);

        if (currentClass.spellcasting?.hasSpellcasting) {
          const sc = currentClass.spellcasting;
          const parseLevels = (data: any) => {
            if (!data) return null;
            return {
              ...data,
              levels:
                typeof data.levels === 'string'
                  ? JSON.parse(data.levels)
                  : data.levels || [],
            };
          };

          if (sc.castingMode === 'pact') {
            // Pact casters: slots from the Pact Master Chart, shown via the
            // Slot Count / Slot Level (alt) columns — no standard slot table.
            if (!cancelled) {
              setSpellcasting(null);
              setAltSpellcasting(buildPactDisplayTable(sc, spellcastingTypes, pactMasterChart));
            }
          } else if (sc.manualProgressionId) {
            allPromises.push(
              fetchDocument<any>('spellcastingScalings', sc.manualProgressionId).then(
                (data) => !cancelled && setSpellcasting(parseLevels(data)),
              ),
            );
          } else if (sc.progressionId && spellcastingTypes.length > 0 && masterMulticlassChart) {
            const type = spellcastingTypes.find((t) => t.id === sc.progressionId);
            if (type) {
              const virtualLevels: Record<string, any> = {};
              for (let level = 1; level <= 20; level++) {
                const effectiveLevel = calculateEffectiveCastingLevel(level, type.formula);
                const slots = getSpellSlotsForLevel(
                  effectiveLevel,
                  masterMulticlassChart.levels || [],
                );
                virtualLevels[level.toString()] = { slots };
              }
              if (!cancelled) setSpellcasting({ name: type.name, levels: virtualLevels });
            }
          }
          if (sc.castingMode !== 'pact' && sc.altProgressionId) {
            allPromises.push(
              fetchDocument<any>('pactMagicScalings', sc.altProgressionId).then(
                (data) => !cancelled && setAltSpellcasting(parseLevels(data)),
              ),
            );
          }
          if (sc.spellsKnownId) {
            allPromises.push(
              fetchDocument<any>('spellsKnownScalings', sc.spellsKnownId).then(
                (data) => !cancelled && setSpellsKnown(parseLevels(data)),
              ),
            );
          }
        }

        // 4. Load Unique Options from advancements
        const allGroupIds = [
          ...(currentClass.advancements || []).flatMap((a: any) => a.optionGroupIds || []),
          ...(featuresData || []).flatMap((f: any) =>
            (f.advancements || []).flatMap((a: any) => a.optionGroupIds || []),
          ),
        ].filter((id, index, self) => id && self.indexOf(id) === index);

        if (allGroupIds.length > 0) {
          const cappedIds = allGroupIds.slice(0, 30);
          allPromises.push(
            fetchCollection<any>('unique_option_groups', {
              where: `id IN (${cappedIds.map(() => '?').join(',')})`,
              params: cappedIds,
            }).then((data) => !cancelled && setOptionGroups(data)),
          );

          allPromises.push(
            fetchCollection<any>('unique_option_items', {
              where: `group_id IN (${cappedIds.map(() => '?').join(',')})`,
              params: cappedIds,
              orderBy: 'name ASC',
            }).then((data) => !cancelled && setOptionItems(data)),
          );
        }

        await Promise.all(allPromises);

        if (cancelled) return;
        // Small timeout to allow state updates to settle
        setTimeout(() => {
          if (!cancelled) setLoading(false);
        }, 300);
      } catch (err) {
        console.error('Error loading preview details:', err);
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
    // `classData` deliberately omitted: it's a derived output of this effect
    // (we set it here). Re-running on its change would loop. Resolution is
    // keyed on the input identity + the catalogue inputs used for virtual slots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputId, enabled, spellcastingTypes.length, !!masterMulticlassChart, !!pactMasterChart]);

  return {
    classData,
    features,
    scalings,
    spellcasting,
    altSpellcasting,
    spellsKnown,
    optionGroups,
    optionItems,
    loading,
  };
}

const getProficiencyBonus = (level: number) => Math.floor((level - 1) / 4) + 2;

export interface ClassPreviewPaneProps {
  /** Open the pane from a full/thin class object… */
  classData?: any | null;
  /** …or from just an id (the pane self-fetches the full row). */
  classId?: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * Pre-loaded catalogue lookups. Pass these from a host that already holds
   * them (ClassList) to avoid a double-fetch. Omit to have the pane load its
   * own via `useClassPaneFoundation`.
   */
  foundation?: ClassPaneFoundation;
  /** Render the "View Page" button → invoked with the resolved class. */
  onViewPage?: (cls: any) => void;
  /** Render the "Edit" button → invoked with the resolved class. */
  onEdit?: (cls: any) => void;
  /** Selection mode: render Select / Cancel instead of View Page / Edit. */
  selectionMode?: boolean;
  /** Selection-mode confirm handler. */
  onSelect?: (cls: any) => void;
  /** Selection-mode cancel handler (defaults to onClose). */
  onCancel?: () => void;
  /**
   * Style the Edit button as a primary action (proposal route) rather than the
   * default outline. Mirrors ClassList's `isProposalRoute` treatment.
   */
  editAsPrimary?: boolean;
}

/**
 * The class preview pane — extracted verbatim from ClassList so the exact same
 * modal renders both from the class grid AND, standalone, from a `@class[…]`
 * reference click. Openable from just a class id: it self-fetches the full
 * class row, its features, scaling columns, spellcasting progressions and
 * unique options, and (when no `foundation` prop is supplied) the catalogue
 * lookups it renders against.
 *
 * The View Page / Edit / Select buttons render only when their callback (or
 * `selectionMode`) is provided, so a read-only reference overlay shows none of
 * the authoring affordances.
 */
export default function ClassPreviewPane({
  classData: classDataProp,
  classId,
  open,
  onClose,
  foundation: foundationProp,
  onViewPage,
  onEdit,
  selectionMode = false,
  onSelect,
  onCancel,
  editAsPrimary = false,
}: ClassPreviewPaneProps) {
  // Self-load the catalogue only when the host didn't provide it.
  const selfFoundation = useClassPaneFoundation(open && !foundationProp);
  const foundation = foundationProp ?? selfFoundation.foundation;

  const {
    allTags,
    allAttributes,
    allSkills,
    allTools,
    allArmorCategories,
    allWeaponCategories,
    allToolCategories,
    allArmor,
    allWeapons,
    sources,
    spellcastingTypes,
    masterMulticlassChart,
    pactMasterChart,
  } = foundation;

  // The class identity passed to the data hook: prefer the object, else the id.
  const classInput = classDataProp ?? classId ?? null;

  const {
    classData: selectedClass,
    features: previewFeatures,
    scalings: previewScalings,
    spellcasting: previewSpellcasting,
    altSpellcasting: previewAltSpellcasting,
    spellsKnown: previewSpellsKnown,
    optionGroups: previewOptionGroups,
    optionItems: previewOptionItems,
    loading: previewLoading,
  } = useClassPreviewData(classInput, spellcastingTypes, masterMulticlassChart, pactMasterChart, open);

  const [previewSelectedOptions, setPreviewSelectedOptions] = useState<Record<string, string>>({});
  const [selectedPreviewFeatureId, setSelectedPreviewFeatureId] = useState<string | null>(null);

  // Reset transient selections when the target class changes.
  const classKey = selectedClass?.id ?? (typeof classInput === 'string' ? classInput : classInput?.id);
  useEffect(() => {
    setPreviewSelectedOptions({});
    setSelectedPreviewFeatureId(null);
  }, [classKey]);

  const minSubclassFeatureLevel =
    previewFeatures.filter((f) => f.isSubclassFeature).length > 0
      ? Math.min(...previewFeatures.filter((f) => f.isSubclassFeature).map((f) => f.level))
      : 0;

  const getPreviewFeaturesForLevel = (level: number) => {
    let levelFeatures = [...previewFeatures.filter((f) => f.level === level)];

    // Add root advancements for this level (only Ability Score Improvements)
    const rootAdvs = (selectedClass?.advancements || []).filter(
      (a: any) => a.level === level && a.type === 'AbilityScoreImprovement',
    );
    rootAdvs.forEach((adv: any) => {
      if (!levelFeatures.some((f) => f.name === 'Ability Score Improvement')) {
        levelFeatures.push({
          name: 'Ability Score Improvement',
          level: adv.level,
          isAdvancement: true,
        } as any);
      }
    });

    // Add subclass features from subclass progression
    const subclassLevels = selectedClass?.subclassFeatureLevels || [];
    if (subclassLevels.includes(level)) {
      const isFirst = level === Math.min(...subclassLevels);
      const title = selectedClass?.subclassTitle || 'Subclass';
      const name = isFirst ? title : `${title} Feature`;
      levelFeatures.push({
        name,
        level,
        isSubclassFeaturePlaceholder: true,
      } as any);
    }

    if (
      selectedClass?.spellcasting?.hasSpellcasting &&
      selectedClass.spellcasting.level === level
    ) {
      if (!levelFeatures.some((f) => f.name === 'Spellcasting')) {
        levelFeatures.push({
          name: 'Spellcasting',
          description: selectedClass.spellcasting.description,
          level: selectedClass.spellcasting.level,
        } as any);
      }
    }
    return levelFeatures;
  };

  const hasAnySpellsKnown = !!previewSpellsKnown;
  const hasAnyAltSpellcasting = !!previewAltSpellcasting;
  const hasAnySpellcasting = !!previewSpellcasting;
  // Mirror ClassView: drop author-hidden columns, and render Cantrips / Spells
  // Known independently so an all-zero series (e.g. a spellbook caster's
  // spells-known) doesn't show an empty column. See classTableColumns.
  const visiblePreviewScalings = previewScalings.filter(c => !isColumnHidden(c));
  const knownLevels = previewSpellsKnown?.levels;
  const showCantripsCol = hasAnySpellsKnown && levelSeriesHasValue(knownLevels, ['cantrips', 'cantripsKnown']);
  const showSpellsKnownCol = hasAnySpellsKnown && levelSeriesHasValue(knownLevels, ['spellsKnown', 'spells']);
  const spellAbilityAbbr = (selectedClass?.spellcasting?.ability || '').toUpperCase();

  const maxSpellLevel = React.useMemo(() => {
    if (!previewSpellcasting?.levels) return 0;
    let max = 0;
    Object.values(previewSpellcasting.levels).forEach((lvl: any) => {
      if (lvl.slots) {
        for (let i = lvl.slots.length - 1; i >= 0; i--) {
          if (lvl.slots[i] > 0) {
            if (i + 1 > max) max = i + 1;
            break;
          }
        }
      }
    });
    return max;
  }, [previewSpellcasting]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[90vh] bg-card border-gold p-0 flex flex-col shadow-2xl shadow-gold/25 overflow-hidden">
        {selectedClass && (
          <>
            {/* Background image — fills top half of the dialog, mask-fades to transparent */}
            {selectedClass.imageUrl && (
              <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none z-0">
                <img
                  src={selectedClass.previewImageUrl || selectedClass.imageUrl}
                  className="absolute inset-0 w-full h-full object-cover opacity-30"
                  style={{
                    ...ClassImageStyle({ display: selectedClass.previewDisplay || selectedClass.imageDisplay || DEFAULT_DISPLAY }),
                    maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
                  }}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  alt=""
                />
              </div>
            )}

            {/* Header */}
            <div className="relative bg-black/10 flex-shrink-0 z-10">
              <div className="absolute inset-0 bg-gradient-to-t from-background to-background/20 pointer-events-none" />
              <div className="relative p-6 px-8 flex items-center justify-between z-10">
                <div>
                  <h2 className="h1-title text-gold drop-shadow-md text-4xl">{selectedClass.name}</h2>
                  <p className="label-text text-gold/65 mt-1">{sources[selectedClass.source_id || selectedClass.sourceId]?.name || 'Unknown Source'}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-gold/15 border border-gold/25 px-3 py-1.5 rounded text-gold label-text">
                      Hit Die: d{selectedClass.hitDie || 8}
                    </div>
                    {selectionMode ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="border-gold/25 text-gold uppercase tracking-widest text-[10px] h-8" onClick={() => (onCancel ? onCancel() : onClose())}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => onSelect && onSelect(selectedClass)} className="btn-gold-solid shadow-lg shadow-gold/25 uppercase tracking-widest text-[10px] h-8">
                          Select Class
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        {/* View Page goes to the admin /compendium/classes/view/:id
                            route — only useful on the admin list. On the proposal
                            route, hide it so a content-creator's back-button flow
                            stays inside /proposals/edit/* end-to-end. Rendered only
                            when the host supplies an onViewPage handler. */}
                        {onViewPage && (
                          <Button size="sm" onClick={() => onViewPage(selectedClass)} className="btn-gold-solid shadow-lg shadow-gold/25 uppercase tracking-widest text-[10px] h-8">
                            View Page
                          </Button>
                        )}
                        {onEdit && (
                          <Button size="sm" variant={editAsPrimary ? undefined : "outline"} onClick={() => onEdit(selectedClass)} className={editAsPrimary ? "btn-gold-solid shadow-lg shadow-gold/25 uppercase tracking-widest text-[10px] h-8" : "border-gold/25 text-gold uppercase tracking-widest text-[10px] h-8"}>
                            <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto min-h-0 p-6 px-8 border-t border-gold/15 relative z-10 custom-scrollbar">
              <div className="space-y-10">
                {/* Class Table */}
                {previewLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center border border-gold/25 bg-card/50 backdrop-blur-sm rounded-lg space-y-4">
                    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    <span className="text-[10px] uppercase font-bold tracking-widest text-gold/65">Loading class table...</span>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="border border-gold/25 bg-card/50 backdrop-blur-sm rounded-lg overflow-x-auto custom-scrollbar"
                  >
                    <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-card z-10 shadow-md">
                      <tr className="border-b border-gold/25 bg-gold/5">
                        <th className="p-1 px-2 label-text italic text-gold text-center w-8 border-r border-gold/15 text-[10px]">Level</th>
                        <th className="p-1 px-2 label-text italic text-gold text-center w-10 border-r border-gold/15 text-[10px]">PB</th>
                        <th className="p-1 px-2 label-text italic text-gold border-r border-gold/15 text-[10px]">Features</th>
                        {visiblePreviewScalings.map(col => (
                          <th key={col.id} className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/15 text-[10px]">{col.name}</th>
                        ))}
                        {showCantripsCol && (
                          <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/15 text-[10px]">Cantrips</th>
                        )}
                        {showSpellsKnownCol && (
                          <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/15 text-[10px]">Spells Known</th>
                        )}
                        {hasAnyAltSpellcasting && (
                          <>
                            <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/15 text-[10px]">Slot Count</th>
                            <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/15 text-[10px]">Slot Level</th>
                          </>
                        )}
                        {hasAnySpellcasting && (
                          <th colSpan={maxSpellLevel} className="p-1 px-2 label-text italic text-gold text-center text-[10px]">Spell Slots per Level</th>
                        )}
                      </tr>
                      {hasAnySpellcasting && (
                        <tr className="border-b border-gold/15 bg-gold/5">
                          <th colSpan={3 + visiblePreviewScalings.length + (showCantripsCol ? 1 : 0) + (showSpellsKnownCol ? 1 : 0) + (hasAnyAltSpellcasting ? 2 : 0)} className="border-r border-gold/15"></th>
                          {Array.from({ length: maxSpellLevel }, (_, i) => i + 1).map(lvl => (
                            <th key={lvl} className="p-0.5 label-text italic text-gold text-center w-5 border-r border-gold/5 last:border-r-0 text-[10px]">
                              {lvl}{lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'}
                            </th>
                          ))}
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                        const levelFeatures = getPreviewFeaturesForLevel(level);
                        const pb = getProficiencyBonus(level);
                        const levelScaling = previewSpellcasting?.levels?.[level.toString()];
                        const levelAlt = previewAltSpellcasting?.levels?.[level.toString()];
                        const levelKnown = previewSpellsKnown?.levels?.[level.toString()];

                        return (
                          <tr key={level} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                            <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/45 border-r border-gold/5">{level}</td>
                            <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/65 border-r border-gold/5">+{pb}</td>
                            <td className="p-1 px-2 border-r border-gold/5">
                              <div className="flex flex-wrap gap-1">
                                {levelFeatures.map((f, idx) => (
                                  <span
                                    key={idx}
                                    className={cn(
                                      "text-[10px]",
                                      f.isAdvancement ? "text-gold/65 italic font-medium" : "font-bold text-gold/85"
                                    )}
                                  >
                                    {f.name.split(' (')[0]}{idx < levelFeatures.length - 1 ? ',' : ''}
                                  </span>
                                ))}
                                {levelFeatures.length === 0 && <span className="text-ink/25 text-[10px]">—</span>}
                              </div>
                            </td>
                            {visiblePreviewScalings.map(col => {
                              let displayValue = '—';
                              for (let l = level; l >= 1; l--) {
                                if (col.values[l.toString()]) {
                                  displayValue = col.values[l.toString()];
                                  break;
                                }
                              }
                              return (
                                <td key={col.id} className="p-1 px-2 text-center text-[10px] font-mono text-ink/65 border-r border-gold/5">
                                  {displayValue}
                                </td>
                              );
                            })}
                            {showCantripsCol && (
                              <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/65 border-r border-gold/5">{formatKnownCell(levelKnown?.cantrips ?? levelKnown?.cantripsKnown, spellAbilityAbbr)}</td>
                            )}
                            {showSpellsKnownCol && (
                              <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/65 border-r border-gold/5">{formatKnownCell(levelKnown?.spellsKnown ?? levelKnown?.spells, spellAbilityAbbr)}</td>
                            )}
                            {hasAnyAltSpellcasting && (
                              <>
                                <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/65 border-r border-gold/5">{levelAlt?.slotCount ?? '—'}</td>
                                <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/65 border-r border-gold/5">
                                  {levelAlt?.slotLevel ? `${levelAlt.slotLevel}${levelAlt.slotLevel === 1 ? 'st' : levelAlt.slotLevel === 2 ? 'nd' : levelAlt.slotLevel === 3 ? 'rd' : 'th'}` : '—'}
                                </td>
                              </>
                            )}
                            {hasAnySpellcasting && (levelScaling?.slots || Array(maxSpellLevel).fill(0)).slice(0, maxSpellLevel).map((slots: number, idx: number) => (
                              <td key={idx} className={`p-1 text-center font-mono text-[10px] border-r border-gold/5 last:border-r-0 ${slots > 0 ? 'text-ink font-bold' : 'text-ink/25'}`}>
                                {slots > 0 ? slots : '—'}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                    </table>
                  </motion.div>
                )}

                <div className="grid md:grid-cols-[1fr_250px] gap-8">
                  {/* Left Column: Core Features and Lore */}
                  <div className="space-y-8">
                    {/* Description Preview */}
                    {selectedClass.description && (
                      <div className="space-y-2">
                        <h3 className="h3-title text-gold border-b border-gold/15 pb-1 w-full">Class Description</h3>
                        <BBCodeRenderer content={selectedClass.description} className="body-text" />
                      </div>
                    )}

                    {/* Core Features Preview */}
                    <div className="space-y-4">
                      <h3 className="h3-title text-gold border-b border-gold/15 pb-1 w-full">Core Features</h3>
                      {previewLoading ? (
                        <div className="animate-pulse h-10 bg-gold/5 border border-gold/15 rounded" />
                      ) : previewFeatures.length > 0 ? (
                        <div>
                          <FeaturesView
                            items={previewFeatures.filter(f => !f.isSubclassFeature || f.level === minSubclassFeatureLevel)}
                            selectedId={selectedPreviewFeatureId}
                            onSelect={setSelectedPreviewFeatureId}
                            optionGroups={previewOptionGroups}
                            optionItems={previewOptionItems}
                            selectedOptions={previewSelectedOptions}
                            onSelectOption={(groupId, itemId) => setPreviewSelectedOptions(prev => ({ ...prev, [groupId]: itemId }))}
                            classId={selectedClass.id}
                            uniqueOptionMappings={selectedClass.uniqueOptionMappings}
                            hideChoices={true}
                            rootAdvancements={selectedClass.advancements || []}
                            hideAdvancementTypes={true}
                            hideAdvancements={true}
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-ink/45 italic">No features defined yet.</p>
                      )}
                    </div>

                    {/* Lore Section */}
                    {selectedClass.lore && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <h2 className="label-text text-gold shrink-0 uppercase tracking-widest font-bold">Class Lore within Setting</h2>
                          <div className="h-px bg-gold/15 w-full" />
                        </div>
                        <BBCodeRenderer content={selectedClass.lore} className="body-text" />
                      </div>
                    )}
                  </div>

                {/* Right Column: Proficiencies & Actions */}
                <div className="space-y-6">
                  <div className="bg-background/50 border border-gold/15 rounded-md p-4 space-y-4">
                    <h4 className="label-text text-gold border-b border-gold/15 pb-1">Proficiencies</h4>
                    <div className="space-y-3">
                      {['armor', 'weapons'].map(key => {
                        const prof = selectedClass.proficiencies?.[key];
                        const displayName = selectedClass.proficiencies?.[`${key}DisplayName`];
                        const categories = key === 'armor' ? allArmorCategories : allWeaponCategories;

                        let displayVal = 'None';
                        if (typeof prof === 'string') displayVal = prof;
                        else if (displayName) displayVal = displayName;
                        else if (prof && typeof prof === 'object') {
                           const fixed = prof.fixedIds || [];
                           const categoryIds = prof.categoryIds || [];
                           const catNames = categoryIds.map((cid: string) => categories.find(c => c.id === cid)?.name).filter(Boolean);

                           // If we have selected categories, show them first
                           if (catNames.length > 0) {
                             displayVal = catNames.join(', ');
                           } else if (fixed.length > 0) {
                             const items = key === 'armor' ? allArmor : allWeapons;
                             displayVal = fixed.map((id: string) => items.find(i => i.id === id)?.name).filter(Boolean).join(', ');
                           }
                        }

                        return (
                          <div key={key}>
                            <span className="block text-[10px] uppercase font-bold text-ink/45 mb-1">{key}</span>
                            <span className="text-xs text-ink/85">{displayVal}</span>
                          </div>
                        );
                      })}
                      <div className="space-y-1">
                        <span className="block text-[10px] uppercase font-bold text-ink/45 mb-1">Tools</span>
                        <span className="text-xs text-ink/85">
                          {(() => {
                            const tools = selectedClass.proficiencies?.tools;
                            const displayName = String(selectedClass.proficiencies?.toolsDisplayName || '').trim();
                            if (!tools || typeof tools === 'string') return tools || displayName || 'None';
                            if (displayName) return displayName;

                            const categoryIds = tools.categoryIds || [];
                            const catNames = categoryIds.map((cid: string) => allToolCategories.find(c => c.id === cid)?.name).filter(Boolean);

                            const fixed = (tools.fixedIds || [])
                              .filter((id: string) => {
                                // Hide if part of a selected category
                                const tool = allTools.find(t => t.id === id);
                                return !categoryIds.includes(tool?.categoryId);
                              })
                              .map((id: string) => allTools.find(t => t.id === id)?.name)
                              .filter(Boolean);

                            const options = (tools.optionIds || []).map((id: string) => allTools.find(t => t.id === id)?.name).filter(Boolean);
                            let parts = [];
                            if (catNames.length > 0) parts.push(catNames.join(', '));
                            if (fixed.length > 0) parts.push(fixed.join(', '));
                            if (tools.choiceCount > 0 && options.length > 0) parts.push(`Choose ${tools.choiceCount} from: ${options.join(', ')}`);
                            return parts.length > 0 ? parts.join('; ') : 'None';
                          })()}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="block text-[10px] uppercase font-bold text-ink/45 mb-1">Skills</span>
                        <span className="text-xs text-ink/85">
                          {(() => {
                            const skills = selectedClass.proficiencies?.skills;
                            if (!skills || typeof skills === 'string') return skills || 'None';
                            const fixed = (skills.fixedIds || []).map((id: string) => allSkills.find(s => s.id === id)?.name).filter(Boolean);
                            const options = (skills.optionIds || []).map((id: string) => allSkills.find(s => s.id === id)?.name).filter(Boolean);
                            let parts = [];
                            if (fixed.length > 0) parts.push(fixed.join(', '));
                            if (skills.choiceCount > 0 && options.length > 0) parts.push(`Choose ${skills.choiceCount} from: ${options.join(', ')}`);
                            return parts.length > 0 ? parts.join('; ') : 'None';
                          })()}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase font-bold text-ink/45 mb-1">Saving Throws</span>
                        <span className="text-xs text-ink/85">
                          {(() => {
                            const st = selectedClass.proficiencies?.savingThrows;
                            let fixedIds = (st?.fixedIds || []);
                            if (!Array.isArray(fixedIds)) fixedIds = [];
                            // Fallback for legacy class structures
                            if (fixedIds.length === 0 && Array.isArray(selectedClass.savingThrows)) {
                              fixedIds = selectedClass.savingThrows.map((id: string) => id.toUpperCase());
                            } else {
                              fixedIds = fixedIds.map((id: string) => id.toUpperCase());
                            }

                            let fixedNames = allAttributes
                              .filter(a => fixedIds.includes((a.identifier || a.id).toUpperCase()))
                              .map(a => a.name);

                            if (fixedNames.length < fixedIds.length) {
                              fixedNames = fixedIds.map((id: string) => {
                                const found = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                                return found ? found.name : id.charAt(0) + id.slice(1).toLowerCase();
                              });
                            }

                            let choiceStr = "";
                           if (st?.choiceCount > 0 && st?.optionIds?.length > 0) {
                             const options = st.optionIds.map((id: string) => {
                               const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                               return attr ? attr.name : id;
                             }).filter(Boolean);

                             if (options.length > 0) {
                               if (st.choiceCount === 1 && options.length === 2) {
                                 choiceStr = options.join(' or ');
                               } else {
                                 const last = options.pop();
                                 choiceStr = `Choose ${st.choiceCount} from ${options.join(', ')}${options.length > 0 ? ', or ' : ''}${last}`;
                               }
                             }
                           }
                           const allParts = [...fixedNames];
                           if (choiceStr) allParts.push(choiceStr);

                           if (allParts.length > 1) {
                             const last = allParts.pop();
                             return allParts.join(', ') + ' and ' + last;
                           }
                           return allParts[0] || 'None';
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Multiclassing Requirements */}
                  <div className="bg-background/50 border border-gold/15 rounded-md p-4 space-y-4">
                    <h4 className="label-text text-gold border-b border-gold/15 pb-1">Multiclassing Requirements</h4>
                    {(() => {
                      const fixedNames = (selectedClass.primaryAbility || []).map((id: string) => {
                        const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                        return attr ? attr.name : id.toUpperCase();
                      });
                      const choiceNames = (selectedClass.primaryAbilityChoice || []).map((id: string) => {
                        const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                        return attr ? attr.name : id.toUpperCase();
                      });

                      if (fixedNames.length === 0 && choiceNames.length === 0) {
                        return <BBCodeRenderer content={selectedClass.multiclassing || 'None'} className="text-xs" />;
                      }

                      let requirementPart = "";
                      if (fixedNames.length > 0) {
                        requirementPart = fixedNames.join(" and ");
                      }

                      if (choiceNames.length > 0) {
                        if (requirementPart) requirementPart += " and ";
                        requirementPart += choiceNames.join(" or ");
                      }

                      if (selectedClass.multiclassing && selectedClass.multiclassing.trim() !== '') {
                        return <BBCodeRenderer content={selectedClass.multiclassing} />;
                      }

                      if (!requirementPart) return null;

                      return (
                        <div className="text-sm">
                          You must have a {requirementPart} score of 13 or higher in order to multiclass in or out of this class.
                        </div>
                      );
                    })()}
                  </div>

                  {/* Tags */}
                  <div className="bg-background/50 border border-gold/15 rounded-md p-4 space-y-4">
                    <h4 className="label-text text-gold border-b border-gold/15 pb-1">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedClass.tagIds?.length > 0 ? selectedClass.tagIds.map((tagId: string) => {
                        const tagDef = allTags.find(t => t.id === tagId);
                        return tagDef ? (
                          <Badge key={tagId} variant="outline" className="text-[10px] px-2 py-0 h-5 border-gold/25 text-ink/65">
                            {tagDef.name}
                          </Badge>
                        ) : null;
                      }) : <span className="text-xs text-ink/85">None</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
