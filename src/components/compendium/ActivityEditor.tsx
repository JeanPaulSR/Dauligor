import React, { useEffect, useState } from 'react';
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

const ABILITY_OPTIONS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SPELL_PROPERTIES = ['vocal', 'somatic', 'material'];
const RECOVERY_PERIOD_OPTIONS = ['turn', 'round', 'shortRest', 'longRest', 'day'];
const RECOVERY_TYPE_OPTIONS = ['recoverAll', 'formula', 'loseAll'];
const TARGET_TYPE_OPTIONS = ['none', 'creature', 'ally', 'enemy', 'object', 'space'];
const TEMPLATE_TYPE_OPTIONS = ['none', 'cone', 'cube', 'cylinder', 'line', 'sphere', 'square'];
const CONSUMPTION_TARGET_TYPES = ['attribute', 'itemUses', 'resource', 'material', 'custom'];
const SCALING_MODE_OPTIONS = ['', 'whole', 'half'];
const SUMMON_OR_TRANSFORM_MODE_OPTIONS = ['', 'cr'];
const MOVEMENT_TYPE_OPTIONS = ['walk', 'burrow', 'climb', 'fly', 'swim'];
const CREATURE_SIZE_OPTIONS = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'];
const CREATURE_TYPE_OPTIONS = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead'
];

const parseCsv = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean);
const parseNullableInteger = (value: string) => {
  if (value.trim() === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeActivity = (activity: SemanticActivity): SemanticActivity => {
  const sanitized: SemanticActivity = { ...activity };

  if (sanitized.visibility) {
    const { requireAttunement, requireIdentification, requireMagic, ...visibility } = sanitized.visibility;
    void requireAttunement;
    void requireIdentification;
    void requireMagic;
    sanitized.visibility = visibility;
  }

  if (sanitized.kind === 'forward') {
    delete sanitized.duration;
    delete sanitized.range;
    delete sanitized.target;
  }

  if (sanitized.damage) {
    if (sanitized.kind === 'save') {
      const { critical, includeBase, ...damage } = sanitized.damage;
      void critical;
      void includeBase;
      sanitized.damage = damage;
    } else if (sanitized.kind !== 'attack' && 'includeBase' in sanitized.damage) {
      const { includeBase, ...damage } = sanitized.damage;
      void includeBase;
      sanitized.damage = damage;
    }
  }

  if (sanitized.consumption) {
    sanitized.consumption = {
      ...sanitized.consumption,
      spellSlot: sanitized.kind === 'cast'
        ? (sanitized.consumption.spellSlot ?? true)
        : (sanitized.consumption.spellSlot ?? false)
    };
  }

  return sanitized;
};

export default function ActivityEditor({ activities, onChange }: ActivityEditorProps) {
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('identity');
  const [activeActivationTab, setActiveActivationTab] = useState('time');

  const activityList = Array.isArray(activities) 
    ? activities 
    : Object.values(activities);

  useEffect(() => {
    const normalized = activityList.map(sanitizeActivity);
    if (JSON.stringify(normalized) !== JSON.stringify(activityList)) {
      onChange(normalized);
    }
  }, [activities, onChange]);

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
        prompt: true
      },
      visibility: {
        identifier: '',
        level: { min: 0, max: 20 }
      },
      consumption: { spellSlot: false, scaling: { allowed: false, max: '' }, targets: [] },
      uses: { spent: 0, max: '', recovery: [] }
    };

    if (kind === 'attack') {
      newActivity.attack = {
        type: 'melee',
        classification: 'weapon',
        flat: false,
        critical: { threshold: null }
      };
      newActivity.damage = { parts: [{}], includeBase: true, critical: { allow: false, bonus: '' } };
    } else if (kind === 'check') {
      newActivity.check = { ability: 'str', associated: [], dc: { calculation: 'spellcasting' } };
    } else if (kind === 'save') {
      newActivity.save = { abilities: ['dex'], dc: { calculation: 'spellcasting' } };
      newActivity.damage = { parts: [{}], onSave: 'half' };
    } else if (kind === 'heal') {
      newActivity.healing = { parts: [{ types: ['healing'] }] };
    } else if (kind === 'damage') {
      newActivity.damage = { parts: [{}], critical: { allow: false, bonus: '' } };
    } else if (kind === 'cast') {
      newActivity.consumption = { ...newActivity.consumption, spellSlot: true };
      newActivity.spell = {
        uuid: '',
        spellbook: true,
        properties: ['vocal', 'somatic', 'material'],
        challenge: { override: false, attack: null, save: null }
      };
    } else if (kind === 'enchant') {
      newActivity.enchant = {
        self: false,
        restrictions: { allowMagical: false, categories: [], properties: [], type: '' },
        effects: []
      };
    } else if (kind === 'forward') {
      delete newActivity.duration;
      delete newActivity.range;
      delete newActivity.target;
      newActivity.activity = { id: '' };
    } else if (kind === 'summon') {
      newActivity.summon = {
        profiles: [],
        bonuses: {},
        match: { attacks: false, disposition: false, proficiency: false, saves: false, ability: '' },
        creatureSizes: [],
        creatureTypes: [],
        mode: '',
        prompt: true,
        tempHP: ''
      };
    } else if (kind === 'transform') {
      newActivity.transform = {
        profiles: [],
        settings: null,
        customize: false,
        mode: 'cr',
        preset: ''
      };
    } else if (kind === 'utility') {
      newActivity.roll = { formula: '', name: '', prompt: false, visible: true };
    }

    onChange([...activityList, sanitizeActivity(newActivity)]);
    setIsSelectorOpen(false);
    setEditingId(id);
  };

  const handleRemoveActivity = (id: string) => {
    onChange(activityList.filter(a => a.id !== id));
  };

  const handleUpdateActivity = (id: string, data: Partial<SemanticActivity>) => {
    const updated = activityList.map(a => 
      a.id === id ? sanitizeActivity({ ...a, ...data }) : a
    );
    onChange(updated);
  };

  const editingActivity = editingId ? activityList.find(a => a.id === editingId) : null;
  const showsTemplatePrompt = !!editingActivity?.target && !['cast', 'enchant', 'summon', 'utility', 'forward'].includes(editingActivity.kind);
  const showsDuration = !!editingActivity?.duration;
  const showsRange = !!editingActivity?.range;
  const showsTargeting = !!editingActivity?.target;
  const showsBaseDamageToggle = editingActivity?.kind === 'attack' && !!editingActivity.damage;
  const showsDamageCritical = !!editingActivity?.damage && editingActivity.kind !== 'save';

  const updateCurrent = (data: Partial<SemanticActivity>) => {
    if (!editingId) return;
    handleUpdateActivity(editingId, data);
  };

  const updateSection = (key: keyof SemanticActivity, patch: Record<string, unknown>) => {
    updateCurrent({
      [key]: {
        ...(((editingActivity?.[key] as Record<string, unknown> | undefined) ?? {})),
        ...patch
      }
    } as Partial<SemanticActivity>);
  };

  const updateTarget = (patch: Record<string, unknown>) => {
    updateCurrent({
      target: {
        ...(editingActivity?.target ?? {}),
        ...patch
      }
    });
  };

  const updateTargetTemplate = (patch: Record<string, unknown>) => {
    updateTarget({
      template: {
        ...(editingActivity?.target?.template ?? {}),
        ...patch
      }
    });
  };

  const updateTargetAffects = (patch: Record<string, unknown>) => {
    updateTarget({
      affects: {
        ...(editingActivity?.target?.affects ?? {}),
        ...patch
      }
    });
  };

  const updateConsumption = (patch: Record<string, unknown>) => {
    updateCurrent({
      consumption: {
        ...(editingActivity?.consumption ?? { scaling: { allowed: false, max: '' }, targets: [] }),
        ...patch
      }
    });
  };

  const updateConsumptionScaling = (patch: Record<string, unknown>) => {
    updateConsumption({
      scaling: {
        ...(editingActivity?.consumption?.scaling ?? { allowed: false, max: '' }),
        ...patch
      }
    });
  };

  const updateSpell = (patch: Record<string, unknown>) => {
    updateCurrent({
      spell: {
        ...(editingActivity?.spell ?? { uuid: '', spellbook: true }),
        ...patch
      }
    });
  };

  const updateSummon = (patch: Record<string, unknown>) => {
    updateCurrent({
      summon: {
        ...(editingActivity?.summon ?? {
          profiles: [],
          bonuses: {},
          match: {},
          creatureSizes: [],
          creatureTypes: [],
          mode: '',
          prompt: true,
          tempHP: ''
        }),
        ...patch
      }
    });
  };

  const updateTransform = (patch: Record<string, unknown>) => {
    updateCurrent({
      transform: {
        ...(editingActivity?.transform ?? {
          profiles: [],
          settings: null,
          customize: false,
          mode: 'cr',
          preset: ''
        }),
        ...patch
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="section-header">
        <h4 className="section-label text-gold">Activities</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsSelectorOpen(true)}
          className="h-7 px-2 gap-1.5 btn-gold"
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
                <span className="field-label group-hover:text-gold">{label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingId} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="dialog-content max-w-[95vw] lg:max-w-4xl flex flex-col h-[90vh]">
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
                            <div className="grid gap-1.5">
                               <Label className="label-text-xs-custom">Critical Threshold</Label>
                               <Input
                                type="number"
                                value={editingActivity.attack?.critical?.threshold ?? ''}
                                onChange={e => handleUpdateActivity(editingId!, {
                                  attack: {
                                    ...editingActivity.attack!,
                                    critical: {
                                      ...(editingActivity.attack?.critical ?? { threshold: null }),
                                      threshold: parseNullableInteger(e.target.value)
                                    }
                                  }
                                })}
                                className="h-9 bg-background/40 border-gold/10 text-center"
                                placeholder="20"
                               />
                            </div>
                            <div className="col-span-2 flex items-center justify-between border-t border-gold/5 pt-4">
                              <div className="space-y-0.5">
                                <Label className="font-bold text-xs uppercase text-ink/80">Flat Attack</Label>
                                <p className="text-[10px] text-ink/40">Treat the attack bonus as a flat formula instead of deriving it.</p>
                              </div>
                              <Checkbox
                                checked={editingActivity.attack?.flat}
                                onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                  attack: { ...editingActivity.attack!, flat: !!checked }
                                })}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {showsTemplatePrompt && (
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
                              onCheckedChange={checked => updateTarget({ prompt: !!checked })}
                            />
                          </div>
                        </div>
                      </div>
                      )}

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
                                  value={editingActivity.visibility?.level?.min ?? 0}
                                  onChange={e => updateSection('visibility', {
                                    level: { min: parseInt(e.target.value, 10) || 0, max: editingActivity.visibility?.level?.max ?? 20 }
                                  })}
                                  className="h-8 bg-background/40 border-gold/10 text-center"
                                />
                                <ArrowRight className="w-3 h-3 text-gold/20" />
                                <Input 
                                  type="number"
                                  value={editingActivity.visibility?.level?.max ?? 20}
                                  placeholder="∞"
                                  onChange={e => updateSection('visibility', {
                                    level: { min: editingActivity.visibility?.level?.min ?? 0, max: parseInt(e.target.value, 10) || 20 }
                                  })}
                                  className="h-8 bg-background/40 border-gold/10 text-center"
                                />
                              </div>
                           </div>
                           <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Identifier Override</Label>
                              <Input 
                                value={editingActivity.visibility?.identifier || ''}
                                onChange={e => updateSection('visibility', { identifier: e.target.value })}
                                placeholder="class-slug"
                                className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                              />
                           </div>
                           <p className="col-span-2 text-[10px] text-ink/40 border-t border-gold/5 pt-4">
                             Item-specific visibility requirements like attunement, identification, and magic are handled later when item and spell workflows are added.
                           </p>
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
                                   onValueChange={val => updateSection('activation', { type: val })}
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
                                 <Label className="label-text-xs-custom">Activation Value</Label>
                                 <Input 
                                   type="number"
                                   value={editingActivity.activation?.value ?? 1}
                                   onChange={e => updateSection('activation', { value: parseInt(e.target.value, 10) || 1 })}
                                   className="h-9 bg-background/40 border-gold/10 text-center"
                                 />
                               </div>
                               <div className="grid gap-1.5 col-span-2">
                                 <Label className="label-text-xs-custom">Condition</Label>
                                 <Input 
                                   value={editingActivity.activation?.condition || ''}
                                   onChange={e => updateSection('activation', { condition: e.target.value })}
                                   placeholder="Activation Condition"
                                   className="h-9 bg-background/40 border-gold/10 text-xs"
                                 />
                               </div>
                               <div className="col-span-2 flex items-center justify-between border-t border-gold/5 pt-4">
                                 <div className="space-y-0.5">
                                   <Label className="font-bold text-xs uppercase text-ink/80">Override Activation</Label>
                                   <p className="text-[10px] text-ink/40">Use this activity’s activation instead of inheriting from a cast/forward source.</p>
                                 </div>
                                 <Checkbox
                                   checked={editingActivity.activation?.override}
                                   onCheckedChange={checked => updateSection('activation', { override: !!checked })}
                                 />
                               </div>
                             </div>
                           </div>

                           {showsDuration && (
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Duration</Label>
                             </div>
                             <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Value</Label>
                                 <Input
                                   value={editingActivity.duration?.value || ''}
                                   onChange={e => updateSection('duration', { value: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="1"
                                 />
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Time</Label>
                                 <Select 
                                    value={editingActivity.duration?.units}
                                    onValueChange={val => updateSection('duration', { units: val })}
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
                               <div className="grid gap-1.5 col-span-2">
                                 <Label className="label-text-xs-custom">Special</Label>
                                 <Input
                                   value={editingActivity.duration?.special || ''}
                                   onChange={e => updateSection('duration', { special: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs"
                                   placeholder="Special duration text"
                                 />
                               </div>
                               <div className="flex items-center justify-between pt-2">
                                  <Label className="label-text-xs-custom">Concentration</Label>
                                  <Checkbox 
                                    checked={editingActivity.duration?.concentration}
                                    onCheckedChange={checked => updateSection('duration', { concentration: !!checked })}
                                  />
                               </div>
                               <div className="flex items-center justify-between pt-2">
                                 <Label className="label-text-xs-custom">Override Duration</Label>
                                 <Checkbox
                                   checked={editingActivity.duration?.override}
                                   onCheckedChange={checked => updateSection('duration', { override: !!checked })}
                                 />
                               </div>
                               <p className="col-span-2 text-[10px] text-ink/40 mt-[-8px]">Creature must maintain concentration while active.</p>
                             </div>
                           </div>
                           )}
                         </div>
                       )}

                       {activeActivationTab === 'consumption' && (
                         <div className="space-y-6">
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom tracking-tighter">Consumption Scaling</Label>
                             </div>
                             <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-4">
                               <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                     <Label className="font-bold text-xs uppercase text-ink/80">Allow Scaling</Label>
                                     <p className="text-[10px] text-ink/40">Can an activity not on a spell be activated at higher levels?</p>
                                  </div>
                                  <Checkbox 
                                    checked={editingActivity.consumption?.scaling?.allowed}
                                    onCheckedChange={checked => updateConsumptionScaling({
                                      allowed: !!checked,
                                      max: editingActivity.consumption?.scaling?.max || ''
                                    })}
                                  />
                               </div>
                               {editingActivity.consumption?.scaling?.allowed && (
                                 <div className="grid gap-1.5">
                                   <Label className="label-text-xs-custom">Maximum Scaling Formula</Label>
                                   <Input
                                     value={editingActivity.consumption?.scaling?.max || ''}
                                     onChange={e => updateConsumptionScaling({ max: e.target.value })}
                                     className="h-9 bg-background/40 border-gold/10 font-mono text-xs"
                                     placeholder="@item.level or 9"
                                   />
                                 </div>
                               )}
                               <div className="flex items-center justify-between border-t border-gold/5 pt-4">
                                 <div className="space-y-0.5">
                                   <Label className="font-bold text-xs uppercase text-ink/80">Consume Spell Slot</Label>
                                   <p className="text-[10px] text-ink/40">Native `cast` activities usually leave this enabled.</p>
                                 </div>
                                 <Checkbox
                                   checked={editingActivity.consumption?.spellSlot}
                                   onCheckedChange={checked => updateConsumption({ spellSlot: !!checked })}
                                 />
                               </div>
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
                             <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-3">
                               {((editingActivity.uses?.recovery) || []).map((entry, idx) => (
                                 <div key={idx} className="grid grid-cols-4 gap-3 items-end border border-gold/5 rounded p-3">
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Period</Label>
                                     <Select
                                       value={entry.period || '__none'}
                                       onValueChange={val => {
                                         const recovery = [...(editingActivity.uses?.recovery || [])];
                                         recovery[idx] = { ...entry, period: val === '__none' ? '' : val };
                                         updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                       }}
                                     >
                                       <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                         <SelectValue />
                                       </SelectTrigger>
                                       <SelectContent>
                                         <SelectItem value="__none">None</SelectItem>
                                         {RECOVERY_PERIOD_OPTIONS.map(option => (
                                           <SelectItem key={option} value={option}>{option}</SelectItem>
                                         ))}
                                       </SelectContent>
                                     </Select>
                                   </div>
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Type</Label>
                                     <Select
                                       value={entry.type || '__none'}
                                       onValueChange={val => {
                                         const recovery = [...(editingActivity.uses?.recovery || [])];
                                         recovery[idx] = { ...entry, type: val === '__none' ? '' : val };
                                         updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                       }}
                                     >
                                       <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                         <SelectValue />
                                       </SelectTrigger>
                                       <SelectContent>
                                         <SelectItem value="__none">None</SelectItem>
                                         {RECOVERY_TYPE_OPTIONS.map(option => (
                                           <SelectItem key={option} value={option}>{option}</SelectItem>
                                         ))}
                                       </SelectContent>
                                     </Select>
                                   </div>
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Formula</Label>
                                     <Input
                                       value={entry.formula || ''}
                                       onChange={e => {
                                         const recovery = [...(editingActivity.uses?.recovery || [])];
                                         recovery[idx] = { ...entry, formula: e.target.value };
                                         updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                       }}
                                       className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                       placeholder="1d4 or @prof"
                                     />
                                   </div>
                                   <Button
                                     type="button"
                                     variant="ghost"
                                     size="sm"
                                     className="h-8 text-blood hover:text-blood"
                                     onClick={() => {
                                       const recovery = (editingActivity.uses?.recovery || []).filter((_, i) => i !== idx);
                                       updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                     }}
                                   >
                                     Remove
                                   </Button>
                                 </div>
                               ))}
                               {!(editingActivity.uses?.recovery?.length) && (
                                 <div className="text-center py-4 text-ink/30 italic text-xs">No recovery entries yet.</div>
                               )}
                               <Button
                                 type="button"
                                 variant="ghost"
                                 size="sm"
                                 className="text-gold text-[10px] h-8 w-full border border-dashed border-gold/10 hover:bg-gold/5"
                                 onClick={() => updateCurrent({
                                   uses: {
                                     ...(editingActivity.uses || {}),
                                     recovery: [...(editingActivity.uses?.recovery || []), { period: '', type: '', formula: '' }]
                                   }
                                 })}
                               >
                                 <Plus className="w-3 h-3 mr-2" /> Add Recovery Rule
                               </Button>
                             </div>
                           </div>

                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Consumption Targets</Label>
                             </div>
                             <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-3">
                               {(editingActivity.consumption?.targets || []).map((target, idx) => (
                                 <div key={idx} className="grid grid-cols-6 gap-3 items-end border border-gold/5 rounded p-3">
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Type</Label>
                                     <Select
                                       value={target.type || '__none'}
                                       onValueChange={val => {
                                         const targets = [...(editingActivity.consumption?.targets || [])];
                                         targets[idx] = { ...target, type: val === '__none' ? '' : val };
                                         updateConsumption({ targets });
                                       }}
                                     >
                                       <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                         <SelectValue />
                                       </SelectTrigger>
                                       <SelectContent>
                                         <SelectItem value="__none">None</SelectItem>
                                         {CONSUMPTION_TARGET_TYPES.map(option => (
                                           <SelectItem key={option} value={option}>{option}</SelectItem>
                                         ))}
                                       </SelectContent>
                                     </Select>
                                   </div>
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Target Path</Label>
                                     <Input
                                       value={target.target || ''}
                                       onChange={e => {
                                         const targets = [...(editingActivity.consumption?.targets || [])];
                                         targets[idx] = { ...target, target: e.target.value };
                                         updateConsumption({ targets });
                                       }}
                                       className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                       placeholder="resources.primary.value"
                                     />
                                   </div>
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Value</Label>
                                     <Input
                                       value={target.value || ''}
                                       onChange={e => {
                                         const targets = [...(editingActivity.consumption?.targets || [])];
                                         targets[idx] = { ...target, value: e.target.value };
                                         updateConsumption({ targets });
                                       }}
                                       className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                       placeholder="1"
                                     />
                                   </div>
                                   <div className="grid gap-1.5">
                                     <Label className="label-text-xs-custom">Scaling Formula</Label>
                                     <div className="grid gap-2">
                                       <Select
                                         value={target.scaling?.mode || '__none'}
                                         onValueChange={val => {
                                           const targets = [...(editingActivity.consumption?.targets || [])];
                                           targets[idx] = {
                                             ...target,
                                             scaling: {
                                               ...(target.scaling || { mode: '', formula: '' }),
                                               mode: val === '__none' ? '' : val
                                             }
                                           };
                                           updateConsumption({ targets });
                                         }}
                                       >
                                         <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                           <SelectValue />
                                         </SelectTrigger>
                                         <SelectContent>
                                           <SelectItem value="__none">No Scaling</SelectItem>
                                           {SCALING_MODE_OPTIONS.filter(Boolean).map(option => (
                                             <SelectItem key={option} value={option}>{option}</SelectItem>
                                           ))}
                                         </SelectContent>
                                       </Select>
                                       <Input
                                         value={target.scaling?.formula || ''}
                                         onChange={e => {
                                           const targets = [...(editingActivity.consumption?.targets || [])];
                                         targets[idx] = {
                                           ...target,
                                           scaling: { ...(target.scaling || { mode: '', formula: '' }), formula: e.target.value }
                                         };
                                         updateConsumption({ targets });
                                       }}
                                         className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                         placeholder="@item.level"
                                       />
                                     </div>
                                   </div>
                                   <Button
                                     type="button"
                                     variant="ghost"
                                     size="sm"
                                     className="h-8 text-blood hover:text-blood"
                                     onClick={() => updateConsumption({
                                       targets: (editingActivity.consumption?.targets || []).filter((_, i) => i !== idx)
                                     })}
                                   >
                                     Remove
                                   </Button>
                                 </div>
                               ))}
                               {!(editingActivity.consumption?.targets?.length) && (
                                 <div className="text-center py-4 text-ink/30 italic text-xs">No consumption targets yet.</div>
                               )}
                               <Button
                                 type="button"
                                 variant="ghost"
                                 size="sm"
                                 className="text-gold text-[10px] h-8 w-full border border-dashed border-gold/10 hover:bg-gold/5"
                                 onClick={() => updateConsumption({
                                   targets: [
                                     ...(editingActivity.consumption?.targets || []),
                                     { type: '', target: '', value: '', scaling: { mode: '', formula: '' } }
                                   ]
                                 })}
                               >
                                 <Plus className="w-3 h-3 mr-2" /> Add Consumption Target
                               </Button>
                             </div>
                           </div>
                         </div>
                       )}

                       {activeActivationTab === 'targeting' && (
                         <div className="space-y-6">
                           {showsRange && (
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Range</Label>
                             </div>
                             <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Unit</Label>
                                 <Select 
                                   value={editingActivity.range?.units}
                                   onValueChange={val => updateSection('range', { units: val })}
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
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Value</Label>
                                 <Input
                                   value={editingActivity.range?.value || ''}
                                   onChange={e => updateSection('range', { value: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="30"
                                 />
                               </div>
                               <div className="grid gap-1.5 col-span-2">
                                 <Label className="label-text-xs-custom">Special</Label>
                                 <Input 
                                    value={editingActivity.range?.special || ''}
                                    onChange={e => updateSection('range', { special: e.target.value })}
                                    placeholder="Special Range"
                                    className="h-9 bg-background/40 border-gold/10 text-xs"
                                 />
                               </div>
                               <div className="col-span-2 flex items-center justify-between border-t border-gold/5 pt-4">
                                 <div className="space-y-0.5">
                                   <Label className="font-bold text-xs uppercase text-ink/80">Override Range</Label>
                                   <p className="text-[10px] text-ink/40">Important for cast and forward activities that can inherit another source.</p>
                                 </div>
                                 <Checkbox
                                   checked={editingActivity.range?.override}
                                   onCheckedChange={checked => updateSection('range', { override: !!checked })}
                                 />
                               </div>
                             </div>
                           </div>
                           )}

                           {showsTargeting && (
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom">Targets</Label>
                             </div>
                             <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Type</Label>
                                 <Select 
                                   value={editingActivity.target?.affects?.type || 'none'}
                                   onValueChange={val => updateTargetAffects({ type: val === 'none' ? '' : val })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TARGET_TYPE_OPTIONS.map(option => (
                                        <SelectItem key={option} value={option}>{option === 'none' ? 'None' : option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem>
                                      ))}
                                    </SelectContent>
                                 </Select>
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Count</Label>
                                 <Input
                                   value={editingActivity.target?.affects?.count || ''}
                                   onChange={e => updateTargetAffects({ count: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="1"
                                 />
                               </div>
                               <div className="grid gap-1.5 col-span-2">
                                 <Label className="label-text-xs-custom">Special Targeting</Label>
                                 <Input
                                   value={editingActivity.target?.affects?.special || ''}
                                   onChange={e => updateTargetAffects({ special: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs"
                                   placeholder="Additional target text"
                                 />
                               </div>
                               <div className="col-span-2 flex items-center justify-between">
                                 <span className="label-text-xs-custom">Allow Choice</span>
                                 <Checkbox
                                   checked={editingActivity.target?.affects?.choice}
                                   onCheckedChange={checked => updateTargetAffects({ choice: !!checked })}
                                 />
                               </div>
                             </div>
                           </div>
                           )}
                           <div className="form-group-custom">
                             <div className="flex items-center justify-between mb-2">
                               <Label className="label-text-custom font-serif">Area</Label>
                             </div>
                             <div className="grid grid-cols-2 gap-4 p-4 border border-gold/10 bg-background/20 rounded">
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Shape (Template)</Label>
                                 <Select 
                                   value={editingActivity.target?.template?.type || 'none'}
                                   onValueChange={val => updateTargetTemplate({ type: val === 'none' ? '' : val })}
                                 >
                                    <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TEMPLATE_TYPE_OPTIONS.map(option => (
                                        <SelectItem key={option} value={option}>{option === 'none' ? 'None' : option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem>
                                      ))}
                                    </SelectContent>
                                 </Select>
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Count</Label>
                                 <Input
                                   value={editingActivity.target?.template?.count || ''}
                                   onChange={e => updateTargetTemplate({ count: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="1"
                                 />
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Size</Label>
                                 <Input
                                   value={editingActivity.target?.template?.size || ''}
                                   onChange={e => updateTargetTemplate({ size: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="15"
                                 />
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Units</Label>
                                 <Select
                                   value={editingActivity.target?.template?.units || 'ft'}
                                   onValueChange={val => updateTargetTemplate({ units: val })}
                                 >
                                   <SelectTrigger className="h-9 bg-background/40 border-gold/10">
                                     <SelectValue />
                                   </SelectTrigger>
                                   <SelectContent>
                                     <SelectItem value="ft">Feet</SelectItem>
                                     <SelectItem value="mi">Miles</SelectItem>
                                   </SelectContent>
                                 </Select>
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Width</Label>
                                 <Input
                                   value={editingActivity.target?.template?.width || ''}
                                   onChange={e => updateTargetTemplate({ width: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="5"
                                 />
                               </div>
                               <div className="grid gap-1.5">
                                 <Label className="label-text-xs-custom">Height</Label>
                                 <Input
                                   value={editingActivity.target?.template?.height || ''}
                                   onChange={e => updateTargetTemplate({ height: e.target.value })}
                                   className="h-9 bg-background/40 border-gold/10 text-xs font-mono"
                                   placeholder="5"
                                 />
                               </div>
                               <div className="col-span-2 grid grid-cols-3 gap-4 border-t border-gold/5 pt-4">
                                 <label className="flex items-center justify-between gap-3">
                                   <span className="label-text-xs-custom">Contiguous</span>
                                   <Checkbox
                                     checked={editingActivity.target?.template?.contiguous}
                                     onCheckedChange={checked => updateTargetTemplate({ contiguous: !!checked })}
                                   />
                                 </label>
                                 <label className="flex items-center justify-between gap-3">
                                   <span className="label-text-xs-custom">Stationary</span>
                                   <Checkbox
                                     checked={editingActivity.target?.template?.stationary}
                                     onCheckedChange={checked => updateTargetTemplate({ stationary: !!checked })}
                                   />
                                 </label>
                                 <label className="flex items-center justify-between gap-3">
                                   <span className="label-text-xs-custom">Override Target</span>
                                   <Checkbox
                                     checked={editingActivity.target?.override}
                                     onCheckedChange={checked => updateTarget({ override: !!checked })}
                                   />
                                 </label>
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
                            <>
                              <div className="grid gap-1.5">
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
                                    {ABILITY_OPTIONS.map(ability => (
                                      <SelectItem key={ability} value={ability}>
                                        {ability.toUpperCase()}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-1.5">
                                <Label className="label-text-xs-custom">Associated Checks</Label>
                                <Input
                                  value={(editingActivity.check.associated || []).join(', ')}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    check: { ...editingActivity.check!, associated: parseCsv(e.target.value) }
                                  })}
                                  className="bg-background/40 border-gold/10 h-9 font-mono text-xs"
                                  placeholder="arc, inv, thieves"
                                />
                              </div>
                            </>
                          )}
                          
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">DC Mode</Label>
                            <Select 
                              value={editingActivity.save?.dc?.calculation || editingActivity.check?.dc?.calculation || '__formula'}
                              onValueChange={val => {
                                const calculation = val === '__formula' ? '' : val;
                                if (editingActivity.save) {
                                  handleUpdateActivity(editingId!, { 
                                    save: { ...editingActivity.save, dc: { ...editingActivity.save.dc, calculation } } 
                                  });
                                } else if (editingActivity.check) {
                                  handleUpdateActivity(editingId!, { 
                                    check: { ...editingActivity.check, dc: { ...editingActivity.check.dc, calculation } } 
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="bg-background/40 border-gold/10 h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="spellcasting">Spellcasting DC</SelectItem>
                                <SelectItem value="__formula">Flat / Formula</SelectItem>
                                {ABILITY_OPTIONS.map(ability => (
                                  <SelectItem key={ability} value={ability}>
                                    {ability.toUpperCase()}
                                  </SelectItem>
                                ))}
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
                            {!editingActivity.healing && (
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
                                <Plus className="w-3 h-3 mr-2" /> Add Damage Part
                              </Button>
                            )}
                            {editingActivity.healing && (
                              <p className="text-[10px] text-ink/40 border border-dashed border-gold/10 rounded p-3">
                                Foundry heal activities use a single healing roll. This editor keeps one primary healing part.
                              </p>
                            )}
                          </div>
                          
                          {(showsBaseDamageToggle || editingActivity.kind === 'save') && (
                          <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                            {showsBaseDamageToggle && (
                            <div className="flex items-center justify-between">
                                <Label className="text-[10px] uppercase text-gold font-bold tracking-widest">Base Item Damage</Label>
                                <Checkbox 
                                  checked={editingActivity.damage?.includeBase}
                                  onCheckedChange={checked => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, includeBase: !!checked } })}
                                />
                            </div>
                            )}
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
                          )}
                          {showsDamageCritical && (
                            <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                              <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <Label className="text-[10px] uppercase text-gold font-bold tracking-widest">Allow Critical Bonus</Label>
                                  <p className="text-[10px] text-ink/40">Native damage activities can opt into extra critical damage.</p>
                                </div>
                                <Checkbox
                                  checked={editingActivity.damage.critical?.allow}
                                  onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                    damage: {
                                      ...editingActivity.damage!,
                                      critical: { ...(editingActivity.damage?.critical || {}), allow: !!checked }
                                    }
                                  })}
                                />
                              </div>
                              <div className="grid gap-1.5">
                                <Label className="label-text-xs-custom">Critical Bonus Formula</Label>
                                <Input
                                  value={editingActivity.damage.critical?.bonus || ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    damage: {
                                      ...editingActivity.damage!,
                                      critical: { ...(editingActivity.damage?.critical || {}), bonus: e.target.value }
                                    }
                                  })}
                                  className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  placeholder="1d8"
                                />
                              </div>
                            </div>
                          )}
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
                            <div className="col-span-2 flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="label-text-xs-custom">Use Caster Spellbook</Label>
                                <p className="text-[10px] text-ink/40">Keep this on for most native cast activities.</p>
                              </div>
                              <Checkbox
                                checked={editingActivity.spell.spellbook}
                                onCheckedChange={checked => updateSpell({ spellbook: !!checked })}
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

                    {editingActivity.roll && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Utility Roll</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-4">
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">Roll Name</Label>
                            <Input
                              value={editingActivity.roll.name || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), name: e.target.value }
                              })}
                              className="bg-background/40 border-gold/10 h-8 text-xs"
                              placeholder="Roll"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="label-text-xs-custom">Formula</Label>
                            <Input
                              value={editingActivity.roll.formula || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), formula: e.target.value }
                              })}
                              className="bg-background/40 border-gold/10 h-8 text-xs font-mono"
                              placeholder="1d20 + @prof"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                            <label className="flex items-center justify-between gap-3">
                              <span className="label-text-xs-custom">Prompt Before Roll</span>
                              <Checkbox
                                checked={editingActivity.roll.prompt}
                                onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                  roll: { ...(editingActivity.roll || {}), prompt: !!checked }
                                })}
                              />
                            </label>
                            <label className="flex items-center justify-between gap-3">
                              <span className="label-text-xs-custom">Visible Chat Button</span>
                              <Checkbox
                                checked={editingActivity.roll.visible}
                                onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                  roll: { ...(editingActivity.roll || {}), visible: !!checked }
                                })}
                              />
                            </label>
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
                          <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Item Type Restriction</Label>
                              <Input
                                value={editingActivity.enchant.restrictions?.type || ''}
                                onChange={e => handleUpdateActivity(editingId!, {
                                  enchant: {
                                    ...editingActivity.enchant!,
                                    restrictions: {
                                      ...(editingActivity.enchant?.restrictions || {}),
                                      type: e.target.value
                                    }
                                  }
                                })}
                                className="bg-background/40 border-gold/10 h-8 text-xs"
                                placeholder="weapon"
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Categories</Label>
                              <Input
                                value={(editingActivity.enchant.restrictions?.categories || []).join(', ')}
                                onChange={e => handleUpdateActivity(editingId!, {
                                  enchant: {
                                    ...editingActivity.enchant!,
                                    restrictions: {
                                      ...(editingActivity.enchant?.restrictions || {}),
                                      categories: parseCsv(e.target.value)
                                    }
                                  }
                                })}
                                className="bg-background/40 border-gold/10 h-8 text-xs"
                                placeholder="martial, focus"
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Properties</Label>
                              <Input
                                value={(editingActivity.enchant.restrictions?.properties || []).join(', ')}
                                onChange={e => handleUpdateActivity(editingId!, {
                                  enchant: {
                                    ...editingActivity.enchant!,
                                    restrictions: {
                                      ...(editingActivity.enchant?.restrictions || {}),
                                      properties: parseCsv(e.target.value)
                                    }
                                  }
                                })}
                                className="bg-background/40 border-gold/10 h-8 text-xs"
                                placeholder="versatile, finesse"
                              />
                            </div>
                            <div className="flex items-center justify-between pt-6">
                              <Label className="label-text-xs-custom">Allow Magical Items</Label>
                              <Checkbox
                                checked={editingActivity.enchant.restrictions?.allowMagical}
                                onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                  enchant: {
                                    ...editingActivity.enchant!,
                                    restrictions: {
                                      ...(editingActivity.enchant?.restrictions || {}),
                                      allowMagical: !!checked
                                    }
                                  }
                                })}
                              />
                            </div>
                          </div>
                          <p className="text-[10px] text-ink/40 border-t border-gold/5 pt-4">
                            Enchantment effects and riders can stay lightweight for now while items and spells are still placeholders.
                          </p>
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
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-6">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Mode</Label>
                              <Select
                                value={editingActivity.summon.mode || '__direct'}
                                onValueChange={val => updateSummon({ mode: val === '__direct' ? '' : val })}
                              >
                                <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__direct">Direct</SelectItem>
                                  {SUMMON_OR_TRANSFORM_MODE_OPTIONS.filter(Boolean).map(option => (
                                    <SelectItem key={option} value={option}>{option.toUpperCase()}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Temp HP</Label>
                              <Input
                                value={editingActivity.summon.tempHP || ''}
                                onChange={e => updateSummon({ tempHP: e.target.value })}
                                className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                placeholder="@mod"
                              />
                            </div>
                            <label className="col-span-2 flex items-center justify-between gap-3">
                              <span className="label-text-xs-custom">Prompt For Placement</span>
                              <Checkbox
                                checked={editingActivity.summon.prompt}
                                onCheckedChange={checked => updateSummon({ prompt: !!checked })}
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Creature Sizes</Label>
                              <Input
                                value={(editingActivity.summon.creatureSizes || []).join(', ')}
                                onChange={e => updateSummon({ creatureSizes: parseCsv(e.target.value) })}
                                className="h-8 bg-background/40 border-gold/10 text-xs"
                                placeholder={CREATURE_SIZE_OPTIONS.join(', ')}
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Creature Types</Label>
                              <Input
                                value={(editingActivity.summon.creatureTypes || []).join(', ')}
                                onChange={e => updateSummon({ creatureTypes: parseCsv(e.target.value) })}
                                className="h-8 bg-background/40 border-gold/10 text-xs"
                                placeholder={CREATURE_TYPE_OPTIONS.slice(0, 4).join(', ')}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 border-t border-gold/5 pt-4">
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Ability Match</Label>
                              <Input
                                value={editingActivity.summon.match?.ability || ''}
                                onChange={e => updateSummon({
                                  match: { ...(editingActivity.summon.match || {}), ability: e.target.value }
                                })}
                                className="h-8 bg-background/40 border-gold/10 text-xs"
                                placeholder="cha"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3 items-end">
                              {['attacks', 'saves', 'proficiency', 'disposition'].map(flag => (
                                <label key={flag} className="flex items-center justify-between gap-2">
                                  <span className="label-text-xs-custom">{flag}</span>
                                  <Checkbox
                                    checked={Boolean((editingActivity.summon.match as Record<string, unknown> | undefined)?.[flag])}
                                    onCheckedChange={checked => updateSummon({
                                      match: { ...(editingActivity.summon.match || {}), [flag]: !!checked }
                                    })}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-4 border-t border-gold/5 pt-4">
                            {['ac', 'hd', 'hp', 'attackDamage', 'saveDamage', 'healing'].map(field => (
                              <div key={field} className="grid gap-1.5">
                                <Label className="label-text-xs-custom">{field}</Label>
                                <Input
                                  value={((editingActivity.summon.bonuses as Record<string, unknown> | undefined)?.[field] as string) || ''}
                                  onChange={e => updateSummon({
                                    bonuses: { ...(editingActivity.summon.bonuses || {}), [field]: e.target.value }
                                  })}
                                  className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  placeholder="+2"
                                />
                              </div>
                            ))}
                          </div>

                          <div className="border-t border-gold/5 pt-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="label-text-custom">Profiles</Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-gold text-[10px] h-8 border border-dashed border-gold/10 hover:bg-gold/5"
                                onClick={() => updateSummon({
                                  profiles: [
                                    ...(editingActivity.summon.profiles || []),
                                    { _id: Math.random().toString(36).substring(2, 11), count: '1', cr: '', level: { min: 0, max: 20 }, name: '', types: [], uuid: null }
                                  ]
                                })}
                              >
                                <Plus className="w-3 h-3 mr-2" /> Add Profile
                              </Button>
                            </div>
                            {(editingActivity.summon.profiles || []).map((profile, idx) => (
                              <div key={profile._id || idx} className="grid grid-cols-6 gap-3 items-end border border-gold/5 rounded p-3">
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Name</Label>
                                  <Input
                                    value={profile.name}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.summon.profiles || [])];
                                      profiles[idx] = { ...profile, name: e.target.value };
                                      updateSummon({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Count</Label>
                                  <Input
                                    value={profile.count}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.summon.profiles || [])];
                                      profiles[idx] = { ...profile, count: e.target.value };
                                      updateSummon({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">CR</Label>
                                  <Input
                                    value={profile.cr}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.summon.profiles || [])];
                                      profiles[idx] = { ...profile, cr: e.target.value };
                                      updateSummon({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">UUID</Label>
                                  <Input
                                    value={profile.uuid || ''}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.summon.profiles || [])];
                                      profiles[idx] = { ...profile, uuid: e.target.value || null };
                                      updateSummon({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Level Range</Label>
                                  <div className="flex gap-2">
                                    <Input
                                      type="number"
                                      value={profile.level.min}
                                      onChange={e => {
                                        const profiles = [...(editingActivity.summon.profiles || [])];
                                        profiles[idx] = { ...profile, level: { ...profile.level, min: parseInt(e.target.value, 10) || 0 } };
                                        updateSummon({ profiles });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-xs text-center"
                                    />
                                    <Input
                                      type="number"
                                      value={profile.level.max}
                                      onChange={e => {
                                        const profiles = [...(editingActivity.summon.profiles || [])];
                                        profiles[idx] = { ...profile, level: { ...profile.level, max: parseInt(e.target.value, 10) || 20 } };
                                        updateSummon({ profiles });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-xs text-center"
                                    />
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-blood hover:text-blood"
                                  onClick={() => updateSummon({
                                    profiles: (editingActivity.summon.profiles || []).filter((_, i) => i !== idx)
                                  })}
                                >
                                  Remove
                                </Button>
                                <div className="col-span-6 grid gap-1.5">
                                  <Label className="label-text-xs-custom">Types</Label>
                                  <Input
                                    value={(profile.types || []).join(', ')}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.summon.profiles || [])];
                                      profiles[idx] = { ...profile, types: parseCsv(e.target.value) };
                                      updateSummon({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs"
                                    placeholder="beast, fey"
                                  />
                                </div>
                              </div>
                            ))}
                            {!(editingActivity.summon.profiles || []).length && (
                              <div className="text-center py-4 text-ink/30 italic text-xs">
                                Monster support is still pending, but profiles can already be authored in a Foundry-like shape.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {editingActivity.transform && (
                      <div className="form-group-custom">
                        <div className="flex items-center justify-between mb-2">
                           <Label className="label-text-custom">Transform</Label>
                        </div>
                        <div className="p-4 border border-gold/10 bg-background/20 rounded space-y-6">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Mode</Label>
                              <Select
                                value={editingActivity.transform.mode || '__direct'}
                                onValueChange={val => updateTransform({ mode: val === '__direct' ? '' : val })}
                              >
                                <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__direct">Direct</SelectItem>
                                  {SUMMON_OR_TRANSFORM_MODE_OPTIONS.filter(Boolean).map(option => (
                                    <SelectItem key={option} value={option}>{option.toUpperCase()}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="label-text-xs-custom">Preset</Label>
                              <Input
                                value={editingActivity.transform.preset || ''}
                                onChange={e => updateTransform({ preset: e.target.value })}
                                className="h-8 bg-background/40 border-gold/10 text-xs"
                                placeholder="wildshape"
                              />
                            </div>
                            <label className="col-span-2 flex items-center justify-between gap-3">
                              <span className="label-text-xs-custom">Customize Settings</span>
                              <Checkbox
                                checked={editingActivity.transform.customize}
                                onCheckedChange={checked => updateTransform({ customize: !!checked })}
                              />
                            </label>
                          </div>

                          <div className="border-t border-gold/5 pt-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="label-text-custom">Profiles</Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-gold text-[10px] h-8 border border-dashed border-gold/10 hover:bg-gold/5"
                                onClick={() => updateTransform({
                                  profiles: [
                                    ...(editingActivity.transform.profiles || []),
                                    { _id: Math.random().toString(36).substring(2, 11), cr: '', level: { min: 0, max: 20 }, movement: [], name: '', sizes: [], types: [], uuid: null }
                                  ]
                                })}
                              >
                                <Plus className="w-3 h-3 mr-2" /> Add Profile
                              </Button>
                            </div>
                            {(editingActivity.transform.profiles || []).map((profile, idx) => (
                              <div key={profile._id || idx} className="grid grid-cols-6 gap-3 items-end border border-gold/5 rounded p-3">
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Name</Label>
                                  <Input
                                    value={profile.name}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.transform?.profiles || [])];
                                      profiles[idx] = { ...profile, name: e.target.value };
                                      updateTransform({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">CR</Label>
                                  <Input
                                    value={profile.cr || ''}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.transform?.profiles || [])];
                                      profiles[idx] = { ...profile, cr: e.target.value };
                                      updateTransform({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">UUID</Label>
                                  <Input
                                    value={profile.uuid || ''}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.transform?.profiles || [])];
                                      profiles[idx] = { ...profile, uuid: e.target.value || null };
                                      updateTransform({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Sizes</Label>
                                  <Input
                                    value={(profile.sizes || []).join(', ')}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.transform?.profiles || [])];
                                      profiles[idx] = { ...profile, sizes: parseCsv(e.target.value) };
                                      updateTransform({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs"
                                    placeholder={CREATURE_SIZE_OPTIONS.join(', ')}
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label className="label-text-xs-custom">Types</Label>
                                  <Input
                                    value={(profile.types || []).join(', ')}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.transform?.profiles || [])];
                                      profiles[idx] = { ...profile, types: parseCsv(e.target.value) };
                                      updateTransform({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs"
                                    placeholder="beast, monstrosity"
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-blood hover:text-blood"
                                  onClick={() => updateTransform({
                                    profiles: (editingActivity.transform?.profiles || []).filter((_, i) => i !== idx)
                                  })}
                                >
                                  Remove
                                </Button>
                                <div className="col-span-3 grid gap-1.5">
                                  <Label className="label-text-xs-custom">Movement</Label>
                                  <Input
                                    value={(profile.movement || []).join(', ')}
                                    onChange={e => {
                                      const profiles = [...(editingActivity.transform?.profiles || [])];
                                      profiles[idx] = { ...profile, movement: parseCsv(e.target.value) };
                                      updateTransform({ profiles });
                                    }}
                                    className="h-8 bg-background/40 border-gold/10 text-xs"
                                    placeholder={MOVEMENT_TYPE_OPTIONS.join(', ')}
                                  />
                                </div>
                                <div className="col-span-3 grid gap-1.5">
                                  <Label className="label-text-xs-custom">Level Range</Label>
                                  <div className="flex gap-2">
                                    <Input
                                      type="number"
                                      value={profile.level.min}
                                      onChange={e => {
                                        const profiles = [...(editingActivity.transform?.profiles || [])];
                                        profiles[idx] = { ...profile, level: { ...profile.level, min: parseInt(e.target.value, 10) || 0 } };
                                        updateTransform({ profiles });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-xs text-center"
                                    />
                                    <Input
                                      type="number"
                                      value={profile.level.max}
                                      onChange={e => {
                                        const profiles = [...(editingActivity.transform?.profiles || [])];
                                        profiles[idx] = { ...profile, level: { ...profile.level, max: parseInt(e.target.value, 10) || 20 } };
                                        updateTransform({ profiles });
                                      }}
                                      className="h-8 bg-background/40 border-gold/10 text-xs text-center"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                            {!(editingActivity.transform.profiles || []).length && (
                              <div className="text-center py-4 text-ink/30 italic text-xs">
                                Transform settings can already be authored in a Foundry-like shape even before actor and monster tooling exists.
                              </div>
                            )}
                          </div>
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

              <div className="dialog-footer flex justify-end shrink-0">
                 <Button
                  onClick={() => setEditingId(null)}
                  className="btn-gold-solid gap-2 px-12 h-10"
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
