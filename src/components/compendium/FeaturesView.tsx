import React, { useEffect } from 'react';
import { BookOpen, ChevronLeft } from 'lucide-react';
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
  hideAdvancements?: boolean;
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
  hideAdvancementTypes = false,
  hideAdvancements = false
}: FeaturesViewProps) {
  const [expandedAdvancements, setExpandedAdvancements] = React.useState<Record<string, boolean>>({});

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

            {!hideAdvancements && linkedAdvancements.length > 0 && (
              <div className="space-y-4 pt-6 mt-6 border-t border-gold/10 block not-prose">
                {linkedAdvancements.map((adv, idx) => {
                  const isExpanded = expandedAdvancements[adv._id || idx] || false;
                  const advTitle = adv.title || adv.configuration?.title || adv.type;
                  const isOptionGroup = adv.configuration?.choiceType === 'option-group' && adv.configuration?.optionGroupId;
                  const hasChoices = (adv.type === 'ItemGrant' || adv.type === 'ItemChoice') && 
                                     (adv.configuration?.pool?.length > 0 || isOptionGroup);

                  return (
                    <div key={idx} className="mt-4 space-y-4">
                      {hasChoices ? (
                        <>
                          <button 
                            onClick={() => setExpandedAdvancements(prev => ({ ...prev, [adv._id || idx]: !isExpanded }))}
                            className="flex items-center gap-3 group w-full text-left"
                          >
                            <div className="flex items-center gap-2 pr-3 shrink-0">
                              <BookOpen className="w-4 h-4 text-gold" />
                              <span className="text-xs font-bold uppercase tracking-widest text-gold">{advTitle}</span>
                            </div>
                            <div className="h-px bg-gold/10 flex-grow" />
                            <div className={`transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                              <ChevronLeft className="w-4 h-4 text-gold -rotate-90" />
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300 bg-gold/5 border border-gold/20 rounded p-4">
                              <div className="flex items-center justify-between mb-4">
                                <span className="text-[11px] font-bold text-ink uppercase tracking-tight">{advTitle}</span>
                                {!hideAdvancementTypes && <span className="text-[9px] font-medium text-gold/60 uppercase">{adv.type}</span>}
                              </div>
                              
                              {isOptionGroup && !hideChoices ? (() => {
                                const groupId = adv.configuration.optionGroupId;
                                const exclusions = adv.configuration?.excludedOptionIds || [];
                                const groupItems = optionItems.filter(item => 
                                  item.groupId === groupId && 
                                  (!item.classIds || item.classIds.length === 0 || item.classIds.includes(classId)) &&
                                  !exclusions.includes(item.id)
                                );
                                if (groupItems.length === 0) {
                                  return <p className="text-xs text-ink/40 italic">No options available for this group.</p>;
                                }
                                return (
                                  <ModularChoiceView 
                                    items={groupItems} 
                                    groupId={groupId} 
                                    selectedId={selectedOptions[groupId] || groupItems[0]?.id}
                                    onSelect={(itemId) => onSelectOption(groupId, itemId)}
                                    maxHeight="350px"
                                  />
                                );
                              })() : (
                                <div className="flex flex-wrap gap-2">
                                  {adv.configuration?.pool?.map((item: string, i: number) => (
                                    <span key={i} className="px-2 py-1 bg-background/50 border border-gold/10 rounded text-[11px] font-medium text-ink/80">
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="bg-gold/5 border border-gold/20 rounded p-3 flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-ink uppercase tracking-tight">{advTitle}</span>
                            {!hideAdvancementTypes && <span className="text-[9px] font-medium text-gold/60 uppercase">{adv.type}</span>}
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
