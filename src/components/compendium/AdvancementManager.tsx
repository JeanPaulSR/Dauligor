import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Plus, Trash2, Edit2, Zap, Heart, Star, BookOpen, Settings, Shield, Sword, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { db } from '../../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export type AdvancementType = 
  | 'AbilityScoreImprovement'
  | 'HitPoints'
  | 'ItemChoice'
  | 'ItemGrant'
  | 'ScaleValue'
  | 'Size'
  | 'Trait';

export interface Advancement {
  _id: string;
  type: AdvancementType;
  level: number;
  title: string;
  icon?: string;
  featureId?: string;
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
  isInsideFeature?: boolean;
  featureId?: string;
  onLinkAdvancement?: (advId: string, featureId: string | undefined) => void;
  rootAdvancements?: Advancement[];
  defaultLevel?: number; // Added this
}

const ADVANCEMENT_INFO: Record<AdvancementType, { label: string, icon: any, color: string }> = {
  AbilityScoreImprovement: { label: 'Ability Score Improvement', icon: <UpArrow className="w-4 h-4" />, color: 'text-indigo-500' },
  HitPoints: { label: 'Hit Points', icon: <Heart className="w-4 h-4" />, color: 'text-rose-500' },
  ItemChoice: { label: 'Item Choice', icon: <Star className="w-4 h-4" />, color: 'text-gold' },
  ItemGrant: { label: 'Item Grant', icon: <Zap className="w-4 h-4" />, color: 'text-amber-500' },
  ScaleValue: { label: 'Scale Value', icon: <BookOpen className="w-4 h-4" />, color: 'text-sky-500' },
  Size: { label: 'Size', icon: <Settings className="w-4 h-4" />, color: 'text-slate-500' },
  Trait: { label: 'Trait (Proficiency)', icon: <Sword className="w-4 h-4" />, color: 'text-orange-500' },
};

function UpArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export default function AdvancementManager({ 
  advancements, 
  onChange, 
  availableFeatures = [],
  availableScalingColumns = [],
  availableOptionGroups = [],
  isInsideFeature = false,
  featureId,
  onLinkAdvancement,
  rootAdvancements = [],
  defaultLevel = 1 // Added this
}: AdvancementManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingAdv, setEditingAdv] = useState<Partial<Advancement>>({});
  const [traitOptionsMap, setTraitOptionsMap] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (editingAdv.type === 'Trait') {
        const type = editingAdv.configuration?.type;
        if (!type) return;
        if (traitOptionsMap[type]) return;

        let cols: string[] = [];
        if (type === 'skills') cols = ['skills'];
        else if (type === 'armor') cols = ['armor'];
        else if (type === 'weapons') cols = ['weapons'];
        else if (type === 'tools') cols = ['tools'];
        else if (type === 'languages') cols = ['languages'];
        else if (type === 'di' || type === 'dr' || type === 'dv') cols = ['damageTypes'];
        else if (type === 'ci') cols = ['conditions'];
        else if (type === 'attributes') cols = ['attributes'];

        if (cols.length > 0) {
            Promise.all(cols.map(c => getDocs(collection(db, c)))).then(snaps => {
                const items = snaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
                setTraitOptionsMap(prev => ({ ...prev, [type]: items }));
            }).catch(console.error);
        } else if (type === 'saves') {
            setTraitOptionsMap(prev => ({ ...prev, saves: [
                {id: 'str', name: 'Strength'}, {id: 'dex', name: 'Dexterity'}, {id: 'con', name: 'Constitution'},
                {id: 'int', name: 'Intelligence'}, {id: 'wis', name: 'Wisdom'}, {id: 'cha', name: 'Charisma'}
            ] }));
        }
    }
  }, [editingAdv.type, editingAdv.configuration?.type]);

  const handleAdd = () => {
    setEditingIndex(null);
    setEditingAdv({
      _id: Math.random().toString(36).substring(2, 11),
      type: 'ItemGrant',
      level: defaultLevel, // Use defaultLevel
      title: '',
      configuration: {}
    });
    setIsModalOpen(true);
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditingAdv({ ...advancements[index] });
    setIsModalOpen(true);
  };

  const handleDelete = (index: number) => {
    const next = [...advancements];
    next.splice(index, 1);
    onChange(next);
  };

  const handleSave = () => {
    const next = [...advancements];
    const adv = editingAdv as Advancement;
    
    if (editingIndex !== null) {
      next[editingIndex] = adv;
    } else {
      next.push(adv);
    }
    
    // Sort by level then type
    next.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return a.type.localeCompare(b.type);
    });
    
    onChange(next);
    setIsModalOpen(false);
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
      <div className="flex items-center justify-between border-b border-gold/10 pb-2">
        <h3 className="label-text text-gold">Advancements</h3>
        <Button size="sm" onClick={handleAdd} className="h-7 text-[10px] uppercase font-black tracking-widest gap-2 bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20">
          <Plus className="w-3.5 h-3.5" /> Add Row
        </Button>
      </div>

      <div className="grid gap-2">
        {advancements.map((adv, idx) => (
          <div key={adv._id} className="flex items-center gap-3 p-3 bg-card/40 border border-gold/10 rounded-lg group hover:border-gold/30 hover:bg-card/60 transition-all">
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
                  <span className="text-[8px] font-bold text-ink/20 uppercase tracking-widest">
                    {adv.type}
                  </span>
               </div>
               <div className="text-[10px] text-ink/40 font-serif italic truncate">
                  {/* Summary of config */}
                  {adv.type === 'ItemGrant' && `Grants items: ${adv.configuration.pool?.length || 0}`}
                  {adv.type === 'ItemChoice' && `Choose ${adv.configuration.count || 1} from ${adv.configuration.pool?.length || 0}`}
                  {adv.type === 'HitPoints' && `Hit Die: d${adv.configuration.hitDie || '?'}`}
                  {adv.type === 'Trait' && `Proficiency: ${adv.configuration.type}`}
               </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
               <Button variant="ghost" size="sm" onClick={() => handleEdit(idx)} className="h-7 w-7 p-0 text-gold hover:bg-gold/10"><Edit2 className="w-3.5 h-3.5" /></Button>
               <Button variant="ghost" size="sm" onClick={() => handleDelete(idx)} className="h-7 w-7 p-0 text-blood hover:bg-blood/10"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        ))}

        {advancements.length === 0 && (
          <div className="py-12 border border-dashed border-gold/20 rounded-xl flex flex-col items-center justify-center text-center bg-gold/5">
             <Zap className="w-8 h-8 text-gold/20 mb-3" />
             <p className="text-ink/40 font-serif italic text-sm">No advancements defined yet.</p>
             <p className="text-[9px] uppercase font-black text-gold/40 mt-1 tracking-widest">Own the progression path for this class</p>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl bg-card border-gold/20 p-0 overflow-hidden">
          <DialogHeader className="p-6 bg-ink text-gold border-b border-gold/10">
            <DialogTitle className="text-xl font-serif font-black uppercase tracking-tight">
              {editingIndex !== null ? 'Configure Advancement' : 'New Advancement'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                   <label className="text-[10px] uppercase font-black text-ink/60">Advancement Type</label>
                   <Select 
                    value={editingAdv.type} 
                    onValueChange={(val: AdvancementType) => {
                      const base: Partial<Advancement> = { ...editingAdv, type: val };
                      if (val === 'ItemGrant') base.configuration = { pool: [], optional: false };
                      if (val === 'ItemChoice') base.configuration = { pool: [], count: 1 };
                      if (val === 'HitPoints') base.configuration = { hitDie: 8 };
                      if (val === 'Trait') base.configuration = { type: 'skills', options: [], fixed: [] };
                      if (val === 'ScaleValue') base.configuration = { identifier: '', type: 'number' };
                      setEditingAdv(base);
                    }}
                  >
                     <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        {Object.entries(ADVANCEMENT_INFO).map(([key, info]) => (
                          <SelectItem key={key} value={key}>{info.label}</SelectItem>
                        ))}
                     </SelectContent>
                   </Select>
                </div>
                <div className="space-y-1.5">
                   <label className="text-[10px] uppercase font-black text-ink/60">Gained at Level</label>
                   <Input 
                    type="number" 
                    min="1" 
                    max="20" 
                    value={editingAdv.level || 1} 
                    onChange={e => setEditingAdv({...editingAdv, level: parseInt(e.target.value)})}
                    className="h-9 bg-background/50 border-gold/10"
                   />
                </div>
             </div>

             <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-black text-ink/60">Title (Custom Labels)</label>
                <Input 
                  value={editingAdv.title || ''} 
                  onChange={e => setEditingAdv({...editingAdv, title: e.target.value})}
                  placeholder="Leave blank to use default type label"
                  className="h-9 bg-background/50 border-gold/10 placeholder:text-ink/20"
                />
             </div>

             {!isInsideFeature && (
              <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-black text-ink/60">Attached to Feature (Inline Display)</label>
                  <Select 
                    value={editingAdv.featureId || 'none'} 
                    onValueChange={(val) => setEditingAdv({...editingAdv, featureId: val === 'none' ? undefined : val})}
                  >
                    <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                        <SelectValue placeholder="Standalone Advancement">
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
                  <p className="text-[9px] text-ink/40 italic">Associates this advancement with a specific feature's UI block.</p>
              </div>
             )}

             <div className="pt-4 border-t border-gold/10 space-y-4">
                <h4 className="text-[10px] uppercase font-black text-gold tracking-widest">Configuration</h4>
                
                {editingAdv.type === 'ItemGrant' && (
                  <div className="space-y-4">
                     <p className="text-[10px] text-ink/40">Grants specific items automatically when the level is reached.</p>
                     
                     <div className="flex items-center gap-2">
                        <input 
                           type="checkbox"
                           checked={editingAdv.configuration?.optional || false}
                           onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optional: e.target.checked }})}
                           className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                        />
                        <span className="text-[10px] uppercase font-bold text-ink/60">Optional (Players may opt out of any items below)</span>
                     </div>
                     <div className="space-y-1.5">
                         <label className="text-[10px] uppercase font-black text-ink/60">Item Type</label>
                         <Select 
                          value={editingAdv.configuration?.choiceType || 'feature'} 
                          onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, choiceType: val, pool: [], optionalPool: [] }})}
                        >
                            <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                               <SelectValue />
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

                     {editingAdv.configuration?.choiceType === 'feature' ? (
                       <div className="space-y-2">
                          <label className="text-[9px] uppercase font-bold text-ink/60">Items to Grant</label>
                          <div className="grid gap-1">
                             {availableFeatures.map(f => (
                               <div key={f.id} className="flex items-center justify-between p-2 bg-gold/5 border border-gold/10 rounded-md hover:bg-gold/10">
                                 <label className="flex items-center gap-2 cursor-pointer">
                                    <input 
                                      type="checkbox"
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
                                      className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                                    />
                                    <span className="text-xs font-bold text-ink">{f.name} (Lvl {f.level})</span>
                                 </label>
                                 <label className="flex items-center gap-1 cursor-pointer opacity-70 hover:opacity-100">
                                    <span className="text-[8px] uppercase tracking-widest text-ink/50">Optional</span>
                                    <input 
                                      type="checkbox"
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
                                      className="w-2.5 h-2.5 rounded border-gold/20 text-gold focus:ring-gold"
                                    />
                                 </label>
                               </div>
                             ))}
                             {availableFeatures.length === 0 && <p className="text-[10px] italic text-ink/30 px-2">No features created for this class yet.</p>}
                          </div>
                       </div>
                     ) : (
                       <div className="space-y-2">
                          <label className="text-[9px] uppercase font-bold text-ink/60">Target Option Group</label>
                          <Select 
                           value={editingAdv.configuration?.optionGroupId || ''} 
                           onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionGroupId: val }})}
                          >
                             <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                               <SelectValue placeholder="Select a group...">
                                   {editingAdv.configuration?.optionGroupId 
                                    ? (availableOptionGroups.find(g => g.id === editingAdv.configuration.optionGroupId)?.name || editingAdv.configuration.optionGroupId) 
                                    : 'Select a group...'}
                               </SelectValue>
                             </SelectTrigger>
                             <SelectContent>
                                {availableOptionGroups.map(g => (
                                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                                ))}
                             </SelectContent>
                          </Select>
                       </div>
                     )}
                  </div>
                )}

                {editingAdv.type === 'ItemChoice' && (
                   <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                               <label className="text-[10px] uppercase font-black text-ink/60">Number of Choices</label>
                               <button 
                                  onClick={() => {
                                     const config = { ...editingAdv.configuration };
                                     if (config.countSource === 'scaling') {
                                        config.countSource = 'fixed';
                                        delete config.scalingColumnId;
                                     } else {
                                        config.countSource = 'scaling';
                                        config.count = 1;
                                     }
                                     setEditingAdv({...editingAdv, configuration: config });
                                  }}
                                  className="text-[8px] uppercase font-bold text-gold hover:underline"
                               >
                                  {editingAdv.configuration?.countSource === 'scaling' ? 'Switch to Fixed' : 'Link Scaling'}
                               </button>
                            </div>
                            {editingAdv.configuration?.countSource === 'scaling' ? (
                               <Select 
                                  value={editingAdv.configuration?.scalingColumnId || ''} 
                                  onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, scalingColumnId: val }})}
                               >
                                  <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                                     <SelectValue placeholder="Select Column..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                     {availableScalingColumns.map(col => (
                                       <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                                     ))}
                                  </SelectContent>
                               </Select>
                            ) : (
                               <Input 
                                 type="number"
                                 min="1"
                                 value={editingAdv.configuration?.count || 1}
                                 onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, count: parseInt(e.target.value) }})}
                                 className="h-9 bg-background/50 border-gold/10"
                               />
                            )}
                         </div>
                          <div className="space-y-1.5">
                             <label className="text-[10px] uppercase font-black text-ink/60">Item Type</label>
                             <Select 
                              value={editingAdv.configuration?.choiceType || 'feature'} 
                              onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, choiceType: val, pool: [] }})}
                            >
                                <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                                   <SelectValue />
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
                      </div>

                      {editingAdv.configuration?.choiceType === 'feature' ? (
                        <div className="space-y-2">
                          <label className="text-[9px] uppercase font-bold text-ink/60">Choice Pool (Features)</label>
                          <div className="grid gap-1">
                              {availableFeatures.map(f => (
                                <label key={f.id} className="flex items-center gap-2 p-2 bg-gold/5 border border-gold/10 rounded-md cursor-pointer hover:bg-gold/10">
                                  <input 
                                    type="checkbox"
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
                                    className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                                  />
                                  <span className="text-xs font-bold text-ink">{f.name} (Lvl {f.level})</span>
                                </label>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                           <label className="text-[9px] uppercase font-bold text-ink/60">Target Option Group</label>
                           <Select 
                            value={editingAdv.configuration?.optionGroupId || ''} 
                            onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, optionGroupId: val }})}
                           >
                              <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                                 <SelectValue placeholder="Select a group...">
                                     {editingAdv.configuration?.optionGroupId 
                                      ? (availableOptionGroups.find(g => g.id === editingAdv.configuration.optionGroupId)?.name || editingAdv.configuration.optionGroupId) 
                                      : 'Select a group...'}
                                 </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                 {availableOptionGroups.map(g => (
                                   <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                        </div>
                      )}
                   </div>
                )}

                {editingAdv.type === 'HitPoints' && (
                  <div className="space-y-4">
                     <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black text-ink/60">Hit Die for dnd5e calculation</label>
                        <Select 
                          value={String(editingAdv.configuration?.hitDie || 8)} 
                          onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, hitDie: parseInt(val) }})}
                        >
                           <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="6">d6</SelectItem>
                              <SelectItem value="8">d8</SelectItem>
                              <SelectItem value="10">d10</SelectItem>
                              <SelectItem value="12">d12</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
                )}

                {editingAdv.type === 'ScaleValue' && (
                  <div className="space-y-4">
                     <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black text-ink/60">Class Scaling Column</label>
                        <Select 
                          value={editingAdv.configuration?.scalingColumnId || ''} 
                          onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, scalingColumnId: val }})}
                        >
                           <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                              <SelectValue placeholder="Select Column..." />
                           </SelectTrigger>
                           <SelectContent>
                              {availableScalingColumns.map(col => (
                                <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
                )}

                {editingAdv.type === 'Size' && (
                  <div className="space-y-4">
                     <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black text-ink/60">Set Creature Size</label>
                        <Select 
                          value={editingAdv.configuration?.size || 'med'} 
                          onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, size: val }})}
                        >
                           <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                              <SelectValue placeholder="Select Size..." />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="tiny">Tiny</SelectItem>
                              <SelectItem value="sm">Small</SelectItem>
                              <SelectItem value="med">Medium</SelectItem>
                              <SelectItem value="lg">Large</SelectItem>
                              <SelectItem value="huge">Huge</SelectItem>
                              <SelectItem value="grg">Gargantuan</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
                )}

                {editingAdv.type === 'Trait' && (
                  <div className="space-y-4">
                     <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black text-ink/60">Trait Type</label>
                        <Select 
                          value={editingAdv.configuration?.type || 'skills'} 
                          onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, type: val, options: [], fixed: [] }})}
                        >
                           <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="skills">Skills</SelectItem>
                              <SelectItem value="saves">Saving Throws</SelectItem>
                               <SelectItem value="attributes">Attributes</SelectItem>
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
                     
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                             <label className="text-[10px] uppercase font-black text-ink/60">Mode</label>
                             <Select 
                               value={editingAdv.configuration?.mode || 'default'} 
                               onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, mode: val }})}
                             >
                                <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                                   <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                   <SelectItem value="default">Default</SelectItem>
                                   <SelectItem value="expertise">Expertise</SelectItem>
                                   <SelectItem value="forcedExpertise">Forced Expertise</SelectItem>
                                   <SelectItem value="upgrade">Upgrade</SelectItem>
                                </SelectContent>
                             </Select>
                        </div>
                        <div className="space-y-1.5 flex flex-col justify-end">
                            <label className="flex items-center gap-2 cursor-pointer pb-2">
                                <input 
                                  type="checkbox"
                                  checked={editingAdv.configuration?.allowReplacement || false}
                                  onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, allowReplacement: e.target.checked }})}
                                  className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                                />
                                <span className="text-[10px] uppercase font-black text-ink/60 leading-none">Allow Replacements</span>
                            </label>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-2">
                             <label className="text-[10px] uppercase font-black text-ink/60">Guaranteed</label>
                             <div className="grid gap-1 max-h-60 overflow-y-auto pr-2">
                                 {(traitOptionsMap[editingAdv.configuration?.type || 'skills'] || []).map(t => (
                                     <label key={t.id} className="flex items-center gap-2 p-1.5 bg-background border border-gold/10 rounded cursor-pointer hover:bg-gold/5">
                                         <input 
                                             type="checkbox"
                                             checked={(editingAdv.configuration?.fixed || []).includes(t.id)}
                                             onChange={e => {
                                                 const fixed = [...(editingAdv.configuration?.fixed || [])];
                                                 if (e.target.checked) fixed.push(t.id);
                                                 else {
                                                     const i = fixed.indexOf(t.id);
                                                     if (i !== -1) fixed.splice(i, 1);
                                                 }
                                                 setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, fixed }});
                                             }}
                                             className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                                         />
                                         <span className="text-xs text-ink truncate">{t.name}</span>
                                     </label>
                                 ))}
                                 {(!traitOptionsMap[editingAdv.configuration?.type || 'skills'] || traitOptionsMap[editingAdv.configuration?.type || 'skills'].length === 0) && (
                                     <p className="text-[10px] italic text-ink/40">Loading or none available...</p>
                                 )}
                             </div>
                         </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                               <label className="text-[10px] uppercase font-black text-ink/60">Number of Choices</label>
                               <button 
                                  onClick={() => {
                                     const config = { ...editingAdv.configuration };
                                     if (config.choiceSource === 'scaling') {
                                        config.choiceSource = 'fixed';
                                        delete config.scalingColumnId;
                                     } else {
                                        config.choiceSource = 'scaling';
                                        config.choiceCount = 0;
                                     }
                                     setEditingAdv({...editingAdv, configuration: config });
                                  }}
                                  className="text-[8px] uppercase font-bold text-gold hover:underline"
                               >
                                  {editingAdv.configuration?.choiceSource === 'scaling' ? 'Switch to Fixed' : 'Link Scaling'}
                               </button>
                            </div>
                            {editingAdv.configuration?.choiceSource === 'scaling' ? (
                               <Select 
                                  value={editingAdv.configuration?.scalingColumnId || ''} 
                                  onValueChange={val => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, scalingColumnId: val }})}
                               >
                                  <SelectTrigger className="h-9 bg-background/50 border-gold/10">
                                     <SelectValue placeholder="Select Column..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                     {availableScalingColumns.map(col => (
                                       <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                                     ))}
                                  </SelectContent>
                               </Select>
                            ) : (
                               <Input 
                                type="number"
                                min="0"
                                value={editingAdv.configuration?.choiceCount || 0}
                                onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, choiceCount: parseInt(e.target.value) }})}
                                className="h-9 bg-background/50 border-gold/10"
                               />
                            )}

                            <label className="text-[10px] uppercase font-bold text-ink/40 mt-2 block">Available Options</label>
                            <div className="grid gap-1 max-h-[11rem] overflow-y-auto pr-2">
                                {(traitOptionsMap[editingAdv.configuration?.type || 'skills'] || []).map(t => (
                                    <label key={t.id} className="flex items-center gap-2 p-1.5 bg-background border border-gold/10 rounded cursor-pointer hover:bg-gold/5">
                                        <input 
                                            type="checkbox"
                                            checked={(editingAdv.configuration?.options || []).includes(t.id)}
                                            onChange={e => {
                                                const options = [...(editingAdv.configuration?.options || [])];
                                                if (e.target.checked) options.push(t.id);
                                                else {
                                                    const i = options.indexOf(t.id);
                                                    if (i !== -1) options.splice(i, 1);
                                                }
                                                setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, options }});
                                            }}
                                            className="w-3.5 h-3.5 rounded border-gold/20 text-gold focus:ring-gold"
                                        />
                                        <span className="text-xs text-ink truncate">{t.name}</span>
                                    </label>
                                ))}
                                {(!traitOptionsMap[editingAdv.configuration?.type || 'skills'] || traitOptionsMap[editingAdv.configuration?.type || 'skills'].length === 0) && (
                                    <p className="text-[10px] italic text-ink/40">Loading or none available...</p>
                                )}
                            </div>
                        </div>
                     </div>
                  </div>
                )}
                
                {editingAdv.type === 'AbilityScoreImprovement' && (
                  <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                           <label className="text-[10px] uppercase font-black text-ink/60">Points to Distribute</label>
                           <Input 
                             type="number"
                             min="0"
                             value={editingAdv.configuration?.points ?? 2}
                             onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, points: parseInt(e.target.value) || 0 }})}
                             className="h-9 bg-background/50 border-gold/10"
                           />
                        </div>
                        <div className="space-y-1.5">
                           <label className="text-[10px] uppercase font-black text-ink/60">Point Cap</label>
                           <Input 
                             type="number"
                             min="0"
                             value={editingAdv.configuration?.cap ?? 2}
                             onChange={e => setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, cap: parseInt(e.target.value) || 0 }})}
                             className="h-9 bg-background/50 border-gold/10"
                           />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] uppercase font-black text-ink/60">Fixed Improvements / Locks</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {['str', 'dex', 'con', 'int', 'wis', 'cha'].map(stat => (
                               <div key={stat} className="p-2 border border-gold/10 bg-background/50 rounded flex flex-col items-center gap-2">
                                  <span className="text-[10px] uppercase font-bold text-ink/60">{stat}</span>
                                  <div className="flex gap-1 items-center">
                                      <Input 
                                        type="number" 
                                        className="h-7 w-12 text-center text-xs" 
                                        value={editingAdv.configuration?.fixed?.[stat] ?? 0}
                                        onChange={e => {
                                            const fixed = { ...(editingAdv.configuration?.fixed || {}) };
                                            fixed[stat] = parseInt(e.target.value) || 0;
                                            setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, fixed }});
                                        }}
                                      />
                                      <button 
                                        onClick={() => {
                                            const locked = { ...(editingAdv.configuration?.locked || {}) };
                                            locked[stat] = !locked[stat];
                                            setEditingAdv({...editingAdv, configuration: { ...editingAdv.configuration, locked }});
                                        }}
                                        className={`w-7 h-7 flex items-center justify-center border rounded ${editingAdv.configuration?.locked?.[stat] ? 'bg-blood/10 border-blood/30 text-blood' : 'bg-gold/5 border-gold/20 text-gold/50'}`}
                                      >
                                         <Lock className="w-3 h-3" />
                                      </button>
                                  </div>
                               </div>
                            ))}
                        </div>
                     </div>
                  </div>
                )}
             </div>
          </div>
          
          <DialogFooter className="p-4 bg-background border-t border-gold/10">
             <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="label-text opacity-70">Cancel</Button>
             <Button onClick={handleSave} className="bg-gold text-white hover:bg-gold/90 font-black uppercase tracking-widest px-8 label-text">
               Save Advancement
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
