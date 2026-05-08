import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Plus, Minus, Trash2, Edit2, Zap, Heart, Star, BookOpen, Settings, Sword, Lock, Check, Eye, EyeOff, X, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { fetchCollection } from '../../lib/d1';
import ReferenceSheetDialog from '../reference/ReferenceSheetDialog';
import type { ReferenceContext } from '../../lib/referenceSyntax';
import {
  buildDefaultAdvancementConfiguration,
  normalizeAdvancementForEditor,
  resolveAdvancementDefaultHitDie
} from '../../lib/advancementState';

export type AdvancementType =
  | 'AbilityScoreImprovement'
  | 'HitPoints'
  | 'ItemChoice'
  | 'ItemGrant'
  | 'ScaleValue'
  | 'Size'
  | 'Trait'
  | 'Subclass';

export interface Advancement {
  _id: string;
  type: AdvancementType;
  level: number;
  title: string;
  icon?: string;
  featureId?: string;
  isBase?: boolean;
  configuration: any;
  value?: any;
  flags?: {
    'dauligor-pairing'?: {
      semanticId?: string;
    }
  }
}

interface AdvancementManagerProps {
  advancements: Advancement[];
  onChange: (advancements: Advancement[]) => void;
  availableFeatures?: any[];
  availableScalingColumns?: any[];
  availableOptionGroups?: any[];
  availableOptionItems?: any[];
  isInsideFeature?: boolean;
  featureId?: string;
  classId?: string;
  onLinkAdvancement?: (advId: string, featureId: string | undefined) => void;
  rootAdvancements?: Advancement[];
  defaultLevel?: number;
  defaultHitDie?: number;
  referenceContext?: ReferenceContext;
  referenceSheetTitle?: string;
}

function UpArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

const ADVANCEMENT_INFO: Record<AdvancementType, { label: string, icon: any, color: string }> = {
  AbilityScoreImprovement: { label: 'Ability Score Improvement', icon: <UpArrow className="w-4 h-4" />, color: 'text-indigo-500' },
  HitPoints: { label: 'Hit Points', icon: <Heart className="w-4 h-4" />, color: 'text-rose-500' },
  ItemChoice: { label: 'Item Choice', icon: <Star className="w-4 h-4" />, color: 'text-gold' },
  ItemGrant: { label: 'Item Grant', icon: <Zap className="w-4 h-4" />, color: 'text-amber-500' },
  ScaleValue: { label: 'Scale Value', icon: <BookOpen className="w-4 h-4" />, color: 'text-sky-500' },
  Size: { label: 'Size', icon: <Settings className="w-4 h-4" />, color: 'text-slate-500' },
  Trait: { label: 'Trait (Proficiency)', icon: <Sword className="w-4 h-4" />, color: 'text-orange-500' },
  Subclass: { label: 'Choose Subclass', icon: <Star className="w-4 h-4" />, color: 'text-purple-500' },
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  any: 'Anything',
  feature: 'Feature',
  'option-group': 'Unique Option Group',
  spell: 'Spell (Placeholder)',
  item: 'Item (Placeholder)',
};

const SIZE_LABELS: Record<string, string> = {
  tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan',
};

const TRAIT_TYPE_LABELS: Record<string, string> = {
  skills: 'Skills', saves: 'Saving Throws',
  armor: 'Armor', weapons: 'Weapons', tools: 'Tools', languages: 'Languages',
  di: 'Damage Immunities', dr: 'Damage Resistances', dv: 'Damage Vulnerabilities', ci: 'Condition Immunities',
};

const TRAIT_MODE_LABELS: Record<string, string> = {
  default: 'Default', expertise: 'Expertise', forcedExpertise: 'Forced Expertise', upgrade: 'Upgrade',
};

const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ABILITY_LABELS: Record<(typeof ABILITY_ORDER)[number], string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

const TRAIT_MODE_ENABLED_TYPES = new Set(['skills', 'saves', 'tools']);
const GROUPED_TRAIT_TYPES = new Set(['armor', 'weapons', 'languages', 'tools']);

function getScalingBreakpoints(values: Record<string, any> = {}) {
  let lastValue: string | undefined;
  return Object.entries(values)
    .sort(([a], [b]) => Number(a) - Number(b))
    .filter(([, value]) => {
      const normalized = String(value ?? '');
      if (normalized === '' || normalized === lastValue) return false;
      lastValue = normalized;
      return true;
    });
}

function getGroupedTraitEntries(items: any[] = [], type: string = 'skills') {
  const sorted = [...items].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  
  if (type === 'saves') {
    sorted.sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : 999;
      const orderB = typeof b.order === 'number' ? b.order : 999;
      return orderA - orderB;
    });
  }

  return sorted.reduce((groups, item) => {
    let key = String(item.category || 'Uncategorized');
    
    if (type === 'weapons' && item.weaponType) {
       key = key.replace(/ Weapons?/i, '');
       key += ` ${item.weaponType}`;
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {} as Record<string, any[]>);
}

function PreviewPanel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-between bg-background/20 border border-gold/10 hover:bg-gold/5 h-auto py-3 px-4 rounded-md transition-colors text-left focus:outline-none focus:ring-2 focus:ring-gold/50 cursor-pointer"
      >
        <span className="text-[10px] uppercase font-black tracking-widest text-gold/60">{title}</span>
        <Eye className="w-3.5 h-3.5 text-gold/60 shrink-0" />
      </button>

      {isOpen && createPortal(
        <div className="fixed inset-0 z-[200] isolate flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm -z-10" 
            onClick={() => setIsOpen(false)} 
            aria-hidden="true"
          />
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col gap-0 rounded-xl bg-card p-4 text-ink shadow-2xl ring-1 ring-gold/20 outline-none animate-in fade-in-0 zoom-in-95 duration-100">
            <div className="flex justify-between items-start mb-4 gap-4">
              <div className="shrink-0">
                <h4 className="text-sm uppercase font-black tracking-widest text-gold/80">{title}</h4>
                {subtitle && <p className="text-[10px] text-ink/60 mt-1">{subtitle}</p>}
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="rounded-sm opacity-70 hover:opacity-100 transition-opacity p-1 bg-background/50 hover:bg-background border border-gold/10 shrink-0 cursor-pointer text-gold"
              >
                 <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[65vh] pl-1 pr-3 -mr-3 pb-2">{children}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function AdvancementManager({
  advancements,
  onChange,
  availableFeatures = [],
  availableScalingColumns = [],
  availableOptionGroups = [],
  availableOptionItems = [],
  isInsideFeature = false,
  featureId,
  classId,
  onLinkAdvancement,
  rootAdvancements = [],
  defaultLevel = 1,
  defaultHitDie = 8,
  referenceContext,
  referenceSheetTitle = 'Reference Sheet'
}: AdvancementManagerProps) {
  const resolvedDefaultHitDie = resolveAdvancementDefaultHitDie(defaultHitDie);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingAdv, setEditingAdvState] = useState<Partial<Advancement>>({});
  const [traitOptionsMap, setTraitOptionsMap] = useState<Record<string, any[]>>({});
  const [collapsedTraitCategories, setCollapsedTraitCategories] = useState<Record<string, boolean>>({});
  const [featureSearch, setFeatureSearch] = useState('');
  const [allFeatures, setAllFeatures] = useState<any[]>([]);
  const [optionGroupSearch, setOptionGroupSearch] = useState('');
  const [showAllOptionGroups, setShowAllOptionGroups] = useState(false);
  const setEditingAdv = (nextValue: React.SetStateAction<Partial<Advancement>>) => {
    setEditingAdvState((previousValue) => normalizeAdvancementForEditor(
      typeof nextValue === 'function'
        ? (nextValue as (value: Partial<Advancement>) => Partial<Advancement>)(previousValue)
        : nextValue,
      {
        defaultLevel,
        defaultHitDie: resolvedDefaultHitDie
      }
    ));
  };
  const selectedScalingColumn = availableScalingColumns.find(c => c.id === editingAdv.configuration?.scalingColumnId);
  const selectedOptionGroup = availableOptionGroups.find(g => g.id === editingAdv.configuration?.optionGroupId);
  const excludedOptionIds = new Set(editingAdv.configuration?.excludedOptionIds || []);
  const selectedOptionItems = selectedOptionGroup
    ? availableOptionItems
        .filter((item: any) => item.groupId === selectedOptionGroup.id)
        .sort((a: any, b: any) => {
          const aLevel = Number(a.levelPrerequisite || 0);
          const bLevel = Number(b.levelPrerequisite || 0);
          if (aLevel !== bLevel) return aLevel - bLevel;
          return String(a.name || '').localeCompare(String(b.name || ''));
        })
    : [];
  const includedOptionItems = selectedOptionItems.filter((item: any) => !excludedOptionIds.has(item.id));
  const selectedPoolFeatures = (editingAdv.configuration?.pool || [])
    .map((id: string) =>
      availableFeatures.find((f: any) => f.id === id) ||
      allFeatures.find((f: any) => f.id === id)
    )
    .filter(Boolean);
  const optionalPoolIds = new Set(editingAdv.configuration?.optionalPool || []);
  const selectedSizeIds = Object.entries(editingAdv.configuration?.sizes || {})
    .filter(([, isSelected]) => Boolean(isSelected))
    .map(([size]) => size);
  const scalingBreakpointRows = getScalingBreakpoints(selectedScalingColumn?.values || {});
  const choiceCountMode = editingAdv.configuration?.countSource === 'scaling'
    ? (editingAdv.configuration?.scalingColumnId || '')
    : 'manual';
  const traitType = editingAdv.configuration?.type || 'skills';
  const traitAllowsReplacements = Boolean(editingAdv.configuration?.allowReplacements);
  const traitChoiceUsesScaling = editingAdv.configuration?.choiceSource === 'scaling';
  const traitOptions = traitOptionsMap[traitType] || [];
  const groupedTraitEntries: Record<string, any[]> = getGroupedTraitEntries(traitOptions, traitType);
  const averageHitPointsAtLevel = (level: number) => {
    const die = Number(editingAdv.configuration?.hitDie || resolvedDefaultHitDie);
    const averagePerLevel = Math.floor(die / 2) + 1;
    return die + Math.max(0, level - 1) * averagePerLevel;
  };

  const toggleExcludedOption = (optionId: string, includeOption: boolean) => {
    const nextExcluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
    if (includeOption) nextExcluded.delete(optionId);
    else nextExcluded.add(optionId);
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        excludedOptionIds: Array.from(nextExcluded)
      }
    });
  };

  const toggleSelectedSize = (sizeId: string, isSelected: boolean) => {
    const nextSizes = { ...(editingAdv.configuration?.sizes || {}) };
    if (isSelected) nextSizes[sizeId] = true;
    else delete nextSizes[sizeId];
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        sizes: nextSizes
      }
    });
  };

  const setAsiPoints = (nextValue: number) => {
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        points: Math.max(0, nextValue)
      }
    });
  };

  const setTraitMode = (nextMode: string) => {
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        mode: nextMode
      }
    });
  };

  const setTraitConfigurationLists = (nextFixed: string[], nextOptions: string[], nextReplacements?: string[]) => {
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        fixed: Array.from(new Set(nextFixed)),
        options: Array.from(new Set(nextOptions)),
        replacements: Array.from(new Set(nextReplacements || editingAdv.configuration?.replacements || []))
      }
    });
  };

  const toggleTraitFixed = (traitId: string, isChecked: boolean) => {
    const fixed = new Set<string>(editingAdv.configuration?.fixed || []);
    const options = new Set<string>(editingAdv.configuration?.options || []);
    if (isChecked) {
      fixed.add(traitId);
      options.delete(traitId);
    } else {
      fixed.delete(traitId);
    }
    setTraitConfigurationLists(Array.from(fixed), Array.from(options));
  };

  const toggleTraitOption = (traitId: string, isChecked: boolean) => {
    const fixed = new Set<string>(editingAdv.configuration?.fixed || []);
    const options = new Set<string>(editingAdv.configuration?.options || []);
    if (isChecked) {
      options.add(traitId);
      fixed.delete(traitId);
    } else {
      options.delete(traitId);
    }
    setTraitConfigurationLists(Array.from(fixed), Array.from(options));
  };

  const toggleTraitReplacement = (traitId: string, isChecked: boolean) => {
    const replacements = new Set<string>(editingAdv.configuration?.replacements || []);
    if (isChecked) replacements.add(traitId);
    else replacements.delete(traitId);
    setTraitConfigurationLists(
      editingAdv.configuration?.fixed || [],
      editingAdv.configuration?.options || [],
      Array.from(replacements)
    );
  };

  const toggleTraitCategory = (category: string, target: 'fixed' | 'options' | 'replacements', isChecked: boolean) => {
    const categoryItems = groupedTraitEntries[category] || [];
    const fixed = new Set<string>(editingAdv.configuration?.fixed || []);
    const options = new Set<string>(editingAdv.configuration?.options || []);
    const replacements = new Set<string>(editingAdv.configuration?.replacements || []);
    categoryItems.forEach((item: any) => {
      if (target === 'fixed') {
        if (isChecked) {
          fixed.add(item.id);
          options.delete(item.id);
        } else {
          fixed.delete(item.id);
        }
      } else if (target === 'options') {
        if (isChecked) {
          options.add(item.id);
          fixed.delete(item.id);
        } else {
          options.delete(item.id);
        }
      } else if (target === 'replacements') {
        if (isChecked) replacements.add(item.id);
        else replacements.delete(item.id);
      }
    });
    setTraitConfigurationLists(Array.from(fixed), Array.from(options), Array.from(replacements));
    if (target === 'fixed' && isChecked) {
      setCollapsedTraitCategories(prev => ({ ...prev, [`${traitType}:${category}`]: true }));
    }
  };
  const setAsiFixedValue = (ability: (typeof ABILITY_ORDER)[number], nextValue: number) => {
    const fixed = { ...(editingAdv.configuration?.fixed || {}) };
    fixed[ability] = Math.max(0, nextValue);
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        fixed
      }
    });
  };
  const toggleAsiLock = (ability: (typeof ABILITY_ORDER)[number]) => {
    const locked = { ...(editingAdv.configuration?.locked || {}) };
    locked[ability] = !locked[ability];
    setEditingAdv({
      ...editingAdv,
      configuration: {
        ...editingAdv.configuration,
        locked
      }
    });
  };

  useEffect(() => {
    if (editingAdv.type === 'Trait') {
      const type = editingAdv.configuration?.type;
      if (!type) return;
      if (traitOptionsMap[type]) return;

      let cols: string[] = [];
      let catCol = '';
      if (type === 'skills') cols = ['skills'];
      else if (type === 'armor') { cols = ['armor']; catCol = 'armorCategories'; }
      else if (type === 'weapons') { cols = ['weapons']; catCol = 'weaponCategories'; }
      else if (type === 'tools') { cols = ['tools']; catCol = 'toolCategories'; }
      else if (type === 'languages') { cols = ['languages']; catCol = 'languageCategories'; }
      else if (type === 'di' || type === 'dr' || type === 'dv') cols = ['damageTypes'];
      else if (type === 'ci') cols = ['conditions'];
      else if (type === 'saves') cols = ['attributes'];

      if (cols.length > 0) {
        const promises: Promise<any[]>[] = cols.map(c => fetchCollection<any>(c));
        if (catCol) {
          promises.push(fetchCollection<any>(catCol));
        }

        Promise.all(promises).then(rowsList => {
          const itemRowsList = rowsList.slice(0, cols.length);
          const catRows = catCol ? rowsList[rowsList.length - 1] : null;

          const catMap = new Map<string, string>();
          if (catRows) {
            catRows.forEach((r: any) => catMap.set(r.id, r.name));
          }

          let items = itemRowsList.flatMap(rows => rows.map((data: any) => {
            const categoryId = data.category_id;
            return {
              ...data,
              category: (categoryId && catMap.has(categoryId)) ? catMap.get(categoryId) : (data.category || 'Other')
            };
          }));
          
          // Deduplicate attributes for saves
          if (type === 'saves') {
            const uniqueAttrsMap = new Map();
            items.forEach((item: any) => {
              const key = (item.identifier || item.id).toUpperCase();
              if (!uniqueAttrsMap.has(key) || item.identifier) {
                uniqueAttrsMap.set(key, item);
              }
            });
            items = Array.from(uniqueAttrsMap.values());
          }

          if (type === 'saves' && items.length === 0) {
            setTraitOptionsMap(prev => ({ ...prev, saves: [
              {id: 'str', name: 'Strength'},
              {id: 'dex', name: 'Dexterity'},
              {id: 'con', name: 'Constitution'},
              {id: 'int', name: 'Intelligence'},
              {id: 'wis', name: 'Wisdom'},
              {id: 'cha', name: 'Charisma'}
            ]}));
            return;
          }
          
          items.sort((a, b) => {
            if (type === 'saves') {
              const orderA = typeof a.order === 'number' ? a.order : 999;
              const orderB = typeof b.order === 'number' ? b.order : 999;
              if (orderA !== orderB) return orderA - orderB;
            }
            return (a.name || a.id).localeCompare(b.name || b.id);
          });
          
          setTraitOptionsMap(prev => ({ ...prev, [type]: items }));
        }).catch(console.error);
      }
    }
  }, [editingAdv.type, editingAdv.configuration?.type]);

  useEffect(() => {
    if (editingAdv.type !== 'Trait') return;
    const type = editingAdv.configuration?.type || 'skills';
    const mode = editingAdv.configuration?.mode || 'default';
    if (!TRAIT_MODE_ENABLED_TYPES.has(type) && mode !== 'default') {
      setEditingAdv(prev => ({
        ...prev,
        configuration: {
          ...prev.configuration,
          mode: 'default'
        }
      }));
    }
  }, [editingAdv.type, editingAdv.configuration?.type, editingAdv.configuration?.mode]);

  useEffect(() => {
    if (!isModalOpen || allFeatures.length > 0) return;
    fetchCollection<any>('features')
      .then(rows => setAllFeatures(rows))
      .catch(() => {});
  }, [isModalOpen]);


  const handleAdd = () => {
    setEditingIndex(null);
    setEditingAdv({
      _id: Math.random().toString(36).substring(2, 11),
      type: 'ItemGrant',
      level: defaultLevel,
      title: '',
      configuration: buildDefaultAdvancementConfiguration('ItemGrant', resolvedDefaultHitDie)
    });
    setIsModalOpen(true);
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditingAdv(advancements[index]);
    setIsModalOpen(true);
  };

  const handleDelete = (index: number) => {
    const next = [...advancements];
    next.splice(index, 1);
    onChange(next);
  };

  const handleSave = () => {
    const next = advancements.map((advancement) => normalizeAdvancementForEditor(advancement, {
      defaultLevel,
      defaultHitDie: resolvedDefaultHitDie
    }) as Advancement);
    const adv = normalizeAdvancementForEditor(editingAdv as Advancement, {
      defaultLevel,
      defaultHitDie: resolvedDefaultHitDie
    }) as Advancement;
    if (editingIndex !== null) {
      next[editingIndex] = adv;
    } else {
      next.push(adv);
    }
    next.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return a.type.localeCompare(b.type);
    });
    onChange(next);
    setIsModalOpen(false);
    setFeatureSearch('');
    setOptionGroupSearch('');
    setShowAllOptionGroups(false);
  };

  if (isInsideFeature) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-gold/5 border border-gold/10 rounded-md">
          <p className="text-[10px] text-ink/60 mb-4 italic">
            Select which class-level advancements are linked to this feature.
            Progression logic should be managed on the main Class page.
          </p>
          <div className="grid gap-2">
            {rootAdvancements.map((adv) => {
              const isLinked = adv.featureId === featureId;
              return (
                <div key={adv._id} className={`flex items-center gap-3 p-2 rounded border transition-all ${isLinked ? 'bg-gold/10 border-gold/30' : 'bg-background/40 border-gold/5 opacity-60'}`}>
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                    checked={isLinked}
                    onChange={(e) => onLinkAdvancement?.(adv._id, e.target.checked ? featureId : undefined)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-gold/60">L{adv.level}</span>
                      <span className={`text-[10px] uppercase font-black tracking-tight ${ADVANCEMENT_INFO[adv.type]?.color}`}>
                        {ADVANCEMENT_INFO[adv.type]?.label || adv.type}
                      </span>
                    </div>
                    <div className="text-xs font-serif font-bold text-ink truncate">
                      {adv.title || 'Untitled Advancement'}
                    </div>
                  </div>
                </div>
              );
            })}
            {rootAdvancements.length === 0 && (
              <div className="text-center py-4 bg-background/20 border border-dashed border-gold/10 rounded">
                <p className="text-[10px] text-ink/40 uppercase tracking-widest font-black">No Class Advancements Found</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="section-header">
        <h3 className="label-text text-gold">Advancements</h3>
        <Button size="sm" onClick={handleAdd} className="h-7 gap-2 btn-gold">
          <Plus className="w-3.5 h-3.5" /> Add Row
        </Button>
      </div>

      <div className="grid gap-2">
        {advancements.map((adv, idx) => (
          <div key={adv._id} className={cn(
            "flex items-center gap-3 p-3 bg-card/40 border border-gold/10 rounded-lg group hover:border-gold/30 hover:bg-card/60 transition-all",
            adv.isBase && "opacity-60 saturate-50 bg-gold/[0.02]"
          )}>
            <div className="w-10 h-10 bg-background rounded border border-gold/10 flex flex-col items-center justify-center shrink-0">
              <span className="text-[10px] font-mono text-gold/60 leading-none">L{adv.level}</span>
              <div className={ADVANCEMENT_INFO[adv.type]?.color || 'text-gold'}>
                {ADVANCEMENT_INFO[adv.type]?.icon || <Zap className="w-4 h-4" />}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase text-ink/80 tracking-wider truncate">
                  {adv.title || ADVANCEMENT_INFO[adv.type]?.label || adv.type}
                </span>
                {adv.isBase && (
                  <span className="text-[8px] bg-gold/10 text-gold px-1.5 py-0.5 rounded font-black tracking-widest uppercase">Base</span>
                )}
                <span className="text-[8px] font-bold text-ink/20 uppercase tracking-widest shrink-0">
                  {adv.type}
                </span>
              </div>
              <div className="text-[10px] text-ink/40 font-serif italic flex items-center gap-2">
                <span className="truncate">
                  {adv.type === 'ItemGrant' && (adv.configuration?.choiceType === 'option-group'
                    ? `Grants items from Option Group`
                    : `Grants items: ${adv.configuration?.pool?.length || 0}`)}
                  {adv.type === 'ItemChoice' && (adv.configuration?.choiceType === 'option-group' 
                    ? `Choose ${adv.configuration?.count || 1} from Option Group` 
                    : `Choose ${adv.configuration?.count || 1} from ${adv.configuration?.pool?.length || 0}`)}
                  {adv.type === 'HitPoints' && `Hit Die: d${adv.configuration.hitDie || '?'}`}
                  {adv.type === 'Trait' && `Proficiency: ${TRAIT_TYPE_LABELS[adv.configuration.type] || adv.configuration.type}`}
                  {adv.type === 'Subclass' && `Subclass selection trigger`}
                </span>
                {adv.isBase && (
                  <span className="text-gold/40 not-italic font-sans font-bold uppercase tracking-tighter text-[9px]">
                    — Starting Core Advancement
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="sm" onClick={() => handleEdit(idx)} className="h-7 w-7 p-0 text-gold hover:bg-gold/10"><Edit2 className="w-3.5 h-3.5" /></Button>
              {!adv.isBase && (
                <Button variant="ghost" size="sm" onClick={() => handleDelete(idx)} className="h-7 w-7 p-0 btn-danger"><Trash2 className="w-3.5 h-3.5" /></Button>
              )}
            </div>
          </div>
        ))}

        {advancements.length === 0 && (
          <div className="empty-state">
            <Zap className="w-8 h-8 text-gold/20 mb-3" />
            <p className="text-ink/40 font-serif italic text-sm">No advancements defined yet.</p>
            <p className="text-[9px] uppercase font-black text-gold/40 mt-1 tracking-widest">Own the progression path for this class</p>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="dialog-content w-[95vw] max-w-[95vw] sm:max-w-[95vw] lg:max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader className="dialog-header">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="dialog-title flex items-center gap-3">
                {editingIndex !== null ? 'Configure Advancement' : 'New Advancement'}
                {editingAdv.isBase && <span className="text-[10px] bg-gold/10 text-gold px-2 py-0.5 rounded border border-gold/20 tracking-widest">Base</span>}
              </DialogTitle>
              {referenceContext ? (
                <ReferenceSheetDialog
                  title={referenceSheetTitle}
                  triggerLabel="Open Reference Sheet"
                  triggerClassName="shrink-0"
                  context={referenceContext}
                />
              ) : null}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 dialog-body space-y-6">

            <fieldset className="config-fieldset">
              <legend className="section-label px-2">Core Settings</legend>
              <div className="grid md:grid-cols-2 gap-4">
                <div className={`space-y-1.5 ${isInsideFeature ? 'md:col-span-2' : ''}`}>
                  <label className="field-label">Title</label>
                  <Input
                    value={editingAdv.title || ''}
                    onChange={e => setEditingAdv({...editingAdv, title: e.target.value})}
                    placeholder="Leave blank for default"
                    className="h-9 bg-background/50 border-gold/10 placeholder:text-ink/20"
                  />
                </div>
                {!isInsideFeature && (
                  <div className="space-y-1.5">
                    <label className="field-label">Gained at Level</label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={editingAdv.featureId && availableFeatures.find(f => f.id === editingAdv.featureId) ? availableFeatures.find(f => f.id === editingAdv.featureId)?.level : (editingAdv.level || 1)}
                      onChange={e => setEditingAdv({...editingAdv, level: parseInt(e.target.value)})}
                      disabled={!!(editingAdv.featureId && availableFeatures.find(f => f.id === editingAdv.featureId))}
                      className="h-9 bg-background/50 border-gold/10 disabled:opacity-50"
                    />
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4 pt-1">
                <div className="space-y-1.5">
                  <label className="field-label">Advancement Type</label>
                  <Select
                    value={editingAdv.type}
                    onValueChange={(val: AdvancementType | null) => {
                      if (!val) return;
                      const base: Partial<Advancement> = {
                        ...editingAdv,
                        type: val,
                        configuration: buildDefaultAdvancementConfiguration(val, resolvedDefaultHitDie)
                      };
                      setEditingAdv(base);
                    }}
                  >
                    <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                      <SelectValue>
                        {editingAdv.type ? (ADVANCEMENT_INFO[editingAdv.type]?.label || editingAdv.type) : 'Select type...'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ADVANCEMENT_INFO).filter(([key]) => key !== 'Subclass').map(([key, info]) => (
                        <SelectItem key={key} value={key}>{info.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!isInsideFeature && (
                  <div className="space-y-1.5">
                    <label className="field-label">Attached to Feature</label>
                    <Select
                      value={(editingAdv.featureId ?? undefined) || 'none'}
                      onValueChange={(val) => {
                        const newFeatureId = (!val || val === 'none') ? undefined : val;
                        const linkedFeature = newFeatureId ? availableFeatures.find(f => f.id === newFeatureId) : undefined;
                        setEditingAdv({
                          ...editingAdv, 
                          featureId: newFeatureId,
                          level: linkedFeature ? linkedFeature.level : editingAdv.level
                        });
                      }}
                    >
                      <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                        <SelectValue>
                          {editingAdv.featureId && editingAdv.featureId !== 'none'
                            ? (availableFeatures.find(f => f.id === editingAdv.featureId)?.name || 'Unknown Feature')
                            : 'Standalone Advancement'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Standalone Advancement</SelectItem>
                        {availableFeatures.map(f => (
                          <SelectItem key={f.id} value={f.id}>{f.name} (Lvl {f.level})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </fieldset>

            {/* Configuration */}
            <div className="space-y-4">
              {/* ── ItemGrant ── */}
              {editingAdv.type === 'ItemGrant' && (
                <div className="grid xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] gap-5 items-start">
                  
                  {/* Left Column: Settings & Preview */}
                  <div className="space-y-4">
                    <fieldset className="config-fieldset bg-background/20">
                      <legend className="section-label text-gold/60 px-1">Grant Settings</legend>
                      <div className="space-y-4">
                        <label className="flex items-center gap-2 cursor-pointer group w-fit">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${editingAdv.configuration?.optional ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/60'}`}>
                            {editingAdv.configuration?.optional && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={editingAdv.configuration?.optional || false}
                            onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optional: e.target.checked }})}
                          />
                          <span className="text-[10px] uppercase font-bold text-ink/60">Optional (players may opt out)</span>
                        </label>

                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="field-label">Item Type</label>
                            <Select
                              value={editingAdv.configuration?.choiceType || 'feature'}
                              onValueChange={val => setEditingAdv({
                                ...editingAdv,
                                configuration: {
                                  ...editingAdv.configuration,
                                  choiceType: val,
                                  pool: [],
                                  optionalPool: [],
                                  optionGroupId: undefined,
                                  excludedOptionIds: []
                                }
                              })}
                            >
                              <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                                <SelectValue>
                                  {ITEM_TYPE_LABELS[editingAdv.configuration?.choiceType || 'feature'] || editingAdv.configuration?.choiceType}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">Anything</SelectItem>
                                <SelectItem value="feature">Feature</SelectItem>
                                <SelectItem value="option-group">Unique Option Group</SelectItem>
                                <SelectItem value="spell" disabled>Spell (Placeholder)</SelectItem>
                                <SelectItem value="item" disabled>Item (Placeholder)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="field-label">
                              {editingAdv.configuration?.choiceType === 'option-group' ? 'Target Option Group' : 'Grant Source'}
                            </label>
                            {editingAdv.configuration?.choiceType === 'option-group' ? (() => {
                              const classFiltered = classId
                                ? availableOptionGroups.filter(g => !g.classIds?.length || g.classIds.includes(classId))
                                : availableOptionGroups;
                              const q = optionGroupSearch.trim().toLowerCase();
                              const searchFiltered = q
                                ? availableOptionGroups.filter(g => (g.name || '').toLowerCase().includes(q))
                                : availableOptionGroups;
                              return (
                                <div className="space-y-1.5">
                                  <Select
                                    value={editingAdv.configuration?.optionGroupId || ''}
                                    onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionGroupId: val, excludedOptionIds: [] }})}
                                  >
                                    <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                                      <SelectValue>
                                        {editingAdv.configuration?.optionGroupId
                                          ? (availableOptionGroups.find(g => g.id === editingAdv.configuration.optionGroupId)?.name || editingAdv.configuration.optionGroupId)
                                          : 'Select a group...'}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {classFiltered.map(g => (
                                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                                      ))}
                                      {classFiltered.length === 0 && <p className="px-2 py-2 text-[10px] italic text-ink/30">No groups assigned to this class.</p>}
                                    </SelectContent>
                                  </Select>
                                  {/* Inline search-all panel */}
                                  <div className="border border-gold/10 rounded-md overflow-hidden bg-background/20">
                                    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gold/10">
                                      <Search className="w-3 h-3 text-ink/40 shrink-0" />
                                      <input
                                        type="text"
                                        placeholder="Search all option groups…"
                                        value={optionGroupSearch}
                                        onChange={e => { setOptionGroupSearch(e.target.value); setShowAllOptionGroups(true); }}
                                        onFocus={() => setShowAllOptionGroups(true)}
                                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/40 text-ink"
                                      />
                                      {optionGroupSearch && (
                                        <button type="button" onClick={() => { setOptionGroupSearch(''); setShowAllOptionGroups(false); }} className="text-ink/30 hover:text-ink/60 text-sm leading-none">×</button>
                                      )}
                                    </div>
                                    {showAllOptionGroups && (
                                      <div className="max-h-40 overflow-y-auto divide-y divide-gold/5">
                                        {searchFiltered.map(g => (
                                          <button
                                            key={g.id}
                                            type="button"
                                            className="w-full text-left px-3 py-2 text-xs hover:bg-gold/10 flex items-center justify-between gap-2"
                                            onClick={() => {
                                              setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionGroupId: g.id, excludedOptionIds: [] }});
                                              setShowAllOptionGroups(false);
                                              setOptionGroupSearch('');
                                            }}
                                          >
                                            <span className="font-bold text-ink">{g.name}</span>
                                            {g.classIds?.length > 0 && <span className="text-[9px] text-gold/60 shrink-0">{g.classIds.length} class{g.classIds.length !== 1 ? 'es' : ''}</span>}
                                          </button>
                                        ))}
                                        {searchFiltered.length === 0 && <p className="px-3 py-3 text-[10px] italic text-ink/30">No groups match.</p>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })() : (
                              <div className="h-9 rounded-md border border-gold/10 bg-background/35 px-3 flex items-center text-[10px] text-ink/40">
                                Specific Features
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </fieldset>

                    <PreviewPanel
                      title="Items Preview"
                      subtitle={editingAdv.configuration?.choiceType === 'option-group'
                        ? 'Included group items are listed here. Excluded items stay available in the group but will not be exported with this advancement.'
                        : 'Use this panel to confirm the features granted by this advancement.'}
                    >
                      {editingAdv.configuration?.choiceType === 'option-group' ? (
                        selectedOptionGroup ? (
                          <div className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-ink">{selectedOptionGroup.name}</p>
                                {selectedOptionGroup.description && (
                                  <p className="mt-1 text-[10px] text-ink/45">{selectedOptionGroup.description}</p>
                                )}
                              </div>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">
                                {includedOptionItems.length}/{selectedOptionItems.length} included
                              </span>
                            </div>
                            <div className="border border-gold/10 rounded-md overflow-hidden">
                              <div className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)] px-3 py-2 bg-background/60 border-b border-gold/10">
                                <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Optional</span>
                                <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Level</span>
                                <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Item</span>
                              </div>
                              <div className="divide-y divide-gold/5 max-h-[16rem] overflow-y-auto">
                                {includedOptionItems.map((item: any) => (
                                  <div key={item.id} className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)] gap-3 px-3 py-2 items-start">
                                    <span className="text-[10px] font-black tracking-widest text-ink/45 uppercase">
                                      {editingAdv.configuration?.optional && optionalPoolIds.has(item.id) ? 'Yes' : 'No'}
                                    </span>
                                    <span className="text-[10px] font-black tracking-widest text-ink/45 uppercase">Lvl {item.levelPrerequisite || 0}+</span>
                                    <div>
                                      <p className="text-xs font-bold text-ink">{item.name}</p>
                                      {(item.featureId || item.sourceId) && (
                                        <p className="mt-1 text-[9px] text-ink/40">
                                          {item.featureId ? `Linked feature: ${availableFeatures.find((feature: any) => feature.id === item.featureId)?.name || item.featureId}` : `Source: ${item.sourceId}`}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {includedOptionItems.length === 0 && (
                                  <p className="px-3 py-4 text-[10px] italic text-ink/35">All items in this option group are currently excluded.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[10px] italic text-ink/35">Choose a unique option group to preview what this advancement will grant.</p>
                        )
                      ) : selectedPoolFeatures.length > 0 ? (
                        <div className="border border-gold/10 rounded-md overflow-hidden">
                          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] px-3 py-2 bg-background/60 border-b border-gold/10">
                            <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Optional</span>
                            <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Item</span>
                          </div>
                          <div className="divide-y divide-gold/5 max-h-[16rem] overflow-y-auto">
                            {selectedPoolFeatures.map((feature: any) => (
                              <div key={feature.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-3 py-2 items-start">
                                <span className="text-[10px] font-black tracking-widest text-ink/45 uppercase">
                                  {editingAdv.configuration?.optional && optionalPoolIds.has(feature.id) ? 'Yes' : 'No'}
                                </span>
                                <div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-ink">{feature.name}</span>
                                    <span className="text-[9px] text-gold/60 uppercase tracking-widest">Lvl {feature.level}</span>
                                  </div>
                                  {feature.description && (
                                    <p className="mt-1 text-[9px] text-ink/40 line-clamp-2">{feature.description}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] italic text-ink/35">Select one or more features to preview what this advancement will grant.</p>
                      )}
                    </PreviewPanel>
                  </div>

                  {/* Right Column: Pool selection */}
                  <div className="space-y-4">
                    <fieldset className="config-fieldset bg-background/20 h-full">
                      <legend className="section-label text-gold/60 px-1">
                        {editingAdv.configuration?.choiceType === 'option-group' ? 'Included Group Items' : 'Items to Grant'}
                      </legend>
                      <div className="border border-gold/10 rounded-md overflow-hidden bg-background/20">
                        {editingAdv.configuration?.choiceType === 'option-group' ? (
                          <>
                            {selectedOptionGroup && selectedOptionItems.length > 0 && (
                              <div className="flex flex-wrap gap-2 px-3 py-2 bg-gold/5 border-b border-gold/10">
                                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] text-ink/60 border-gold/20 hover:bg-gold/10 hover:text-ink/80" onClick={() => {
                                  let excluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                  selectedOptionItems.forEach(item => excluded.delete(item.id));
                                  setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(excluded) }});
                                }}>Select All</Button>
                                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] text-ink/60 border-gold/20 hover:bg-gold/10 hover:text-ink/80" onClick={() => {
                                  let excluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                  selectedOptionItems.forEach(item => excluded.add(item.id));
                                  setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(excluded) }});
                                }}>Deselect All</Button>
                                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] text-ink/60 border-gold/20 hover:bg-gold/10 hover:text-ink/80" onClick={() => {
                                  let excluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                  selectedOptionItems.forEach(item => {
                                    if ((item.levelPrerequisite || 0) > 0) excluded.add(item.id);
                                  });
                                  setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(excluded) }});
                                }}>Exclude Options with Level Prerequisites</Button>
                              </div>
                            )}
                            <div className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_4.5rem] px-3 py-2 bg-gold/5 border-b border-gold/10">
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Include</span>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Level</span>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Item</span>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60 text-center">Optional</span>
                            </div>
                            <div className="divide-y divide-gold/5 max-h-[16rem] overflow-y-auto">
                              {selectedOptionGroup ? selectedOptionItems.map((item: any) => {
                                const isIncluded = !excludedOptionIds.has(item.id);
                                return (
                                  <div key={item.id} className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_4.5rem] gap-3 px-3 py-2 items-center hover:bg-gold/5">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all ${isIncluded ? 'bg-gold border-gold' : 'border-gold/30 hover:border-gold/60'}`}>
                                        {isIncluded && <Check className="w-2.5 h-2.5 text-white" />}
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={isIncluded}
                                        onChange={e => {
                                          const nextExcluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                          const optionalPool = [...(editingAdv.configuration?.optionalPool || [])];
                                          if (e.target.checked) {
                                              nextExcluded.delete(item.id);
                                          } else {
                                              nextExcluded.add(item.id);
                                              const o = optionalPool.indexOf(item.id);
                                              if (o !== -1) optionalPool.splice(o, 1);
                                          }
                                          setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(nextExcluded), optionalPool }});
                                        }}
                                      />
                                    </label>
                                    <span className="text-[10px] font-black tracking-widest text-ink/45 uppercase">Lvl {item.levelPrerequisite || 0}+</span>
                                    <div>
                                      <p className="text-xs font-bold text-ink">{item.name}</p>
                                      {(item.featureId || item.sourceId) && (
                                        <p className="mt-1 text-[9px] text-ink/40">
                                          {item.featureId ? `Linked feature: ${availableFeatures.find((feature: any) => feature.id === item.featureId)?.name || item.featureId}` : `Source: ${item.sourceId}`}
                                        </p>
                                      )}
                                    </div>
                                    <label className="flex justify-center cursor-pointer">
                                      <input
                                        type="checkbox"
                                        className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                                        disabled={!isIncluded || !editingAdv.configuration?.optional}
                                        checked={(editingAdv.configuration?.optionalPool || []).includes(item.id)}
                                        onChange={e => {
                                          const optionalPool = [...(editingAdv.configuration?.optionalPool || [])];
                                          if (e.target.checked) optionalPool.push(item.id);
                                          else {
                                            const i = optionalPool.indexOf(item.id);
                                            if (i !== -1) optionalPool.splice(i, 1);
                                          }
                                          setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionalPool }});
                                        }}
                                      />
                                    </label>
                                  </div>
                                );
                              }) : (
                                <p className="px-3 py-4 text-[10px] italic text-ink/35">Choose a unique option group to configure its items.</p>
                              )}
                              {selectedOptionGroup && selectedOptionItems.length === 0 && (
                                <p className="px-3 py-4 text-[10px] italic text-ink/35">This group has no saved unique options yet.</p>
                              )}
                            </div>
                          </>
                        ) : (() => {
                            const q = featureSearch.trim().toLowerCase();
                            const displayed = q
                              ? allFeatures.filter(f => (f.name || '').toLowerCase().includes(q))
                              : availableFeatures;
                            return (
                              <>
                                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gold/10 bg-background/30">
                                  <Search className="w-3 h-3 text-ink/30 shrink-0" />
                                  <input
                                    type="text"
                                    placeholder={q ? `${displayed.length} result${displayed.length !== 1 ? 's' : ''}` : `${availableFeatures.length} local features — search all…`}
                                    value={featureSearch}
                                    onChange={e => setFeatureSearch(e.target.value)}
                                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/30 text-ink py-0.5"
                                  />
                                  {featureSearch && (
                                    <button type="button" onClick={() => setFeatureSearch('')} className="text-ink/30 hover:text-ink/60 text-sm leading-none">×</button>
                                  )}
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] px-3 py-2 bg-gold/5 border-b border-gold/10">
                                  <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Item</span>
                                  <span className="text-[9px] uppercase font-black tracking-widest text-gold/60 text-center">Optional</span>
                                </div>
                                <div className="divide-y divide-gold/5 max-h-[14rem] overflow-y-auto">
                                  {displayed.map(f => (
                                    <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3 px-3 py-2 items-center hover:bg-gold/5">
                                      <label className="flex items-center gap-2 cursor-pointer min-w-0">
                                        <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all ${
                                          (editingAdv.configuration?.pool || []).includes(f.id) ? 'bg-gold border-gold' : 'border-gold/30 hover:border-gold/60'
                                        }`}>
                                          {(editingAdv.configuration?.pool || []).includes(f.id) && <Check className="w-2.5 h-2.5 text-white" />}
                                        </div>
                                        <input
                                          type="checkbox"
                                          className="hidden"
                                          checked={(editingAdv.configuration?.pool || []).includes(f.id)}
                                          onChange={e => {
                                            const pool = [...(editingAdv.configuration?.pool || [])];
                                            const optionalPool = [...(editingAdv.configuration?.optionalPool || [])];
                                            if (e.target.checked) pool.push(f.id);
                                            else {
                                              const i = pool.indexOf(f.id);
                                              if (i !== -1) pool.splice(i, 1);
                                              const o = optionalPool.indexOf(f.id);
                                              if (o !== -1) optionalPool.splice(o, 1);
                                            }
                                            setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, pool, optionalPool }});
                                          }}
                                        />
                                        <span className="min-w-0 text-xs font-bold text-ink truncate">{f.name} <span className="text-ink/40 font-normal">(Lvl {f.level})</span></span>
                                      </label>
                                      <label className="flex justify-center cursor-pointer">
                                        <input
                                          type="checkbox"
                                          className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                                          disabled={!(editingAdv.configuration?.pool || []).includes(f.id) || !editingAdv.configuration?.optional}
                                          checked={(editingAdv.configuration?.optionalPool || []).includes(f.id)}
                                          onChange={e => {
                                            const optionalPool = [...(editingAdv.configuration?.optionalPool || [])];
                                            if (e.target.checked) optionalPool.push(f.id);
                                            else {
                                              const i = optionalPool.indexOf(f.id);
                                              if (i !== -1) optionalPool.splice(i, 1);
                                            }
                                            setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionalPool }});
                                          }}
                                        />
                                      </label>
                                    </div>
                                  ))}
                                  {displayed.length === 0 && (
                                    <p className="px-3 py-4 text-[10px] italic text-ink/30">
                                      {q ? `No features match "${featureSearch}".` : 'No features created for this class yet.'}
                                    </p>
                                  )}
                                </div>
                              </>
                            );
                          })()
                        }
                      </div>
                    </fieldset>
                  </div>
                </div>
              )}

              {/* ── ItemChoice ── */}
              {editingAdv.type === 'ItemChoice' && (
                <div className="grid xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] gap-5 items-start">
                  
                  {/* Left Column: Number of Choices & Selection Rule */}
                  <div className="space-y-4">
                    <fieldset className="config-fieldset bg-background/20">
                      <legend className="section-label text-gold/60 px-1">Number of Choices</legend>
                      <div className="space-y-3">
                        <Select
                          value={choiceCountMode}
                          onValueChange={val => {
                            if (val === 'manual') {
                              const nextConfiguration = { ...editingAdv.configuration };
                              delete nextConfiguration.scalingColumnId;
                              setEditingAdv({
                                ...editingAdv,
                                configuration: {
                                  ...nextConfiguration,
                                  countSource: 'fixed',
                                  count: nextConfiguration.count || 1
                                }
                              });
                              return;
                            }

                            setEditingAdv({
                              ...editingAdv,
                              configuration: {
                                ...editingAdv.configuration,
                                countSource: 'scaling',
                                scalingColumnId: val
                              }
                            });
                          }}
                        >
                          <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                            <SelectValue>
                              {choiceCountMode === 'manual'
                                ? 'Manual'
                                : (availableScalingColumns.find(c => c.id === choiceCountMode)?.name || 'Select Column...')}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Manual</SelectItem>
                            {availableScalingColumns.map(col => (
                              <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {choiceCountMode === 'manual' && (
                          <div className="space-y-1.5">
                            <label className="field-label">Count</label>
                            <Input
                              type="number"
                              min="1"
                              value={editingAdv.configuration?.count || 1}
                              onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, count: parseInt(e.target.value) || 1 }})}
                              className="w-full h-9 bg-background/50 border-gold/10"
                            />
                          </div>
                        )}
                      </div>
                    </fieldset>

                    <PreviewPanel
                      title="Selection Rule"
                      subtitle={choiceCountMode === 'manual'
                        ? 'Use a fixed manual choice count for this advancement.'
                        : 'Choice counts are read from the selected class column breakpoints.'}
                    >
                      {choiceCountMode === 'manual' ? (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase font-black tracking-widest text-gold/60">Manual Count</p>
                          <p className="text-2xl font-serif font-black text-ink">{editingAdv.configuration?.count || 1}</p>
                        </div>
                      ) : selectedScalingColumn ? (
                        <div className="space-y-3">
                          <div>
                            <p className="text-sm font-bold text-ink">{selectedScalingColumn.name}</p>
                            <p className="mt-1 text-[10px] text-ink/45">
                              Only saved value changes are shown here so the choice pool keeps its space.
                            </p>
                          </div>
                          {scalingBreakpointRows.length > 0 ? (
                            <div className="flex flex-col gap-1.5 w-full">
                              {scalingBreakpointRows.map(([level, value]) => (
                                <div key={level} className="flex items-center gap-3 rounded-md border border-gold/10 bg-background/55 px-3 py-1.5 w-full">
                                  <span className="text-[10px] uppercase font-black tracking-widest text-gold/60 min-w-[2.5rem] whitespace-nowrap">Lvl {level}</span>
                                  <div className="h-px bg-gold/10 flex-1" />
                                  <span className="text-sm font-black text-ink">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] italic text-ink/35">This class column does not have any saved breakpoints yet.</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] italic text-ink/35">Choose a class column to preview the choice count progression.</p>
                      )}
                    </PreviewPanel>

                    <PreviewPanel
                      title="Choice Preview"
                      subtitle={editingAdv.configuration?.choiceType === 'option-group'
                        ? 'Included options are listed here after exclusions are applied.'
                        : 'Use this panel to confirm the features available to choose from.'}
                    >
                      <div className="space-y-4">
                        {editingAdv.configuration?.choiceType === 'option-group' ? (
                          selectedOptionGroup ? (
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-bold text-ink">{selectedOptionGroup.name}</p>
                                  {selectedOptionGroup.description && (
                                    <p className="mt-1 text-[10px] text-ink/45">{selectedOptionGroup.description}</p>
                                  )}
                                </div>
                                <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">
                                  {includedOptionItems.length}/{selectedOptionItems.length} usable
                                </span>
                              </div>
                              <div className="border border-gold/10 rounded-md overflow-hidden">
                                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] px-3 py-2 bg-background/60 border-b border-gold/10">
                                  <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Level</span>
                                  <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Option</span>
                                </div>
                                <div className="divide-y divide-gold/5 max-h-[16rem] overflow-y-auto">
                                  {includedOptionItems.map((item: any) => (
                                    <div key={item.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-3 py-2 items-start">
                                      <span className="text-[10px] font-black tracking-widest text-ink/45 uppercase">Lvl {item.levelPrerequisite || 0}+</span>
                                      <div>
                                        <p className="text-xs font-bold text-ink">{item.name}</p>
                                        {(item.featureId || item.sourceId) && (
                                          <p className="mt-1 text-[9px] text-ink/40">
                                            {item.featureId ? `Linked feature: ${availableFeatures.find((feature: any) => feature.id === item.featureId)?.name || item.featureId}` : `Source: ${item.sourceId}`}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {includedOptionItems.length === 0 && (
                                    <p className="px-3 py-4 text-[10px] italic text-ink/35">All options in this group are currently excluded.</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[10px] italic text-ink/35">Choose a unique option group to preview the usable options.</p>
                          )
                        ) : selectedPoolFeatures.length > 0 ? (
                          <div className="border border-gold/10 rounded-md overflow-hidden">
                            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] px-3 py-2 bg-background/60 border-b border-gold/10">
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Feature</span>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60 text-right">Level</span>
                            </div>
                            <div className="divide-y divide-gold/5 max-h-[16rem] overflow-y-auto">
                              {selectedPoolFeatures.map((feature: any) => (
                                <div key={feature.id} className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3 px-3 py-2 items-start">
                                  <span className="text-xs font-bold text-ink">{feature.name}</span>
                                  <span className="text-right text-[10px] font-black tracking-widest text-ink/45 uppercase">Lvl {feature.level}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-[10px] italic text-ink/35">Select features or a unique option group to preview the choice pool.</p>
                        )}
                      </div>
                    </PreviewPanel>
                  </div>

                  {/* Right Column: Item Type, Pool, Preview */}
                  <div className="space-y-4">
                    <fieldset className="config-fieldset bg-background/20 h-full">
                      <legend className="section-label text-gold/60 px-1">Choice Pool Settings</legend>
                      <div className="grid sm:grid-cols-2 gap-4 mb-3">
                        <div className="space-y-1.5">
                          <label className="field-label">Item Type</label>
                          <Select
                            value={editingAdv.configuration?.choiceType || 'option-group'}
                            onValueChange={val => setEditingAdv({
                              ...editingAdv,
                              configuration: {
                                ...editingAdv.configuration,
                                choiceType: val,
                                pool: [],
                                optionGroupId: undefined,
                                excludedOptionIds: []
                              }
                            })}
                          >
                            <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                              <SelectValue>
                                {ITEM_TYPE_LABELS[editingAdv.configuration?.choiceType || 'option-group'] || editingAdv.configuration?.choiceType}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Anything</SelectItem>
                              <SelectItem value="feature">Feature</SelectItem>
                              <SelectItem value="option-group">Unique Option Group</SelectItem>
                              <SelectItem value="spell" disabled>Spell (Placeholder)</SelectItem>
                              <SelectItem value="item" disabled>Item (Placeholder)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {editingAdv.configuration?.choiceType === 'option-group' && (() => {
                          const classFiltered = classId
                            ? availableOptionGroups.filter(g => !g.classIds?.length || g.classIds.includes(classId))
                            : availableOptionGroups;
                          const q = optionGroupSearch.trim().toLowerCase();
                          const searchFiltered = q
                            ? availableOptionGroups.filter(g => (g.name || '').toLowerCase().includes(q))
                            : availableOptionGroups;
                          return (
                            <div className="space-y-1.5">
                              <label className="field-label">Option Group</label>
                              <Select
                                value={editingAdv.configuration?.optionGroupId || ''}
                                onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionGroupId: val, excludedOptionIds: [] }})}
                              >
                                <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                                  <SelectValue>
                                    {editingAdv.configuration?.optionGroupId
                                      ? (availableOptionGroups.find(g => g.id === editingAdv.configuration.optionGroupId)?.name || editingAdv.configuration.optionGroupId)
                                      : 'Select a group...'}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {classFiltered.map(g => (
                                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                                  ))}
                                  {classFiltered.length === 0 && <p className="px-2 py-2 text-[10px] italic text-ink/30">No groups assigned to this class.</p>}
                                </SelectContent>
                              </Select>
                              {/* Inline search-all panel */}
                              <div className="border border-gold/10 rounded-md overflow-hidden bg-background/20">
                                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gold/10">
                                  <Search className="w-3 h-3 text-ink/40 shrink-0" />
                                  <input
                                    type="text"
                                    placeholder="Search all option groups…"
                                    value={optionGroupSearch}
                                    onChange={e => { setOptionGroupSearch(e.target.value); setShowAllOptionGroups(true); }}
                                    onFocus={() => setShowAllOptionGroups(true)}
                                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/40 text-ink"
                                  />
                                  {optionGroupSearch && (
                                    <button type="button" onClick={() => { setOptionGroupSearch(''); setShowAllOptionGroups(false); }} className="text-ink/30 hover:text-ink/60 text-sm leading-none">×</button>
                                  )}
                                </div>
                                {showAllOptionGroups && (
                                  <div className="max-h-40 overflow-y-auto divide-y divide-gold/5">
                                    {searchFiltered.map(g => (
                                      <button
                                        key={g.id}
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-gold/10 flex items-center justify-between gap-2"
                                        onClick={() => {
                                          setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionGroupId: g.id, excludedOptionIds: [] }});
                                          setShowAllOptionGroups(false);
                                          setOptionGroupSearch('');
                                        }}
                                      >
                                        <span className="font-bold text-ink">{g.name}</span>
                                        {g.classIds?.length > 0 && <span className="text-[9px] text-gold/60 shrink-0">{g.classIds.length} class{g.classIds.length !== 1 ? 'es' : ''}</span>}
                                      </button>
                                    ))}
                                    {searchFiltered.length === 0 && <p className="px-3 py-3 text-[10px] italic text-ink/30">No groups match.</p>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="border border-gold/10 rounded-md overflow-hidden bg-background/20">
                        {editingAdv.configuration?.choiceType === 'option-group' ? (
                          <>
                            {selectedOptionGroup && selectedOptionItems.length > 0 && (
                              <div className="flex flex-wrap gap-2 px-3 py-2 bg-gold/5 border-b border-gold/10">
                                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] text-ink/60 border-gold/20 hover:bg-gold/10 hover:text-ink/80" onClick={() => {
                                  let excluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                  selectedOptionItems.forEach(item => excluded.delete(item.id));
                                  setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(excluded) }});
                                }}>Select All</Button>
                                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] text-ink/60 border-gold/20 hover:bg-gold/10 hover:text-ink/80" onClick={() => {
                                  let excluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                  selectedOptionItems.forEach(item => excluded.add(item.id));
                                  setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(excluded) }});
                                }}>Deselect All</Button>
                                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] text-ink/60 border-gold/20 hover:bg-gold/10 hover:text-ink/80" onClick={() => {
                                  let excluded = new Set(editingAdv.configuration?.excludedOptionIds || []);
                                  selectedOptionItems.forEach(item => {
                                    if ((item.levelPrerequisite || 0) > 0) excluded.add(item.id);
                                  });
                                  setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, excludedOptionIds: Array.from(excluded) }});
                                }}>Exclude Options with Level Prerequisites</Button>
                              </div>
                            )}
                            <div className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)] px-3 py-2 bg-gold/5 border-b border-gold/10">
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Use</span>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Level</span>
                              <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Option</span>
                            </div>
                            <div className="divide-y divide-gold/5 max-h-[16rem] overflow-y-auto">
                              {selectedOptionGroup ? selectedOptionItems.map((item: any) => {
                                const isIncluded = !excludedOptionIds.has(item.id);
                                return (
                                  <div key={item.id} className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)] gap-3 px-3 py-2 items-start hover:bg-gold/5">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all ${isIncluded ? 'bg-gold border-gold' : 'border-gold/30 hover:border-gold/60'}`}>
                                        {isIncluded && <Check className="w-2.5 h-2.5 text-white" />}
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={isIncluded}
                                        onChange={e => toggleExcludedOption(item.id, e.target.checked)}
                                      />
                                    </label>
                                    <span className="text-[10px] font-black tracking-widest text-ink/45 uppercase">Lvl {item.levelPrerequisite || 0}+</span>
                                    <div>
                                      <p className="text-xs font-bold text-ink">{item.name}</p>
                                      {(item.featureId || item.sourceId) && (
                                        <p className="mt-1 text-[9px] text-ink/40">
                                          {item.featureId ? `Linked feature: ${availableFeatures.find((feature: any) => feature.id === item.featureId)?.name || item.featureId}` : `Source: ${item.sourceId}`}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              }) : (
                                <p className="px-3 py-4 text-[10px] italic text-ink/35">Choose a unique option group to configure its choice pool.</p>
                              )}
                              {selectedOptionGroup && selectedOptionItems.length === 0 && (
                                <p className="px-3 py-4 text-[10px] italic text-ink/35">This group has no saved unique options yet.</p>
                              )}
                            </div>
                          </>
                        ) : (() => {
                            const q = featureSearch.trim().toLowerCase();
                            const displayed = q
                              ? allFeatures.filter(f => (f.name || '').toLowerCase().includes(q))
                              : availableFeatures;
                            return (
                              <>
                                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gold/10 bg-background/30">
                                  <Search className="w-3 h-3 text-ink/30 shrink-0" />
                                  <input
                                    type="text"
                                    placeholder={q ? `${displayed.length} result${displayed.length !== 1 ? 's' : ''}` : `${availableFeatures.length} local features — search all…`}
                                    value={featureSearch}
                                    onChange={e => setFeatureSearch(e.target.value)}
                                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/30 text-ink py-0.5"
                                  />
                                  {featureSearch && (
                                    <button type="button" onClick={() => setFeatureSearch('')} className="text-ink/30 hover:text-ink/60 text-sm leading-none">×</button>
                                  )}
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)] px-3 py-2 bg-gold/5 border-b border-gold/10">
                                  <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Feature</span>
                                </div>
                                <div className="divide-y divide-gold/5 max-h-[14rem] overflow-y-auto">
                                  {displayed.map(f => (
                                    <label key={f.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gold/5 group transition-colors">
                                      <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all ${
                                        (editingAdv.configuration?.pool || []).includes(f.id) ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/60'
                                      }`}>
                                        {(editingAdv.configuration?.pool || []).includes(f.id) && <Check className="w-2.5 h-2.5 text-white" />}
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={(editingAdv.configuration?.pool || []).includes(f.id)}
                                        onChange={e => {
                                          const pool = [...(editingAdv.configuration?.pool || [])];
                                          if (e.target.checked) pool.push(f.id);
                                          else {
                                            const i = pool.indexOf(f.id);
                                            if (i !== -1) pool.splice(i, 1);
                                          }
                                          setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, pool }});
                                        }}
                                      />
                                      <span className="text-xs font-bold text-ink">{f.name} <span className="text-ink/40 font-normal">(Lvl {f.level})</span></span>
                                    </label>
                                  ))}
                                  {displayed.length === 0 && (
                                    <p className="px-3 py-4 text-[10px] italic text-ink/30">
                                      {q ? `No features match "${featureSearch}".` : 'No features created yet.'}
                                    </p>
                                  )}
                                </div>
                              </>
                            );
                          })()
                        }
                      </div>
                    </fieldset>

                  </div>
                </div>
              )}

              {/* ── HitPoints ── */}
              {editingAdv.type === 'HitPoints' && (
                <div className="grid xl:grid-cols-[minmax(260px,320px)_minmax(320px,1fr)] gap-5 items-start">
                  <fieldset className="config-fieldset bg-background/20">
                    <legend className="section-label text-gold/60 px-1">Hit Point Details</legend>
                    <div className="space-y-1.5">
                      <label className="field-label">Hit Die</label>
                      <Select
                        value={String(editingAdv.configuration?.hitDie || resolvedDefaultHitDie)}
                        onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, hitDie: parseInt(val ?? String(resolvedDefaultHitDie)) }})}
                      >
                        <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                          <SelectValue>{`d${editingAdv.configuration?.hitDie || resolvedDefaultHitDie}`}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="6">d6</SelectItem>
                          <SelectItem value="8">d8</SelectItem>
                          <SelectItem value="10">d10</SelectItem>
                          <SelectItem value="12">d12</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 rounded-md border border-gold/10 bg-background/55 p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink/50">Hit Dice</span>
                        <span className="font-black text-ink">d{editingAdv.configuration?.hitDie || resolvedDefaultHitDie}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink/50">Hit Dice Gained / Level</span>
                        <span className="font-black text-ink">1</span>
                      </div>
                    </div>
                  </fieldset>

                  <div className="bg-background/20 border border-gold/10 p-4 rounded-md">
                    <div className="mb-3">
                      <h4 className="text-sm uppercase font-black tracking-widest text-gold/80">Hit Point Preview</h4>
                      <p className="text-[10px] text-ink/60 mt-1">Foundry treats this as a class-level hit die definition, so matching the class default will usually produce the cleanest export.</p>
                    </div>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      <div className="rounded-md border border-gold/10 bg-background/55 px-3 py-3">
                        <p className="text-[9px] uppercase font-black tracking-widest text-gold/60">Selected Die</p>
                        <p className="mt-2 text-lg font-serif font-black text-ink">d{editingAdv.configuration?.hitDie || resolvedDefaultHitDie}</p>
                      </div>
                      <div className="rounded-md border border-gold/10 bg-background/55 px-3 py-3">
                        <p className="text-[9px] uppercase font-black tracking-widest text-gold/60">Class Default</p>
                        <p className="mt-2 text-lg font-serif font-black text-ink">d{resolvedDefaultHitDie}</p>
                      </div>
                      <div className="rounded-md border border-gold/10 bg-background/55 px-3 py-3">
                        <p className="text-[9px] uppercase font-black tracking-widest text-gold/60">Average</p>
                        <p className="mt-2 text-lg font-serif font-black text-ink">{Math.floor((Number(editingAdv.configuration?.hitDie || resolvedDefaultHitDie) / 2)) + 1}</p>
                      </div>
                    </div>
                    <div className="mt-3 border border-gold/10 rounded-md overflow-hidden">
                      <div className="grid grid-cols-[minmax(0,1fr)_5rem] px-3 py-2 bg-background/60 border-b border-gold/10">
                        <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Average HP</span>
                        <span className="text-[9px] uppercase font-black tracking-widest text-gold/60 text-right">Total</span>
                      </div>
                      <div className="divide-y divide-gold/5">
                        {[5, 11, 17].map((level) => (
                          <div key={level} className="grid grid-cols-[minmax(0,1fr)_5rem] px-3 py-2 text-xs">
                            <span className="font-bold text-ink">Level {level}</span>
                            <span className="text-right text-ink/70">{averageHitPointsAtLevel(level)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="mt-3 text-[10px] text-ink/45">
                      {Number(editingAdv.configuration?.hitDie || resolvedDefaultHitDie) === resolvedDefaultHitDie
                        ? 'This matches the current class hit die.'
                        : 'This differs from the current class hit die and will read like a manual override.'}
                    </p>
                  </div>
                </div>
              )}

              {/* ── ScaleValue ── */}
              {editingAdv.type === 'ScaleValue' && (
                <div className="grid xl:grid-cols-[minmax(260px,320px)_minmax(320px,1fr)] gap-5 items-start">
                  <div className="space-y-1.5 max-w-xs">
                    <label className="field-label">Class Scaling Column</label>
                    <Select
                      value={editingAdv.configuration?.scalingColumnId || ''}
                      onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, scalingColumnId: val }})}
                    >
                      <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                        <SelectValue>
                          {selectedScalingColumn?.name || 'Select Column...'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableScalingColumns.map(col => (
                          <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="bg-background/20 border border-gold/10 p-4 rounded-md h-full">
                    <div className="mb-3">
                      <h4 className="text-sm uppercase font-black tracking-widest text-gold/80">Scale Preview</h4>
                      <p className="text-[10px] text-ink/60 mt-1">Selected scale values appear here so you can verify the progression before saving.</p>
                    </div>
                    {selectedScalingColumn ? (
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-bold text-ink">{selectedScalingColumn.name}</p>
                          {selectedScalingColumn.identifier && (
                            <p className="mt-1 text-[10px] text-ink/45">Identifier: {selectedScalingColumn.identifier}</p>
                          )}
                        </div>
                        <div className="border border-gold/10 rounded-md overflow-hidden">
                          <div className="grid grid-cols-2 bg-background/60 border-b border-gold/10 px-3 py-2">
                            <span className="text-[9px] uppercase font-black tracking-widest text-gold/60">Level</span>
                            <span className="text-[9px] uppercase font-black tracking-widest text-gold/60 text-right">Value</span>
                          </div>
                          <div className="divide-y divide-gold/5 overflow-y-auto max-h-[300px]">
                            {Object.entries(selectedScalingColumn.values || {})
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([level, value]) => (
                                <div key={level} className="grid grid-cols-2 px-3 py-2 text-xs">
                                  <span className="font-bold text-ink">Level {level}</span>
                                  <span className="text-right text-ink/70">{String(value)}</span>
                                </div>
                              ))}
                            {Object.keys(selectedScalingColumn.values || {}).length === 0 && (
                              <p className="px-3 py-4 text-[10px] italic text-ink/35">This scaling column does not have any saved values yet.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] italic text-ink/35">Choose a scaling column to preview its progression values.</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Size ── */}
              {editingAdv.type === 'Size' && (
                <div className="grid xl:grid-cols-[minmax(260px,320px)_minmax(320px,1fr)] gap-5 items-start">
                  <fieldset className="config-fieldset bg-background/20">
                    <legend className="section-label text-gold/60 px-1">Allowed Sizes</legend>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {Object.entries(SIZE_LABELS).map(([sizeId, label]) => {
                        const isSelected = selectedSizeIds.includes(sizeId);
                        return (
                          <label key={sizeId} className="flex items-center gap-2 px-3 py-2 rounded-md border border-gold/10 bg-background/55 cursor-pointer hover:bg-gold/5">
                            <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all ${isSelected ? 'bg-gold border-gold' : 'border-gold/30 hover:border-gold/60'}`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={isSelected}
                              onChange={e => toggleSelectedSize(sizeId, e.target.checked)}
                            />
                            <span className="text-xs font-bold text-ink">{label}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-ink/40">
                      Foundry supports size advancements as a set of valid size outcomes. We also keep the first selected size as the legacy primary value for older export paths.
                    </p>
                  </fieldset>

                  <div className="bg-background/20 border border-gold/10 p-4 rounded-md h-full">
                    <div className="mb-3">
                      <h4 className="text-sm uppercase font-black tracking-widest text-gold/80">Size Preview</h4>
                      <p className="text-[10px] text-ink/60 mt-1">These are the sizes that will be available when this advancement is resolved.</p>
                    </div>
                    {selectedSizeIds.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {selectedSizeIds.map((sizeId) => (
                            <span key={sizeId} className="px-2.5 py-1 rounded-md bg-gold/10 border border-gold/20 text-xs font-bold text-ink">
                              {SIZE_LABELS[sizeId] || sizeId}
                            </span>
                          ))}
                        </div>
                        <p className="text-[10px] text-ink/45">
                          Primary export size: <span className="font-bold text-ink">{SIZE_LABELS[selectedSizeIds[0]] || selectedSizeIds[0]}</span>
                        </p>
                      </div>
                    ) : (
                      <p className="text-[10px] italic text-ink/35">Select at least one size for this advancement.</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Trait ── */}
              {editingAdv.type === 'Trait' && (
                <div className="grid grid-cols-[2fr_3fr] gap-5">

                  {/* Left column: Details + Guaranteed + Choices panels */}
                  <div className="space-y-3">

                    {/* Details */}
                    <fieldset className="config-fieldset">
                      <legend className="section-label text-gold/60 px-1">Trait Details</legend>
                      <div className="space-y-1.5">
                        <label className="field-label">Mode</label>
                        {TRAIT_MODE_ENABLED_TYPES.has(traitType) ? (
                          <Select
                            value={editingAdv.configuration?.mode || 'default'}
                            onValueChange={setTraitMode}
                          >
                            <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                              <SelectValue>
                                {TRAIT_MODE_LABELS[editingAdv.configuration?.mode || 'default'] || editingAdv.configuration?.mode}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default</SelectItem>
                              <SelectItem value="expertise">Expertise</SelectItem>
                              <SelectItem value="forcedExpertise">Forced Expertise</SelectItem>
                              <SelectItem value="upgrade">Upgrade</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="h-9 rounded-md border border-gold/10 bg-background/50 px-3 flex items-center text-sm font-bold text-ink">
                            Default
                          </div>
                        )}
                        <p className="text-[9px] text-ink/40 italic">Gain a trait or proficiency.</p>
                      </div>
                      <label className="flex items-start gap-2.5 cursor-pointer group">
                        <div className={`w-4 h-4 mt-0.5 rounded border shrink-0 flex items-center justify-center transition-all ${
                          traitAllowsReplacements ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/60'
                        }`}>
                          {traitAllowsReplacements && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <input type="checkbox" className="hidden"
                          checked={traitAllowsReplacements}
                          onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, allowReplacements: e.target.checked }})}
                        />
                        <div>
                          <span className="text-[10px] uppercase font-bold text-ink/70 block">Allow Replacements</span>
                          <span className="text-[9px] text-ink/40">If a trait is already set on the actor, allow the player to choose from any other trait as a replacement.</span>
                        </div>
                      </label>
                    </fieldset>

                    {/* Guaranteed */}
                    <fieldset className="config-fieldset space-y-2 bg-background/25">
                      <legend className="section-label text-gold/60 px-1">Guaranteed</legend>
                      <p className="text-[9px] text-ink/40 italic">The following traits will be granted to the character as long as they don't already possess that trait.</p>
                      <div className="space-y-1 min-h-[1.5rem]">
                        {(editingAdv.configuration?.fixed || []).length === 0 ? (
                          <p className="text-[9px] text-ink/20 italic">None selected — check Guaranteed →</p>
                        ) : (
                          (editingAdv.configuration?.fixed || []).map((id: string, idx: number) => {
                            const found = (traitOptionsMap[editingAdv.configuration?.type] || []).find((t: any) => t.id === id);
                            return (
                              <div key={`${id}-${idx}`} className="flex items-center gap-2">
                                <span className="text-gold/70 text-xs">→</span>
                                <span className="text-[10px] text-ink/70">{found?.name || id}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </fieldset>

                    {/* Choices */}
                    <fieldset className="config-fieldset space-y-2 bg-background/25">
                      <legend className="section-label text-sky-500/60 px-1">Choices</legend>
                      <p className="text-[9px] text-ink/40 italic">The following traits will be presented as a choice to the player.</p>
                      <div className="space-y-1 min-h-[1.5rem] mb-2">
                        {(editingAdv.configuration?.options || []).length === 0 ? (
                          <p className="text-[9px] text-ink/20 italic">None selected — check Choice Pool →</p>
                        ) : (
                          (editingAdv.configuration?.options || []).map((id: string, idx: number) => {
                            const found = (traitOptionsMap[editingAdv.configuration?.type] || []).find((t: any) => t.id === id);
                            return (
                              <div key={`${id}-${idx}`} className="flex items-center gap-2">
                                <span className="text-sky-500/70 text-xs">⚙</span>
                                <span className="text-[10px] text-ink/70">{found?.name || id}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="pt-2 border-t border-gold/10 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="field-label">Number to Choose</label>
                          <button
                            onClick={() => {
                              const config = { ...editingAdv.configuration };
                              if (config.choiceSource === 'scaling') { config.choiceSource = 'fixed'; delete config.scalingColumnId; }
                              else { config.choiceSource = 'scaling'; config.choiceCount = 0; }
                              setEditingAdv({...editingAdv, configuration: config});
                            }}
                            className="text-[8px] uppercase font-bold text-gold hover:underline"
                          >
                            {traitChoiceUsesScaling ? 'Switch to Fixed' : 'Link Scaling'}
                          </button>
                        </div>
                        {traitChoiceUsesScaling ? (
                          <Select
                            value={editingAdv.configuration?.scalingColumnId || ''}
                            onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, scalingColumnId: val }})}
                          >
                            <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                              <SelectValue>
                                {availableScalingColumns.find(c => c.id === editingAdv.configuration?.scalingColumnId)?.name || 'Select Column...'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {availableScalingColumns.map(col => (
                                <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input type="number" min="0"
                            value={editingAdv.configuration?.choiceCount || 0}
                            onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, choiceCount: parseInt(e.target.value) }})}
                            className="w-full h-9 bg-background/50 border-gold/10"
                          />
                        )}
                      </div>
                    </fieldset>

                  </div>

                  {/* Right column: Trait Pool */}
                  <fieldset className="config-fieldset bg-background/25">
                    <legend className="section-label text-gold/60 px-1">Traits</legend>
                    <div className="space-y-1.5">
                      <label className="field-label">Trait Type</label>
                      <Select
                        value={editingAdv.configuration?.type || 'skills'}
                        onValueChange={val => setEditingAdv({
                          ...editingAdv,
                          configuration: {
                            ...editingAdv.configuration,
                            type: val,
                            options: [],
                            fixed: [],
                            mode: TRAIT_MODE_ENABLED_TYPES.has(val) ? (editingAdv.configuration?.mode || 'default') : 'default'
                          }
                        })}
                      >
                        <SelectTrigger className="w-full h-9 bg-background/50 border-gold/10">
                          <SelectValue>
                            {TRAIT_TYPE_LABELS[editingAdv.configuration?.type || 'skills'] || editingAdv.configuration?.type}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skills">Skills</SelectItem>
                          <SelectItem value="saves">Saving Throws</SelectItem>
                          <SelectItem value="armor">Armor</SelectItem>
                          <SelectItem value="weapons">Weapons</SelectItem>
                          <SelectItem value="tools">Tools</SelectItem>
                          <SelectItem value="languages">Languages</SelectItem>
                          <SelectItem value="di">Damage Immunities</SelectItem>
                          <SelectItem value="dr">Damage Resistances</SelectItem>
                          <SelectItem value="dv">Damage Vulnerabilities</SelectItem>
                          <SelectItem value="ci">Condition Immunities</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="border border-gold/10 rounded-md overflow-hidden">
                      <div className={`grid ${traitAllowsReplacements ? 'grid-cols-[1fr_5rem_5rem_5rem]' : 'grid-cols-[1fr_5rem_5rem]'} bg-gold/5 border-b border-gold/10 px-3 py-2`}>
                        <span className="text-[9px] uppercase font-black text-ink/40 tracking-widest leading-none flex items-center">Trait</span>
                        <span className="text-[9px] uppercase font-black text-gold/60 tracking-widest text-center leading-none flex items-center justify-center">Guaranteed</span>
                        <span className="text-[9px] uppercase font-black text-sky-500/60 tracking-widest text-center leading-none flex items-center justify-center">Choice Pool</span>
                        {traitAllowsReplacements && (
                          <span className="text-[9px] uppercase font-black text-purple-500/60 tracking-widest text-center leading-none flex items-center justify-center">Replace</span>
                        )}
                      </div>
                      <div className="divide-y divide-gold/5 max-h-96 overflow-y-auto">
                        {GROUPED_TRAIT_TYPES.has(traitType) ? (
                          (Object.entries(groupedTraitEntries) as [string, any[]][])
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([category, items]) => {
                            const itemIds = items.map((item: any) => item.id);
                            const allFixed = itemIds.length > 0 && itemIds.every((id: string) => (editingAdv.configuration?.fixed || []).includes(id));
                            const allOptions = itemIds.length > 0 && itemIds.every((id: string) => (editingAdv.configuration?.options || []).includes(id));
                            const allReplacements = itemIds.length > 0 && itemIds.every((id: string) => (editingAdv.configuration?.replacements || []).includes(id));
                            const collapseKey = `${traitType}:${category}`;
                            const isCollapsed = collapsedTraitCategories[collapseKey] ?? allFixed;

                            return (
                              <div key={category} className="divide-y divide-gold/5">
                              <div className={`grid ${traitAllowsReplacements ? 'grid-cols-[1fr_5rem_5rem_5rem]' : 'grid-cols-[1fr_5rem_5rem]'} px-3 py-2 bg-background/50 items-center`}>
                                  <button
                                    type="button"
                                    onClick={() => setCollapsedTraitCategories(prev => ({ ...prev, [collapseKey]: !isCollapsed }))}
                                    className="flex items-center gap-2 text-left min-w-0"
                                  >
                                    <span className={`text-[10px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                                    <span className="text-xs font-bold text-ink truncate">{category}</span>
                                    <span className="text-[9px] text-ink/35">({items.length})</span>
                                  </button>
                                  <div className="flex justify-center">
                                    <label className="cursor-pointer">
                                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                        allFixed ? 'bg-gold border-gold' : 'border-gold/30 hover:border-gold/50'
                                      }`}>
                                        {allFixed && <Check className="w-2.5 h-2.5 text-white" />}
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={allFixed}
                                        onChange={e => toggleTraitCategory(category, 'fixed', e.target.checked)}
                                      />
                                    </label>
                                  </div>
                                  <div className="flex justify-center">
                                    <label className="cursor-pointer">
                                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                        allOptions ? 'bg-sky-500 border-sky-500' : 'border-gold/30 hover:border-sky-400/50'
                                      }`}>
                                        {allOptions && <Check className="w-2.5 h-2.5 text-white" />}
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={allOptions}
                                        onChange={e => toggleTraitCategory(category, 'options', e.target.checked)}
                                      />
                                    </label>
                                  </div>
                                {traitAllowsReplacements && (
                                  <div className="flex justify-center">
                                      <label className="cursor-pointer">
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                          allReplacements ? 'bg-purple-500 border-purple-500' : 'border-gold/30 hover:border-purple-400/50'
                                        }`}>
                                          {allReplacements && <Check className="w-2.5 h-2.5 text-white" />}
                                        </div>
                                        <input
                                          type="checkbox"
                                          className="hidden"
                                          checked={allReplacements}
                                          onChange={e => toggleTraitCategory(category, 'replacements', e.target.checked)}
                                        />
                                      </label>
                                    </div>
                                  )}
                                </div>
                                {!isCollapsed && items.map((t: any) => {
                                  const isFixed = (editingAdv.configuration?.fixed || []).includes(t.id);
                                  const isOption = (editingAdv.configuration?.options || []).includes(t.id);
                                  const isReplacement = (editingAdv.configuration?.replacements || []).includes(t.id);
                                  return (
                                    <div key={t.id} className={`grid ${traitAllowsReplacements ? 'grid-cols-[1fr_5rem_5rem_5rem]' : 'grid-cols-[1fr_5rem_5rem]'} px-3 py-2 hover:bg-gold/5 transition-colors items-center group`}>
                                      <span className="text-xs text-ink/80 truncate pl-5">{t.name}</span>
                                      <div className="flex justify-center">
                                        <label className="cursor-pointer">
                                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                            isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'
                                          }`}>
                                            {isFixed && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          <input type="checkbox" className="hidden" checked={isFixed}
                                            onChange={e => toggleTraitFixed(t.id, e.target.checked)}
                                          />
                                        </label>
                                      </div>
                                      <div className="flex justify-center">
                                        <label className="cursor-pointer">
                                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                            isOption ? 'bg-sky-500 border-sky-500' : 'border-gold/30 group-hover:border-sky-400/50'
                                          }`}>
                                            {isOption && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          <input type="checkbox" className="hidden" checked={isOption}
                                            onChange={e => toggleTraitOption(t.id, e.target.checked)}
                                          />
                                        </label>
                                      </div>
                                    {traitAllowsReplacements && (
                                      <div className="flex justify-center">
                                          <label className="cursor-pointer">
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                              isReplacement ? 'bg-purple-500 border-purple-500' : 'border-gold/30 group-hover:border-purple-400/50'
                                            }`}>
                                              {isReplacement && <Check className="w-2.5 h-2.5 text-white" />}
                                            </div>
                                            <input type="checkbox" className="hidden" checked={isReplacement}
                                              onChange={e => toggleTraitReplacement(t.id, e.target.checked)}
                                            />
                                          </label>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })
                        ) : traitOptions.map((t: any) => {
                          const isFixed = (editingAdv.configuration?.fixed || []).includes(t.id);
                          const isOption = (editingAdv.configuration?.options || []).includes(t.id);
                          const isReplacement = (editingAdv.configuration?.replacements || []).includes(t.id);
                          return (
                            <div key={t.id} className={`grid ${traitAllowsReplacements ? 'grid-cols-[1fr_5rem_5rem_5rem]' : 'grid-cols-[1fr_5rem_5rem]'} px-3 py-2 hover:bg-gold/5 transition-colors items-center group`}>
                              <span className="text-xs text-ink/80 truncate">{t.name}</span>
                              <div className="flex justify-center">
                                <label className="cursor-pointer">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                    isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'
                                  }`}>
                                    {isFixed && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                  <input type="checkbox" className="hidden" checked={isFixed}
                                    onChange={e => toggleTraitFixed(t.id, e.target.checked)}
                                  />
                                </label>
                              </div>
                              <div className="flex justify-center">
                                <label className="cursor-pointer">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                    isOption ? 'bg-sky-500 border-sky-500' : 'border-gold/30 group-hover:border-sky-400/50'
                                  }`}>
                                    {isOption && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                  <input type="checkbox" className="hidden" checked={isOption}
                                    onChange={e => toggleTraitOption(t.id, e.target.checked)}
                                  />
                                </label>
                              </div>
                              {traitAllowsReplacements && (
                                <div className="flex justify-center">
                                  <label className="cursor-pointer">
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                      isReplacement ? 'bg-purple-500 border-purple-500' : 'border-gold/30 group-hover:border-purple-400/50'
                                    }`}>
                                      {isReplacement && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={isReplacement}
                                      onChange={e => toggleTraitReplacement(t.id, e.target.checked)}
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {traitOptions.length === 0 && (
                          <p className="text-[10px] italic text-ink/40 px-3 py-4">Loading options or none available...</p>
                        )}
                      </div>
                    </div>
                  </fieldset>

                </div>
              )}

              {/* ── AbilityScoreImprovement ── */}
              {editingAdv.type === 'AbilityScoreImprovement' && (
                <div className="grid xl:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
                  <div className="space-y-3">
                    <fieldset className="border border-gold/10 rounded-md px-4 pt-1 pb-3 space-y-3">
                      <legend className="section-label text-gold/60 px-1">Improvement Details</legend>
                      <div className="space-y-1.5">
                        <label className="field-label">Point Cap</label>
                        <Input type="number" min="0"
                          value={editingAdv.configuration?.cap ?? 2}
                          onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, cap: parseInt(e.target.value) || 0 }})}
                          className="w-full h-9 bg-background/50 border-gold/10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="field-label">Maximum</label>
                        <Input type="number" min="0"
                          value={editingAdv.configuration?.max ?? ''}
                          onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, max: e.target.value === '' ? '' : (parseInt(e.target.value) || 0) }})}
                          className="w-full h-9 bg-background/50 border-gold/10"
                        />
                      </div>
                    </fieldset>

                    <div className="rounded-md border border-gold/10 bg-background/55 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setAsiPoints((editingAdv.configuration?.points ?? 2) - 1)}
                          className="w-7 h-7 rounded border border-gold/20 bg-gold/5 text-gold/70 flex items-center justify-center hover:bg-gold/10"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <div className="text-center min-w-[3rem]">
                          <p className="text-[9px] uppercase font-black tracking-widest text-gold/60">Points</p>
                          <p className="mt-1 text-3xl font-serif font-black text-ink">{editingAdv.configuration?.points ?? 2}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAsiPoints((editingAdv.configuration?.points ?? 2) + 1)}
                          className="w-7 h-7 rounded border border-gold/20 bg-gold/5 text-gold/70 flex items-center justify-center hover:bg-gold/10"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="mt-2 text-[10px] text-ink/45">
                        Players can spend these points across any unlocked abilities.
                      </p>
                    </div>
                  </div>

                  <fieldset className="border border-gold/10 rounded-md px-4 pt-3 pb-4 space-y-3">
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {ABILITY_ORDER.map((stat) => (
                        <div key={stat} className="rounded-md border border-gold/10 bg-background/55 px-3 py-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-serif font-black text-ink">{ABILITY_LABELS[stat]}</span>
                            <button
                              type="button"
                              onClick={() => toggleAsiLock(stat)}
                              className={`w-7 h-7 rounded border flex items-center justify-center ${editingAdv.configuration?.locked?.[stat] ? 'bg-blood/10 border-blood/30 text-blood' : 'bg-gold/5 border-gold/20 text-gold/50 hover:bg-gold/10'}`}
                            >
                              <Lock className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => setAsiFixedValue(stat, (editingAdv.configuration?.fixed?.[stat] ?? 0) - 1)}
                              className="w-7 h-7 rounded border border-gold/20 bg-gold/5 text-gold/70 flex items-center justify-center hover:bg-gold/10"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <div className="w-12 h-10 rounded-md border border-gold/10 bg-card/70 flex items-center justify-center text-2xl font-serif font-black text-ink">
                              {editingAdv.configuration?.fixed?.[stat] ?? 0}
                            </div>
                            <button
                              type="button"
                              onClick={() => setAsiFixedValue(stat, (editingAdv.configuration?.fixed?.[stat] ?? 0) + 1)}
                              className="w-7 h-7 rounded border border-gold/20 bg-gold/5 text-gold/70 flex items-center justify-center hover:bg-gold/10"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-[9px] text-center text-ink/40">
                            {editingAdv.configuration?.locked?.[stat] ? 'Locked for players' : 'Available unless capped'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}

            </div>
          </div>

          <DialogFooter className="dialog-footer">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="label-text opacity-70">Cancel</Button>
            <Button onClick={handleSave} className="btn-gold-solid px-8 label-text">
              Save Advancement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
