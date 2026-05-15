import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import { calculateEffectiveCastingLevel, getSpellSlotsForLevel } from '../../lib/spellcasting';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Sword,
  Shield,
  BookOpen,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Edit,
  Scroll,
  Wand2,
  Heart,
  Dna,
  Hammer,
  Check,
  Download
} from 'lucide-react';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import Markdown from 'react-markdown';
import ModularChoiceView from '../../components/compendium/ModularChoiceView';
import { motion } from 'motion/react';

import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '../../components/ui/dropdown-menu';
import {
  exportClassSemantic,
  slugify
} from '../../lib/classExport';
import { fetchClassSpellList, type ClassSpellListSummary } from '../../lib/classSpellLists';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import { ACTIVATION_LABELS, RANGE_LABELS } from '../../lib/spellFilters';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import SpellFilterShell from '../../components/compendium/SpellFilterShell';
import { useSpellFilters } from '../../hooks/useSpellFilters';
import { cn } from '../../lib/utils';
import { ClassImageStyle, DEFAULT_DISPLAY } from '../../components/compendium/ClassImageEditor';
import { toast } from 'sonner';
import { Database, CloudOff } from 'lucide-react';

export default function ClassView({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [classData, setClassData] = useState<any>(null);
  const [source, setSource] = useState<any>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [optionGroups, setOptionGroups] = useState<any[]>([]);
  const [optionItems, setOptionItems] = useState<any[]>([]);
  const [spellcasting, setSpellcasting] = useState<any>(null);
  const [altSpellcasting, setAltSpellcasting] = useState<any>(null);
  const [spellsKnown, setSpellsKnown] = useState<any>(null);
  const [spellcastingTypes, setSpellcastingTypes] = useState<any[]>([]);
  const [masterMulticlassChart, setMasterMulticlassChart] = useState<any | null>(null);
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allTools, setAllTools] = useState<any[]>([]);
  const [allToolCategories, setAllToolCategories] = useState<any[]>([]);
  const [allWeaponCategories, setAllWeaponCategories] = useState<any[]>([]);
  const [allArmorCategories, setAllArmorCategories] = useState<any[]>([]);
  const [allWeapons, setAllWeapons] = useState<any[]>([]);
  const [allArmor, setAllArmor] = useState<any[]>([]);
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [selectedSubclassId, setSelectedSubclassId] = useState<string | null>(null);
  const [selectedSubclass, setSelectedSubclass] = useState<any>(null);
  // Controlled Tabs state so we can react to the active tab when
  // deciding what auxiliary UI to render. Currently used to hide
  // the class-meta sidebar on the Spell List tab (gives the
  // spell content the full content-area width).
  const [activeTab, setActiveTab] = useState<string>('features');
  // Subclass picker popover state — opens the per-subclass menu
  // attached to the new top-bar Subclass button.
  const [subclassPopoverOpen, setSubclassPopoverOpen] = useState(false);
  const [subclassFeatures, setSubclassFeatures] = useState<any[]>([]);
  const [subclassScalingColumns, setSubclassScalingColumns] = useState<any[]>([]);
  const [subclassSpellcasting, setSubclassSpellcasting] = useState<any>(null);
  const [subclassAltSpellcasting, setSubclassAltSpellcasting] = useState<any>(null);
  const [subclassSpellsKnown, setSubclassSpellsKnown] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedOptionItems, setSelectedOptionItems] = useState<Record<string, string>>({});
  const [featureFilter, setFeatureFilter] = useState<'all' | 'class' | 'subclass'>('all');
  const [collapsedFeatures, setCollapsedFeatures] = useState<Record<string, boolean>>({});
  const [classSpellList, setClassSpellList] = useState<ClassSpellListSummary[]>([]);
  const [classSpellListLoading, setClassSpellListLoading] = useState(false);

  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    if (!id) {
      setClassSpellList([]);
      return;
    }
    let active = true;
    setClassSpellListLoading(true);
    fetchClassSpellList(id)
      .then(rows => { if (active) setClassSpellList(rows); })
      .catch(err => {
        console.error('[ClassView] Failed to load class spell list:', err);
        if (active) setClassSpellList([]);
      })
      .finally(() => { if (active) setClassSpellListLoading(false); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!selectedSubclassId) {
      setSelectedSubclass(null);
      setSubclassFeatures([]);
      setSubclassScalingColumns([]);
      setSubclassSpellcasting(null);
      setSubclassAltSpellcasting(null);
      setSubclassSpellsKnown(null);
      return;
    }

    const loadSubclassData = async () => {
      try {
        const subData = await fetchDocument<any>('subclasses', selectedSubclassId);

        if (subData) {
          // Remap snake_case D1 columns to camelCase
          const mappedSub = {
            ...subData,
            classId: subData.class_id,
            sourceId: subData.source_id,
            imageUrl: subData.image_url,
            imageDisplay: typeof subData.image_display === 'string' ? JSON.parse(subData.image_display) : (subData.image_display ?? null),
            spellcasting: typeof subData.spellcasting === 'string' ? JSON.parse(subData.spellcasting) : (subData.spellcasting ?? {}),
            advancements: typeof subData.advancements === 'string' ? JSON.parse(subData.advancements) : (subData.advancements ?? []),
          };
          setSelectedSubclass(mappedSub);

          // Fetch Spellcasting Scalings for Subclass
          if (mappedSub.spellcasting?.hasSpellcasting) {
            const sc = mappedSub.spellcasting;
            const parseLevels = (data: any) => {
              if (!data) return null;
              return {
                ...data,
                levels: typeof data.levels === 'string' ? JSON.parse(data.levels) : (data.levels ?? []),
              };
            };
            
            if (sc.manualProgressionId) {
              const snap = await fetchDocument<any>('spellcastingScalings', sc.manualProgressionId);
              if (snap) setSubclassSpellcasting(parseLevels(snap));
            } else if (sc.progressionId && spellcastingTypes.length > 0 && masterMulticlassChart) {
              const type = spellcastingTypes.find(t => t.id === sc.progressionId);
              if (type) {
                const virtualLevels: Record<string, any> = {};
                for (let level = 1; level <= 20; level++) {
                  const effectiveLevel = calculateEffectiveCastingLevel(level, type.formula);
                  const slots = getSpellSlotsForLevel(effectiveLevel, masterMulticlassChart.levels || []);
                  virtualLevels[level.toString()] = { slots };
                }
                setSubclassSpellcasting({ name: type.name, levels: virtualLevels });
              }
            }

            if (sc.altProgressionId) {
              const snap = await fetchDocument<any>('pactMagicScalings', sc.altProgressionId);
              if (snap) setSubclassAltSpellcasting(parseLevels(snap));
            } else {
              setSubclassAltSpellcasting(null);
            }
            if (sc.spellsKnownId) {
              const snap = await fetchDocument<any>('spellsKnownScalings', sc.spellsKnownId);
              if (snap) setSubclassSpellsKnown(parseLevels(snap));
            } else {
              setSubclassSpellsKnown(null);
            }
          }
        }

        const [subFeatures, subScalings] = await Promise.all([
          fetchCollection<any>('features', { where: "parent_id = ? AND parent_type = 'subclass'", params: [selectedSubclassId], orderBy: 'level ASC' }),
          fetchCollection<any>('scaling_columns', { where: "parent_id = ? AND parent_type = 'subclass'", params: [selectedSubclassId] })
        ]);

        setSubclassFeatures(subFeatures.map((f: any) => ({
          ...f,
          parentId: f.parent_id,
          parentType: f.parent_type,
          imageUrl: f.image_url,
          isSubclassFeature: f.parent_type === 'subclass' || f.is_subclass_feature === 1,
          advancements: typeof f.advancements === 'string' ? JSON.parse(f.advancements) : (f.advancements ?? []),
        })));
        setSubclassScalingColumns(subScalings.map((s: any) => ({
          ...s,
          parentId: s.parent_id,
          parentType: s.parent_type,
          values: typeof s.values === 'string' ? JSON.parse(s.values) : (s.values ?? {}),
        })));
      } catch (err) {
        console.error("Error loading subclass data:", err);
      }
    };

    loadSubclassData();
  }, [selectedSubclassId, spellcastingTypes.length, !!masterMulticlassChart]);

  const allFeaturesWithSpellcasting = useMemo(() => {
    if (!classData) return [];
    
    // Start with class features
    let combined = features.map(f => ({ ...f, isFromSubclass: false }));

    // If subclass selected, replace placeholders or add subclass features
    if (selectedSubclassId) {
      // Filter out placeholders
      combined = combined.filter(f => !f.isSubclassFeature);
      // Add subclass features
      combined = [...combined, ...subclassFeatures.map(f => ({ ...f, isFromSubclass: true }))];
    }

    if (classData.spellcasting?.hasSpellcasting && !combined.some(f => f.name === 'Spellcasting')) {
      combined.push({
        id: 'spellcasting-feature',
        name: 'Spellcasting',
        description: classData.spellcasting.description,
        level: classData.spellcasting.level,
        isSpellcasting: true
      });
    }

    // Add subclass spellcasting if it exists and has a description
    if (selectedSubclass?.spellcasting?.hasSpellcasting && selectedSubclass.spellcasting.description) {
      combined.push({
        id: 'subclass-spellcasting-feature',
        name: `${selectedSubclass.name} Spellcasting`,
        description: selectedSubclass.spellcasting.description,
        level: selectedSubclass.spellcasting.level,
        isSpellcasting: true,
        isFromSubclass: true
      });
    }

    return combined.sort((a, b) => a.level - b.level);
  }, [features, classData?.spellcasting, selectedSubclassId, subclassFeatures, selectedSubclass]);

  useEffect(() => {
    if (!id) return;
    const loadMainClassData = async () => {
      setLoading(true);
      try {
        const classInfo = await fetchDocument<any>('classes', id);

        if (!classInfo) {
          navigate('/compendium/classes');
          return;
        }

        const mappedClass = {
          ...classInfo,
          sourceId: classInfo.source_id,
          tagIds: typeof classInfo.tag_ids === 'string' ? JSON.parse(classInfo.tag_ids) : (classInfo.tag_ids ?? []),
          hitDie: classInfo.hit_die,
          imageUrl: classInfo.image_url,
          cardImageUrl: classInfo.card_image_url,
          previewImageUrl: classInfo.preview_image_url,
          cardDisplay: typeof classInfo.card_display === 'string' ? JSON.parse(classInfo.card_display) : (classInfo.card_display ?? null),
          imageDisplay: typeof classInfo.image_display === 'string' ? JSON.parse(classInfo.image_display) : (classInfo.image_display ?? null),
          previewDisplay: typeof classInfo.preview_display === 'string' ? JSON.parse(classInfo.preview_display) : (classInfo.preview_display ?? null),
          proficiencies: typeof classInfo.proficiencies === 'string' ? JSON.parse(classInfo.proficiencies) : (classInfo.proficiencies ?? {}),
          startingEquipment: classInfo.starting_equipment,
          primaryAbility: typeof classInfo.primary_ability === 'string' ? JSON.parse(classInfo.primary_ability) : (classInfo.primary_ability ?? []),
          primaryAbilityChoice: typeof classInfo.primary_ability_choice === 'string' ? JSON.parse(classInfo.primary_ability_choice) : (classInfo.primary_ability_choice ?? []),
          savingThrows: typeof classInfo.saving_throws === 'string' ? JSON.parse(classInfo.saving_throws) : (classInfo.saving_throws ?? []),
          spellcasting: typeof classInfo.spellcasting === 'string' ? JSON.parse(classInfo.spellcasting) : (classInfo.spellcasting ?? {}),
          advancements: typeof classInfo.advancements === 'string' ? JSON.parse(classInfo.advancements) : (classInfo.advancements ?? []),
          subclassTitle: classInfo.subclass_title || 'Subclass',
          subclassFeatureLevels: typeof classInfo.subclass_feature_levels === 'string' ? JSON.parse(classInfo.subclass_feature_levels) : (classInfo.subclass_feature_levels ?? []),
        };

        setClassData(mappedClass);

        // Parallel fetch for associated data
        const [featData, scalingsData, subsData, sourceData] = await Promise.all([
          fetchCollection<any>('features', { where: "parent_id = ? AND parent_type = 'class'", params: [id], orderBy: 'level ASC' }),
          fetchCollection<any>('scaling_columns', { where: "parent_id = ? AND parent_type = 'class'", params: [id] }),
          fetchCollection<any>('subclasses', { where: "class_id = ?", params: [id], orderBy: 'name ASC' }),
          classInfo.source_id ? fetchDocument<any>('sources', classInfo.source_id) : Promise.resolve(null)
        ]);

        setFeatures(featData.map((f: any) => ({
          ...f,
          parentId: f.parent_id,
          parentType: f.parent_type,
          imageUrl: f.image_url,
          isSubclassFeature: f.parent_type === 'subclass' || f.is_subclass_feature === 1,
          advancements: typeof f.advancements === 'string' ? JSON.parse(f.advancements) : (f.advancements ?? []),
        })));
        setScalingColumns(scalingsData.map((s: any) => ({
          ...s,
          parentId: s.parent_id,
          parentType: s.parent_type,
          values: typeof s.values === 'string' ? JSON.parse(s.values) : (s.values ?? {}),
        })));
        setSubclasses(subsData.map((sub: any) => ({
          ...sub,
          classId: sub.class_id,
          sourceId: sub.source_id,
          imageUrl: sub.image_url,
          imageDisplay: typeof sub.image_display === 'string' ? JSON.parse(sub.image_display) : (sub.image_display ?? null),
          spellcasting: typeof sub.spellcasting === 'string' ? JSON.parse(sub.spellcasting) : (sub.spellcasting ?? {}),
          advancements: typeof sub.advancements === 'string' ? JSON.parse(sub.advancements) : (sub.advancements ?? []),
        })));
        setSource(sourceData ? {
          ...sourceData,
          rulesVersion: sourceData.rules_version,
          imageUrl: sourceData.image_url,
        } : null);

        // Spellcasting Scalings
        if (mappedClass.spellcasting?.hasSpellcasting) {
          const sc = mappedClass.spellcasting;
          const parseLevels = (data: any) => {
            if (!data) return null;
            return {
              ...data,
              levels: typeof data.levels === 'string' ? JSON.parse(data.levels) : (data.levels || [])
            };
          };

          if (sc.manualProgressionId) {
            const snap = await fetchDocument<any>('spellcastingScalings', sc.manualProgressionId);
            if (snap) setSpellcasting(parseLevels(snap));
          } else if (sc.progressionId && spellcastingTypes.length > 0 && masterMulticlassChart) {
            const type = spellcastingTypes.find(t => t.id === sc.progressionId);
            if (type) {
              const virtualLevels: Record<string, any> = {};
              for (let level = 1; level <= 20; level++) {
                const effectiveLevel = calculateEffectiveCastingLevel(level, type.formula);
                const slots = getSpellSlotsForLevel(effectiveLevel, masterMulticlassChart.levels || []);
                virtualLevels[level.toString()] = { slots };
              }
              setSpellcasting({ name: type.name, levels: virtualLevels });
            }
          }

          if (sc.altProgressionId) {
            const snap = await fetchDocument<any>('pactMagicScalings', sc.altProgressionId);
            if (snap) setAltSpellcasting(parseLevels(snap));
          }
          if (sc.spellsKnownId) {
            const snap = await fetchDocument<any>('spellsKnownScalings', sc.spellsKnownId);
            if (snap) setSpellsKnown(parseLevels(snap));
          }
        }

        setLoading(false);
        setTableLoading(false);
      } catch (err) {
        console.error("Error loading main class data:", err);
        setLoading(false);
        setTableLoading(false);
      }
    };
    loadMainClassData();
  }, [id, navigate, spellcastingTypes.length, !!masterMulticlassChart]);

  const allScalingColumns = useMemo(() => {
    return [...scalingColumns, ...subclassScalingColumns];
  }, [scalingColumns, subclassScalingColumns]);

  const allGroupIds = useMemo(() => {
    const ids = new Set<string>();
    (classData?.uniqueOptionMappings || []).forEach((m: any) => {
      if (m.groupId) ids.add(m.groupId);
    });
    
    // Also include option groups from advancements
    const allAdvs = [
      ...(classData?.advancements || []),
      ...(selectedSubclass?.advancements || [])
    ];
    
    allAdvs.forEach((adv: any) => {
      if (adv.configuration?.choiceType === 'option-group' && adv.configuration?.optionGroupId) {
        ids.add(adv.configuration.optionGroupId);
      }
    });
    
    return Array.from(ids);
  }, [classData?.uniqueOptionMappings, classData?.advancements, selectedSubclass?.advancements]);

  useEffect(() => {
    if (!id || allGroupIds.length === 0) {
      setOptionGroups([]);
      setOptionItems([]);
      return;
    }

    const loadOptions = async () => {
      try {
        const [groupsData, itemsData] = await Promise.all([
          fetchCollection<any>('unique_option_groups', { where: `id IN (${allGroupIds.map(() => '?').join(',')})`, params: allGroupIds }),
          fetchCollection<any>('unique_option_items', { where: `group_id IN (${allGroupIds.map(() => '?').join(',')})`, params: allGroupIds })
        ]);
        setOptionGroups(groupsData.map((g: any) => ({
          ...g,
          sourceId: g.source_id || g.sourceId,
          classIds: typeof g.class_ids === 'string' ? JSON.parse(g.class_ids) : (g.class_ids || g.classIds || [])
        })));
        setOptionItems(itemsData.map((i: any) => ({
          ...i,
          groupId: i.group_id || i.groupId,
          sourceId: i.source_id || i.sourceId,
          iconUrl: i.icon_url || i.iconUrl,
          levelPrerequisite: i.level_prerequisite || i.levelPrerequisite,
          stringPrerequisite: i.string_prerequisite || i.stringPrerequisite,
          isRepeatable: i.is_repeatable || i.isRepeatable,
          classIds: typeof i.class_ids === 'string' ? JSON.parse(i.class_ids) : (i.class_ids || i.classIds || [])
        })));
      } catch (err) {
        console.error("Error loading options:", err);
      }
    };
    loadOptions();
  }, [id, allGroupIds]);

  useEffect(() => {
    const loadFoundation = async () => {
      try {
        const [
          tagGroupsData,
          tagsData,
          skillsData,
          toolsData,
          toolCatsData,
          weaponCatsData,
          armorCatsData,
          weaponsData,
          armorData,
          attrsData,
          scTypesData,
          masterData
        ] = await Promise.all([
          fetchCollection<any>('tagGroups'),
          fetchCollection<any>('tags'),
          fetchCollection<any>('skills'),
          fetchCollection<any>('tools'),
          fetchCollection<any>('toolCategories'),
          fetchCollection<any>('weaponCategories'),
          fetchCollection<any>('armorCategories'),
          fetchCollection<any>('weapons'),
          fetchCollection<any>('armor'),
          fetchCollection<any>('attributes'),
          fetchCollection<any>('spellcastingTypes'),
          fetchDocument<any>('standardMulticlassProgression', 'master')
        ]);

        setTagGroups(tagGroupsData.map((tg: any) => ({
          ...tg,
          classifications: typeof tg.classifications === 'string' ? JSON.parse(tg.classifications) : (tg.classifications || [])
        })));
        setAllTags(tagsData);
        setAllSkills(skillsData.map((s: any) => ({
          ...s,
          abilityId: s.ability_id || s.abilityId
        })));
        setAllTools(toolsData.map((t: any) => ({
          ...t,
          categoryId: t.category_id || t.categoryId,
          abilityId: t.ability_id || t.abilityId
        })));
        setAllToolCategories(toolCatsData);
        setAllWeaponCategories(weaponCatsData);
        setAllArmorCategories(armorCatsData);
        setAllWeapons(weaponsData.map((w: any) => ({
          ...w,
          categoryId: w.category_id || w.categoryId,
          abilityId: w.ability_id || w.abilityId,
          propertyIds: typeof w.property_ids === 'string' ? JSON.parse(w.property_ids) : (w.property_ids || w.propertyIds || [])
        })));
        setAllArmor(armorData.map((a: any) => ({
          ...a,
          categoryId: a.category_id || a.categoryId,
          abilityId: a.ability_id || a.abilityId
        })));
        setSpellcastingTypes(scTypesData);
        setMasterMulticlassChart(masterData ? {
          ...masterData,
          levels: typeof masterData.levels === 'string' ? JSON.parse(masterData.levels) : (masterData.levels || [])
        } : null);

        // Attributes unique logic
        const uniqueAttrsMap = new Map();
        attrsData.forEach((item: any) => {
          const key = (item.identifier || item.id).toUpperCase();
          if (!uniqueAttrsMap.has(key) || item.identifier) {
            uniqueAttrsMap.set(key, item);
          }
        });
        setAllAttributes(Array.from(uniqueAttrsMap.values()).sort((a: any, b: any) => {
          const orderA = typeof a.order === 'number' ? a.order : 999;
          const orderB = typeof b.order === 'number' ? b.order : 999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || '').localeCompare(b.name || '');
        }));

        if (tagGroupsData.length > 0) {
          setIsFoundationUsingD1(true);
        }
      } catch (err) {
        console.error("[ClassView] Error loading foundation data:", err);
        setIsFoundationUsingD1(false);
      }
    };

    loadFoundation();
  }, []);

  const hasAnySpellsKnown = !!(spellsKnown || subclassSpellsKnown);
  const hasAnyAltSpellcasting = !!(altSpellcasting || subclassAltSpellcasting);
  const hasAnySpellcasting = !!(spellcasting || subclassSpellcasting);

  const maxSpellLevel = useMemo(() => {
    // Check both base and subclass spellcasting to find the true max level across all levels
    const candidates = [spellcasting, subclassSpellcasting].filter(Boolean);
    let max = 0;
    candidates.forEach(sc => {
      if (!sc?.levels) return;
      Object.values(sc.levels).forEach((lvl: any) => {
        if (lvl.slots) {
          for (let i = lvl.slots.length - 1; i >= 0; i--) {
            if (lvl.slots[i] > 0) {
              if (i + 1 > max) max = i + 1;
              break;
            }
          }
        }
      });
    });
    return max;
  }, [spellcasting, subclassSpellcasting]);

  if (loading) return (
    <div className="max-w-6xl mx-auto py-20 text-center space-y-4">
      <div className="font-serif italic text-gold animate-pulse">Consulting the archives...</div>
      <Button variant="ghost" size="sm" onClick={() => navigate('/compendium/classes')} className="text-ink/40">
        <ChevronLeft className="w-4 h-4 mr-2" /> Return to Compendium
      </Button>
    </div>
  );
  if (!classData) return null;

  const getProficiencyBonus = (level: number) => {
    return Math.floor((level - 1) / 4) + 2;
  };

  const getFeaturesForLevel = (level: number) => {
    if (!classData) return [];
    
    // Start with class features
    let levelFeatures = [...features.filter(f => f.level === level)];

    // Add root advancements for this level (only Ability Score Improvements)
    const asiAdvs = (classData.advancements || []).filter((a: any) => a.level === level && a.type === 'AbilityScoreImprovement');
    asiAdvs.forEach((adv: any) => {
      if (!levelFeatures.some(f => f.name === 'Ability Score Improvement')) {
         levelFeatures.push({ 
           id: `asi-${level}`,
           name: 'Ability Score Improvement', 
           level: adv.level,
           isAdvancement: true 
         } as any);
      }
    });

    // Add subclass features from subclass progression
    const subclassLevels = classData.subclassFeatureLevels || [];
    if (subclassLevels.includes(level)) {
      const isFirst = level === Math.min(...subclassLevels);
      const title = classData.subclassTitle || 'Subclass';
      const name = isFirst ? title : `${title} Feature`;
      levelFeatures.push({
        id: `subclass-level-${level}`,
        name,
        level,
        isSubclassFeaturePlaceholder: true
      });
    }

    // If subclass selected, handle placeholders and add subclass features
    if (selectedSubclassId) {
      // Filter out our dynamic placeholders if we have real subclass features? 
      // Actually the user wants both? "Sorcerous Origin at level 1, and Sorcerous Origin Feature at level 6, 14 and 18"
      // Wait, if I have a subclass selected, I should show the subclass features INSTEAD of the placeholder?
      // "In our class table in class view, and class preview in class list, we'll use the level to decide where 'Subclass Title' + Feature appears."
      // This implies the placeholder logic should ALWAY show if we want that table layout.
      const subFeatures = subclassFeatures.filter(f => f.level === level);
      levelFeatures = [...levelFeatures, ...subFeatures.map(f => ({ ...f, isFromSubclass: true }))];
    }
    
    // Add spellcasting as a "feature" if it's obtained at this level
    if (classData.spellcasting?.hasSpellcasting && classData.spellcasting.level === level) {
      if (!levelFeatures.some(f => f.name === 'Spellcasting')) {
        levelFeatures.push({
          id: 'spellcasting-feature',
          name: 'Spellcasting',
          description: classData.spellcasting.description,
          level: classData.spellcasting.level,
          isSpellcasting: true
        });
      }
    }

    // Add subclass spellcasting
    if (selectedSubclass?.spellcasting?.hasSpellcasting && selectedSubclass.spellcasting.level === level) {
      levelFeatures.push({
        id: 'subclass-spellcasting-feature',
        name: `${selectedSubclass.name} Spellcasting`,
        description: selectedSubclass.spellcasting.description,
        level: selectedSubclass.spellcasting.level,
        isSpellcasting: true,
        isFromSubclass: true
      });
    }

    return levelFeatures;
  };

  const handleExportSlice = async (slice: "everything" | "skeleton" | "subclasses" | "features" | "unique-options") => {
    try {
      const data = await exportClassSemantic(id!, { fetchCollection, fetchDocument });
      if (!data) throw new Error("Data not found");
      let exportData: any = {};
      let filenameSuffix = "export";

      if (slice === "everything") {
        exportData = data;
        filenameSuffix = "full_export";
      } else if (slice === "skeleton") {
        exportData = {
          class: data.class,
          scalingColumns: data.scalingColumns,
          source: data.source,
          spellsKnownScalings: data.spellsKnownScalings,
          alternativeSpellcastingScalings: data.alternativeSpellcastingScalings
        };
        filenameSuffix = "skeleton";
      } else if (slice === "subclasses") {
        exportData = { subclasses: data.subclasses };
        filenameSuffix = "subclasses";
      } else if (slice === "features") {
        exportData = { features: data.features };
        filenameSuffix = "features";
      } else if (slice === "unique-options") {
        exportData = { uniqueOptionGroups: data.uniqueOptionGroups, uniqueOptionItems: data.uniqueOptionItems };
        filenameSuffix = "unique_options";
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dauligor_${slugify(classData.name)}_${filenameSuffix}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Export (${slice}) downloaded!`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error(`Failed to export data (${slice}).`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <Link to="/compendium/classes">
          <Button variant="ghost" className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back to Classes
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-gold/20 bg-transparent shadow-sm hover:bg-gold/10 hover:text-gold text-gold h-9 px-4 py-2 gap-2">
                  <Download className="w-4 h-4" /> Export
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-card border-gold/20 shadow-xl" align="end">
                  <DropdownMenuItem className="text-ink hover:bg-gold/10 hover:text-gold cursor-pointer" onClick={() => handleExportSlice('everything')}>
                    Export Everything
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-ink hover:bg-gold/10 hover:text-gold cursor-pointer" onClick={() => handleExportSlice('skeleton')}>
                    Export Class Skeleton
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-ink hover:bg-gold/10 hover:text-gold cursor-pointer" onClick={() => handleExportSlice('subclasses')}>
                    Export Subclasses
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-ink hover:bg-gold/10 hover:text-gold cursor-pointer" onClick={() => handleExportSlice('features')}>
                    Export Features
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-ink hover:bg-gold/10 hover:text-gold cursor-pointer" onClick={() => handleExportSlice('unique-options')}>
                    Export Unique Options
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Link to={`/compendium/classes/edit/${id}`}>
                <Button variant="outline" className="border-gold/20 text-gold gap-2 hover:bg-gold/10">
                  <Edit className="w-4 h-4" /> Edit Class
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {/* Header - Full Width */}
        <div className="flex flex-col md:flex-row gap-8 border-b border-gold/10 pb-8">
          {classData.imageUrl && (
            <div 
              className="w-full md:w-64 h-64 shrink-0 rounded-lg overflow-hidden border border-gold/20 shadow-lg cursor-pointer transition-transform hover:scale-[1.02]"
              onClick={() => navigate(`/images/view?url=${encodeURIComponent(classData.imageUrl!)}`)}
            >
              <img
                src={classData.imageUrl}
                alt={classData.name}
                className="w-full h-full object-cover"
                style={ClassImageStyle({ display: classData.imageDisplay || DEFAULT_DISPLAY })}
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-gold/30 text-gold bg-gold/5 px-2 py-0.5 label-text">
                {source?.name || 'Unknown Source'}
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <h1 className="h1-title uppercase">{classData.name}</h1>
              {isFoundationUsingD1 ? (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <Database className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Foundation Linked</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Legacy Foundation</span>
                </div>
              )}
            </div>
            
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {tagGroups.map(group => {
                const groupTags = allTags.filter(t => t.groupId === group.id && (classData.tagIds || []).includes(t.id));
                if (groupTags.length === 0) return null;
                return (
                  <div key={group.id} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30">{group.name}:</span>
                    <div className="flex flex-wrap gap-1">
                      {groupTags.map(tag => (
                        <div 
                          key={tag.id} 
                          className="flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-[9px] font-black uppercase tracking-wider bg-gold/10 border-gold/40 text-gold"
                        >
                          {tag.name}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {(classData.preview || classData.description) && (
              <BBCodeRenderer content={classData.preview || classData.description} className="max-w-4xl body-text h3-title" />
            )}
          </div>
        </div>

        {/* Class Table - Full Width */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <h2 className="label-text text-gold shrink-0">The {classData.name} Table</h2>
            <div className="h-px bg-gold/10 w-full" />
          </div>
          
          {tableLoading ? (
            <div className="h-64 flex flex-col items-center justify-center border border-gold/20 bg-card/50 backdrop-blur-sm rounded-lg space-y-4">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] uppercase font-bold tracking-widest text-gold/60">Loading class table...</span>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-x-auto border border-gold/20 bg-card/50 backdrop-blur-sm rounded-lg"
            >
              <table className="w-full text-left border-collapse min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-gold/20 bg-gold/5">
                  <th className="p-1.5 label-text italic text-gold text-center w-10 border-r border-gold/10">Level</th>
                  <th className="p-1.5 label-text italic text-gold text-center w-14 border-r border-gold/10">Proficiency Bonus</th>
                  <th className="p-1.5 label-text italic text-gold border-r border-gold/10">Features</th>
                  {allScalingColumns.map(col => (
                    <th key={col.id} className="p-1.5 label-text italic text-gold text-center border-r border-gold/10">
                      {col.name}
                    </th>
                  ))}
                  {hasAnySpellsKnown && (
                    <>
                      <th className="p-1.5 label-text italic text-gold text-center border-r border-gold/10">Cantrips</th>
                      <th className="p-1.5 label-text italic text-gold text-center border-r border-gold/10">Spells Known</th>
                    </>
                  )}
                  {hasAnyAltSpellcasting && (
                    <>
                      <th className="p-1.5 label-text italic text-gold text-center border-r border-gold/10">Slot Count</th>
                      <th className="p-1.5 label-text italic text-gold text-center border-r border-gold/10">Slot Level</th>
                    </>
                  )}
                  {hasAnySpellcasting && (
                    <th colSpan={maxSpellLevel} className="p-1.5 label-text italic text-gold text-center">Spell Slots per Spell Level</th>
                  )}
                </tr>
                {hasAnySpellcasting && (
                  <tr className="border-b border-gold/10 bg-gold/5">
                    <th colSpan={3 + allScalingColumns.length + (hasAnySpellsKnown ? 2 : 0) + (hasAnyAltSpellcasting ? 2 : 0)} className="border-r border-gold/10"></th>
                    {Array.from({ length: maxSpellLevel }, (_, i) => i + 1).map(lvl => (
                      <th key={lvl} className="p-1 label-text italic text-gold text-center w-6 border-r border-gold/5 last:border-r-0">
                        {lvl}{lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                  const levelFeatures = getFeaturesForLevel(level);
                  const pb = getProficiencyBonus(level);
                  
                  const levelScaling = (spellcasting || subclassSpellcasting)?.levels[level.toString()];
                  const levelAlt = (altSpellcasting || subclassAltSpellcasting)?.levels[level.toString()];
                  const levelKnown = (spellsKnown || subclassSpellsKnown)?.levels[level.toString()];

                  return (
                    <tr key={level} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                      <td className="p-1.5 text-center font-mono text-ink/40 border-r border-gold/5">{level}</td>
                      <td className="p-1.5 text-center font-mono text-ink/60 border-r border-gold/5">+{pb}</td>
                      <td className="p-1.5 border-r border-gold/5">
                        <div className="flex flex-wrap gap-1">
                          {levelFeatures.map(f => (
                            <span key={f.id} className={`font-bold hover:underline cursor-help transition-colors ${f.isFromSubclass ? 'text-gold/80 italic' : 'text-gold'}`}>
                              {f.name.split(' (')[0]}{levelFeatures.indexOf(f) < levelFeatures.length - 1 ? ',' : ''}
                            </span>
                          ))}
                          {levelFeatures.length === 0 && <span className="text-ink/20">—</span>}
                        </div>
                      </td>
                      {allScalingColumns.map(col => {
                        let displayValue = '—';
                        for (let l = level; l >= 1; l--) {
                          if (col.values[l.toString()]) {
                            displayValue = col.values[l.toString()];
                            break;
                          }
                        }
                        return (
                          <td key={col.id} className="p-1.5 text-center font-mono text-ink/80 border-r border-gold/5">
                            {displayValue}
                          </td>
                        );
                      })}
                      {hasAnySpellsKnown && (
                        <>
                          <td className="p-1.5 text-center font-mono text-ink/80 border-r border-gold/5">
                            {levelKnown?.cantrips ?? levelKnown?.cantripsKnown ?? '—'}
                          </td>
                          <td className="p-1.5 text-center font-mono text-ink/80 border-r border-gold/5">
                            {levelKnown?.spellsKnown ?? levelKnown?.spells ?? '—'}
                          </td>
                        </>
                      )}
                      {hasAnyAltSpellcasting && (
                        <>
                          <td className="p-1.5 text-center font-mono text-ink/80 border-r border-gold/5">{levelAlt?.slotCount ?? '—'}</td>
                          <td className="p-1.5 text-center font-mono text-ink/80 border-r border-gold/5">
                            {levelAlt?.slotLevel ? `${levelAlt.slotLevel}${levelAlt.slotLevel === 1 ? 'st' : levelAlt.slotLevel === 2 ? 'nd' : levelAlt.slotLevel === 3 ? 'rd' : 'th'}` : '—'}
                          </td>
                        </>
                      )}
                      {hasAnySpellcasting && (
                        <>
                          {(() => {
                            const slots = levelScaling?.slots || [];
                            const paddedSlots = [...slots, ...Array(Math.max(0, maxSpellLevel - slots.length)).fill(0)].slice(0, maxSpellLevel);
                            return paddedSlots.map((sCount: number, idx: number) => (
                              <td key={idx} className={`p-1 text-center font-mono border-r border-gold/5 last:border-r-0 ${sCount > 0 ? 'text-ink font-bold' : 'text-ink/10'}`}>
                                {sCount > 0 ? sCount : '—'}
                              </td>
                            ));
                          })()}
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
          )}
        </div>

        {/* Bottom Section - Split Layout.
            When the Spell List tab is active we drop the right-hand
            class-meta sidebar so the spell content (browser-style
            row layout) gets the full content-area width. The grid
            collapses to a single column. */}
        <div className={cn(
          'grid gap-12 pt-8',
          activeTab === 'spells' ? 'lg:grid-cols-1' : 'lg:grid-cols-4'
        )}>
          {/* Features / Tabs - Left (Large) */}
          <div className={activeTab === 'spells' ? '' : 'lg:col-span-3'}>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {/* ── Tab row: chevron tab bar (left) + Subclass picker
                  (right). The subclass picker shares the row so the
                  class-meta sidebar no longer needs to host it — see
                  the bottom-of-page sidebar where the old Subclass
                  section used to live. */}
              <div className="flex items-end justify-between gap-4 mb-8 border-b border-gold/20">
                <TabsList className="flex bg-transparent rounded-none p-0 h-auto gap-0 overflow-visible">
                  {(() => {
                    const tabs = [
                      { value: 'features', label: 'Class Features' },
                      ...(classData.spellcasting?.hasSpellcasting
                        ? [{ value: 'spells', label: 'Spell List' }]
                        : []),
                      { value: 'info', label: 'Class Information' },
                      { value: 'flavor', label: 'Flavor Suggestions' },
                    ];
                    return tabs.map((tab, i) => (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        style={{
                          clipPath: i === 0
                            ? 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)'
                            : 'polygon(12px 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)',
                        }}
                        className={`
                          relative flex-none rounded-none border-none h-auto
                          min-w-[160px] py-3 px-8 text-[10px] font-black uppercase tracking-[0.12em] text-center whitespace-nowrap
                          transition-colors duration-150
                          bg-gold/10 text-gold/50 hover:bg-gold/20 hover:text-gold/70
                          data-active:bg-gold data-active:text-black data-active:z-10
                          focus-visible:outline-none focus-visible:ring-0
                          ${i > 0 ? '-ml-3' : ''}
                        `}
                      >
                        {tab.label}
                      </TabsTrigger>
                    ));
                  })()}
                </TabsList>

                {/* Subclass picker — single popover button that opens
                    a list of the class's subclasses. Was previously a
                    full sidebar section with one card per subclass —
                    moved up here so it shares a row with the tabs and
                    frees the sidebar for class-meta content. Only
                    renders when the class actually defines subclasses;
                    classes with no subclasses skip the button entirely. */}
                {subclasses.length > 0 && (
                  <div className="pb-2 shrink-0">
                    <Popover open={subclassPopoverOpen} onOpenChange={setSubclassPopoverOpen}>
                      <PopoverTrigger
                        className={cn(
                          'inline-flex items-center gap-2 h-8 px-3 rounded-md border text-[10px] font-black uppercase tracking-[0.12em] transition-colors whitespace-nowrap',
                          selectedSubclass
                            ? 'bg-gold/15 border-gold/40 text-gold hover:bg-gold/25'
                            : 'bg-transparent border-gold/30 text-gold/70 hover:bg-gold/10 hover:text-gold'
                        )}
                        title={selectedSubclass ? `Active ${classData.subclassTitle || 'Subclass'}: ${selectedSubclass.name}` : `Choose a ${classData.subclassTitle || 'Subclass'}`}
                      >
                        <span className="truncate max-w-[200px]">
                          {selectedSubclass
                            ? selectedSubclass.name
                            : `Choose ${classData.subclassTitle || 'Subclass'}`}
                        </span>
                        <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        sideOffset={6}
                        className="w-72 p-1.5"
                      >
                        <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-gold/60">
                          {classData.subclassTitle || 'Subclasses'}
                        </div>
                        <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-0.5">
                          {selectedSubclassId && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSubclassId(null);
                                setSubclassPopoverOpen(false);
                              }}
                              className="w-full text-left px-2 py-1.5 rounded text-[11px] font-bold uppercase tracking-widest text-ink/40 hover:bg-gold/5 hover:text-gold/70 transition-colors"
                            >
                              Clear selection
                            </button>
                          )}
                          {subclasses.map(sub => {
                            const isSelected = selectedSubclassId === sub.id;
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => {
                                  setSelectedSubclassId(isSelected ? null : sub.id);
                                  setSubclassPopoverOpen(false);
                                }}
                                className={cn(
                                  'w-full text-left px-2 py-1.5 rounded text-sm font-bold uppercase tracking-tight transition-colors flex items-center justify-between gap-2',
                                  isSelected
                                    ? 'bg-gold text-white'
                                    : 'text-ink hover:bg-gold/10 hover:text-gold'
                                )}
                              >
                                <span className="truncate">{sub.name}</span>
                                {isSelected && <Check className="w-4 h-4 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>

              {/* ── Features Tab ─────────────────────────────────────── */}
              <TabsContent value="features" className="space-y-8">
                {selectedSubclass && (
                  <div className="animate-in fade-in slide-in-from-top-4 duration-500 space-y-6 p-6 border border-gold/30 bg-gold/5 rounded-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-2">
                      <Badge variant="outline" className="border-gold/20 text-gold bg-gold/5 uppercase tracking-widest text-[10px]">
                        Subclass Active
                      </Badge>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6">
                      {selectedSubclass.imageUrl && (
                        <div 
                          className="w-full md:w-48 h-48 shrink-0 rounded-md overflow-hidden border border-gold/20 shadow-md cursor-pointer transition-transform hover:scale-[1.02]"
                          onClick={() => navigate(`/images/view?url=${encodeURIComponent(selectedSubclass.imageUrl!)}`)}
                        >
                          <img
                            src={selectedSubclass.imageUrl}
                            alt={selectedSubclass.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      <div className="flex-1 space-y-4">
                        <h2 className="h2-title text-gold uppercase underline decoration-gold/20 underline-offset-8">
                          {selectedSubclass.name}
                        </h2>
                        <BBCodeRenderer content={selectedSubclass.description} className="text-lg italic leading-relaxed opacity-90 font-sans" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Filter toggle — only when a subclass is active */}
                {selectedSubclass && (
                  <div className="flex items-center gap-2">
                    {(['all', 'class', 'subclass'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFeatureFilter(f)}
                        className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded transition-colors ${
                          featureFilter === f
                            ? 'bg-gold/20 text-gold border border-gold/40'
                            : 'text-ink/40 border border-gold/10 hover:border-gold/30 hover:text-gold/60'
                        }`}
                      >
                        {f === 'all' ? 'All Features' : f === 'class' ? 'Class Only' : 'Subclass Only'}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {allFeaturesWithSpellcasting
                    .filter((feature) => {
                      if (featureFilter === 'class') return !feature.isFromSubclass;
                      if (featureFilter === 'subclass') return !!feature.isFromSubclass;
                      return true;
                    })
                    .map((feature) => {
                      const linkedMappings = (classData.uniqueOptionMappings || []).filter((m: any) => m.featureId === feature.id);
                      const isCollapsed = collapsedFeatures[feature.id] ?? false;
                      const isSubclass = !!feature.isFromSubclass;

                      return (
                        <div
                          key={feature.id}
                          className={`rounded-lg border transition-colors ${
                            isSubclass
                              ? 'border-amber-500/30 bg-amber-500/5'
                              : 'border-gold/10 bg-transparent'
                          }`}
                        >
                          {/* Feature header — always visible, click to collapse */}
                          <button
                            type="button"
                            onClick={() => setCollapsedFeatures(prev => ({ ...prev, [feature.id]: !isCollapsed }))}
                            className="w-full flex items-baseline justify-between px-4 pt-3 pb-3 text-left group"
                          >
                            <div className="flex items-center gap-3">
                              {isSubclass && (
                                <span className="text-[8px] font-black uppercase tracking-widest text-amber-400/80 border border-amber-500/30 px-1.5 py-0.5 rounded shrink-0">
                                  Subclass
                                </span>
                              )}
                              <h3 className="h3-title text-gold uppercase group-hover:text-white transition-colors">{feature.name}</h3>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="label-text text-ink/40">Level {feature.level}</span>
                              <ChevronDown
                                className={`w-4 h-4 text-gold/40 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
                              />
                            </div>
                          </button>

                          {/* Feature body — collapsible */}
                          {!isCollapsed && (
                            <div className="px-4 pb-4 space-y-4">
                              <BBCodeRenderer content={feature.description} />

                              {/* Linked advancements */}
                              {(() => {
                                const allAdvs = [
                                  ...(classData.advancements || []),
                                  ...(selectedSubclass?.advancements || [])
                                ];
                                const featureAdvs = allAdvs.filter((a: any) => a.featureId === feature.id && a.type !== 'ScaleValue' && a.type !== 'Trait');
                                if (featureAdvs.length === 0) return null;

                                return (
                                  <div className="space-y-4 pt-4 border-t border-gold/10">
                                    {featureAdvs.map((adv: any, idx: number) => {
                                      const isExpanded = expandedGroups[adv._id] || false;
                                      const advTitle = adv.title || adv.configuration?.title || adv.type;
                                      const isOptionGroup = adv.configuration?.choiceType === 'option-group' && adv.configuration?.optionGroupId;
                                      const hasChoices = (adv.type === 'ItemGrant' || adv.type === 'ItemChoice') &&
                                                         (adv.configuration?.pool?.length > 0 || isOptionGroup);

                                      return (
                                        <div key={idx} className="mt-4 space-y-4">
                                          {hasChoices ? (
                                            <>
                                              <button
                                                onClick={() => setExpandedGroups(prev => ({ ...prev, [adv._id]: !isExpanded }))}
                                                className={`flex items-center justify-between group w-full text-left bg-gold/5 hover:bg-gold/10 border border-gold/20 p-3 transition-colors ${isExpanded ? 'rounded-t border-b-0' : 'rounded'}`}
                                              >
                                                <div className="flex items-center gap-2 shrink-0">
                                                  <BookOpen className="w-4 h-4 text-gold group-hover:drop-shadow-[0_0_8px_rgba(255,215,0,0.5)] transition-all" />
                                                  <span className="text-xs font-bold uppercase tracking-widest text-gold group-hover:text-white transition-colors">{advTitle}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                  <span className="text-[9px] font-medium text-gold/50 uppercase">{adv.type}</span>
                                                  <div className={`transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                                    <ChevronLeft className="w-4 h-4 text-gold -rotate-90 group-hover:text-white transition-colors" />
                                                  </div>
                                                </div>
                                              </button>

                                              {isExpanded && (
                                                <div className="animate-in fade-in slide-in-from-top-2 duration-300 bg-gold/5 border border-gold/20 rounded-b p-4">
                                                  {isOptionGroup ? (() => {
                                                    const groupId = adv.configuration.optionGroupId;
                                                    const exclusions = adv.configuration?.excludedOptionIds || [];
                                                    const groupItems = optionItems.filter((item: any) =>
                                                      item.groupId === groupId &&
                                                      (!item.classIds || item.classIds.length === 0 || item.classIds.includes(id)) &&
                                                      !(classData?.excludedOptionIds?.[groupId] || []).includes(item.id) &&
                                                      !exclusions.includes(item.id)
                                                    );
                                                    console.log("Rendering advancement option group", {
                                                      adv, groupId, exclusions,
                                                      groupItems: groupItems.length,
                                                      totalOptionItems: optionItems.length,
                                                      allGroupIds
                                                    });
                                                    if (groupItems.length === 0) {
                                                      return <p className="text-xs text-ink/40 italic">No options available for this group.</p>;
                                                    }
                                                    return (
                                                      <ModularChoiceView
                                                        items={groupItems}
                                                        groupId={adv._id || groupId}
                                                        selectedId={selectedOptionItems[adv._id || groupId] || groupItems[0]?.id}
                                                        onSelect={(itemId) => setSelectedOptionItems(prev => ({ ...prev, [adv._id || groupId]: itemId }))}
                                                        sidebarWidth="240px"
                                                        maxHeight="350px"
                                                      />
                                                    );
                                                  })() : (() => {
                                                    const poolIds = adv.configuration?.pool || [];
                                                    if (poolIds.length === 0) {
                                                      return <p className="text-xs text-ink/40 italic">No options available.</p>;
                                                    }
                                                    const poolItems = poolIds
                                                      .map((itemId: string) => allFeaturesWithSpellcasting.find((f: any) => f.id === itemId))
                                                      .filter(Boolean)
                                                      .map((f: any) => ({
                                                        id: f.id,
                                                        name: f.name,
                                                        description: f.description,
                                                        levelPrerequisite: f.level,
                                                        featureId: f.id
                                                      }));

                                                    if (poolItems.length === 0) {
                                                      return <p className="text-xs text-ink/40 italic">Features could not be found.</p>;
                                                    }
                                                    return (
                                                      <ModularChoiceView
                                                        items={poolItems}
                                                        groupId={adv._id || 'pool'}
                                                        selectedId={selectedOptionItems[adv._id || 'pool'] || poolItems[0]?.id}
                                                        onSelect={(itemId) => setSelectedOptionItems(prev => ({ ...prev, [adv._id || 'pool']: itemId }))}
                                                        sidebarWidth="240px"
                                                        maxHeight="350px"
                                                      />
                                                    );
                                                  })()}
                                                </div>
                                              )}
                                            </>
                                          ) : (
                                            <div className="bg-gold/5 border border-gold/20 rounded p-3 flex flex-col gap-1">
                                              <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-ink uppercase tracking-tight">{advTitle}</span>
                                                <span className="text-[9px] font-medium text-gold/60 uppercase">{adv.type}</span>
                                              </div>
                                              {adv.type === 'Trait' && (
                                                <p className="text-[10px] text-ink/60 italic">Gains proficiency in {adv.configuration?.type || 'Trait'}</p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </TabsContent>

              {/* ── Spell List Tab ────────────────────────────────────── */}
              {classData.spellcasting?.hasSpellcasting && (
                <TabsContent value="spells">
                  <ClassSpellListTab
                    rows={classSpellList}
                    loading={classSpellListLoading}
                    isAdmin={isAdmin}
                    classId={id || ''}
                  />
                </TabsContent>
              )}

              {/* ── Info Tab ─────────────────────────────────────────── */}
              <TabsContent value="info" className="space-y-10">
                {classData.description ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <h2 className="font-bold uppercase tracking-[0.2em] text-gold shrink-0">Class Description</h2>
                      <div className="h-px bg-gold/10 w-full" />
                    </div>
                    <BBCodeRenderer content={classData.description} className="body-text" />
                  </div>
                ) : (
                  <p className="text-ink/40 italic text-sm">No class description has been written yet.</p>
                )}

                {classData.lore && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <h2 className="font-bold uppercase tracking-[0.2em] text-gold shrink-0">Class Lore</h2>
                      <div className="h-px bg-gold/10 w-full" />
                    </div>
                    <BBCodeRenderer content={classData.lore} className="body-text" />
                  </div>
                )}

                {!classData.description && !classData.lore && (
                  <p className="text-ink/40 italic text-sm">No lore has been written yet.</p>
                )}
              </TabsContent>

              {/* ── Flavor Tab ───────────────────────────────────────── */}
              <TabsContent value="flavor">
                <div className="flex flex-col items-center justify-center py-24 gap-4 text-center border border-dashed border-gold/20 rounded-lg">
                  <p className="font-bold uppercase tracking-widest text-gold/40 text-sm">Under Construction</p>
                  <p className="text-ink/40 text-xs max-w-xs">Flavor recommendations and roleplaying guidance will appear here.</p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar - Right (Small).
              Hidden on the Spell List tab because the spell content
              uses a wider browser-row layout that benefits from the
              full content-area width. Subclass picker lives in the
              tab row above (see TabsList sibling) so it's reachable
              from every tab, including this one. */}
          {activeTab !== 'spells' && (
          <div className="space-y-8">
            {/* Core Traits */}
            <div className="space-y-4">
              <h2 className="font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2">Core Traits</h2>
              <div className="space-y-6">
                <div className="space-y-1">
                  <p className="uppercase font-bold tracking-widest text-ink/40">Hit Points</p>
                  <p className="text-ink/80"><strong>Hit Die:</strong> D{classData.hitDie || 8} per level</p>
                  <p className="text-ink/80"><strong>HP at 1st Level:</strong> {classData.hitDie || 8} + Con Modifier</p>
                  <p className="text-ink/80"><strong>HP at Higher Levels:</strong> 1D{classData.hitDie || 8} (or {(classData.hitDie || 8) / 2 + 1}) + Con Modifier</p>
                </div>

                <div className="space-y-1">
                  <p className="uppercase font-bold tracking-widest text-ink/40">Proficiencies</p>
                  <p className="text-ink/80"><strong>Saving Throws:</strong> {(() => {
                    const st = classData.proficiencies?.savingThrows;
                    
                    let fixedIds = (st?.fixedIds || []);
                    if (!Array.isArray(fixedIds)) fixedIds = [];
                    // Fallback for legacy class structures
                    if (fixedIds.length === 0 && Array.isArray(classData.savingThrows)) {
                      fixedIds = classData.savingThrows.map((id: string) => id.toUpperCase());
                    } else {
                      fixedIds = fixedIds.map((id: string) => id.toUpperCase());
                    }
                    
                    // Fixed attributes
                    let fixedNames = allAttributes
                      .filter(a => fixedIds.includes((a.identifier || a.id).toUpperCase()))
                      .map(a => a.name);

                    if (fixedNames.length < fixedIds.length) {
                      fixedNames = fixedIds.map((id: string) => {
                        const found = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                        return found ? found.name : id.charAt(0) + id.slice(1).toLowerCase();
                      });
                    }

                    // Choice attribute
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
                  })()}</p>
                  <p className="text-ink/80">
                    <strong>Armor:</strong> {(() => {
                      const prof = classData.proficiencies?.armor;
                      const displayName = classData.proficiencies?.armorDisplayName;
                      if (typeof prof === 'string') return prof;
                      if (displayName) return displayName;
                      if (prof && typeof prof === 'object') {
                        const categoryIds = prof.categoryIds || [];
                        const catNames = categoryIds.map((cid: string) => allArmorCategories.find(c => c.id === cid)?.name).filter(Boolean);
                        
                        const fixed = (prof.fixedIds || [])
                          .filter((id: string) => {
                            const item = allArmor.find(i => i.id === id);
                            return !categoryIds.includes(item?.categoryId);
                          })
                          .map((id: string) => allArmor.find(i => i.id === id)?.name)
                          .filter(Boolean);

                        let parts = [];
                        if (catNames.length > 0) parts.push(catNames.join(', '));
                        if (fixed.length > 0) parts.push(fixed.join(', '));
                        return parts.length > 0 ? parts.join(', ') : 'None';
                      }
                      return 'None';
                    })()}
                  </p>
                  <p className="text-ink/80">
                    <strong>Weapons:</strong> {(() => {
                      const prof = classData.proficiencies?.weapons;
                      const displayName = classData.proficiencies?.weaponsDisplayName;
                      if (typeof prof === 'string') return prof;
                      if (displayName) return displayName;
                      if (prof && typeof prof === 'object') {
                        const categoryIds = prof.categoryIds || [];
                        const catNames = categoryIds.map((cid: string) => allWeaponCategories.find(c => c.id === cid)?.name).filter(Boolean);
                        
                        const fixed = (prof.fixedIds || [])
                          .filter((id: string) => {
                            const item = allWeapons.find(i => i.id === id);
                            return !categoryIds.includes(item?.categoryId);
                          })
                          .map((id: string) => allWeapons.find(i => i.id === id)?.name)
                          .filter(Boolean);

                        let parts = [];
                        if (catNames.length > 0) parts.push(catNames.join(', '));
                        if (fixed.length > 0) parts.push(fixed.join(', '));
                        return parts.length > 0 ? parts.join(', ') : 'None';
                      }
                      return 'None';
                    })()}
                  </p>
                  <div className="text-ink/80">
                    <strong>Tools:</strong> {(() => {
                      const tools = classData.proficiencies?.tools;
                      const displayName = classData.proficiencies?.toolsDisplayName;
                      if (!tools || typeof tools === 'string') return tools || 'None';
                      if (displayName) return displayName;
                      
                      const categoryIds = tools.categoryIds || [];
                      const catNames = categoryIds.map((cid: string) => allToolCategories.find(c => c.id === cid)?.name).filter(Boolean);
                      
                      const fixed = (tools.fixedIds || [])
                        .filter((id: string) => {
                          const tool = allTools.find(t => t.id === id);
                          return !categoryIds.includes(tool?.categoryId);
                        })
                        .map((id: string) => allTools.find(t => t.id === id)?.name)
                        .filter(Boolean);
                      const options = (tools.optionIds || []).map((id: string) => allTools.find(t => t.id === id)?.name).filter(Boolean);
                      
                      let parts = [];
                      if (catNames.length > 0) parts.push(catNames.join(', '));
                      if (fixed.length > 0) parts.push(fixed.join(', '));
                      if (tools.choiceCount > 0 && options.length > 0) {
                        parts.push(`Choose ${tools.choiceCount} from: ${options.join(', ')}`);
                      }
                      
                      return parts.length > 0 ? parts.join('; ') : 'None';
                    })()}
                  </div>
                  <div className="text-ink/80">
                    <strong>Skills:</strong> {(() => {
                      const skills = classData.proficiencies?.skills;
                      if (!skills || typeof skills === 'string') return skills || 'None';
                      
                      const fixed = (skills.fixedIds || []).map((id: string) => allSkills.find(s => s.id === id)?.name).filter(Boolean);
                      const options = (skills.optionIds || []).map((id: string) => allSkills.find(s => s.id === id)?.name).filter(Boolean);
                      
                      let parts = [];
                      if (fixed.length > 0) parts.push(fixed.join(', '));
                      if (skills.choiceCount > 0 && options.length > 0) {
                        parts.push(`Choose ${skills.choiceCount} from: ${options.join(', ')}`);
                      }
                      
                      return parts.length > 0 ? parts.join('; ') : 'None';
                    })()}
                  </div>
                </div>

                {((classData.primaryAbility?.length || 0) > 0 || (classData.primaryAbilityChoice?.length || 0) > 0 || classData.multiclassing) && (
                  <div className="space-y-1">
                    <p className="uppercase font-bold tracking-widest text-ink/40">Multiclassing Requirements</p>
                    <div className="prose-sm italic text-xs text-ink/80">
                      {(() => {
                        const fixedNames = (classData.primaryAbility || []).map((id: string) => {
                          const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                          return attr ? attr.name : id.toUpperCase();
                        });
                        const choiceNames = (classData.primaryAbilityChoice || []).map((id: string) => {
                          const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                          return attr ? attr.name : id.toUpperCase();
                        });

                        if (fixedNames.length === 0 && choiceNames.length === 0) {
                          return classData.multiclassing ? <BBCodeRenderer content={classData.multiclassing} /> : null;
                        }

                        let requirementPart = "";
                        if (fixedNames.length > 0) {
                          requirementPart = fixedNames.join(" and ");
                        }
                        
                        if (choiceNames.length > 0) {
                          if (requirementPart) requirementPart += " and ";
                          requirementPart += choiceNames.join(" or ");
                        }

                        if (classData.multiclassing && classData.multiclassing.trim() !== '') {
                          return <BBCodeRenderer content={classData.multiclassing} />;
                        }

                        if (!requirementPart) return null;

                        return (
                          <div className="text-sm">
                            You must have a {requirementPart} score of 13 or higher in order to multiclass in or out of this class.
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <p className="uppercase font-bold tracking-widest text-ink/40">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {tagGroups.map(group => {
                      const groupTags = allTags.filter(t => t.groupId === group.id && (classData.tagIds || []).includes(t.id));
                      if (groupTags.length === 0) return null;
                      return groupTags.map(tag => (
                        <div 
                          key={tag.id} 
                          className="px-1.5 py-0.5 border rounded text-[8px] font-bold uppercase tracking-wider bg-gold/5 border-gold/20 text-gold/60"
                        >
                          {tag.name}
                        </div>
                      ));
                    })}
                    {(!classData.tagIds || classData.tagIds.length === 0) && <span className="text-xs text-ink/40 italic">None</span>}
                  </div>
                </div>

                {(classData.spellcasting?.hasSpellcasting || classData.spellcasting?.isRitualCaster) && (
                  <div className="space-y-1">
                    <p className="uppercase font-bold tracking-widest text-ink/40">Spellcasting</p>
                    {classData.spellcasting?.hasSpellcasting && (
                      <>
                        <p className="text-ink/80"><strong>Ability:</strong> {(() => {
                          const id = (classData.spellcasting.ability || '').toUpperCase();
                          const attr = allAttributes.find(a => ((a.identifier || a.id).toUpperCase() === id));
                          return attr ? attr.name : id;
                        })()}</p>
                        <p className="text-ink/80"><strong>Type:</strong> {classData.spellcasting.type ? classData.spellcasting.type.charAt(0).toUpperCase() + classData.spellcasting.type.slice(1) : ''}</p>
                        <p className="text-ink/80"><strong>Level Gained:</strong> {classData.spellcasting.level}</p>
                        {classData.spellcasting.spellsKnownFormula && (
                          <p className="text-ink/80"><strong>Spells Known:</strong> {classData.spellcasting.spellsKnownFormula}</p>
                        )}
                      </>
                    )}
                    {classData.spellcasting?.isRitualCaster && (
                      <div className="flex items-center gap-2 pt-1">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all bg-gold border-gold`}>
                          <Check className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Ritual Caster</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <p className="uppercase font-bold tracking-widest text-ink/40">Equipment</p>
                  <BBCodeRenderer content={classData.startingEquipment || 'Standard starting equipment.'} className="prose-sm italic" />
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TraitItem({ label, value, icon: Icon }: { label: string, value: string, icon: any }) {
  return (
    <div className="flex gap-3">
      <Icon className="w-4 h-4 text-ink/20 shrink-0 mt-1" />
      <div>
        <p className="font-bold text-ink/40 uppercase tracking-widest">{label}</p>
        <p className="text-ink/80 leading-tight">{value || 'None'}</p>
      </div>
    </div>
  );
}

// Compact row layout for the class Spell List tab. Mirrors the
// browser-style columns from /compendium/spells (Name | Lv | Time
// | School | C. | Range | Src) so admins curating a list can
// eyeball the catalogue at a density comparable to the public
// browser. Sortable header — click a column to toggle sort
// direction. Class spell lists are bounded (typically ≤ 200 rows)
// so we skip virtualization; a flat scrollable list is enough.
type SpellListColumnKey = 'name' | 'level' | 'time' | 'school' | 'concentration' | 'range' | 'source';
type SpellListSortDir = 'asc' | 'desc';

const SPELL_LIST_COL_WIDTHS: Record<SpellListColumnKey, string> = {
  name: 'minmax(0,1fr)',
  level: '36px',
  time: '90px',
  school: '70px',
  concentration: '24px',
  range: '90px',
  source: '60px',
};
const SPELL_LIST_COL_LABELS: Record<SpellListColumnKey, string> = {
  name: 'Name',
  level: 'Lv',
  time: 'Time',
  school: 'School',
  concentration: 'C.',
  range: 'Range',
  source: 'Src',
};
const SPELL_LIST_COLS: SpellListColumnKey[] = ['name', 'level', 'time', 'school', 'concentration', 'range', 'source'];

function ClassSpellListTab({
  rows,
  loading,
  isAdmin,
  classId,
}: {
  rows: ClassSpellListSummary[];
  loading: boolean;
  isAdmin: boolean;
  classId: string;
}) {
  const filters = useSpellFilters();
  const [previewSpellId, setPreviewSpellId] = useState<string | null>(null);
  const [sources, setSources] = useState<{ id: string; name?: string; abbreviation?: string; shortName?: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; groupId: string | null }[]>([]);
  const [tagGroups, setTagGroups] = useState<{ id: string; name: string }[]>([]);
  // Sort state — default is ascending by level, so cantrips lead and
  // higher levels follow. Same-level rows fall back to name order.
  const [sortBy, setSortBy] = useState<SpellListColumnKey>('level');
  const [sortDir, setSortDir] = useState<SpellListSortDir>('asc');

  // Foundation for the filter shell (sources + spell-classified tag groups).
  // Cheap: all three are in the d1 PERSISTENT_TABLES so subsequent loads are free.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCollection<any>('sources', { orderBy: 'name ASC' }),
      fetchCollection<any>('tags', { orderBy: 'name ASC' }),
      fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
    ])
      .then(([sourceData, tagData, groupData]) => {
        if (!active) return;
        setSources(sourceData);
        setTags(tagData.map((t: any) => ({ id: t.id, name: t.name || '', groupId: t.group_id || t.groupId || null })));
        setTagGroups(groupData.map((g: any) => ({ id: g.id, name: g.name || 'Tags' })));
      })
      .catch(err => console.error('[ClassSpellListTab] foundation load failed:', err));
    return () => { active = false; };
  }, []);

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, { name: t.name }])) as Record<string, { name: string }>,
    [tags],
  );

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, { id: string; name?: string; abbreviation?: string; shortName?: string }>,
    [sources],
  );

  const filteredEntries = useMemo(
    () => filters.filter(rows, tagsById),
    [filters, rows, tagsById],
  );

  // Sort helper — extracts the comparable scalar for each column.
  // Level falls back to name for stable secondary order so cantrips
  // and 1st-level lists read alphabetically inside their tier.
  const sortedEntries = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: typeof filteredEntries[number], b: typeof filteredEntries[number]) => {
      const sa = a.spell;
      const sb = b.spell;
      let primary = 0;
      switch (sortBy) {
        case 'name':
          primary = (sa.name || '').localeCompare(sb.name || '');
          break;
        case 'level':
          primary = (sa.level ?? 0) - (sb.level ?? 0);
          break;
        case 'school':
          primary = (sa.school || '').localeCompare(sb.school || '');
          break;
        case 'time':
          primary = (sa.activationBucket || '').localeCompare(sb.activationBucket || '');
          break;
        case 'range':
          primary = (sa.rangeBucket || '').localeCompare(sb.rangeBucket || '');
          break;
        case 'concentration':
          primary = Number(!!sa.concentration) - Number(!!sb.concentration);
          break;
        case 'source': {
          const aLabel = sourceById[sa.source_id || '']?.abbreviation
            || sourceById[sa.source_id || '']?.shortName || '';
          const bLabel = sourceById[sb.source_id || '']?.abbreviation
            || sourceById[sb.source_id || '']?.shortName || '';
          primary = aLabel.localeCompare(bLabel);
          break;
        }
      }
      if (primary !== 0) return dir * primary;
      // Stable secondary sort by name so equal-bucket rows are
      // alphabetical inside their tier. Avoid `localeCompare` when
      // both names are missing (rare; protects against undefined).
      return (sa.name || '').localeCompare(sb.name || '');
    };
    return [...filteredEntries].sort(cmp);
  }, [filteredEntries, sortBy, sortDir, sourceById]);

  const handleSort = (col: SpellListColumnKey) => {
    if (sortBy === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const gridTemplate = SPELL_LIST_COLS.map(c => SPELL_LIST_COL_WIDTHS[c]).join(' ');

  if (loading) {
    return <div className="px-8 py-20 text-center text-ink/45">Loading spell list…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center border border-dashed border-gold/20 rounded-lg">
        <p className="font-bold uppercase tracking-widest text-gold/40 text-sm">No spells yet</p>
        <p className="text-ink/40 text-xs max-w-xs">
          This class doesn't have any spells on its master list.
          {isAdmin && classId ? ' Use the Spell List Manager to add them.' : ''}
        </p>
        {isAdmin && classId ? (
          <Link
            to={`/compendium/spell-lists?class=${classId}`}
            className="text-[10px] font-bold uppercase tracking-widest text-gold/70 hover:text-gold underline-offset-4 hover:underline"
          >
            Open Spell List Manager →
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-ink/50">
          <span className="text-gold font-bold">{filteredEntries.length}</span>
          {filteredEntries.length !== rows.length ? <> of <span className="text-gold/70">{rows.length}</span></> : null}
          {' '}spell{rows.length === 1 ? '' : 's'} on this class's list
        </p>
        <div className="flex items-center gap-3">
          {/* "Browse in Compendium" hand-off — opens the full
              /compendium/spells browser with this class's spell
              list pre-applied as a scope filter. Useful when the
              spell list is hundreds of rows and the inline tab
              (compact rows, sortable columns) is good for scan
              but limited compared to the full filter vocabulary
              and column-toggle controls in the public browser.
              Available to every authenticated user — not gated on
              admin. */}
          {classId ? (
            <Link
              to={`/compendium/spells?class=${classId}`}
              className="text-[10px] font-bold uppercase tracking-widest text-gold/70 hover:text-gold underline-offset-4 hover:underline"
              title="Open the full Spell List browser with this class's spells pre-filtered."
            >
              Browse in Compendium →
            </Link>
          ) : null}
          {isAdmin && classId ? (
            <Link
              to={`/compendium/spell-lists?class=${classId}`}
              className="text-[10px] font-bold uppercase tracking-widest text-gold/70 hover:text-gold underline-offset-4 hover:underline"
            >
              Manage →
            </Link>
          ) : null}
        </div>
      </div>

      <SpellFilterShell
        filters={filters}
        sources={sources}
        tags={tags}
        tagGroups={tagGroups}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Sortable column-row list. Header strip stays visible above
            the rows; the row list itself scrolls inside a max-height
            so the page never grows past the viewport when the class
            has hundreds of spells. */}
        <Card className="border-gold/10 bg-card/50 overflow-hidden">
          <CardContent className="p-0">
            {filteredEntries.length === 0 ? (
              <div className="px-8 py-20 text-center text-ink/45">
                No spells match the current filters.
              </div>
            ) : (
              <>
                <div className="border-b border-gold/10 bg-background/35">
                  <div
                    className="grid gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 items-center"
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    {SPELL_LIST_COLS.map(col => {
                      const isActive = sortBy === col;
                      const isName = col === 'name';
                      return (
                        <button
                          key={col}
                          type="button"
                          onClick={() => handleSort(col)}
                          className={cn(
                            'flex items-center gap-1 transition-colors',
                            isName ? 'justify-start' : 'justify-center',
                            isActive ? 'text-gold' : 'hover:text-gold/90',
                          )}
                          title={`Sort by ${SPELL_LIST_COL_LABELS[col]}${isActive ? ` (${sortDir})` : ''}`}
                        >
                          <span>{SPELL_LIST_COL_LABELS[col]}</span>
                          {isActive && (
                            sortDir === 'asc'
                              ? <ChevronUp className="w-3 h-3" />
                              : <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="custom-scrollbar overflow-y-auto divide-y divide-gold/5"
                  style={{ maxHeight: '60vh' }}
                >
                  {sortedEntries.map(({ spell }) => {
                    const isPreviewing = previewSpellId === spell.id;
                    const sourceLabel = sourceById[spell.source_id || '']?.abbreviation
                      || sourceById[spell.source_id || '']?.shortName
                      || '';
                    const schoolAbbrev = (() => {
                      const full = SCHOOL_LABELS[String(spell.school ?? '')];
                      if (!full) return String(spell.school ?? '').slice(0, 4).toUpperCase() || '—';
                      return full.length > 6 ? full.slice(0, 4) + '.' : full;
                    })();
                    const timeLabel = ACTIVATION_LABELS[spell.activationBucket as keyof typeof ACTIVATION_LABELS] || '—';
                    const rangeLabel = RANGE_LABELS[spell.rangeBucket as keyof typeof RANGE_LABELS] || '—';
                    return (
                      <button
                        key={spell.id}
                        type="button"
                        onClick={() => setPreviewSpellId(spell.id)}
                        className={cn(
                          'grid h-[44px] w-full gap-2 items-center px-3 text-left transition-colors',
                          isPreviewing ? 'bg-gold/15' : 'hover:bg-gold/5',
                        )}
                        style={{ gridTemplateColumns: gridTemplate }}
                      >
                        <div className="min-w-0 flex items-center">
                          <span className="truncate font-serif text-sm text-ink">{spell.name}</span>
                        </div>
                        <div className="text-xs text-ink/75 text-center">
                          {Number(spell.level ?? 0) === 0 ? 'C' : spell.level}
                        </div>
                        <div className="text-xs text-ink/75 text-center truncate" title={timeLabel}>
                          {timeLabel}
                        </div>
                        <div
                          className="text-xs text-ink/75 text-center truncate"
                          title={SCHOOL_LABELS[String(spell.school ?? '')] || ''}
                        >
                          {schoolAbbrev}
                        </div>
                        <div className="text-xs text-blood/70 text-center" title="Concentration">
                          {spell.concentration ? '◆' : ''}
                        </div>
                        <div className="text-xs text-ink/75 text-center truncate" title={rangeLabel}>
                          {rangeLabel}
                        </div>
                        <div className="text-xs font-bold text-gold/80 text-center truncate">
                          {sourceLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-gold/20 bg-card/50 overflow-hidden self-start">
          <CardContent className="p-0">
            <SpellDetailPanel
              spellId={previewSpellId}
              emptyMessage="Click a spell to preview its details here."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
