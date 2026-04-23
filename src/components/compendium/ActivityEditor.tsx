import React, { useState } from 'react';
import { 
  Swords, Wand2, Dices, Zap, Sparkles, ArrowRight, 
  Heart, Shield, Boxes, RefreshCw, Wrench, Plus,
  Trash2, Edit2, Info, Timer, Target,
  ChevronRight, X, FileJson, Eye, MousePointer2
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ActivityKind, SemanticActivity } from '../../types/activities';

interface ActivityEditorProps {
  activities: SemanticActivity[] | Record<string, SemanticActivity>;
  onChange: (activities: SemanticActivity[]) => void;
}

const ACTIVITY_KINDS: { kind: ActivityKind; label: string; icon: any }[] = [
  { kind: 'attack', label: 'Attack', icon: Swords },
  { kind: 'cast', label: 'Cast Spell', icon: Wand2 },
  { kind: 'check', label: 'Ability Check', icon: Dices },
  { kind: 'damage', label: 'Damage', icon: Zap },
  { kind: 'enchant', label: 'Enchant', icon: Sparkles },
  { kind: 'forward', label: 'Forward', icon: ArrowRight },
  { kind: 'heal', label: 'Heal', icon: Heart },
  { kind: 'save', label: 'Save', icon: Shield },
  { kind: 'summon', label: 'Summon', icon: Boxes },
  { kind: 'transform', label: 'Transform', icon: RefreshCw },
  { kind: 'utility', label: 'Utility', icon: Wrench },
];

export default function ActivityEditor({ activities, onChange }: ActivityEditorProps) {
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('identity');
  const [activeActivationTab, setActiveActivationTab] = useState('time');

  const activityList = Array.isArray(activities) 
    ? activities 
    : Object.values(activities);

  const handleAddActivity = (kind: ActivityKind) => {
    const id = Math.random().toString(36).substring(2, 11);
    const newActivity: SemanticActivity = {
      id,
      kind,
      name: kind.charAt(0).toUpperCase() + kind.slice(1),
      img: `systems/dnd5e/icons/svg/activity/${kind}.svg`,
      activation: { type: 'action', value: 1 },
      duration: { units: 'inst', concentration: false },
      range: { units: 'self' },
      target: {
        template: { count: '', type: '' },
        affects: { count: '', type: '' },
        prompt: false
      },
      visibility: { identifier: '' },
      consumption: { scaling: { allowed: false, max: '' }, targets: [] }
    };

    if (kind === 'attack') {
      newActivity.attack = { type: 'melee', classification: 'weapon' };
      newActivity.damage = { parts: [{}] };
    } else if (kind === 'check') {
      newActivity.check = { ability: 'str', dc: { calculation: 'spellcasting' } };
    } else if (kind === 'save') {
      newActivity.save = { abilities: ['dex'], dc: { calculation: 'spellcasting' } };
      newActivity.damage = { parts: [{}], onSave: 'half' };
    } else if (kind === 'heal') {
      newActivity.healing = { parts: [{ types: ['healing'] }] };
    } else if (kind === 'damage') {
      newActivity.damage = { parts: [{}] };
    } else if (kind === 'cast') {
      newActivity.spell = { uuid: '', spellbook: true };
    } else if (kind === 'enchant') {
      newActivity.enchant = { self: false };
    } else if (kind === 'forward') {
      newActivity.activity = { id: '' };
    } else if (kind === 'summon') {
      newActivity.summon = { profiles: [] };
    } else if (kind === 'utility') {
      newActivity.roll = { formula: '' };
    }

    onChange([...activityList, newActivity]);
    setIsSelectorOpen(false);
    setEditingId(id);
  };

  const handleRemoveActivity = (id: string) => {
    onChange(activityList.filter(a => a.id !== id));
  };

  const handleUpdateActivity = (id: string, data: Partial<SemanticActivity>) => {
    const updated = activityList.map(a => 
      a.id === id ? { ...a, ...data } : a
    );
    onChange(updated);
  };

  const editingActivity = editingId ? activityList.find(a => a.id === editingId) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gold/10 pb-2">
        <h4 className="text-[11px] uppercase text-gold font-bold tracking-widest">Activities</h4>
        <Button 
          type="button" 
          variant="outline" 
          size="sm" 
          onClick={() => setIsSelectorOpen(true)}
          className="h-7 px-2 border-gold/20 text-gold hover:bg-gold/10 gap-1.5 bg-gold/5"
        >
          <Plus className="w-3 h-3" /> Add Activity
        </Button>
      </div>

      <div className="space-y-1">
        {activityList.map((activity) => {
          const kindInfo = ACTIVITY_KINDS.find(k => k.kind === activity.kind);
          const Icon = kindInfo?.icon || Info;

          return (
            <div 
              key={activity.id}
              className="group flex items-center justify-between p-2 border border-gold/5 bg-background/20 rounded hover:border-gold/30 hover:bg-gold/5 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-gold/10 bg-gold/5 flex items-center justify-center text-gold">
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-ink leading-none">{activity.name}</div>
                  <div className="text-[10px] text-ink/40 uppercase tracking-tight mt-1">
                    {activity.activation?.type || activity.kind}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  type="button"
                  size="icon" 
                  variant="ghost" 
                  onClick={() => setEditingId(activity.id)}
                  className="h-7 w-7 text-ink/40 hover:text-gold"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </Button>
                <Button 
                  type="button"
                  size="icon" 
                  variant="ghost" 
                  onClick={() => handleRemoveActivity(activity.id)}
                  className="h-7 w-7 text-ink/40 hover:text-blood"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}

        {activityList.length === 0 && (
          <div className="py-12 border border-dashed border-gold/10 rounded flex flex-col items-center justify-center text-center bg-background/5">
            <Zap className="w-8 h-8 text-gold/10 mb-2" />
            <div className="text-ink/20 italic text-xs">No activities defined yet.</div>
          </div>
        )}
      </div>

      <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
        <DialogContent className="max-w-md bg-card border-gold/20 p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="h2-title text-center text-gold">Create Activity</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITY_KINDS.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                onClick={() => handleAddActivity(kind)}
                className="flex flex-col items-center gap-2 p-4 rounded border border-gold/10 bg-background/20 hover:border-gold/40 hover:bg-gold/10 transition-all text-center group"
              >
                <div className="p-3 bg-background rounded border border-gold/10 text-gold group-hover:scale-110 transition-transform">
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-ink/60 group-hover:text-gold">{label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingId} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="max-w-[95vw] lg:max-w-4xl bg-card border-gold/20 p-0 overflow-hidden flex flex-col h-[90vh]">
          {editingActivity && (
            <>
              <DialogHeader className="p-6 pb-2 shrink-0 border-b border-gold/10">
                <div className="flex flex-col space-y-4">
                  <DialogTitle className="h1-title text-center text-ink">
                    {editingActivity.name}
                  </DialogTitle>
                  <div className="flex justify-center text-gold/40">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="bg-transparent border-none">
                      <TabsList className="bg-transparent border-none h-auto p-0 gap-8">
                        <TabsTrigger value="identity" className="tab-trigger-custom label-text data-[state=active]:text-gold">
                          <Info className="w-3.5 h-3.5 mr-2" /> Identity
                        </TabsTrigger>
                        <TabsTrigger value="activation" className="tab-trigger-custom label-text data-[state=active]:text-gold">
                          <Timer className="w-3.5 h-3.5 mr-2" /> Activation
                        </TabsTrigger>
                        <TabsTrigger value="effect" className="tab-trigger-custom label-text data-[state=active]:text-gold">
                          <Zap className="w-3.5 h-3.5" /> Effect
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>
              </DialogHeader>

              <ScrollArea className="flex-1 px-8 pb-8">
                <div className="max-w-2xl mx-auto space-y-8 py-4">
                  
                  {activeTab === 'identity' && (
                    <div className="space-y-6">
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Activity</Label>
                        </div>
                        <div className="grid gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">Name</Label>
                            <Input 
                              value={editingActivity.name}
                              onChange={e => handleUpdateActivity(editingId!, { name: e.target.value })}
                              className="bg-background/40 border-gold/10 h-9 font-serif text-lg"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">Icon</Label>
                            <div className="flex gap-1.5">
                              <Input 
                                value={editingActivity.img}
                                onChange={e => handleUpdateActivity(editingId!, { img: e.target.value })}
                                className="bg-background/40 border-gold/10 h-9 font-mono text-xs"
                              />
                              <Button variant="outline" size="icon" className="h-9 w-9 border-gold/10 shrink-0">
                                <FileJson className="w-4 h-4 text-gold/40" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">Chat Flavor</Label>
                            <Input 
                              value={editingActivity.chatFlavor || ''}
                              onChange={e => handleUpdateActivity(editingId!, { chatFlavor: e.target.value })}
                              className="bg-background/40 border-gold/10 h-9 text-xs"
                              placeholder="Additional text displayed in chat..."
                            />
                          </div>
                        </div>
                      </div>

                      {editingActivity.kind === 'attack' && (
                        <div className="form-group-custom">
                          <div className="flex items-center justify-between mb-2">
                             <Label className="label-text-custom font-serif">Attack</Label>
                          </div>
                          <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Attack Type</Label>
                              <Select 
                                value={editingActivity.attack?.type}
                                onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, type: val as any } })}
                              >
                                <SelectTrigger className="h-9 bg-background/40 border-gold/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="melee">Melee</SelectItem>
                                  <SelectItem value="ranged">Ranged</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Classification</Label>
                              <Select 
                                value={editingActivity.attack?.classification}
                                onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, classification: val as any } })}
                              >
                                <SelectTrigger className="h-9 bg-background/40 border-gold/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unarmed">Unarmed Attack</SelectItem>
                                  <SelectItem value="weapon">Weapon Attack</SelectItem>
                                  <SelectItem value="spell">Spell Attack</SelectItem>
                                  <SelectItem value="none">None</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-1.5">
                               <Label className="label-text-xs-custom">Ability</Label>
                               <Select 
                                value={editingActivity.attack?.ability || ''}
                                onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, ability: val } })}
                               >
                                  <SelectTrigger className="h-9 bg-background/40 border-gold/10 text-xs">
                                    <SelectValue placeholder="Default" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="">Default</SelectItem>
                                    <SelectItem value="str">Strength</SelectItem>
                                    <SelectItem value="dex">Dexterity</SelectItem>
                                    <SelectItem value="con">Constitution</SelectItem>
                                    <SelectItem value="int">Intelligence</SelectItem>
                                    <SelectItem value="wis">Wisdom</SelectItem>
                                    <SelectItem value="cha">Charisma</SelectItem>
                                  </SelectContent>
                               </Select>
                            </div>
                            <div className="grid gap-1.5">
                               <Label className="label-text-xs-custom">Flat Bonus</Label>
                               <Input 
                                value={editingActivity.attack?.bonus || ''}
                                onChange={e => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, bonus: e.target.value } })}
                                className="h-9 bg-background/40 border-gold/10 font-mono text-xs text-center"
                                placeholder="+2"
                               />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="form-group-custom">
                         <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Behavior</Label>
                        </div>
                        <div className="grid gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                               <Label className="font-bold text-xs uppercase text-ink/80">Measured Template Prompt</Label>
                               <p className="text-[10px] text-ink/40">Should player be prompted to place a template?</p>
                            </div>
                            <Checkbox 
                              checked={editingActivity.target?.prompt}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, { target: { ...editingActivity.target, prompt: !!checked } })}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="form-group-custom">
                         <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Visibility</Label>
                        </div>
                        <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                           <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Level Limit</Label>
                              <div className="flex items-center gap-2">
                                <Input 
                                  type="number"
                                  value={editingActivity.visibility?.level?.min || 0}
                                  onChange={e => handleUpdateActivity(editingId!, { 
                                    visibility: { ...editingActivity.visibility, level: { min: parseInt(e.target.value) || 0, max: editingActivity.visibility?.level?.max || 20 } } 
                                  })}
                                  className="h-8 bg-background/40 border-gold/10 text-center"
                                />
                                <ArrowRight className="w-3 h-3 text-gold/20" />
                                <Input 
                                  type="number"
                                  value={editingActivity.visibility?.level?.max || 20}
                                  placeholder="∞"
                                  onChange={e => handleUpdateActivity(editingId!, { 
                                    visibility: { ...editingActivity.visibility, level: { min: editingActivity.visibility?.level?.min || 0, max: parseInt(e.target.value) || 20 } } 
                                  })}
                                  className="h-8 bg-background/40 border-gold/10 text-center"
                                />
                              </div>
                           </div>
                           <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Identifier Override</Label>
                              <Input 
                                value={editingActivity.visibility?.identifier || ''}
                                onChange={e => handleUpdateActivity(editingId!, { visibility: { ...editingActivity.visibility, identifier: e.target.value } })}
                                placeholder="class-slug"
                                className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                              />
                           </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'activation' && (
                    <div className="space-y-8">
                       <div className="flex justify-center border-b border-gold/10">
                          <Tabs value={activeActivationTab} onValueChange={setActiveActivationTab} className="bg-transparent border-none">
                            <TabsList className="bg-transparent border-none h-12 p-0 gap-12">
                              <TabsTrigger value="time" className="tab-trigger-custom-small">
                                <Timer className="w-3.5 h-3.5" /> Time
                              </TabsTrigger>
                              <TabsTrigger value="consumption" className="tab-trigger-custom-small">
                                <Zap className="w-3.5 h-3.5" /> Consumption
                              </TabsTrigger>
                              <TabsTrigger value="targeting" className="tab-trigger-custom-small">
                                <Target className="w-3.5 h-3.5" /> Targeting
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>
                       </div>

                       {activeActivationTab === 'time' && (
                         <div className="space-y-6">
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Activation</Label>
                             </div>
                             <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Activation Cost</Label>
                                 <Select 
                                   value={editingActivity.activation?.type}
                                   onValueChange={val => handleUpdateActivity(editingId!, { activation: { ...editingActivity.activation, type: val } })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="action">Action</SelectItem>
                                      <SelectItem value="bonus">Bonus Action</SelectItem>
                                      <SelectItem value="reaction">Reaction</SelectItem>
                                      <SelectItem value="minute">Minute</SelectItem>
                                      <SelectItem value="hour">Hour</SelectItem>
                                      <SelectItem value="special">Special</SelectItem>
                                    </SelectContent>
                                 </Select>
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">&nbsp;</Label>
                                 <Input 
                                   value={editingActivity.activation?.condition || ''}
                                   onChange={e => handleUpdateActivity(editingId!, { activation: { ...editingActivity.activation, condition: e.target.value } })}
                                   placeholder="Activation Condition"
                                   className="h-9 bg-background/40 border-gold/10 text-xs"
                                 />
                               </div>
                             </div>
                           </div>

                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Duration</Label>
                             </div>
                             <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Time</Label>
                                 <Select 
                                    value={editingActivity.duration?.units}
                                    onValueChange={val => handleUpdateActivity(editingId!, { duration: { ...editingActivity.duration!, units: val } })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="inst">Instantaneous</SelectItem>
                                      <SelectItem value="round">Round</SelectItem>
                                      <SelectItem value="minute">Minute</SelectItem>
                                      <SelectItem value="hour">Hour</SelectItem>
                                      <SelectItem value="day">Day</SelectItem>
                                      <SelectItem value="spec">Special</SelectItem>
                                    </SelectContent>
                                 </Select>
                               </div>
                               <div className="flex items-center justify-between pt-6">
                                  <Label className="label-text-xs-custom">Concentration</Label>
                                  <Checkbox 
                                    checked={editingActivity.duration?.concentration}
                                    onCheckedChange={checked => handleUpdateActivity(editingId!, { duration: { ...editingActivity.duration!, concentration: !!checked } })}
                                  />
                               </div>
                               <p className="col-span-2 text-[10px] text-ink/40 mt-[-8px]">Creature must maintain concentration while active.</p>
                             </div>
                           </div>
                         </div>
                       )}

                       {activeActivationTab === 'consumption' && (
                         <div className="space-y-6">
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom tracking-tighter">Consumption Scaling</Label>
                             </div>
                             <div className="p-4 border border-gold/10 bg-background/20 rounded flex items-center justify-between">
                                <div className="space-y-0.5">
                                   <Label className="font-bold text-xs uppercase text-ink/80">Allow Scaling</Label>
                                   <p className="text-[10px] text-ink/40">Can an activity not on a spell be activated at higher levels?</p>
                                </div>
                                <Checkbox 
                                  checked={editingActivity.consumption?.scaling?.allowed}
                                  onCheckedChange={checked => handleUpdateActivity(editingId!, { 
                                    consumption: { ...editingActivity.consumption!, scaling: { ...editingActivity.consumption?.scaling, allowed: !!checked, max: editingActivity.consumption?.scaling?.max || '' } } 
                                  })}
                                />
                             </div>
                           </div>

                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Usage</Label>
                             </div>
                             <div className="grid grid-cols-3 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="flex items-center">
                                  <Label className="font-bold text-xs uppercase text-ink/80">Limited Uses</Label>
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Spent</Label>
                                 <Input 
                                   type="number"
                                   value={editingActivity.uses?.spent || 0}
                                   onChange={e => handleUpdateActivity(editingId!, { 
                                     uses: { ...editingActivity.uses, spent: parseInt(e.target.value) || 0 } 
                                   })}
                                   className="h-8 bg-background/40 border-gold/10 text-center"
                                 />
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Max</Label>
                                 <Input 
                                   value={editingActivity.uses?.max || ''}
                                   onChange={e => handleUpdateActivity(editingId!, { 
                                     uses: { ...editingActivity.uses, max: e.target.value } 
                                   })}
                                   className="h-8 bg-background/40 border-gold/10 text-center"
                                 />
                               </div>
                             </div>
                           </div>

                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Recovery</Label>
                             </div>
                             <div className="p-4 border border-gold/10 bg-background/20 rounded text-center py-6 text-ink/20 italic text-xs">
                                Never
                             </div>
                           </div>
                         </div>
                       )}

                       {activeActivationTab === 'targeting' && (
                         <div className="space-y-6">
                            <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Range</Label>
                             </div>
                             <div className="grid gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Unit</Label>
                                 <Select 
                                   value={editingActivity.range?.units}
                                   onValueChange={val => handleUpdateActivity(editingId!, { range: { ...editingActivity.range!, units: val } })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="self">Self</SelectItem>
                                      <SelectItem value="touch">Touch</SelectItem>
                                      <SelectItem value="ft">Feet</SelectItem>
                                      <SelectItem value="mi">Miles</SelectItem>
                                      <SelectItem value="spec">Special</SelectItem>
                                    </SelectContent>
                                 </Select>
                               </div>
                               <Input 
                                  value={editingActivity.range?.special || ''}
                                  onChange={e => handleUpdateActivity(editingId!, { range: { ...editingActivity.range!, special: e.target.value } })}
                                  placeholder="Special Range"
                                  className="h-9 bg-background/40 border-gold/10 text-xs"
                               />
                             </div>
                           </div>

                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Targets</Label>
                             </div>
                             <div className="grid gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Type</Label>
                                 <Select 
                                   value={editingActivity.target?.affects?.type || 'none'}
                                   onValueChange={val => handleUpdateActivity(editingId!, { target: { ...editingActivity.target, affects: { ...editingActivity.target?.affects, type: val } } })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      <SelectItem value="creature">Creature</SelectItem>
                                      <SelectItem value="ally">Ally</SelectItem>
                                      <SelectItem value="enemy">Enemy</SelectItem>
                                      <SelectItem value="object">Object</SelectItem>
                                      <SelectItem value="space">Space</SelectItem>
                                    </SelectContent>
                                 </Select>
                               </div>
                             </div>
                           </div>
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom font-serif">Area</Label>
                             </div>
                             <div className="grid gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Shape (Template)</Label>
                                 <Select 
                                   value={editingActivity.target?.template?.type || 'none'}
                                   onValueChange={val => handleUpdateActivity(editingId!, { target: { ...editingActivity.target, template: { ...editingActivity.target?.template, type: val } } })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      <SelectItem value="cone">Cone</SelectItem>
                                      <SelectItem value="cube">Cube</SelectItem>
                                      <SelectItem value="cylinder">Cylinder</SelectItem>
                                      <SelectItem value="line">Line</SelectItem>
                                      <SelectItem value="sphere">Sphere</SelectItem>
                                      <SelectItem value="square">Square</SelectItem>
                                    </SelectContent>
                                 </Select>
                               </div>
                             </div>
                           </div>
                         </div>
                       )}
                    </div>
                  )}

                  {activeTab === 'effect' && (
                    <div className="space-y-6">
                       {(editingActivity.save || editingActivity.check) && (
                        <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">{editingActivity.save ? 'Saving Throw' : 'Ability Check'}</Label>
                        </div>
                        <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                          {editingActivity.save && (
                            <div className="grid gap-1.5 col-span-2">
                              <Label className="label-text-xs-custom">Abilities</Label>
                              <Input 
                                value={editingActivity.save.abilities.join(', ')}
                                onChange={e => handleUpdateActivity(editingId!, { 
                                  save: { ...editingActivity.save!, abilities: e.target.value.split(',').map(s => s.trim()) } 
                                })}
                                className="bg-background/40 border-gold/10 h-9 font-mono text-xs"
                                placeholder="dex, str, etc."
                              />
                            </div>
                          )}
                          {editingActivity.check && (
                            <div className="grid gap-1.5 col-span-2">
                              <Label className="label-text-xs-custom">Ability</Label>
                              <Select 
                                value={editingActivity.check.ability}
                                onValueChange={val => handleUpdateActivity(editingId!, { 
                                  check: { ...editingActivity.check!, ability: val } 
                                })}
                              >
                                <SelectTrigger className="bg-background/40 border-gold/10 h-9 shrink-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="str">Strength</SelectItem>
                                  <SelectItem value="dex">Dexterity</SelectItem>
                                  <SelectItem value="con">Constitution</SelectItem>
                                  <SelectItem value="int">Intelligence</SelectItem>
                                  <SelectItem value="wis">Wisdom</SelectItem>
                                  <SelectItem value="cha">Charisma</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">DC Mode</Label>
                            <Select 
                              value={editingActivity.save?.dc?.calculation || editingActivity.check?.dc?.calculation || ''}
                              onValueChange={val => {
                                if (editingActivity.save) {
                                  handleUpdateActivity(editingId!, { 
                                    save: { ...editingActivity.save, dc: { ...editingActivity.save.dc, calculation: val } } 
                                  });
                                } else if (editingActivity.check) {
                                  handleUpdateActivity(editingId!, { 
                                    check: { ...editingActivity.check, dc: { ...editingActivity.check.dc, calculation: val } } 
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="bg-background/40 border-gold/10 h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="spellcasting">Spellcasting DC</SelectItem>
                                <SelectItem value="flat">Flat / Constant</SelectItem>
                                <SelectItem value="str">Strength</SelectItem>
                                <SelectItem value="dex">Dexterity</SelectItem>
                                <SelectItem value="con">Constitution</SelectItem>
                                <SelectItem value="int">Intelligence</SelectItem>
                                <SelectItem value="wis">Wisdom</SelectItem>
                                <SelectItem value="cha">Charisma</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">DC Formula / Value</Label>
                            <Input 
                              value={editingActivity.save?.dc?.formula || editingActivity.check?.dc?.formula || ''}
                              onChange={e => {
                                if (editingActivity.save) {
                                  handleUpdateActivity(editingId!, { 
                                    save: { ...editingActivity.save, dc: { ...editingActivity.save.dc, formula: e.target.value } } 
                                  });
                                } else if (editingActivity.check) {
                                  handleUpdateActivity(editingId!, { 
                                    check: { ...editingActivity.check, dc: { ...editingActivity.check.dc, formula: e.target.value } } 
                                  });
                                }
                              }}
                              className="bg-background/40 border-gold/10 h-9 font-mono text-xs"
                              placeholder="10, or @abilities.int.dc"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {(editingActivity.damage || editingActivity.healing) && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">{editingActivity.healing ? 'Healing' : 'Damage'}</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-6">
                          <div className="space-y-6">
                            {(editingActivity.damage?.parts || editingActivity.healing?.parts || []).map((part, idx) => (
                              <div key={idx} className="p-3 border border-gold/5 bg-background/20 rounded relative group">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-gold/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => {
                                    const key = editingActivity.healing ? 'healing' : 'damage';
                                    const obj = editingActivity[key] as any;
                                    const newParts = obj.parts.filter((_: any, i: number) => i !== idx);
                                    handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                  }}
                                >
                                  <Trash2 className="h-3 w-3 text-red-400" />
                                </Button>
                                
                                <div className="grid grid-cols-12 gap-3 mb-3">
                                  <div className="col-span-2">
                                    <Label className="label-text-xs-custom">Num</Label>
                                    <Input 
                                      type="number"
                                      value={part.number || ''}
                                      onChange={e => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, number: parseInt(e.target.value) || null };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-center text-xs"
                                    />
                                  </div>
                                  <div className="col-span-3">
                                    <Label className="label-text-xs-custom">Die</Label>
                                    <Select 
                                      value={part.denomination?.toString() || ''}
                                      onValueChange={val => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, denomination: parseInt(val) || null };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                    >
                                      <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                        <SelectValue placeholder="-" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="4">d4</SelectItem>
                                        <SelectItem value="6">d6</SelectItem>
                                        <SelectItem value="8">d8</SelectItem>
                                        <SelectItem value="10">d10</SelectItem>
                                        <SelectItem value="12">d12</SelectItem>
                                        <SelectItem value="20">d20</SelectItem>
                                        <SelectItem value="100">d100</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="col-span-3">
                                    <Label className="label-text-xs-custom">Bonus</Label>
                                    <Input 
                                      value={part.bonus || ''}
                                      onChange={e => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, bonus: e.target.value };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                      placeholder="+5"
                                    />
                                  </div>
                                  <div className="col-span-4">
                                    <Label className="label-text-xs-custom">Type(s)</Label>
                                    <Input 
                                      value={(part.types || []).join(', ')}
                                      onChange={e => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, types: e.target.value.split(',').map(s => s.trim()) };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-[9px] uppercase font-bold"
                                      placeholder="fire, radiant"
                                    />
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-3">
                                  <div className="flex items-center gap-3">
                                    <Checkbox 
                                      id={`custom-${idx}`}
                                      checked={part.custom?.enabled}
                                      onCheckedChange={checked => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, custom: { ...part.custom, enabled: !!checked, formula: part.custom?.formula || '' } };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                    />
                                    <Label htmlFor={`custom-${idx}`} className="text-[9px] uppercase text-ink/60 font-bold">Custom Formula</Label>
                                  </div>
                                  {part.custom?.enabled && (
                                    <Input 
                                      value={part.custom.formula}
                                      onChange={e => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, custom: { ...part.custom, formula: e.target.value } };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                      className="h-7 bg-background/40 border-gold/10 text-[9px] font-mono"
                                      placeholder="Formula..."
                                    />
                                  )}
                                </div>

                                <div className="grid grid-cols-12 gap-2 border-t border-gold/5 mt-3 pt-3">
                                  <div className="col-span-4">
                                     <Label className="label-text-xs-custom">Scaling Mode</Label>
                                     <Select 
                                      value={part.scaling?.mode || ''}
                                      onValueChange={val => {
                                        const key = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[key] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, scaling: { ...part.scaling, mode: val } };
                                        handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                      }}
                                     >
                                        <SelectTrigger className="h-7 bg-background/40 border-gold/10 text-[9px]">
                                          <SelectValue placeholder="None" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="">None</SelectItem>
                                          <SelectItem value="whole">Every Level</SelectItem>
                                          <SelectItem value="half">Every Other Level</SelectItem>
                                        </SelectContent>
                                     </Select>
                                  </div>
                                  <div className="col-span-8">
                                     <Label className="label-text-xs-custom">Scaling Formula / Dice</Label>
                                     <div className="flex gap-2">
                                        <Input 
                                          type="number"
                                          value={part.scaling?.number || ''}
                                          onChange={e => {
                                            const key = editingActivity.healing ? 'healing' : 'damage';
                                            const obj = editingActivity[key] as any;
                                            const newParts = [...obj.parts];
                                            newParts[idx] = { ...part, scaling: { ...part.scaling, number: parseInt(e.target.value) || 0 } };
                                            handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                          }}
                                          className="h-7 w-12 bg-background/40 border-gold/10 text-[9px] text-center"
                                          placeholder="1"
                                        />
                                        <Input 
                                          value={part.scaling?.formula || ''}
                                          onChange={e => {
                                            const key = editingActivity.healing ? 'healing' : 'damage';
                                            const obj = editingActivity[key] as any;
                                            const newParts = [...obj.parts];
                                            newParts[idx] = { ...part, scaling: { ...part.scaling, formula: e.target.value } };
                                            handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                                          }}
                                          className="h-7 flex-1 bg-background/40 border-gold/10 text-[9px] font-mono"
                                          placeholder="Formula..."
                                        />
                                     </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm" 
                              className="text-gold text-[10px] h-8 w-full mt-2 border border-dashed border-gold/10 hover:bg-gold/5"
                              onClick={() => {
                                const key = editingActivity.healing ? 'healing' : 'damage';
                                const obj = editingActivity[key] as any;
                                const newParts = [...(obj.parts || []), { types: [editingActivity.healing ? 'healing' : ''] }];
                                handleUpdateActivity(editingId!, { [key]: { ...obj, parts: newParts } });
                              }}
                            >
                              <Plus className="w-3 h-3 mr-2" /> Add {editingActivity.healing ? 'Healing' : 'Damage'} Part
                            </Button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                            <div className="flex items-center justify-between">
                                <Label className="text-[10px] uppercase text-gold font-bold tracking-widest">Base Item Damage</Label>
                                <Checkbox 
                                  checked={editingActivity.damage?.includeBase}
                                  onCheckedChange={checked => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, includeBase: !!checked } })}
                                />
                            </div>
                            {editingActivity.kind === 'save' && editingActivity.damage && (
                              <div className="flex items-center justify-between gap-4">
                                 <Label className="label-text-xs-custom">On Save</Label>
                                 <Select 
                                  value={editingActivity.damage.onSave}
                                  onValueChange={val => handleUpdateActivity(editingId!, { 
                                    damage: { ...editingActivity.damage!, onSave: val } 
                                  })}
                                 >
                                    <SelectTrigger className="bg-background/40 border-gold/10 h-8 flex-1">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="half">Half Damage</SelectItem>
                                      <SelectItem value="none">No Damage</SelectItem>
                                    </SelectContent>
                                 </Select>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}                     {editingActivity.spell && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Spellcasting</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-1.5 col-span-2">
                              <Label className="label-text-xs-custom">Spell UUID</Label>
                              <Input 
                                value={editingActivity.spell.uuid || ''}
                                placeholder="Item.FoundrySpellId"
                                onChange={e => handleUpdateActivity(editingId!, { 
                                  spell: { ...editingActivity.spell!, uuid: e.target.value } 
                                })}
                                className="bg-background/40 border-gold/10 h-8 text-xs font-mono"
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Ability Override</Label>
                              <Select 
                                value={editingActivity.spell.ability || ''}
                                onValueChange={val => handleUpdateActivity(editingId!, { 
                                  spell: { ...editingActivity.spell!, ability: val } 
                                })}
                              >
                                <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                  <SelectValue placeholder="Default" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">Default</SelectItem>
                                  <SelectItem value="str">Strength</SelectItem>
                                  <SelectItem value="dex">Dexterity</SelectItem>
                                  <SelectItem value="con">Constitution</SelectItem>
                                  <SelectItem value="int">Intelligence</SelectItem>
                                  <SelectItem value="wis">Wisdom</SelectItem>
                                  <SelectItem value="cha">Charisma</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Cast Level Override</Label>
                              <Input 
                                type="number"
                                value={editingActivity.spell.level || ''}
                                onChange={e => handleUpdateActivity(editingId!, { 
                                  spell: { ...editingActivity.spell!, level: parseInt(e.target.value) || null } 
                                })}
                                className="bg-background/40 border-gold/10 h-8 text-center"
                              />
                            </div>
                          </div>

                          <div className="border-t border-gold/5 pt-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="label-text-xs-custom text-gold">Challenge Overrides</Label>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] uppercase text-ink/40 font-bold">Enabled</span>
                                <Checkbox 
                                  checked={editingActivity.spell.challenge?.override}
                                  onCheckedChange={checked => handleUpdateActivity(editingId!, { 
                                    spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, override: !!checked } } 
                                  })}
                                />
                              </div>
                            </div>
                            {editingActivity.spell.challenge?.override && (
                              <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Attack Bonus</Label>
                                  <Input 
                                    type="number"
                                    value={editingActivity.spell.challenge.attack || ''}
                                    onChange={e => handleUpdateActivity(editingId!, { 
                                      spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, attack: parseInt(e.target.value) || null } } 
                                    })}
                                    className="bg-background/40 border-gold/10 h-8 text-center"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Save DC</Label>
                                  <Input 
                                    type="number"
                                    value={editingActivity.spell.challenge.save || ''}
                                    onChange={e => handleUpdateActivity(editingId!, { 
                                      spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, save: parseInt(e.target.value) || null } } 
                                    })}
                                    className="bg-background/40 border-gold/10 h-8 text-center"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="border-t border-gold/5 pt-4">
                            <Label className="label-text-xs-custom">Spell Properties (Removed if cast)</Label>
                            <div className="flex flex-wrap gap-4 mt-2">
                              {['vocal', 'somatic', 'material'].map(prop => (
                                <div key={prop} className="flex items-center gap-2">
                                  <Checkbox 
                                    id={`prop-${prop}`}
                                    checked={(editingActivity.spell!.properties || []).includes(prop)}
                                    onCheckedChange={checked => {
                                      const props = editingActivity.spell!.properties || [];
                                      const newProps = checked ? [...props, prop] : props.filter(p => p !== prop);
                                      handleUpdateActivity(editingId!, { spell: { ...editingActivity.spell!, properties: newProps } });
                                    }}
                                  />
                                  <Label htmlFor={`prop-${prop}`} className="text-[10px] uppercase font-bold text-ink/60">{prop[0]}</Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {editingActivity.enchant && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Enchantment</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox 
                              className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white h-4 w-4"
                              checked={editingActivity.enchant.self}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, { 
                                enchant: { ...editingActivity.enchant!, self: !!checked } 
                              })}
                            />
                            <span className="label-text-xs-custom">Enchant Self (Instead of targeting an item)</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {editingActivity.activity && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Forward Execution</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-4">
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">Target Activity ID</Label>
                            <Select 
                              value={editingActivity.activity.id}
                              onValueChange={val => handleUpdateActivity(editingId!, { 
                                activity: { id: val } 
                              })}
                            >
                              <SelectTrigger className="bg-background/40 border-gold/10 h-8">
                                <SelectValue placeholder="Select another activity" />
                              </SelectTrigger>
                              <SelectContent>
                                {activityList
                                  .filter(a => a.id !== editingId)
                                  .map(a => (
                                    <SelectItem key={a.id} value={a.id}>{a.name} ({a.kind})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {editingActivity.summon && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Summon</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-4">
                           <p className="text-[10px] uppercase font-serif tracking-widest text-gold opacity-60">
                             Monster UI block placeholder
                           </p>
                        </div>
                      </div>
                    )}
                    
                    <div className="p-12 border border-dashed border-gold/10 rounded flex flex-col items-center justify-center text-center opacity-40">
                       <Zap className="w-12 h-12 text-gold/10 mb-2" />
                       <p className="text-[10px] uppercase font-serif tracking-widest">Advanced Logic Flow coming soon</p>
                    </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-gold/10 bg-background/40 flex justify-end shrink-0">
                 <Button 
                  onClick={() => setEditingId(null)}
                  className="bg-gold hover:bg-gold/90 text-white gap-2 px-12 h-10 font-black uppercase tracking-widest text-[10px]"
                 >
                   Done
                 </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      <style>{`
        .tab-trigger-custom {
          @apply data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-gold data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none h-auto pb-2 px-2 text-[10px] font-black uppercase tracking-widest gap-2 flex items-center transition-all opacity-40 data-[state=active]:opacity-100;
        }
        .tab-trigger-custom-small {
          @apply data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-gold data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none h-12 px-0 text-[9px] font-black uppercase tracking-[0.2em] gap-2 flex items-center transition-all opacity-30 data-[state=active]:opacity-100;
        }
        .label-text-custom {
          @apply text-[10px] uppercase text-gold font-bold tracking-[0.2em] mb-2 block;
        }
        .label-text-xs-custom {
          @apply text-[9px] uppercase text-ink/40 font-black tracking-widest;
        }
        .form-group-custom {
          @apply relative border-t border-gold/5 pt-4 mt-4 first:border-0 first:pt-0 first:mt-0;
        }
      `}</style>
    </div>
  );
}
