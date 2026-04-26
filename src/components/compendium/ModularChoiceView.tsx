import React, { useState, useEffect } from 'react';
import BBCodeRenderer from '../BBCodeRenderer';
import { cn } from '../../lib/utils';
import { db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { BookOpen, ChevronLeft } from 'lucide-react';

export interface ModularChoiceItem {
  id: string;
  name: string;
  description: string;
  levelPrerequisite?: number;
  stringPrerequisite?: string;
  [key: string]: any;
}

interface ModularChoiceViewProps {
  items: ModularChoiceItem[];
  groupId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
  maxHeight?: string;
  sidebarWidth?: string;
}

/**
 * A shared component for displaying a list of choices (e.g., Fighting Styles, Metamagic) 
 * with a sidebar for selection and a main area for the description.
 */
export default function ModularChoiceView({ 
  items, 
  groupId, 
  selectedId, 
  onSelect,
  className,
  maxHeight = "400px",
  sidebarWidth = "180px"
}: ModularChoiceViewProps) {
  const [featureDescriptions, setFeatureDescriptions] = useState<Record<string, string>>({});
  const [featureAdvancements, setFeatureAdvancements] = useState<Record<string, any[]>>({});
  const [loadingFeatures, setLoadingFeatures] = useState<Record<string, boolean>>({});

  const [expandedAdvancements, setExpandedAdvancements] = useState<Record<string, boolean>>({});

  const selectedItem = items.find(i => i.id === selectedId) || items[0];
  const effectiveSelectedId = selectedItem?.id;
  
  useEffect(() => {
    if (selectedItem?.featureId && !featureDescriptions[selectedItem.featureId]) {
      setLoadingFeatures(prev => ({ ...prev, [selectedItem.featureId]: true }));
      getDoc(doc(db, 'features', selectedItem.featureId))
        .then(docSnap => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFeatureDescriptions(prev => ({ ...prev, [selectedItem.featureId]: data.description || '' }));
            if (data.advancements) {
              setFeatureAdvancements(prev => ({ ...prev, [selectedItem.featureId]: data.advancements }));
            }
          }
        })
        .finally(() => {
          setLoadingFeatures(prev => ({ ...prev, [selectedItem.featureId]: false }));
        });
    }
  }, [selectedItem?.featureId]);

  const displayDescription = (selectedItem?.featureId && featureDescriptions[selectedItem.featureId]) 
    ? featureDescriptions[selectedItem.featureId] 
    : selectedItem?.description || '';
  
  // Clean group names (redundancy check if passed in name) - though usually name is handled outside
  const cleanName = (name: string) => name.replace(/\s*(Choice|Modular Choice Group)$/i, '');

  const sortedItems = [...items].sort((a, b) => {
    const levelA = a.levelPrerequisite || 0;
    const levelB = b.levelPrerequisite || 0;
    if (levelA !== levelB) {
      return levelA - levelB;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={cn("browser-panel", className)} style={{ minHeight: maxHeight }}>
      {/* Sidebar: Names List */}
      <div
        className="browser-sidebar"
        style={{ width: sidebarWidth }}
      >
        <div className="flex-grow overflow-y-auto custom-scrollbar" style={{ maxHeight }}>
          {sortedItems.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                "browser-row",
                effectiveSelectedId === item.id
                  ? 'bg-gold/20 border-r-4 border-r-gold text-gold font-bold shadow-inner'
                  : 'text-ink/70'
              )}
            >
              <div className="flex flex-col gap-0.5">
                <span>{item.name}</span>
                {item.levelPrerequisite !== undefined && item.levelPrerequisite > 0 && (
                  <span className="text-[9px] opacity-40 italic font-normal">Level {item.levelPrerequisite}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Content: Selected Item Details */}
      <div className="browser-content custom-scrollbar" style={{ maxHeight }}>
        {selectedItem ? (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex items-baseline justify-between border-b border-gold/10 pb-2">
              <h4 className="text-sm font-bold text-gold uppercase tracking-tight">
                {selectedItem.name}
              </h4>
              <div className="flex gap-2 text-[9px] font-bold text-gold/40 italic uppercase">
                {selectedItem.levelPrerequisite !== undefined && selectedItem.levelPrerequisite > 0 && (
                  <span className="bg-gold/5 px-1.5 py-0.5 rounded border border-gold/10">Level {selectedItem.levelPrerequisite}+</span>
                )}
                {selectedItem.stringPrerequisite && (
                  <span className="bg-gold/5 px-1.5 py-0.5 rounded border border-gold/10">{selectedItem.stringPrerequisite}</span>
                )}
              </div>
            </div>
            <div className="prose prose-gold prose-sm max-w-none">
              {loadingFeatures[selectedItem?.featureId] ? (
                <div className="animate-pulse flex space-y-4 flex-col">
                  <div className="h-4 bg-gold/10 rounded w-3/4"></div>
                  <div className="h-4 bg-gold/10 rounded"></div>
                  <div className="h-4 bg-gold/10 rounded w-5/6"></div>
                </div>
              ) : (
                <>
                  <BBCodeRenderer content={displayDescription} />
                  
                  {/* Show advancements linked to this unique option */}
                  {(() => {
                    // Try pulling from selectedItem.advancements (from class data)
                    // Or from fetched feature if it was a standalone feature (we might need to store them if we fetch them... but selectedItem might already have them if it's an option items)
                    const localAdvs = selectedItem?.advancements || [];
                    const remoteAdvs = (selectedItem?.featureId ? featureAdvancements[selectedItem.featureId] : []) || [];
                    const advs = [...localAdvs, ...remoteAdvs];
                    
                    if (advs.length === 0) return null;
                    
                    return (
                      <div className="space-y-4 pt-6 mt-6 border-t border-gold/10 block not-prose">
                        {advs.map((adv: any, idx: number) => {
                          const isExpanded = expandedAdvancements[adv._id || idx] || false;
                          const advTitle = adv.title || adv.configuration?.title || adv.type;
                          const hasChoices = (adv.type === 'ItemGrant' || adv.type === 'ItemChoice') && 
                            (adv.configuration?.pool?.length > 0 || adv.configuration?.choiceType === 'option-group');

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
                                        <span className="text-[9px] font-medium text-gold/60 uppercase">{adv.type}</span>
                                      </div>
                                      
                                      <div className="flex flex-wrap gap-2">
                                        {adv.configuration?.choiceType === 'option-group' ? (
                                          <span className="px-2 py-1 bg-background/50 border border-gold/10 border-dashed rounded text-[11px] font-medium text-ink/60">
                                            Grants from Option Group
                                          </span>
                                        ) : (
                                          (adv.configuration?.pool || []).map((item: string, i: number) => (
                                            <span key={i} className="px-2 py-1 bg-background/50 border border-gold/10 rounded text-[11px] font-medium text-ink/80">
                                              {item}
                                            </span>
                                          ))
                                        )}
                                      </div>
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
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-ink/20 italic text-sm">
            Select an option to view details
          </div>
        )}
      </div>
    </div>
  );
}
