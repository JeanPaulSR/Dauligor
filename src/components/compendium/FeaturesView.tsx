import React, { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import BBCodeRenderer from '../BBCodeRenderer';
import ModularChoiceView, { ModularChoiceItem } from './ModularChoiceView';
import { cn } from '../../lib/utils';

export interface CompendiumFeature {
  id: string;
  name: string;
  description: string;
  level: number;
  uniqueOptionGroupIds?: string[];
  advancements?: any[];
  [key: string]: any;
}

interface FeaturesViewProps {
  items: CompendiumFeature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  optionGroups: any[];
  optionItems: any[];
  selectedOptions: Record<string, string>;
  onSelectOption: (groupId: string, itemId: string) => void;
  classId: string;
  uniqueOptionMappings?: any[];
  className?: string;
  maxHeight?: string;
  hideChoices?: boolean;
  rootAdvancements?: any[];
  hideAdvancementTypes?: boolean;
}

/**
 * A shared component for displaying class features in a split-view layout.
 * Integrates with ModularChoiceView for features that have unique options.
 */
export default function FeaturesView({ 
  items, 
  selectedId, 
  onSelect, 
  optionGroups, 
  optionItems, 
  selectedOptions, 
  onSelectOption,
  classId,
  uniqueOptionMappings = [],
  className,
  maxHeight = "500px",
  hideChoices = false,
  rootAdvancements = [],
  hideAdvancementTypes = false
}: FeaturesViewProps) {
  const selectedItem = items.find(i => i.id === selectedId) || items[0];
  const effectiveSelectedId = selectedItem?.id;

  // Find advancements linked to this feature
  const linkedAdvancements = React.useMemo(() => {
    if (!effectiveSelectedId) return [];
    
    // 1. Check advancements directly on the feature
    const localAdvs = selectedItem?.advancements || [];
    
    // 2. Check root advancements linked via featureId
    const rootLinked = rootAdvancements.filter(a => a.featureId === effectiveSelectedId);
    
    return [...localAdvs, ...rootLinked];
  }, [selectedItem, rootAdvancements, effectiveSelectedId]);

  // Handle auto-selection if none selected
  useEffect(() => {
    if (!selectedId && items.length > 0) {
      onSelect(items[0].id);
    }
  }, [selectedId, items, onSelect]);

  const featureChoiceGroups = React.useMemo(() => {
    // 1. Groups explicitly listed on the feature
    const explicitGroupIds = selectedItem?.uniqueOptionGroupIds || [];
    
    // 2. Groups mapped to this feature in the class configuration
    const mappedGroupIds = uniqueOptionMappings
      .filter(m => m.featureId === effectiveSelectedId)
      .map(m => m.groupId);
    
    // 3. Combined unique list
    const allRelevantGroupIds = Array.from(new Set([...explicitGroupIds, ...mappedGroupIds]));

    return allRelevantGroupIds.map(groupId => {
      const group = optionGroups.find(g => g.id === groupId);
      if (!group) return null;

      const groupItems = optionItems.filter(item => 
        item.groupId === group.id && 
        (!item.classIds || item.classIds.length === 0 || item.classIds.includes(classId))
      );
      
      if (groupItems.length === 0) return null;
      return { group, items: groupItems };
    }).filter(Boolean);
  }, [selectedItem, uniqueOptionMappings, optionGroups, optionItems, classId, effectiveSelectedId]);

  const hasChoices = featureChoiceGroups.length > 0;

  return (
    <div className={cn(
      "flex border border-gold/20 bg-background/20 rounded-sm overflow-hidden",
      className
    )} style={{ minHeight: maxHeight }}>
      {/* Sidebar: Feature Names */}
      <div className="w-[200px] border-r border-gold/20 bg-gold/5 flex flex-col shrink-0">
        <div className="flex-grow overflow-y-auto scrollbar-thin scrollbar-thumb-gold/20" style={{ maxHeight }}>
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                "w-full text-left p-3 text-xs transition-all border-b border-gold/5 hover:bg-gold/10",
                effectiveSelectedId === item.id 
                  ? 'bg-gold/20 border-r-4 border-r-gold text-gold font-bold shadow-inner' 
                  : 'text-ink/70'
              )}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">{item.name}</span>
                <span className="text-[10px] opacity-40 italic font-normal">Level {item.level}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 bg-background/10 overflow-y-auto" style={{ maxHeight }}>
        {selectedItem ? (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-baseline justify-between border-b border-gold/10 pb-4">
              <h4 className="text-lg font-bold text-gold uppercase tracking-tight">{selectedItem.name}</h4>
              <span className="text-[10px] font-bold text-gold/40 italic bg-gold/5 px-2 py-0.5 rounded border border-gold/10 uppercase">Level {selectedItem.level}</span>
            </div>
            
            <div className="prose prose-gold prose-sm max-w-none">
              <BBCodeRenderer content={selectedItem.description} />
            </div>

            {linkedAdvancements.length > 0 && (
              <div className="space-y-3 pt-6 border-t border-gold/10">
                <h5 className="text-[10px] font-black uppercase text-gold/60 tracking-widest mb-2">Advancements</h5>
                <div className="grid grid-cols-1 gap-2">
                  {linkedAdvancements.map((adv, idx) => (
                    <div key={idx} className="bg-gold/5 border border-gold/20 rounded p-3 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-ink uppercase tracking-tight">{adv.title || adv.configuration?.title || 'Advancement'}</span>
                        {!hideAdvancementTypes && <span className="text-[9px] font-medium text-gold/60 uppercase">{adv.type}</span>}
                      </div>
                      {adv.type === 'ItemGrant' && adv.configuration?.pool && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {adv.configuration.pool.map((item: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.5 bg-background/50 border border-gold/10 rounded text-[9px] text-ink/70">
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                      {adv.type === 'Trait' && (
                        <p className="text-[10px] text-ink/60 italic">Gains proficiency in {adv.configuration?.type || 'Trait'}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasChoices && !hideChoices && (
              <div className="animate-in fade-in slide-in-from-top-2 pt-6 border-t border-gold/10">
                {featureChoiceGroups.map(({ group, items }) => (
                  <div key={group.id}>
                    <ModularChoiceView 
                      items={items} 
                      groupId={group.id} 
                      selectedId={selectedOptions[group.id] || items[0]?.id}
                      onSelect={(itemId) => onSelectOption(group.id, itemId)}
                      maxHeight="350px"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-ink/20 italic text-sm">
            Select a feature to view details
          </div>
        )}
      </div>
    </div>
  );
}
