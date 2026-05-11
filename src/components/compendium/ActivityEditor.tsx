import React, { useEffect, useState } from 'react';
import {
  Swords, Wand2, Dices, Zap, Sparkles, ArrowRight,
  Heart, Shield, Boxes, RefreshCw, Wrench, Plus,
  Trash2, Info, Timer, Target,
  X,
} from 'lucide-react';
import { ImageUpload } from '../ui/ImageUpload';
import { type FoundryActiveEffect } from './ActiveEffectEditor';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ActivityKind, SemanticActivity } from '../../types/activities';
import { fetchCollection } from '../../lib/d1';
// Shared pickers extracted from the unique-options work, leveraged
// here for searchable selects and multi-select chips.
import SingleSelectSearch from '../ui/SingleSelectSearch';
import EntityPicker from '../ui/EntityPicker';
import ActiveEffectKeyInput from './ActiveEffectKeyInput';

interface ActivityEditorProps {
  activities: SemanticActivity[] | Record<string, SemanticActivity>;
  onChange: (activities: SemanticActivity[]) => void;
  context?: 'feature' | 'spell' | 'item' | 'feat';
  availableEffects?: FoundryActiveEffect[];
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
const FALLBACK_ABILITY_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
const SPELL_PROPERTIES = ['vocal', 'somatic', 'material'];
const RECOVERY_PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'lr',        label: 'Long Rest' },
  { value: 'sr',        label: 'Short Rest' },
  { value: 'day',       label: 'Day' },
  { value: 'dawn',      label: 'Dawn' },
  { value: 'dusk',      label: 'Dusk' },
  { value: 'turn',      label: 'Turn' },
  { value: 'turnStart', label: 'Turn Start' },
  { value: 'turnEnd',   label: 'Turn End' },
  { value: 'round',     label: 'Round' },
  { value: 'recharge',  label: 'Recharge' },
  { value: 'charges',   label: 'Charges' },
];
const RECOVERY_TYPE_OPTIONS = ['recoverAll', 'formula', 'loseAll'];
const TARGET_TYPE_OPTIONS = ['none', 'creature', 'ally', 'enemy', 'object', 'space'];
const TEMPLATE_TYPE_OPTIONS = ['none', 'cone', 'cube', 'cylinder', 'line', 'sphere', 'square'];
const CONSUMPTION_TARGET_TYPES: { value: string; label: string }[] = [
  { value: 'activityUses', label: 'Activity Uses' },
  { value: 'itemUses',     label: 'Item Uses' },
  { value: 'material',     label: 'Material' },
  { value: 'hitDice',      label: 'Hit Dice' },
  { value: 'spellSlots',   label: 'Spell Slots' },
  { value: 'attribute',    label: 'Attribute' },
];
const DAMAGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'acid',        label: 'Acid' },
  { value: 'bludgeoning', label: 'Bludgeoning' },
  { value: 'cold',        label: 'Cold' },
  { value: 'fire',        label: 'Fire' },
  { value: 'force',       label: 'Force' },
  { value: 'lightning',   label: 'Lightning' },
  { value: 'necrotic',    label: 'Necrotic' },
  { value: 'piercing',    label: 'Piercing' },
  { value: 'poison',      label: 'Poison' },
  { value: 'psychic',     label: 'Psychic' },
  { value: 'radiant',     label: 'Radiant' },
  { value: 'slashing',    label: 'Slashing' },
  { value: 'thunder',     label: 'Thunder' },
  { value: 'healing',     label: 'Healing' },
  { value: 'temphp',      label: 'Temp HP' },
];
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

// ── shared form primitives ────────────────────────────────────────────────────

function ActivitySection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 py-2.5">
        <div className="flex-1 border-t border-dashed border-gold/20" />
        <span className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/50 shrink-0 select-none">{label}</span>
        <div className="flex-1 border-t border-dashed border-gold/20" />
      </div>
      <div className="divide-y divide-gold/5">{children}</div>
    </div>
  );
}

function FieldRow({
  label, hint, children, inline = false,
}: {
  label: string; hint?: string; children: React.ReactNode; inline?: boolean;
}) {
  return (
    <div className={cn('flex gap-4 py-2.5', inline ? 'items-center' : 'items-start')}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-ink/75 leading-none">{label}</p>
        {hint && <p className="text-[10px] text-ink/35 mt-1 leading-snug">{hint}</p>}
      </div>
      <div className={inline ? 'shrink-0' : 'w-[220px] shrink-0'}>{children}</div>
    </div>
  );
}

// ── constants ─────────────────────────────────────────────────────────────────

const KIND_DESCRIPTIONS: Record<string, string> = {
  attack:    'Roll to hit a target, then deal damage',
  cast:      'Cast a linked spell from a spellbook',
  check:     'Request an ability check from a creature',
  damage:    'Deal damage without an attack roll',
  enchant:   'Apply magical properties to a held item',
  forward:   'Delegate execution to another activity',
  heal:      'Restore hit points',
  save:      'Force a saving throw, with optional damage',
  summon:    'Conjure creatures into the encounter',
  transform: 'Shift the user into an alternate form',
  utility:   'Perform a custom roll or passive effect',
};

// Which kinds are "primary" (shown first) per context
const PRIMARY_KINDS: Record<NonNullable<ActivityEditorProps['context']>, ActivityKind[]> = {
  feature: ['attack', 'damage', 'save', 'heal', 'utility'],
  spell:   ['attack', 'damage', 'save', 'heal'],
  item:    ['attack', 'damage', 'save', 'heal', 'utility'],
  feat:    ['attack', 'damage', 'save', 'heal', 'utility'],
};

function formatActivationSummary(activity: SemanticActivity): string {
  if (!activity.activation?.type) return '';
  const labels: Record<string, string> = {
    action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction',
    minute: 'Minute', hour: 'Hour', special: 'Special',
  };
  const label = labels[activity.activation.type] ?? activity.activation.type;
  const val = activity.activation.value;
  return val && val > 1 ? `${val} ${label}s` : label;
}

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

export default function ActivityEditor({ activities, onChange, context = 'feature', availableEffects = [] }: ActivityEditorProps) {
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('identity');
  const [activeActivationTab, setActiveActivationTab] = useState('time');
  const [attributes, setAttributes] = useState<{ id: string; identifier?: string; name: string }[]>([]);

  useEffect(() => {
    fetchCollection<{ id: string; identifier?: string; name: string }>('attributes')
      .then(setAttributes)
      .catch(() => {});
  }, []);

  const attrLabel = (id: string): string => {
    const match = attributes.find(a => (a.identifier ?? a.id).toLowerCase() === id.toLowerCase());
    return match?.name ?? FALLBACK_ABILITY_LABELS[id] ?? id.toUpperCase();
  };

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

  const primaryKinds = PRIMARY_KINDS[context];
  const secondaryKinds = ACTIVITY_KINDS.filter(k => !primaryKinds.includes(k.kind));
  const primaryKindEntries = ACTIVITY_KINDS.filter(k => primaryKinds.includes(k.kind));

  return (
    <div className="space-y-3">
      <div className="section-header">
        <h4 className="section-label text-gold">Activities</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsSelectorOpen(true)}
          className="h-7 px-2 gap-1.5 btn-gold"
        >
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>

      {/* Activity list — Foundry-style tree rows */}
      <div className={cn(
        'rounded border overflow-hidden',
        activityList.length > 0 ? 'border-gold/15 bg-background/20' : 'border-dashed border-gold/10',
      )}>
        {activityList.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <Zap className="w-6 h-6 text-gold/15 mb-2" />
            <p className="text-ink/25 italic text-xs">No activities defined</p>
            <p className="text-[10px] text-ink/20 mt-0.5">
              Activities drive the mechanical behaviour of this {context === 'spell' ? 'spell' : context === 'item' ? 'item' : 'feature'}
            </p>
          </div>
        ) : (
          activityList.map((activity, index) => {
            const kindInfo = ACTIVITY_KINDS.find(k => k.kind === activity.kind);
            const KindIcon = kindInfo?.icon || Info;
            const activationLabel = formatActivationSummary(activity);
            const isExternal = activity.img && !activity.img.startsWith('systems/') && !activity.img.startsWith('icons/');

            return (
              <div
                key={activity.id || `activity-${index}`}
                className={cn(
                  'relative group flex items-center gap-2 pl-5 pr-2 py-1.5',
                  'hover:bg-gold/5 cursor-pointer transition-colors',
                  index === 0
                    ? 'border-l-2 border-l-gold/50'
                    : 'border-t border-t-gold/10 border-l-2 border-l-gold/10',
                )}
                onClick={() => setEditingId(activity.id)}
              >
                {/* Tree connector */}
                <span className="absolute left-1.5 top-[9px] text-gold/30 text-[11px] font-bold select-none leading-none">┗</span>

                {/* Icon */}
                <div className="w-6 h-6 shrink-0 rounded border border-gold/20 bg-gold/5 flex items-center justify-center overflow-hidden">
                  {isExternal ? (
                    <img src={activity.img} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <KindIcon className="w-3.5 h-3.5 text-gold/70" />
                  )}
                </div>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold text-ink/85 leading-none">{activity.name}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] uppercase tracking-widest text-ink/30">{kindInfo?.label}</span>
                    {activationLabel && (
                      <>
                        <span className="text-gold/20 leading-none">·</span>
                        <span className="text-[9px] text-ink/30">{activationLabel}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemoveActivity(activity.id); }}
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-ink/20 hover:text-blood opacity-0 group-hover:opacity-100 transition-all rounded"
                  title="Remove activity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Activity type selector */}
      <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
        <DialogContent className="sm:max-w-[440px] bg-card border-gold/20 p-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gold/10">
            <DialogTitle className="dialog-title">Add Activity</DialogTitle>
          </DialogHeader>
          <div className="p-3 overflow-y-auto max-h-[70vh]">
            {/* Primary kinds for this context */}
            <div className="space-y-0.5">
              {primaryKindEntries.map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleAddActivity(kind)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded border border-transparent hover:border-gold/20 hover:bg-gold/5 transition-all text-left group"
                >
                  <div className="w-7 h-7 rounded border border-gold/15 bg-gold/5 flex items-center justify-center shrink-0 group-hover:border-gold/40 group-hover:bg-gold/10 transition-colors">
                    <Icon className="w-4 h-4 text-gold/60 group-hover:text-gold transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink/75 group-hover:text-ink/95 leading-none">{label}</p>
                    <p className="text-[10px] text-ink/30 mt-0.5 leading-snug">{KIND_DESCRIPTIONS[kind]}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Secondary / advanced kinds */}
            {secondaryKinds.length > 0 && (
              <>
                <div className="flex items-center gap-2 my-2.5">
                  <div className="flex-1 border-t border-gold/10" />
                  <span className="text-[9px] uppercase tracking-widest text-ink/25">Advanced</span>
                  <div className="flex-1 border-t border-gold/10" />
                </div>
                <div className="space-y-0.5">
                  {secondaryKinds.map(({ kind, label, icon: Icon }) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => handleAddActivity(kind)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded border border-transparent hover:border-gold/20 hover:bg-gold/5 transition-all text-left group"
                    >
                      <div className="w-6 h-6 rounded border border-gold/10 bg-gold/5 flex items-center justify-center shrink-0 group-hover:border-gold/30 transition-colors">
                        <Icon className="w-3.5 h-3.5 text-gold/40 group-hover:text-gold/70 transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-ink/60 group-hover:text-ink/85 leading-none">{label}</p>
                        <p className="text-[9px] text-ink/25 mt-0.5 leading-snug">{KIND_DESCRIPTIONS[kind]}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingId} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="dialog-content sm:max-w-[95vw] lg:max-w-4xl flex flex-col max-h-[90vh]">
          {editingActivity && (
            <>
              <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-gold/10">
                <div className="flex flex-col gap-3">
                  <DialogTitle className="h1-title text-center text-ink">
                    {editingActivity.name}
                  </DialogTitle>
                  <div className="flex justify-center">
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList variant="line" className="h-auto p-0 gap-8">
                        <TabsTrigger value="identity" className="tab-trigger-custom">
                          <Info className="w-3.5 h-3.5" /> Identity
                        </TabsTrigger>
                        <TabsTrigger value="activation" className="tab-trigger-custom">
                          <Timer className="w-3.5 h-3.5" /> Activation
                        </TabsTrigger>
                        <TabsTrigger value="effect" className="tab-trigger-custom">
                          <Zap className="w-3.5 h-3.5" /> Effect
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="max-w-2xl mx-auto px-8 py-5 pb-10">
                  
                  {activeTab === 'identity' && (
                    <div>
                      {/* ——— ACTIVITY ——— */}
                      <ActivitySection label="Activity">
                        <FieldRow label="Name">
                          <Input
                            value={editingActivity.name}
                            onChange={e => handleUpdateActivity(editingId!, { name: e.target.value })}
                            className="field-input border-gold/15 font-serif"
                          />
                        </FieldRow>
                        <div className="flex gap-4 items-center py-2.5">
                          <p className="text-xs font-semibold text-ink/75 flex-1">Icon</p>
                          <div className="w-14 h-14 shrink-0">
                            <ImageUpload
                              compact
                              imageType="icon"
                              storagePath="icons/activities/"
                              currentImageUrl={editingActivity.img || ''}
                              onUpload={url => handleUpdateActivity(editingId!, { img: url })}
                              className="w-full h-full"
                            />
                          </div>
                        </div>
                        <FieldRow label="Chat Flavor" hint="Extra text appended to this activity's chat message">
                          <Input
                            value={editingActivity.chatFlavor || ''}
                            onChange={e => handleUpdateActivity(editingId!, { chatFlavor: e.target.value })}
                            className="field-input border-gold/15 text-xs"
                            placeholder="Additional context…"
                          />
                        </FieldRow>
                      </ActivitySection>

                      {/* ——— ATTACK ——— */}
                      {editingActivity.kind === 'attack' && (
                        <ActivitySection label="Attack">
                          <FieldRow label="Attack Type" hint="Is this a melee or ranged attack?">
                            <Select
                              value={editingActivity.attack?.type}
                              onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, type: val as any } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="melee">Melee</SelectItem>
                                <SelectItem value="ranged">Ranged</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Classification" hint="Unarmed, weapon, or spell attack?">
                            <Select
                              value={editingActivity.attack?.classification}
                              onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, classification: val as any } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unarmed">Unarmed Attack</SelectItem>
                                <SelectItem value="weapon">Weapon Attack</SelectItem>
                                <SelectItem value="spell">Spell Attack</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Ability Score" hint="Override which ability drives attack and damage rolls">
                            <Select
                              value={editingActivity.attack?.ability || ''}
                              onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, ability: val || undefined } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
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
                          </FieldRow>
                          <FieldRow label="Attack Bonus" hint="Flat bonus formula added on top of the derived roll">
                            <Input
                              value={editingActivity.attack?.bonus || ''}
                              onChange={e => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, bonus: e.target.value } })}
                              className="field-input border-gold/15 font-mono text-xs text-center"
                              placeholder="e.g. +2 or @prof"
                            />
                          </FieldRow>
                          <FieldRow label="Critical Threshold" hint="Minimum natural roll to score a critical hit (default 20)">
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
                              className="field-input border-gold/15 text-center"
                              placeholder="20"
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {/* ——— BEHAVIOR ——— */}
                      {(editingActivity.kind === 'attack' || showsTemplatePrompt) && (
                        <ActivitySection label="Behavior">
                          {editingActivity.kind === 'attack' && (
                            <FieldRow
                              label="Flat Attack"
                              hint="Treat the attack bonus as a complete flat formula rather than adding proficiency and ability"
                              inline
                            >
                              <Checkbox
                                checked={editingActivity.attack?.flat}
                                onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                  attack: { ...editingActivity.attack!, flat: !!checked }
                                })}
                              />
                            </FieldRow>
                          )}
                          {showsTemplatePrompt && (
                            <FieldRow
                              label="Template Prompt"
                              hint="Ask the player to place a measured template before the activity resolves"
                              inline
                            >
                              <Checkbox
                                checked={editingActivity.target?.prompt}
                                onCheckedChange={checked => updateTarget({ prompt: !!checked })}
                              />
                            </FieldRow>
                          )}
                        </ActivitySection>
                      )}

                      {/* ——— VISIBILITY ——— */}
                      <ActivitySection label="Visibility">
                        <FieldRow label="Level Range" hint="Character levels at which this activity is available">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              value={editingActivity.visibility?.level?.min ?? 0}
                              onChange={e => updateSection('visibility', {
                                level: { min: parseInt(e.target.value, 10) || 0, max: editingActivity.visibility?.level?.max ?? 20 }
                              })}
                              className="h-9 w-16 bg-background/40 border-gold/15 text-center text-xs"
                            />
                            <ArrowRight className="w-3 h-3 text-gold/25 shrink-0" />
                            <Input
                              type="number"
                              value={editingActivity.visibility?.level?.max ?? 20}
                              onChange={e => updateSection('visibility', {
                                level: { min: editingActivity.visibility?.level?.min ?? 0, max: parseInt(e.target.value, 10) || 20 }
                              })}
                              className="h-9 w-16 bg-background/40 border-gold/15 text-center text-xs"
                            />
                          </div>
                        </FieldRow>
                        <FieldRow label="Class Identifier" hint="Slug of the class whose level is checked; leave blank to use character level">
                          <Input
                            value={editingActivity.visibility?.identifier || ''}
                            onChange={e => updateSection('visibility', { identifier: e.target.value })}
                            placeholder="e.g. ranger"
                            className="field-input border-gold/15 text-xs font-mono"
                          />
                        </FieldRow>
                      </ActivitySection>
                    </div>
                  )}

                  {activeTab === 'activation' && (
                    <div className="space-y-1">
                      <div className="flex justify-center border-b border-gold/10 mb-1">
                        <Tabs value={activeActivationTab} onValueChange={setActiveActivationTab} className="bg-transparent border-none">
                          <TabsList variant="line" className="h-12 p-0 gap-12">
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
                        <div>
                          <ActivitySection label="ACTIVATION">
                            <FieldRow label="Cost">
                              <Select
                                value={editingActivity.activation?.type}
                                onValueChange={val => updateSection('activation', { type: val })}
                              >
                                <SelectTrigger className="field-input border-gold/15 text-xs">
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
                            </FieldRow>
                            <FieldRow label="Value">
                              <Input
                                type="number"
                                value={editingActivity.activation?.value ?? 1}
                                onChange={e => updateSection('activation', { value: parseInt(e.target.value, 10) || 1 })}
                                className="field-input border-gold/15 text-xs text-center"
                              />
                            </FieldRow>
                            <FieldRow label="Condition" hint="Required condition to trigger this activation">
                              <Input
                                value={editingActivity.activation?.condition || ''}
                                onChange={e => updateSection('activation', { condition: e.target.value })}
                                placeholder="Activation Condition"
                                className="field-input border-gold/15 text-xs"
                              />
                            </FieldRow>
                            <FieldRow label="Override Activation" hint="Use this activity's activation instead of inheriting from a cast/forward source." inline>
                              <Checkbox
                                checked={editingActivity.activation?.override}
                                onCheckedChange={checked => updateSection('activation', { override: !!checked })}
                              />
                            </FieldRow>
                          </ActivitySection>

                          {showsDuration && (
                            <ActivitySection label="DURATION">
                              <FieldRow label="Value">
                                <Input
                                  value={editingActivity.duration?.value || ''}
                                  onChange={e => updateSection('duration', { value: e.target.value })}
                                  className="field-input border-gold/15 text-xs font-mono"
                                  placeholder="1"
                                />
                              </FieldRow>
                              <FieldRow label="Time">
                                <Select
                                  value={editingActivity.duration?.units}
                                  onValueChange={val => updateSection('duration', { units: val })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
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
                              </FieldRow>
                              <FieldRow label="Special">
                                <Input
                                  value={editingActivity.duration?.special || ''}
                                  onChange={e => updateSection('duration', { special: e.target.value })}
                                  className="field-input border-gold/15 text-xs"
                                  placeholder="Special duration text"
                                />
                              </FieldRow>
                              <FieldRow label="Concentration" hint="Creature must maintain concentration while active." inline>
                                <Checkbox
                                  checked={editingActivity.duration?.concentration}
                                  onCheckedChange={checked => updateSection('duration', { concentration: !!checked })}
                                />
                              </FieldRow>
                              <FieldRow label="Override Duration" inline>
                                <Checkbox
                                  checked={editingActivity.duration?.override}
                                  onCheckedChange={checked => updateSection('duration', { override: !!checked })}
                                />
                              </FieldRow>
                            </ActivitySection>
                          )}
                        </div>
                      )}

                      {activeActivationTab === 'consumption' && (
                        <div>
                          <ActivitySection label="SCALING">
                            <FieldRow label="Allow Scaling" hint="Can this activity be activated at higher levels?" inline>
                              <Checkbox
                                checked={editingActivity.consumption?.scaling?.allowed}
                                onCheckedChange={checked => updateConsumptionScaling({
                                  allowed: !!checked,
                                  max: editingActivity.consumption?.scaling?.max || ''
                                })}
                              />
                            </FieldRow>
                            {editingActivity.consumption?.scaling?.allowed && (
                              <FieldRow label="Maximum Formula">
                                <Input
                                  value={editingActivity.consumption?.scaling?.max || ''}
                                  onChange={e => updateConsumptionScaling({ max: e.target.value })}
                                  className="field-input border-gold/15 font-mono text-xs"
                                  placeholder="@item.level or 9"
                                />
                              </FieldRow>
                            )}
                            <FieldRow label="Consume Spell Slot" hint="Native cast activities usually leave this enabled." inline>
                              <Checkbox
                                checked={editingActivity.consumption?.spellSlot}
                                onCheckedChange={checked => updateConsumption({ spellSlot: !!checked })}
                              />
                            </FieldRow>
                          </ActivitySection>

                          <ActivitySection label="USES">
                            <FieldRow label="Spent">
                              <Input
                                type="number"
                                value={editingActivity.uses?.spent || 0}
                                onChange={e => handleUpdateActivity(editingId!, {
                                  uses: { ...editingActivity.uses, spent: parseInt(e.target.value) || 0 }
                                })}
                                className="field-input border-gold/15 text-xs text-center"
                              />
                            </FieldRow>
                            <FieldRow label="Maximum">
                              <Input
                                value={editingActivity.uses?.max || ''}
                                onChange={e => handleUpdateActivity(editingId!, {
                                  uses: { ...editingActivity.uses, max: e.target.value }
                                })}
                                className="field-input border-gold/15 text-xs"
                                placeholder="Formula or number"
                              />
                            </FieldRow>
                          </ActivitySection>

                          <ActivitySection label="RECOVERY">
                            <div className="space-y-2 pb-1">
                              {((editingActivity.uses?.recovery) || []).map((entry, idx) => (
                                <div key={idx} className="flex gap-2 items-center p-2.5 bg-gold/3 border border-gold/8 rounded">
                                  {/* Recovery period — searchable single-pick
                                      (11 entries: long rest, short rest,
                                      day, dawn, dusk, turn variants, round,
                                      recharge, charges). Native <select>
                                      scrolls badly at that length. */}
                                  <SingleSelectSearch
                                    value={entry.period || ''}
                                    onChange={(val) => {
                                      const recovery = [...(editingActivity.uses?.recovery || [])];
                                      recovery[idx] = { ...entry, period: val };
                                      updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                    }}
                                    options={RECOVERY_PERIOD_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                                    placeholder="Period"
                                    triggerClassName="flex-1"
                                  />
                                  <Select
                                    value={entry.type || '__none'}
                                    onValueChange={val => {
                                      const recovery = [...(editingActivity.uses?.recovery || [])];
                                      recovery[idx] = { ...entry, type: val === '__none' ? '' : val };
                                      updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-[10px] bg-background/40 border-gold/10 flex-1">
                                      <SelectValue placeholder="Type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none">None</SelectItem>
                                      {RECOVERY_TYPE_OPTIONS.map(option => (
                                        <SelectItem key={option} value={option}>{option}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    value={entry.formula || ''}
                                    onChange={e => {
                                      const recovery = [...(editingActivity.uses?.recovery || [])];
                                      recovery[idx] = { ...entry, formula: e.target.value };
                                      updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                    }}
                                    className="h-7 text-[10px] font-mono bg-background/40 border-gold/10 flex-1"
                                    placeholder="1d4 or @prof"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const recovery = (editingActivity.uses?.recovery || []).filter((_, i) => i !== idx);
                                      updateCurrent({ uses: { ...(editingActivity.uses || {}), recovery } });
                                    }}
                                    className="text-blood/60 hover:text-blood shrink-0 transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                              {!(editingActivity.uses?.recovery?.length) && (
                                <p className="text-center py-3 text-ink/30 italic text-[10px]">No recovery rules.</p>
                              )}
                              <button
                                type="button"
                                onClick={() => updateCurrent({
                                  uses: {
                                    ...(editingActivity.uses || {}),
                                    recovery: [...(editingActivity.uses?.recovery || []), { period: '', type: '', formula: '' }]
                                  }
                                })}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add Recovery Rule
                              </button>
                            </div>
                          </ActivitySection>

                          <ActivitySection label="CONSUMPTION TARGETS">
                            <div className="space-y-2 pb-1">
                              {(editingActivity.consumption?.targets || []).map((target, idx) => (
                                <div key={idx} className="p-2.5 bg-gold/3 border border-gold/8 rounded space-y-2">
                                  <div className="flex gap-2 items-center">
                                    {/* Consumption target type —
                                        searchable single-pick of the 6
                                        consumption surfaces (Activity
                                        Uses, Item Uses, Material, Hit
                                        Dice, Spell Slots, Attribute). */}
                                    <SingleSelectSearch
                                      value={target.type || ''}
                                      onChange={(val) => {
                                        const targets = [...(editingActivity.consumption?.targets || [])];
                                        targets[idx] = { ...target, type: val };
                                        updateConsumption({ targets });
                                      }}
                                      options={CONSUMPTION_TARGET_TYPES.map(o => ({ id: o.value, name: o.label }))}
                                      placeholder="Type"
                                      triggerClassName="flex-1"
                                    />
                                    <Input
                                      value={target.value || ''}
                                      onChange={e => {
                                        const targets = [...(editingActivity.consumption?.targets || [])];
                                        targets[idx] = { ...target, value: e.target.value };
                                        updateConsumption({ targets });
                                      }}
                                      className="h-7 w-16 text-[10px] font-mono bg-background/40 border-gold/10 text-center"
                                      placeholder="1"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => updateConsumption({
                                        targets: (editingActivity.consumption?.targets || []).filter((_, i) => i !== idx)
                                      })}
                                      className="text-blood/60 hover:text-blood shrink-0 transition-colors"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  {/* Autocomplete-backed target path —
                                      same dnd5e/Midi/DAE catalog the AE
                                      editor uses for its Attribute Key
                                      field. Authors get suggestions for
                                      resource paths, attribute paths,
                                      and module flags rather than having
                                      to remember Foundry's data model. */}
                                  <ActiveEffectKeyInput
                                    value={target.target || ''}
                                    onChange={(next) => {
                                      const targets = [...(editingActivity.consumption?.targets || [])];
                                      targets[idx] = { ...target, target: next };
                                      updateConsumption({ targets });
                                    }}
                                    placeholder="resources.primary.value"
                                  />
                                  <div className="flex gap-2 items-center">
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
                                      <SelectTrigger className="h-7 text-[10px] bg-background/40 border-gold/10 flex-1">
                                        <SelectValue placeholder="No Scaling" />
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
                                      className="h-7 flex-1 text-[10px] font-mono bg-background/40 border-gold/10"
                                      placeholder="@item.level"
                                    />
                                  </div>
                                </div>
                              ))}
                              {!(editingActivity.consumption?.targets?.length) && (
                                <p className="text-center py-3 text-ink/30 italic text-[10px]">No consumption targets.</p>
                              )}
                              <button
                                type="button"
                                onClick={() => updateConsumption({
                                  targets: [
                                    ...(editingActivity.consumption?.targets || []),
                                    { type: '', target: '', value: '', scaling: { mode: '', formula: '' } }
                                  ]
                                })}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add Target
                              </button>
                            </div>
                          </ActivitySection>
                        </div>
                      )}

                      {activeActivationTab === 'targeting' && (
                        <div>
                          {showsRange && (
                            <ActivitySection label="RANGE">
                              <FieldRow label="Unit">
                                <Select
                                  value={editingActivity.range?.units}
                                  onValueChange={val => updateSection('range', { units: val })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
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
                              </FieldRow>
                              <FieldRow label="Value">
                                <Input
                                  value={editingActivity.range?.value || ''}
                                  onChange={e => updateSection('range', { value: e.target.value })}
                                  className="field-input border-gold/15 text-xs font-mono"
                                  placeholder="30"
                                />
                              </FieldRow>
                              <FieldRow label="Special">
                                <Input
                                  value={editingActivity.range?.special || ''}
                                  onChange={e => updateSection('range', { special: e.target.value })}
                                  placeholder="Special Range"
                                  className="field-input border-gold/15 text-xs"
                                />
                              </FieldRow>
                              <FieldRow label="Override Range" hint="Important for cast and forward activities that can inherit another source." inline>
                                <Checkbox
                                  checked={editingActivity.range?.override}
                                  onCheckedChange={checked => updateSection('range', { override: !!checked })}
                                />
                              </FieldRow>
                            </ActivitySection>
                          )}

                          {showsTargeting && (
                            <ActivitySection label="TARGETS">
                              <FieldRow label="Type">
                                <Select
                                  value={editingActivity.target?.affects?.type || 'none'}
                                  onValueChange={val => updateTargetAffects({ type: val === 'none' ? '' : val })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TARGET_TYPE_OPTIONS.map(option => (
                                      <SelectItem key={option} value={option}>{option === 'none' ? 'None' : option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FieldRow>
                              <FieldRow label="Count">
                                <Input
                                  value={editingActivity.target?.affects?.count || ''}
                                  onChange={e => updateTargetAffects({ count: e.target.value })}
                                  className="field-input border-gold/15 text-xs font-mono"
                                  placeholder="1"
                                />
                              </FieldRow>
                              <FieldRow label="Special Targeting">
                                <Input
                                  value={editingActivity.target?.affects?.special || ''}
                                  onChange={e => updateTargetAffects({ special: e.target.value })}
                                  className="field-input border-gold/15 text-xs"
                                  placeholder="Additional target text"
                                />
                              </FieldRow>
                              <FieldRow label="Allow Choice" inline>
                                <Checkbox
                                  checked={editingActivity.target?.affects?.choice}
                                  onCheckedChange={checked => updateTargetAffects({ choice: !!checked })}
                                />
                              </FieldRow>
                            </ActivitySection>
                          )}

                          <ActivitySection label="AREA">
                            <FieldRow label="Shape">
                              <Select
                                value={editingActivity.target?.template?.type || 'none'}
                                onValueChange={val => updateTargetTemplate({ type: val === 'none' ? '' : val })}
                              >
                                <SelectTrigger className="field-input border-gold/15 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEMPLATE_TYPE_OPTIONS.map(option => (
                                    <SelectItem key={option} value={option}>{option === 'none' ? 'None' : option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FieldRow>
                            <FieldRow label="Count">
                              <Input
                                value={editingActivity.target?.template?.count || ''}
                                onChange={e => updateTargetTemplate({ count: e.target.value })}
                                className="field-input border-gold/15 text-xs font-mono"
                                placeholder="1"
                              />
                            </FieldRow>
                            <FieldRow label="Size">
                              <Input
                                value={editingActivity.target?.template?.size || ''}
                                onChange={e => updateTargetTemplate({ size: e.target.value })}
                                className="field-input border-gold/15 text-xs font-mono"
                                placeholder="15"
                              />
                            </FieldRow>
                            <FieldRow label="Units">
                              <Select
                                value={editingActivity.target?.template?.units || 'ft'}
                                onValueChange={val => updateTargetTemplate({ units: val })}
                              >
                                <SelectTrigger className="field-input border-gold/15 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ft">Feet</SelectItem>
                                  <SelectItem value="mi">Miles</SelectItem>
                                </SelectContent>
                              </Select>
                            </FieldRow>
                            <FieldRow label="Width">
                              <Input
                                value={editingActivity.target?.template?.width || ''}
                                onChange={e => updateTargetTemplate({ width: e.target.value })}
                                className="field-input border-gold/15 text-xs font-mono"
                                placeholder="5"
                              />
                            </FieldRow>
                            <FieldRow label="Height">
                              <Input
                                value={editingActivity.target?.template?.height || ''}
                                onChange={e => updateTargetTemplate({ height: e.target.value })}
                                className="field-input border-gold/15 text-xs font-mono"
                                placeholder="5"
                              />
                            </FieldRow>
                            <FieldRow label="Contiguous" inline>
                              <Checkbox
                                checked={editingActivity.target?.template?.contiguous}
                                onCheckedChange={checked => updateTargetTemplate({ contiguous: !!checked })}
                              />
                            </FieldRow>
                            <FieldRow label="Stationary" inline>
                              <Checkbox
                                checked={editingActivity.target?.template?.stationary}
                                onCheckedChange={checked => updateTargetTemplate({ stationary: !!checked })}
                              />
                            </FieldRow>
                            <FieldRow label="Override Target" inline>
                              <Checkbox
                                checked={editingActivity.target?.override}
                                onCheckedChange={checked => updateTarget({ override: !!checked })}
                              />
                            </FieldRow>
                          </ActivitySection>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'effect' && (
                    <div>
                      {/* ── Applied Effects ── */}
                      <ActivitySection label="APPLIED EFFECTS">
                        {availableEffects.length === 0 ? (
                          <p className="text-[10px] text-ink/30 italic py-2 text-center">
                            No effects defined on this feature. Add effects in the Effects tab first.
                          </p>
                        ) : (
                          <div className="space-y-1 pb-1">
                            {availableEffects.map((fx, index) => {
                              const linked = (editingActivity.effects || []).find(e => e._id === fx._id);
                              const toggle = () => {
                                const cur = editingActivity.effects || [];
                                handleUpdateActivity(editingId!, {
                                  effects: linked
                                    ? cur.filter(e => e._id !== fx._id)
                                    : [...cur, { _id: fx._id!, level: { min: null, max: null } }]
                                });
                              };
                              const patchLevel = (patch: { min?: number | null; max?: number | null }) => {
                                const cur = editingActivity.effects || [];
                                handleUpdateActivity(editingId!, {
                                  effects: cur.map(e => e._id === fx._id ? { ...e, level: { ...e.level, ...patch } } : e)
                                });
                              };
                              return (
                                <div key={fx._id || `fx-${index}`} className="flex items-center gap-2 py-1.5">
                                  <button
                                    type="button"
                                    onClick={toggle}
                                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${linked ? 'bg-gold/30 border-gold/60' : 'border-gold/20 hover:border-gold/40'}`}
                                  >
                                    {linked && <svg className="w-2.5 h-2.5 text-gold" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1.5 5l2.5 2.5 4.5-4.5"/></svg>}
                                  </button>
                                  {fx.img && (
                                    <div className="w-5 h-5 rounded border border-gold/15 overflow-hidden shrink-0">
                                      <img src={fx.img} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                                    </div>
                                  )}
                                  <span className={`flex-1 text-xs truncate ${linked ? 'text-ink/85 font-medium' : 'text-ink/40'}`}>{fx.name}</span>
                                  {linked && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="text-[9px] text-ink/30 uppercase tracking-wider">Lvl</span>
                                      <Input
                                        type="number"
                                        value={linked.level?.min ?? ''}
                                        onChange={e => patchLevel({ min: e.target.value === '' ? null : parseInt(e.target.value) })}
                                        className="h-6 w-10 text-[10px] text-center bg-background/40 border-gold/10"
                                        placeholder="—"
                                      />
                                      <span className="text-[9px] text-ink/20">–</span>
                                      <Input
                                        type="number"
                                        value={linked.level?.max ?? ''}
                                        onChange={e => patchLevel({ max: e.target.value === '' ? null : parseInt(e.target.value) })}
                                        className="h-6 w-10 text-[10px] text-center bg-background/40 border-gold/10"
                                        placeholder="—"
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </ActivitySection>

                      {(editingActivity.save || editingActivity.check) && (
                        <ActivitySection label={editingActivity.save ? 'SAVING THROW' : 'ABILITY CHECK'}>
                          {editingActivity.save && (
                            <FieldRow label="Abilities">
                              <div className="flex flex-wrap gap-1">
                                {ABILITY_OPTIONS.map(ab => {
                                  const active = (editingActivity.save!.abilities || []).includes(ab);
                                  return (
                                    <button
                                      key={ab}
                                      type="button"
                                      onClick={() => {
                                        const cur = editingActivity.save!.abilities || [];
                                        handleUpdateActivity(editingId!, {
                                          save: { ...editingActivity.save!, abilities: active ? cur.filter(a => a !== ab) : [...cur, ab] }
                                        });
                                      }}
                                      className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border transition-colors ${active ? 'bg-gold/20 border-gold/50 text-ink/90' : 'bg-transparent border-gold/15 text-ink/35 hover:border-gold/30'}`}
                                    >
                                      {ab}
                                    </button>
                                  );
                                })}
                              </div>
                            </FieldRow>
                          )}
                          {editingActivity.check && (
                            <>
                              <FieldRow label="Ability">
                                <Select
                                  value={editingActivity.check.ability}
                                  onValueChange={val => handleUpdateActivity(editingId!, {
                                    check: { ...editingActivity.check!, ability: val }
                                  })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ABILITY_OPTIONS.map(ability => (
                                      <SelectItem key={ability} value={ability}>{attrLabel(ability)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FieldRow>
                              <FieldRow label="Associated Checks" hint="Comma-separated skill keys">
                                <Input
                                  value={(editingActivity.check.associated || []).join(', ')}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    check: { ...editingActivity.check!, associated: parseCsv(e.target.value) }
                                  })}
                                  className="field-input border-gold/15 font-mono text-xs"
                                  placeholder="arc, inv, thieves"
                                />
                              </FieldRow>
                            </>
                          )}
                          <FieldRow label="DC Mode">
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
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="initial">Item Default</SelectItem>
                                <SelectItem value="spellcasting">Spellcasting DC</SelectItem>
                                <SelectItem value="__formula">Flat / Formula</SelectItem>
                                {ABILITY_OPTIONS.map(ability => (
                                  <SelectItem key={ability} value={ability}>{ability.toUpperCase()} Save</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="DC Formula" hint="10, or @abilities.int.dc">
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
                              className="field-input border-gold/15 font-mono text-xs"
                              placeholder="10, or @abilities.int.dc"
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {(editingActivity.damage || editingActivity.healing) && (
                        <ActivitySection label={editingActivity.healing ? 'HEALING' : 'DAMAGE'}>
                          <div className="py-2 space-y-3">
                            {(editingActivity.damage?.parts || editingActivity.healing?.parts || []).map((part, idx) => (
                              <div key={idx} className="p-3 border border-gold/8 bg-gold/3 rounded relative group">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-gold/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => {
                                    const key = editingActivity.healing ? 'healing' : 'damage';
                                    const obj = editingActivity[key] as any;
                                    handleUpdateActivity(editingId!, { [key]: { ...obj, parts: obj.parts.filter((_: any, i: number) => i !== idx) } });
                                  }}
                                >
                                  <Trash2 className="h-3 w-3 text-red-400" />
                                </Button>
                                <div className="grid grid-cols-12 gap-3 mb-3">
                                  <div className="col-span-2">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Num</p>
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
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Die</p>
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
                                        {[4,6,8,10,12,20,100].map(d => (
                                          <SelectItem key={d} value={String(d)}>d{d}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="col-span-3">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Bonus</p>
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
                                  <div className="col-span-12 mt-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1.5">Damage Types</p>
                                    {/* Damage types — searchable
                                        multi-select with removable chips,
                                        replacing the previous 15-button
                                        toggle grid. Better at scale and
                                        matches the picker pattern used
                                        elsewhere in the app. */}
                                    <EntityPicker
                                      entities={DAMAGE_TYPE_OPTIONS.map(dt => ({ id: dt.value, name: dt.label }))}
                                      selectedIds={part.types || []}
                                      onChange={(nextTypes) => {
                                        const dmgKey = editingActivity.healing ? 'healing' : 'damage';
                                        const obj = editingActivity[dmgKey] as any;
                                        const newParts = [...obj.parts];
                                        newParts[idx] = { ...part, types: nextTypes };
                                        handleUpdateActivity(editingId!, { [dmgKey]: { ...obj, parts: newParts } });
                                      }}
                                      searchPlaceholder="Search damage types…"
                                      maxHeightClass="max-h-32"
                                      showChips
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 border-t border-gold/5 pt-2.5">
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
                                  <Label htmlFor={`custom-${idx}`} className="text-[9px] uppercase text-ink/60 font-black tracking-widest">Custom Formula</Label>
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
                                      className="h-7 flex-1 bg-background/40 border-gold/10 text-[9px] font-mono"
                                      placeholder="Formula..."
                                    />
                                  )}
                                </div>
                                <div className="grid grid-cols-12 gap-2 border-t border-gold/5 mt-2.5 pt-2.5">
                                  <div className="col-span-4">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Scaling Mode</p>
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
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Scaling Dice / Formula</p>
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
                              <button
                                type="button"
                                onClick={() => {
                                  const obj = editingActivity.damage as any;
                                  handleUpdateActivity(editingId!, { damage: { ...obj, parts: [...(obj?.parts || []), { types: [''] }] } });
                                }}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add Damage Part
                              </button>
                            )}
                            {editingActivity.healing && (
                              <p className="text-[10px] text-ink/40 border border-dashed border-gold/10 rounded p-3">
                                Foundry heal activities use a single healing roll. This editor keeps one primary healing part.
                              </p>
                            )}
                          </div>
                          {showsBaseDamageToggle && (
                            <FieldRow label="Base Item Damage" inline>
                              <Checkbox
                                checked={editingActivity.damage?.includeBase}
                                onCheckedChange={checked => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, includeBase: !!checked } })}
                              />
                            </FieldRow>
                          )}
                          {editingActivity.kind === 'save' && editingActivity.damage && (
                            <FieldRow label="On Save">
                              <Select
                                value={editingActivity.damage.onSave}
                                onValueChange={val => handleUpdateActivity(editingId!, {
                                  damage: { ...editingActivity.damage!, onSave: val }
                                })}
                              >
                                <SelectTrigger className="field-input border-gold/15 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="half">Half Damage</SelectItem>
                                  <SelectItem value="none">No Damage</SelectItem>
                                </SelectContent>
                              </Select>
                            </FieldRow>
                          )}
                          {showsDamageCritical && (
                            <>
                              <FieldRow label="Allow Critical Bonus" hint="Native damage activities can opt into extra critical damage." inline>
                                <Checkbox
                                  checked={editingActivity.damage!.critical?.allow}
                                  onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                    damage: { ...editingActivity.damage!, critical: { ...(editingActivity.damage?.critical || {}), allow: !!checked } }
                                  })}
                                />
                              </FieldRow>
                              <FieldRow label="Critical Bonus Formula">
                                <Input
                                  value={editingActivity.damage!.critical?.bonus || ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    damage: { ...editingActivity.damage!, critical: { ...(editingActivity.damage?.critical || {}), bonus: e.target.value } }
                                  })}
                                  className="field-input border-gold/15 text-xs font-mono"
                                  placeholder="1d8"
                                />
                              </FieldRow>
                            </>
                          )}
                        </ActivitySection>
                      )}

                      {editingActivity.spell && (
                        <ActivitySection label="SPELLCASTING">
                          <FieldRow label="Spell UUID">
                            <Input
                              value={editingActivity.spell.uuid || ''}
                              placeholder="Item.FoundrySpellId"
                              onChange={e => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, uuid: e.target.value }
                              })}
                              className="field-input border-gold/15 text-xs font-mono"
                            />
                          </FieldRow>
                          <FieldRow label="Ability Override">
                            <Select
                              value={editingActivity.spell.ability || ''}
                              onValueChange={val => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, ability: val }
                              })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
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
                          </FieldRow>
                          <FieldRow label="Cast Level Override">
                            <Input
                              type="number"
                              value={editingActivity.spell.level || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, level: parseInt(e.target.value) || null }
                              })}
                              className="field-input border-gold/15 text-xs text-center"
                            />
                          </FieldRow>
                          <FieldRow label="Use Caster Spellbook" hint="Keep this on for most native cast activities." inline>
                            <Checkbox
                              checked={editingActivity.spell.spellbook}
                              onCheckedChange={checked => updateSpell({ spellbook: !!checked })}
                            />
                          </FieldRow>
                          <FieldRow label="Challenge Overrides" inline>
                            <Checkbox
                              checked={editingActivity.spell.challenge?.override}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, override: !!checked } }
                              })}
                            />
                          </FieldRow>
                          {editingActivity.spell.challenge?.override && (
                            <>
                              <FieldRow label="Override Attack Bonus">
                                <Input
                                  type="number"
                                  value={editingActivity.spell.challenge.attack || ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, attack: parseInt(e.target.value) || null } }
                                  })}
                                  className="field-input border-gold/15 text-xs text-center"
                                />
                              </FieldRow>
                              <FieldRow label="Override Save DC">
                                <Input
                                  type="number"
                                  value={editingActivity.spell.challenge.save || ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, save: parseInt(e.target.value) || null } }
                                  })}
                                  className="field-input border-gold/15 text-xs text-center"
                                />
                              </FieldRow>
                            </>
                          )}
                          <FieldRow label="Spell Properties">
                            <div className="flex items-center gap-4">
                              {['vocal', 'somatic', 'material'].map(prop => (
                                <label key={prop} className="flex items-center gap-2 cursor-pointer">
                                  <Checkbox
                                    checked={(editingActivity.spell!.properties || []).includes(prop)}
                                    onCheckedChange={checked => {
                                      const props = editingActivity.spell!.properties || [];
                                      handleUpdateActivity(editingId!, { spell: { ...editingActivity.spell!, properties: checked ? [...props, prop] : props.filter(p => p !== prop) } });
                                    }}
                                  />
                                  <span className="text-[9px] uppercase font-black text-ink/60">{prop[0].toUpperCase()}</span>
                                </label>
                              ))}
                            </div>
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {editingActivity.roll && (
                        <ActivitySection label="UTILITY ROLL">
                          <FieldRow label="Roll Name">
                            <Input
                              value={editingActivity.roll.name || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), name: e.target.value }
                              })}
                              className="field-input border-gold/15 text-xs"
                              placeholder="Roll"
                            />
                          </FieldRow>
                          <FieldRow label="Formula">
                            <Input
                              value={editingActivity.roll.formula || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), formula: e.target.value }
                              })}
                              className="field-input border-gold/15 text-xs font-mono"
                              placeholder="1d20 + @prof"
                            />
                          </FieldRow>
                          <FieldRow label="Prompt Before Roll" inline>
                            <Checkbox
                              checked={editingActivity.roll.prompt}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), prompt: !!checked }
                              })}
                            />
                          </FieldRow>
                          <FieldRow label="Visible Chat Button" inline>
                            <Checkbox
                              checked={editingActivity.roll.visible}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), visible: !!checked }
                              })}
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {editingActivity.enchant && (
                        <ActivitySection label="ENCHANTMENT">
                          <FieldRow label="Enchant Self" hint="Target self instead of another item." inline>
                            <Checkbox
                              checked={editingActivity.enchant.self}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                enchant: { ...editingActivity.enchant!, self: !!checked }
                              })}
                            />
                          </FieldRow>
                          <FieldRow label="Item Type">
                            <Input
                              value={editingActivity.enchant.restrictions?.type || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                enchant: { ...editingActivity.enchant!, restrictions: { ...(editingActivity.enchant?.restrictions || {}), type: e.target.value } }
                              })}
                              className="field-input border-gold/15 text-xs"
                              placeholder="weapon"
                            />
                          </FieldRow>
                          <FieldRow label="Categories" hint="Comma-separated">
                            <Input
                              value={(editingActivity.enchant.restrictions?.categories || []).join(', ')}
                              onChange={e => handleUpdateActivity(editingId!, {
                                enchant: { ...editingActivity.enchant!, restrictions: { ...(editingActivity.enchant?.restrictions || {}), categories: parseCsv(e.target.value) } }
                              })}
                              className="field-input border-gold/15 text-xs"
                              placeholder="martial, focus"
                            />
                          </FieldRow>
                          <FieldRow label="Properties" hint="Comma-separated">
                            <Input
                              value={(editingActivity.enchant.restrictions?.properties || []).join(', ')}
                              onChange={e => handleUpdateActivity(editingId!, {
                                enchant: { ...editingActivity.enchant!, restrictions: { ...(editingActivity.enchant?.restrictions || {}), properties: parseCsv(e.target.value) } }
                              })}
                              className="field-input border-gold/15 text-xs"
                              placeholder="versatile, finesse"
                            />
                          </FieldRow>
                          <FieldRow label="Allow Magical Items" inline>
                            <Checkbox
                              checked={editingActivity.enchant.restrictions?.allowMagical}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                enchant: { ...editingActivity.enchant!, restrictions: { ...(editingActivity.enchant?.restrictions || {}), allowMagical: !!checked } }
                              })}
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {editingActivity.activity && (
                        <ActivitySection label="FORWARD EXECUTION">
                          <FieldRow label="Target Activity">
                            <Select
                              value={editingActivity.activity.id}
                              onValueChange={val => handleUpdateActivity(editingId!, { activity: { id: val } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
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
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {editingActivity.summon && (
                        <ActivitySection label="SUMMON">
                          <FieldRow label="Mode">
                            <Select
                              value={editingActivity.summon.mode || '__direct'}
                              onValueChange={val => updateSummon({ mode: val === '__direct' ? '' : val })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__direct">Direct</SelectItem>
                                {SUMMON_OR_TRANSFORM_MODE_OPTIONS.filter(Boolean).map(option => (
                                  <SelectItem key={option} value={option}>{option.toUpperCase()}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Temp HP">
                            <Input
                              value={editingActivity.summon.tempHP || ''}
                              onChange={e => updateSummon({ tempHP: e.target.value })}
                              className="field-input border-gold/15 text-xs font-mono"
                              placeholder="@mod"
                            />
                          </FieldRow>
                          <FieldRow label="Prompt For Placement" inline>
                            <Checkbox
                              checked={editingActivity.summon.prompt}
                              onCheckedChange={checked => updateSummon({ prompt: !!checked })}
                            />
                          </FieldRow>
                          <FieldRow label="Creature Sizes" hint="Comma-separated">
                            <Input
                              value={(editingActivity.summon.creatureSizes || []).join(', ')}
                              onChange={e => updateSummon({ creatureSizes: parseCsv(e.target.value) })}
                              className="field-input border-gold/15 text-xs"
                              placeholder={CREATURE_SIZE_OPTIONS.join(', ')}
                            />
                          </FieldRow>
                          <FieldRow label="Creature Types" hint="Comma-separated">
                            <Input
                              value={(editingActivity.summon.creatureTypes || []).join(', ')}
                              onChange={e => updateSummon({ creatureTypes: parseCsv(e.target.value) })}
                              className="field-input border-gold/15 text-xs"
                              placeholder={CREATURE_TYPE_OPTIONS.slice(0, 4).join(', ')}
                            />
                          </FieldRow>
                          <FieldRow label="Ability Match">
                            <Input
                              value={editingActivity.summon.match?.ability || ''}
                              onChange={e => updateSummon({ match: { ...(editingActivity.summon.match || {}), ability: e.target.value } })}
                              className="field-input border-gold/15 text-xs"
                              placeholder="cha"
                            />
                          </FieldRow>
                          <FieldRow label="Match Flags">
                            <div className="flex flex-wrap gap-3">
                              {['attacks', 'saves', 'proficiency', 'disposition'].map(flag => (
                                <label key={flag} className="flex items-center gap-1.5 cursor-pointer">
                                  <Checkbox
                                    checked={Boolean((editingActivity.summon.match as Record<string, unknown> | undefined)?.[flag])}
                                    onCheckedChange={checked => updateSummon({ match: { ...(editingActivity.summon.match || {}), [flag]: !!checked } })}
                                  />
                                  <span className="text-[9px] uppercase font-black text-ink/60">{flag}</span>
                                </label>
                              ))}
                            </div>
                          </FieldRow>
                          <FieldRow label="Bonuses">
                            <div className="grid grid-cols-3 gap-2">
                              {['ac', 'hd', 'hp', 'attackDamage', 'saveDamage', 'healing'].map(field => (
                                <div key={field}>
                                  <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">{field}</p>
                                  <Input
                                    value={((editingActivity.summon.bonuses as Record<string, unknown> | undefined)?.[field] as string) || ''}
                                    onChange={e => updateSummon({ bonuses: { ...(editingActivity.summon.bonuses || {}), [field]: e.target.value } })}
                                    className="h-7 bg-background/40 border-gold/10 text-[9px] font-mono"
                                    placeholder="+2"
                                  />
                                </div>
                              ))}
                            </div>
                          </FieldRow>
                          <div className="py-2">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-ink/75">Profiles</p>
                              <button
                                type="button"
                                onClick={() => updateSummon({
                                  profiles: [
                                    ...(editingActivity.summon.profiles || []),
                                    { _id: Math.random().toString(36).substring(2, 11), count: '1', cr: '', level: { min: 0, max: 20 }, name: '', types: [], uuid: null }
                                  ]
                                })}
                                className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(editingActivity.summon.profiles || []).map((profile, idx) => (
                                <div key={profile._id || idx} className="grid grid-cols-6 gap-2 items-end p-2.5 bg-gold/3 border border-gold/8 rounded">
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Name</p>
                                    <Input value={profile.name} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,name:e.target.value}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Count</p>
                                    <Input value={profile.count} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,count:e.target.value}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">CR</p>
                                    <Input value={profile.cr} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,cr:e.target.value}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">UUID</p>
                                    <Input value={profile.uuid||''} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,uuid:e.target.value||null}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Level</p>
                                    <div className="flex gap-1">
                                      <Input type="number" value={profile.level.min} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,level:{...profile.level,min:parseInt(e.target.value,10)||0}}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs text-center" />
                                      <Input type="number" value={profile.level.max} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,level:{...profile.level,max:parseInt(e.target.value,10)||20}}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs text-center" />
                                    </div>
                                  </div>
                                  <button type="button" onClick={() => updateSummon({ profiles: (editingActivity.summon.profiles||[]).filter((_,i)=>i!==idx) })} className="h-7 flex items-center justify-center text-blood/60 hover:text-blood transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="col-span-6 grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Types</p>
                                    <Input value={(profile.types||[]).join(', ')} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,types:parseCsv(e.target.value)}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs" placeholder="beast, fey" />
                                  </div>
                                </div>
                              ))}
                              {!(editingActivity.summon.profiles||[]).length && (
                                <p className="text-center py-3 text-ink/30 italic text-[10px]">Monster support is still pending, but profiles can already be authored.</p>
                              )}
                            </div>
                          </div>
                        </ActivitySection>
                      )}

                      {editingActivity.transform && (
                        <ActivitySection label="TRANSFORM">
                          <FieldRow label="Mode">
                            <Select
                              value={editingActivity.transform.mode || '__direct'}
                              onValueChange={val => updateTransform({ mode: val === '__direct' ? '' : val })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__direct">Direct</SelectItem>
                                {SUMMON_OR_TRANSFORM_MODE_OPTIONS.filter(Boolean).map(option => (
                                  <SelectItem key={option} value={option}>{option.toUpperCase()}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Preset">
                            <Input
                              value={editingActivity.transform.preset || ''}
                              onChange={e => updateTransform({ preset: e.target.value })}
                              className="field-input border-gold/15 text-xs"
                              placeholder="wildshape"
                            />
                          </FieldRow>
                          <FieldRow label="Customize Settings" inline>
                            <Checkbox
                              checked={editingActivity.transform.customize}
                              onCheckedChange={checked => updateTransform({ customize: !!checked })}
                            />
                          </FieldRow>
                          <div className="py-2">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-ink/75">Profiles</p>
                              <button
                                type="button"
                                onClick={() => updateTransform({
                                  profiles: [
                                    ...(editingActivity.transform.profiles || []),
                                    { _id: Math.random().toString(36).substring(2, 11), cr: '', level: { min: 0, max: 20 }, movement: [], name: '', sizes: [], types: [], uuid: null }
                                  ]
                                })}
                                className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(editingActivity.transform.profiles || []).map((profile, idx) => (
                                <div key={profile._id || idx} className="grid grid-cols-6 gap-2 items-end p-2.5 bg-gold/3 border border-gold/8 rounded">
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Name</p>
                                    <Input value={profile.name} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,name:e.target.value}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">CR</p>
                                    <Input value={profile.cr||''} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,cr:e.target.value}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">UUID</p>
                                    <Input value={profile.uuid||''} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,uuid:e.target.value||null}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Sizes</p>
                                    <Input value={(profile.sizes||[]).join(', ')} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,sizes:parseCsv(e.target.value)}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs" placeholder={CREATURE_SIZE_OPTIONS.join(', ')} />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Types</p>
                                    <Input value={(profile.types||[]).join(', ')} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,types:parseCsv(e.target.value)}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs" placeholder="beast" />
                                  </div>
                                  <button type="button" onClick={() => updateTransform({ profiles: (editingActivity.transform?.profiles||[]).filter((_,i)=>i!==idx) })} className="h-7 flex items-center justify-center text-blood/60 hover:text-blood transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="col-span-3 grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Movement</p>
                                    <Input value={(profile.movement||[]).join(', ')} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,movement:parseCsv(e.target.value)}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs" placeholder={MOVEMENT_TYPE_OPTIONS.join(', ')} />
                                  </div>
                                  <div className="col-span-3 grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest">Level Range</p>
                                    <div className="flex gap-2">
                                      <Input type="number" value={profile.level.min} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,level:{...profile.level,min:parseInt(e.target.value,10)||0}}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs text-center" />
                                      <Input type="number" value={profile.level.max} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,level:{...profile.level,max:parseInt(e.target.value,10)||20}}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/10 text-xs text-center" />
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {!(editingActivity.transform.profiles||[]).length && (
                                <p className="text-center py-3 text-ink/30 italic text-[10px]">Transform settings can already be authored in a Foundry-like shape.</p>
                              )}
                            </div>
                          </div>
                        </ActivitySection>
                      )}

                      <div className="py-10 border border-dashed border-gold/10 rounded flex flex-col items-center justify-center text-center opacity-40 mx-1">
                        <Zap className="w-8 h-8 text-gold/10 mb-2" />
                        <p className="text-[10px] uppercase font-serif tracking-widest">Advanced Logic Flow coming soon</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

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
          @apply data-active:bg-transparent data-active:shadow-none data-active:text-gold data-active:border-b-2 data-active:border-gold rounded-none h-auto pb-2 px-2 text-[10px] font-black uppercase tracking-widest gap-2 flex items-center transition-all opacity-40 data-active:opacity-100 after:hidden;
        }
        .tab-trigger-custom-small {
          @apply data-active:bg-transparent data-active:shadow-none data-active:text-gold data-active:border-b-2 data-active:border-gold rounded-none h-12 px-0 text-[9px] font-black uppercase tracking-[0.2em] gap-2 flex items-center transition-all opacity-30 data-active:opacity-100 after:hidden;
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
