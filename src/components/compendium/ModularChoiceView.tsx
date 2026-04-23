import React, { useState, useEffect } from 'react';
import BBCodeRenderer from '../BBCodeRenderer';
import { cn } from '../../lib/utils';
import { db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

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
  const [loadingFeatures, setLoadingFeatures] = useState<Record<string, boolean>>({});

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

  return (
    <div className={cn(
      "flex border border-gold/20 bg-background/20 rounded-sm overflow-hidden",
      className
    )} style={{ minHeight: maxHeight }}>
      {/* Sidebar: Names List */}
      <div 
        className="border-r border-gold/20 bg-gold/5 flex flex-col shrink-0"
        style={{ width: sidebarWidth }}
      >
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
      <div className="flex-1 p-6 bg-background/10 overflow-y-auto" style={{ maxHeight }}>
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
                <BBCodeRenderer content={displayDescription} />
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
