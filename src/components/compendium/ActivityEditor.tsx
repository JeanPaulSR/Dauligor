import React, { useEffect, useState } from 'react';
import {
  Swords, Wand2, Dices, Zap, Sparkles, ArrowRight,
  Heart, Shield, Boxes, RefreshCw, Wrench, Plus,
  Trash2, Info, Timer, Target, Minus, Settings, ChevronDown,
} from 'lucide-react';
import { ImageUpload } from '../ui/ImageUpload';
import { type FoundryActiveEffect } from './ActiveEffectEditor';
import { cn, makeFoundryId } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ActivityKind, SemanticActivity } from '../../types/activities';
import { fetchCollection } from '../../lib/d1';
// Shared pickers extracted from the unique-options work, leveraged
// here for searchable selects and multi-select chips.
import SingleSelectSearch from '../ui/SingleSelectSearch';
import EntityPicker from '../ui/EntityPicker';
import ActiveEffectKeyInput from './ActiveEffectKeyInput';
// Sub-components + shared primitives/constants for the activity
// editor. Each lives in `./activity/` so the file stays browsable;
// see DamagePartEditor for the canonical example.
import { ActivitySection, FieldRow, EmptyRow } from './activity/primitives';
import DamagePartEditor from './activity/DamagePartEditor';
import ActivationDurationEditor from './activity/ActivationDurationEditor';
import RangeTargetingEditor from './activity/RangeTargetingEditor';
import ConsumptionTabEditor from './activity/ConsumptionTabEditor';
import {
  ABILITY_OPTIONS,
  FALLBACK_ABILITY_LABELS,
  SPELL_PROPERTIES,
  RECOVERY_PERIOD_OPTIONS,
  RECOVERY_TYPE_OPTIONS,
  TARGET_TYPE_OPTIONS,
  TEMPLATE_TYPE_OPTIONS,
  CONSUMPTION_TARGET_TYPES,
  DAMAGE_TYPE_OPTIONS,
  HEALING_TYPE_OPTIONS,
  SCALING_MODE_OPTIONS,
  SUMMON_OR_TRANSFORM_MODE_OPTIONS,
  MOVEMENT_TYPE_OPTIONS,
  CREATURE_SIZE_OPTIONS,
  CREATURE_TYPE_OPTIONS,
  parseCsv,
  parseNullableInteger,
} from './activity/constants';

interface ActivityEditorProps {
  activities: SemanticActivity[] | Record<string, SemanticActivity>;
  onChange: (activities: SemanticActivity[]) => void;
  context?: 'feature' | 'spell' | 'item' | 'feat';
  availableEffects?: FoundryActiveEffect[];
  /**
   * Lets the activity's Applied Effects section create / rename / delete the
   * parent's Active Effects — Foundry's add/delete-effect controls. Wire the
   * SAME setter the host gives <ActiveEffectEditor> (the `effects` array on the
   * feature). Omitted ⇒ Applied Effects is associate-only (no authoring).
   */
  onAvailableEffectsChange?: (effects: FoundryActiveEffect[]) => void;
  /** Icon seeded onto effects created from the Applied Effects ➕ (parent's icon). */
  defaultEffectImg?: string | null;
  /**
   * Candidate entities an "Item Uses" consumption target can draw from —
   * forwarded to ConsumptionTabEditor. Hosts supply the context-appropriate
   * list (class features with uses in ClassEditor; sibling option items in
   * the option-group editor; …). Omitted ⇒ the target stays a free-text path.
   */
  itemTargets?: { id: string; name: string; hint?: string }[];
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

// Option catalogs + parseCsv/parseNullableInteger helpers live in
// `./activity/constants.ts`. Imported above. Slug values match
// Foundry's dnd5e key conventions so the export round-trips
// cleanly; the editor only ever shows labels to the author.


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

const sanitizeActivity = (activity: SemanticActivity): SemanticActivity => {
  const sanitized: SemanticActivity = { ...activity };

  // `visibility.{requireAttunement,requireIdentification,requireMagic}`
  // round-trip cleanly from Foundry dnd5e v5 — see
  // E:/DnD/Professional/Foundry-JSON/windows/activity-*.json for the
  // canonical shape. They used to be stripped here (pre-2026-05-24)
  // because the editor didn't surface them; now that the Visibility
  // section has checkboxes for each, the values flow through.

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

export default function ActivityEditor({ activities, onChange, context = 'feature', availableEffects = [], onAvailableEffectsChange, defaultEffectImg, itemTargets = [] }: ActivityEditorProps) {
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('identity');
  const [activeActivationTab, setActiveActivationTab] = useState('time');
  // Which applied-effect's "Additional Settings" tray is open (Foundry shows one
  // collapsible per effect; we track the single open one by effect id).
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<{ id: string; identifier?: string; name: string }[]>([]);
  // Classes drive the Visibility › Class Identifier picker (was a
  // free-text slug input — authors now pick from the seeded classes
  // list instead of remembering "ranger" / "warlock" / etc.). Lazily
  // fetched on mount; d1.ts caches the response so multiple
  // ActivityEditor instances on the same page only hit D1 once.
  const [classes, setClasses] = useState<{ id: string; identifier?: string; name: string }[]>([]);
  // Damage types are admin-managed (Proficiencies › Damage Types → the
  // `damage_types` table). The damage-part Type dropdown reads them live so
  // homebrew types appear without a code change; falls back to the bundled
  // DAMAGE_TYPE_OPTIONS list if the table hasn't been seeded.
  const [damageTypeRows, setDamageTypeRows] = useState<{ id: string; identifier?: string; name: string; order?: number }[]>([]);

  useEffect(() => {
    fetchCollection<{ id: string; identifier?: string; name: string }>('attributes')
      .then(setAttributes)
      .catch(() => {});
    fetchCollection<{ id: string; identifier?: string; name: string }>('classes', { orderBy: 'name ASC' })
      .then(setClasses)
      .catch(() => {});
    fetchCollection<{ id: string; identifier?: string; name: string; order?: number }>('damageTypes')
      .then(setDamageTypeRows)
      .catch(() => {});
  }, []);

  const attrLabel = (id: string): string => {
    const match = attributes.find(a => (a.identifier ?? a.id).toLowerCase() === id.toLowerCase());
    return match?.name ?? FALLBACK_ABILITY_LABELS[id] ?? id.toUpperCase();
  };

  // Damage-type options for the damage-part Type dropdown: admin-managed
  // `damage_types` rows when present, else the bundled DAMAGE_TYPE_OPTIONS so
  // authoring still works unseeded. The value is normalized to lowercase so it
  // matches Foundry's `CONFIG.DND5E.damageTypes` keys (the slugs are canonically
  // lowercase, and existing items/the export expect `acid`/`fire`/… — the table
  // currently seeds some identifiers uppercase, which would otherwise mismatch).
  const damageTypeOptions = damageTypeRows.length
    ? [...damageTypeRows]
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name))
        .map(d => ({ value: (d.identifier || d.id).toLowerCase(), label: d.name }))
    : DAMAGE_TYPE_OPTIONS;

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
    // 16-char alphanumeric id matching dnd5e 5.x's PseudoDocument
    // validator. Previously this used `makeFoundryId()`
    // which produced 9-char ids and made the embed fail at import time
    // with "must be a valid 16-character alphanumeric ID". See
    // `makeFoundryId` in lib/utils for the alphabet definition.
    const id = makeFoundryId();
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
        level: { min: null, max: null }
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
      newActivity.damage = { parts: [], includeBase: true, critical: { allow: false, bonus: '' } };
    } else if (kind === 'check') {
      newActivity.check = { ability: 'str', associated: [], dc: { calculation: 'spellcasting' } };
    } else if (kind === 'save') {
      // Match Foundry's fresh save: no challenge ability selected, DC derived
      // (spellcasting → formula disabled), damage half-on-save with no parts.
      newActivity.save = { abilities: [], dc: { calculation: 'spellcasting' } };
      newActivity.damage = { parts: [], onSave: 'half' };
    } else if (kind === 'heal') {
      newActivity.healing = { parts: [{ types: ['healing'] }] };
    } else if (kind === 'damage') {
      newActivity.damage = { parts: [], critical: { allow: false, bonus: '' } };
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
        activityList.length > 0 ? 'border-gold/15 bg-background/20' : 'border-dashed border-gold/15',
      )}>
        {activityList.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <Zap className="w-6 h-6 text-gold/15 mb-2" />
            <p className="text-ink/25 italic text-xs">No activities defined</p>
            <p className="text-[10px] text-ink/25 mt-0.5">
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
                    ? 'border-l-2 border-l-gold/55'
                    : 'border-t border-t-gold/15 border-l-2 border-l-gold/15',
                )}
                onClick={() => setEditingId(activity.id)}
              >
                {/* Tree connector */}
                <span className="absolute left-1.5 top-[9px] text-gold/35 text-[11px] font-bold select-none leading-none">┗</span>

                {/* Icon */}
                <div className="w-6 h-6 shrink-0 rounded border border-gold/25 bg-gold/5 flex items-center justify-center overflow-hidden">
                  {isExternal ? (
                    <img src={activity.img} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <KindIcon className="w-3.5 h-3.5 text-gold/75" />
                  )}
                </div>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold text-ink/85 leading-none">{activity.name}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] uppercase tracking-widest text-ink/35">{kindInfo?.label}</span>
                    {activationLabel && (
                      <>
                        <span className="text-gold/25 leading-none">·</span>
                        <span className="text-[9px] text-ink/35">{activationLabel}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemoveActivity(activity.id); }}
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-ink/25 hover:text-blood opacity-0 group-hover:opacity-100 transition-all rounded"
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
        <DialogContent className="sm:max-w-[440px] bg-card border-gold/25 p-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-gold/15">
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
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded border border-transparent hover:border-gold/25 hover:bg-gold/5 transition-all text-left group"
                >
                  <div className="w-7 h-7 rounded border border-gold/15 bg-gold/5 flex items-center justify-center shrink-0 group-hover:border-gold/45 group-hover:bg-gold/15 transition-colors">
                    <Icon className="w-4 h-4 text-gold/65 group-hover:text-gold transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink/75 group-hover:text-ink/95 leading-none">{label}</p>
                    <p className="text-[10px] text-ink/35 mt-0.5 leading-snug">{KIND_DESCRIPTIONS[kind]}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Secondary / advanced kinds */}
            {secondaryKinds.length > 0 && (
              <>
                <div className="flex items-center gap-2 my-2.5">
                  <div className="flex-1 border-t border-gold/15" />
                  <span className="text-[9px] uppercase tracking-widest text-ink/25">Advanced</span>
                  <div className="flex-1 border-t border-gold/15" />
                </div>
                <div className="space-y-0.5">
                  {secondaryKinds.map(({ kind, label, icon: Icon }) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => handleAddActivity(kind)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded border border-transparent hover:border-gold/25 hover:bg-gold/5 transition-all text-left group"
                    >
                      <div className="w-6 h-6 rounded border border-gold/15 bg-gold/5 flex items-center justify-center shrink-0 group-hover:border-gold/35 transition-colors">
                        <Icon className="w-3.5 h-3.5 text-gold/45 group-hover:text-gold/75 transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-ink/65 group-hover:text-ink/85 leading-none">{label}</p>
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

      {/* Top-anchored auto-height shell. `top-[6vh] translate-y-0` overrides
          the base dialog's vertical centering so the dialog's TOP edge stays
          pinned ~6vh from the viewport top; it then grows downward to fit the
          active tab's content, capped at max-h-[88vh]. Anchoring the top keeps
          the title + tab bar in a fixed screen position, so flipping tabs never
          shifts them out from under the cursor — only the content area below
          resizes. The inner `flex-1 min-h-0 overflow-y-auto` scroller engages
          only when a tab's content exceeds the cap. */}
      <Dialog open={!!editingId} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="dialog-content sm:max-w-[95vw] lg:max-w-[600px] flex flex-col top-[6vh] translate-y-0 max-h-[88vh] min-h-[440px]">
          {editingActivity && (
            <>
              <DialogHeader className="px-6 pt-4 pb-2.5 shrink-0 border-b border-gold/15">
                <div className="flex flex-col gap-2">
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
                <div className="px-5 py-2.5 pb-3">
                  
                  {activeTab === 'identity' && (
                    <div>
                      {/* ——— ACTIVITY ——— */}
                      <ActivitySection label="Activity">
                        <FieldRow label="Name">
                          <Input
                            value={editingActivity.name}
                            onChange={e => handleUpdateActivity(editingId!, { name: e.target.value })}
                            autoComplete="off"
                            className="field-input border-gold/15 font-serif"
                          />
                        </FieldRow>
                        <div className="flex gap-4 items-center py-2">
                          <p className="text-xs font-semibold text-ink/85 flex-1">Icon</p>
                          <div className="w-12 h-12 shrink-0">
                            <ImageUpload
                              compact
                              imageType="icon"
                              storagePath="icons/activities/"
                              currentImageUrl={editingActivity.img && !editingActivity.img.startsWith('systems/') && !editingActivity.img.startsWith('icons/') ? editingActivity.img : ''}
                              fallback={React.createElement(ACTIVITY_KINDS.find(k => k.kind === editingActivity.kind)?.icon || Info, { className: 'w-6 h-6 text-gold/65' })}
                              onUpload={url => handleUpdateActivity(editingId!, { img: url })}
                              className="w-full h-full"
                            />
                          </div>
                        </div>
                        <FieldRow label="Chat Flavor" hint="Additional text displayed in the activation chat message">
                          <Input
                            value={editingActivity.chatFlavor || ''}
                            onChange={e => handleUpdateActivity(editingId!, { chatFlavor: e.target.value })}
                            autoComplete="off"
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
                              value={editingActivity.attack?.type || '__blank'}
                              onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, type: (val === '__blank' ? '' : val) as any } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__blank">{' '}</SelectItem>
                                <SelectItem value="melee">Melee</SelectItem>
                                <SelectItem value="ranged">Ranged</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Attack Classification" hint="Is this an unarmed, weapon, or spell attack?">
                            <Select
                              value={editingActivity.attack?.classification || '__blank'}
                              onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, classification: (val === '__blank' ? '' : val) as any } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__blank">{' '}</SelectItem>
                                <SelectItem value="weapon">Weapon</SelectItem>
                                <SelectItem value="spell">Spell</SelectItem>
                                <SelectItem value="unarmed">Unarmed</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {/* ——— BEHAVIOR ——— */}
                      {showsTemplatePrompt && (
                        <ActivitySection label="Behavior">
                          <FieldRow
                            label="Measured Template Prompt"
                            hint="Should the player be prompted to place a measured template? Players will still be able to place templates from the chat card if prompt is disabled."
                            inline
                          >
                            <Checkbox
                              checked={editingActivity.target?.prompt}
                              onCheckedChange={checked => updateTarget({ prompt: !!checked })}
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}

                      {/* ——— VISIBILITY ——— */}
                      <ActivitySection label="Visibility">
                        <FieldRow label="Level Limit" hint="Range of levels required to use this activity.">
                          <div className="flex items-center gap-2 w-full">
                            <Input
                              type="number"
                              value={editingActivity.visibility?.level?.min ?? ''}
                              placeholder="0"
                              onChange={e => updateSection('visibility', {
                                level: { min: e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0), max: editingActivity.visibility?.level?.max ?? null }
                              })}
                              className="h-9 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin"
                            />
                            <span className="text-[10px] uppercase tracking-wider text-ink/40 shrink-0 select-none">to</span>
                            <Input
                              type="number"
                              value={editingActivity.visibility?.level?.max ?? ''}
                              placeholder="∞"
                              onChange={e => updateSection('visibility', {
                                level: { min: editingActivity.visibility?.level?.min ?? null, max: e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0) }
                              })}
                              className="h-9 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin"
                            />
                          </div>
                        </FieldRow>
                        <FieldRow label="Class Identifier" hint="The identifier of the class that level limits apply to. If left blank, the character level is used.">
                          {/* Pulls from the same `classes` collection
                              the requirements editor uses; the stored
                              value is the class's `identifier` slug so
                              Foundry's runtime can match it (the same
                              shape the free-text field accepted before). */}
                          <SingleSelectSearch
                            value={editingActivity.visibility?.identifier || ''}
                            onChange={(id) => updateSection('visibility', { identifier: id })}
                            options={classes.map(c => ({
                              id: c.identifier || c.id,
                              name: c.name,
                              hint: c.identifier || undefined,
                            }))}
                            placeholder="Use character level"
                            noEntitiesText="No classes seeded — visibility falls back to character level."
                            triggerClassName="w-full"
                          />
                        </FieldRow>
                        {/* The three require* flags mirror dnd5e v5's
                            `visibility.{requireAttunement, requireIdentification,
                            requireMagic}`. Foundry only surfaces these on the
                            Visibility section for ITEM-hosted activities (the
                            attunement / identification / magical states are item
                            concepts), so they're gated to item context here. */}
                        {context === 'item' && (
                          <>
                            <FieldRow label="Requires Attunement" hint="Only available when the parent item is attuned to its wielder." inline>
                              <Checkbox
                                checked={!!editingActivity.visibility?.requireAttunement}
                                onCheckedChange={checked => updateSection('visibility', { requireAttunement: !!checked })}
                              />
                            </FieldRow>
                            <FieldRow label="Requires Identification" hint="Only available when the parent item has been identified." inline>
                              <Checkbox
                                checked={!!editingActivity.visibility?.requireIdentification}
                                onCheckedChange={checked => updateSection('visibility', { requireIdentification: !!checked })}
                              />
                            </FieldRow>
                            <FieldRow label="Requires Magic" hint="Only available when the parent item is magical (has the `mgc` property or non-`none` rarity)." inline>
                              <Checkbox
                                checked={!!editingActivity.visibility?.requireMagic}
                                onCheckedChange={checked => updateSection('visibility', { requireMagic: !!checked })}
                              />
                            </FieldRow>
                          </>
                        )}
                      </ActivitySection>
                    </div>
                  )}

                  {activeTab === 'activation' && (
                    <div className="space-y-1">
                      <div className="flex justify-center border-b border-gold/15 mb-1">
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
                        <ActivationDurationEditor
                          activation={editingActivity.activation}
                          onActivationChange={(patch) => updateSection('activation', patch)}
                          duration={editingActivity.duration}
                          onDurationChange={(patch) => updateSection('duration', patch)}
                          showsDuration={showsDuration}
                        />
                      )}

                      {activeActivationTab === 'consumption' && (
                        <ConsumptionTabEditor
                          consumption={editingActivity.consumption}
                          onConsumptionChange={(patch) => updateConsumption(patch)}
                          uses={editingActivity.uses}
                          onUsesChange={(nextUses) => handleUpdateActivity(editingId!, { uses: nextUses })}
                          showSpellSlot={editingActivity.kind === 'cast'}
                          itemTargets={itemTargets}
                        />
                      )}

                      {activeActivationTab === 'targeting' && (
                        <RangeTargetingEditor
                          range={editingActivity.range}
                          onRangeChange={(patch) => updateSection('range', patch)}
                          target={editingActivity.target}
                          onAffectsChange={(patch) => updateTargetAffects(patch)}
                          onTemplateChange={(patch) => updateTargetTemplate(patch)}
                          onTargetChange={(patch) => updateTarget(patch)}
                          showsRange={showsRange}
                          showsTargeting={showsTargeting}
                        />
                      )}
                    </div>
                  )}

                  {activeTab === 'effect' && (
                    <div>
                      {/* ——— ATTACK DETAILS ——— Foundry keeps the to-hit fields on
                          the Effect tab (Identity only carries Type + Classification). */}
                      {editingActivity.kind === 'attack' && (
                        <ActivitySection label="Attack Details">
                          <FieldRow label="Attack Ability" hint="Ability used for the attack and to determine damage. Available using @mod in formulas.">
                            <Select
                              value={editingActivity.attack?.ability || '__default'}
                              onValueChange={val => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, ability: val === '__default' ? '' : val } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__default">{editingActivity.attack?.type === 'ranged' ? 'Default (Dexterity)' : 'Default (Strength)'}</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="spellcasting">Spellcasting</SelectItem>
                                <SelectGroup>
                                  <SelectLabel className="text-[10px] font-black uppercase tracking-wider text-gold/55 px-2 pt-2 pb-1">Abilities</SelectLabel>
                                  <SelectItem value="str">Strength</SelectItem>
                                  <SelectItem value="dex">Dexterity</SelectItem>
                                  <SelectItem value="con">Constitution</SelectItem>
                                  <SelectItem value="int">Intelligence</SelectItem>
                                  <SelectItem value="wis">Wisdom</SelectItem>
                                  <SelectItem value="cha">Charisma</SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="To Hit Bonus" hint="Bonus added to the to-hit roll for the attack.">
                            <Input
                              value={editingActivity.attack?.bonus || ''}
                              onChange={e => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, bonus: e.target.value } })}
                              autoComplete="off"
                              className="field-input border-gold/15 font-mono text-xs"
                              placeholder="e.g. +2 or @prof"
                            />
                          </FieldRow>
                          <FieldRow label="Flat To Hit" hint="Ignore the ability modifier, proficiency, and other actor bonuses — use only the bonus defined here." inline>
                            <Checkbox
                              checked={editingActivity.attack?.flat}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, { attack: { ...editingActivity.attack!, flat: !!checked } })}
                            />
                          </FieldRow>
                          <FieldRow label="Critical Threshold" hint="Minimum value on the d20 needed to roll a critical hit.">
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
                              autoComplete="off"
                              className="field-input border-gold/15 text-center no-number-spin"
                              placeholder="20"
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}
                      {(editingActivity.save || editingActivity.check) && (() => {
                        const isSave = !!editingActivity.save;
                        const dc = isSave ? editingActivity.save!.dc : editingActivity.check!.dc;
                        // Foundry's save/check DC dropdown (calculationOptions) is exactly:
                        // Custom Formula ("") · Spellcasting Ability · one per ability. The save
                        // default "initial" is NOT a listed option (it means "derive from the
                        // parent item"), so it reads here as the spellcasting-derived case; either
                        // way a non-empty calculation keeps the formula disabled/auto-derived.
                        const rawCalc = (dc?.calculation ?? '') as string;
                        const calc = rawCalc === 'initial' ? 'spellcasting' : rawCalc;
                        const isCustomDC = calc === '';
                        const setDc = (patch: Record<string, unknown>) => {
                          if (isSave) handleUpdateActivity(editingId!, { save: { ...editingActivity.save!, dc: { ...editingActivity.save!.dc, ...patch } } });
                          else handleUpdateActivity(editingId!, { check: { ...editingActivity.check!, dc: { ...editingActivity.check!.dc, ...patch } } });
                        };
                        return (
                        <ActivitySection label={isSave ? 'Save Details' : 'Check Details'}>
                          {isSave && (
                            <FieldRow label="Challenge Abilities" hint="Abilities that may be rolled to attempt to save.">
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
                                      className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border transition-colors ${active ? 'bg-gold/25 border-gold/55 text-ink/95' : 'bg-transparent border-gold/15 text-ink/35 hover:border-gold/35'}`}
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
                          <FieldRow label="DC Calculation" hint="Method or ability used to calculate the difficulty class.">
                            <Select
                              value={calc === '' ? '__custom' : calc}
                              onValueChange={val => setDc({ calculation: val === '__custom' ? '' : val })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__custom">Custom Formula</SelectItem>
                                <SelectItem value="spellcasting">Spellcasting Ability</SelectItem>
                                <SelectGroup>
                                  <SelectLabel className="text-[10px] font-black uppercase tracking-wider text-gold/55 px-2 pt-2 pb-1">Abilities</SelectLabel>
                                  {ABILITY_OPTIONS.map(ability => (
                                    <SelectItem key={ability} value={ability}>{attrLabel(ability)}</SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="DC Formula" hint={isCustomDC ? 'Custom formula or flat value for defining the DC.' : 'Calculated automatically from the selection above.'}>
                            <Input
                              value={isCustomDC ? (dc?.formula || '') : ''}
                              disabled={!isCustomDC}
                              onChange={e => setDc({ formula: e.target.value })}
                              autoComplete="off"
                              className="field-input border-gold/15 font-mono text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              placeholder={isCustomDC ? '10, or @abilities.int.dc' : '8 + @mod + @prof'}
                            />
                          </FieldRow>
                        </ActivitySection>
                        );
                      })()}

                      {(editingActivity.damage || editingActivity.healing) && (() => {
                        const isHeal = !!editingActivity.healing;
                        const isAttack = editingActivity.kind === 'attack';
                        const isDamageKind = editingActivity.kind === 'damage';
                        const damageKey = isHeal ? 'healing' : 'damage';
                        const parts = (((editingActivity as any)[damageKey]?.parts) || []) as any[];
                        const setParts = (nextParts: any[]) => handleUpdateActivity(editingId!, {
                          [damageKey]: { ...(((editingActivity as any)[damageKey]) || {}), parts: nextParts },
                        });
                        const typeOptions = isHeal ? HEALING_TYPE_OPTIONS : damageTypeOptions;
                        return (
                          <ActivitySection
                            label={isHeal ? 'Healing' : isAttack ? 'Attack Damage' : 'Damage'}
                            onAdd={isHeal ? undefined : () => setParts([...parts, { types: [] }])}
                            addLabel="Add damage part"
                          >
                            {isAttack && (
                              <FieldRow label="Extra Critical Damage" hint="Extra damage applied when a critical is rolled. Added to the base damage or first damage part.">
                                <Input
                                  value={editingActivity.damage?.critical?.bonus || ''}
                                  onChange={e => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, critical: { ...(editingActivity.damage?.critical || {}), bonus: e.target.value } } })}
                                  autoComplete="off"
                                  className="field-input border-gold/15 text-xs font-mono"
                                  placeholder="1d8"
                                />
                              </FieldRow>
                            )}
                            {editingActivity.kind === 'save' && editingActivity.damage && (
                              <FieldRow label="Damage on Save" hint="How much damage should be applied on a successful save?">
                                <Select
                                  value={editingActivity.damage.onSave}
                                  onValueChange={val => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, onSave: val } })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No Damage</SelectItem>
                                    <SelectItem value="half">Half Damage</SelectItem>
                                    <SelectItem value="full">Full Damage</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FieldRow>
                            )}
                            {isDamageKind && (
                              <>
                                <FieldRow label="Allow Critical Bonus" hint="Opt into extra damage when this activity scores a critical." inline>
                                  <Checkbox
                                    checked={editingActivity.damage?.critical?.allow}
                                    onCheckedChange={checked => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, critical: { ...(editingActivity.damage?.critical || {}), allow: !!checked } } })}
                                  />
                                </FieldRow>
                                {editingActivity.damage?.critical?.allow && (
                                  <FieldRow label="Critical Bonus Formula">
                                    <Input
                                      value={editingActivity.damage?.critical?.bonus || ''}
                                      onChange={e => handleUpdateActivity(editingId!, { damage: { ...editingActivity.damage!, critical: { ...(editingActivity.damage?.critical || {}), bonus: e.target.value } } })}
                                      autoComplete="off"
                                      className="field-input border-gold/15 text-xs font-mono"
                                      placeholder="1d8"
                                    />
                                  </FieldRow>
                                )}
                              </>
                            )}
                            {parts.length === 0 && !isHeal ? (
                              <EmptyRow>None</EmptyRow>
                            ) : (
                              <DamagePartEditor parts={parts} onChange={setParts} typeOptions={typeOptions} />
                            )}
                          </ActivitySection>
                        );
                      })()}

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
                              className="field-input border-gold/15 text-xs text-center no-number-spin"
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
                                  className="field-input border-gold/15 text-xs text-center no-number-spin"
                                />
                              </FieldRow>
                              <FieldRow label="Override Save DC">
                                <Input
                                  type="number"
                                  value={editingActivity.spell.challenge.save || ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, save: parseInt(e.target.value) || null } }
                                  })}
                                  className="field-input border-gold/15 text-xs text-center no-number-spin"
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
                                  <span className="text-[9px] uppercase font-black text-ink/65">{prop[0].toUpperCase()}</span>
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
                            <SingleSelectSearch
                              value={editingActivity.summon.mode || ''}
                              onChange={(val) => updateSummon({ mode: val })}
                              options={SUMMON_OR_TRANSFORM_MODE_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                              placeholder="Direct (level-based)"
                              allowClear={false}
                              triggerClassName="w-full"
                            />
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
                          <FieldRow label="Creature Sizes" hint="Pick one or more sizes the summon can match.">
                            {/* Multi-select chips replacing the
                                comma-separated free-text input. Authors
                                no longer have to remember the slugs
                                ("tiny, sm, med, lg, huge, grg"). */}
                            <EntityPicker
                              entities={CREATURE_SIZE_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                              selectedIds={editingActivity.summon.creatureSizes || []}
                              onChange={(sizes) => updateSummon({ creatureSizes: sizes })}
                              searchPlaceholder="Search sizes…"
                              maxHeightClass="max-h-32"
                              showChips
                            />
                          </FieldRow>
                          <FieldRow label="Creature Types" hint="Pick one or more creature types.">
                            <EntityPicker
                              entities={CREATURE_TYPE_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                              selectedIds={editingActivity.summon.creatureTypes || []}
                              onChange={(types) => updateSummon({ creatureTypes: types })}
                              searchPlaceholder="Search creature types…"
                              maxHeightClass="max-h-32"
                              showChips
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
                                  <span className="text-[9px] uppercase font-black text-ink/65">{flag}</span>
                                </label>
                              ))}
                            </div>
                          </FieldRow>
                          <FieldRow label="Bonuses">
                            <div className="grid grid-cols-3 gap-2">
                              {['ac', 'hd', 'hp', 'attackDamage', 'saveDamage', 'healing'].map(field => (
                                <div key={field}>
                                  <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest mb-1">{field}</p>
                                  <Input
                                    value={((editingActivity.summon.bonuses as Record<string, unknown> | undefined)?.[field] as string) || ''}
                                    onChange={e => updateSummon({ bonuses: { ...(editingActivity.summon.bonuses || {}), [field]: e.target.value } })}
                                    className="h-7 bg-background/40 border-gold/15 text-[9px] font-mono"
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
                                    { _id: makeFoundryId(), count: '1', cr: '', level: { min: 0, max: 20 }, name: '', types: [], uuid: null }
                                  ]
                                })}
                                className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-black text-gold/55 hover:text-gold transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(editingActivity.summon.profiles || []).map((profile, idx) => (
                                <div key={profile._id || idx} className="grid grid-cols-6 gap-2 items-end p-2.5 bg-gold/5 border border-gold/5 rounded">
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Name</p>
                                    <Input value={profile.name} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,name:e.target.value}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Count</p>
                                    <Input value={profile.count} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,count:e.target.value}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">CR</p>
                                    <Input value={profile.cr} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,cr:e.target.value}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">UUID</p>
                                    <Input value={profile.uuid||''} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,uuid:e.target.value||null}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Level</p>
                                    <div className="flex gap-1">
                                      <Input type="number" value={profile.level.min} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,level:{...profile.level,min:parseInt(e.target.value,10)||0}}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs text-center no-number-spin" />
                                      <Input type="number" value={profile.level.max} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,level:{...profile.level,max:parseInt(e.target.value,10)||20}}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs text-center no-number-spin" />
                                    </div>
                                  </div>
                                  <button type="button" onClick={() => updateSummon({ profiles: (editingActivity.summon.profiles||[]).filter((_,i)=>i!==idx) })} className="h-7 flex items-center justify-center text-blood/60 hover:text-blood transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="col-span-6 grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Types</p>
                                    <Input value={(profile.types||[]).join(', ')} onChange={e => { const p=[...(editingActivity.summon.profiles||[])]; p[idx]={...profile,types:parseCsv(e.target.value)}; updateSummon({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs" placeholder="beast, fey" />
                                  </div>
                                </div>
                              ))}
                              {!(editingActivity.summon.profiles||[]).length && (
                                <p className="text-center py-3 text-ink/35 italic text-[10px]">Monster support is still pending, but profiles can already be authored.</p>
                              )}
                            </div>
                          </div>
                        </ActivitySection>
                      )}

                      {editingActivity.transform && (
                        <ActivitySection label="TRANSFORM">
                          <FieldRow label="Mode">
                            <SingleSelectSearch
                              value={editingActivity.transform.mode || ''}
                              onChange={(val) => updateTransform({ mode: val })}
                              options={SUMMON_OR_TRANSFORM_MODE_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                              placeholder="Direct (level-based)"
                              allowClear={false}
                              triggerClassName="w-full"
                            />
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
                                    { _id: makeFoundryId(), cr: '', level: { min: 0, max: 20 }, movement: [], name: '', sizes: [], types: [], uuid: null }
                                  ]
                                })}
                                className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-black text-gold/55 hover:text-gold transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(editingActivity.transform.profiles || []).map((profile, idx) => (
                                <div key={profile._id || idx} className="grid grid-cols-6 gap-2 items-end p-2.5 bg-gold/5 border border-gold/5 rounded">
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Name</p>
                                    <Input value={profile.name} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,name:e.target.value}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">CR</p>
                                    <Input value={profile.cr||''} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,cr:e.target.value}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">UUID</p>
                                    <Input value={profile.uuid||''} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,uuid:e.target.value||null}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs font-mono" />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Sizes</p>
                                    <Input value={(profile.sizes||[]).join(', ')} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,sizes:parseCsv(e.target.value)}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs" placeholder={CREATURE_SIZE_OPTIONS.map(o => o.value).join(', ')} />
                                  </div>
                                  <div className="grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Types</p>
                                    <Input value={(profile.types||[]).join(', ')} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,types:parseCsv(e.target.value)}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs" placeholder="beast" />
                                  </div>
                                  <button type="button" onClick={() => updateTransform({ profiles: (editingActivity.transform?.profiles||[]).filter((_,i)=>i!==idx) })} className="h-7 flex items-center justify-center text-blood/60 hover:text-blood transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="col-span-3 grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Movement</p>
                                    <Input value={(profile.movement||[]).join(', ')} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,movement:parseCsv(e.target.value)}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs" placeholder={MOVEMENT_TYPE_OPTIONS.map(o => o.value).join(', ')} />
                                  </div>
                                  <div className="col-span-3 grid gap-1">
                                    <p className="text-[9px] uppercase text-ink/45 font-black tracking-widest">Level Range</p>
                                    <div className="flex gap-2">
                                      <Input type="number" value={profile.level.min} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,level:{...profile.level,min:parseInt(e.target.value,10)||0}}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs text-center no-number-spin" />
                                      <Input type="number" value={profile.level.max} onChange={e => { const p=[...(editingActivity.transform?.profiles||[])]; p[idx]={...profile,level:{...profile.level,max:parseInt(e.target.value,10)||20}}; updateTransform({profiles:p}); }} className="h-7 bg-background/40 border-gold/15 text-xs text-center no-number-spin" />
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {!(editingActivity.transform.profiles||[]).length && (
                                <p className="text-center py-3 text-ink/35 italic text-[10px]">Transform settings can already be authored in a Foundry-like shape.</p>
                              )}
                            </div>
                          </div>
                        </ActivitySection>
                      )}

                      {/* ── Applied Effects ── Foundry parity (activity-effects.hbs):
                          ➕ creates a new effect on the parent and associates it; an
                          associate dropdown links existing effects; each row has a
                          dissociate (−) and delete (🗑) control plus a collapsible
                          "Additional Settings" tray holding the Level Limit. Deep
                          edits (changes/keys) still happen in the Effects tab. */}
                      {(() => {
                        const assoc = editingActivity.effects || [];
                        const canAuthor = !!onAvailableEffectsChange;
                        const linkedIds = new Set(assoc.map(a => a._id));
                        const unlinked = availableEffects.filter(fx => fx._id && !linkedIds.has(fx._id));
                        const setAssoc = (next: typeof assoc) => handleUpdateActivity(editingId!, { effects: next });
                        const associate = (id: string) => { if (id && !linkedIds.has(id)) setAssoc([...assoc, { _id: id, level: { min: null, max: null } }]); };
                        const dissociate = (id: string) => setAssoc(assoc.filter(a => a._id !== id));
                        const patchLevel = (id: string, patch: { min?: number | null; max?: number | null }) =>
                          setAssoc(assoc.map(a => a._id === id ? { ...a, level: { ...a.level, ...patch } } : a));
                        const createEffect = () => {
                          if (!onAvailableEffectsChange) return;
                          const fx: FoundryActiveEffect = {
                            _id: makeFoundryId(), name: 'New Effect', img: defaultEffectImg || null,
                            description: '', disabled: false, transfer: true, tint: '#ffffff',
                            changes: [], statuses: [], type: 'base', sort: 0,
                          };
                          onAvailableEffectsChange([...availableEffects, fx]);
                          setAssoc([...assoc, { _id: fx._id!, level: { min: null, max: null } }]);
                        };
                        const renameEffect = (id: string, name: string) =>
                          onAvailableEffectsChange?.(availableEffects.map(fx => fx._id === id ? { ...fx, name } : fx));
                        const deleteEffect = (id: string) => {
                          onAvailableEffectsChange?.(availableEffects.filter(fx => fx._id !== id));
                          dissociate(id);
                        };
                        return (
                          <ActivitySection label="Applied Effects" onAdd={canAuthor ? createEffect : undefined} addLabel="Create new effect">
                            {unlinked.length > 0 && (
                              <div className="py-2">
                                <SingleSelectSearch
                                  value=""
                                  onChange={(id) => associate(id)}
                                  options={unlinked.map(fx => ({ id: fx._id!, name: fx.name || 'Effect' }))}
                                  placeholder="Associate an existing effect…"
                                  noEntitiesText="No unlinked effects."
                                  triggerClassName="w-full"
                                />
                              </div>
                            )}
                            {assoc.length === 0 ? (
                              <EmptyRow>None</EmptyRow>
                            ) : (
                              assoc.map(a => {
                                const fx = availableEffects.find(e => e._id === a._id);
                                const expanded = expandedEffectId === a._id;
                                return (
                                  <div key={a._id} className="py-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-5 h-5 rounded border border-gold/15 overflow-hidden shrink-0 bg-gold/5 flex items-center justify-center">
                                        {fx?.img
                                          ? <img src={fx.img} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                                          : <Sparkles className="w-3 h-3 text-gold/50" />}
                                      </div>
                                      {canAuthor ? (
                                        <Input
                                          value={fx?.name || ''}
                                          onChange={e => renameEffect(a._id, e.target.value)}
                                          autoComplete="off"
                                          className="flex-1 h-7 bg-background/40 border-gold/15 text-xs"
                                          placeholder={fx ? 'Effect name' : 'Missing effect'}
                                        />
                                      ) : (
                                        <span className={`flex-1 text-xs truncate ${fx ? 'text-ink/85' : 'text-blood/60 italic'}`}>{fx?.name || '(missing effect)'}</span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => dissociate(a._id)}
                                        title="Remove from this activity"
                                        aria-label="Dissociate effect"
                                        className="shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-gold/20 hover:text-gold transition-colors"
                                      >
                                        <Minus className="w-3.5 h-3.5" />
                                      </button>
                                      {canAuthor && (
                                        <button
                                          type="button"
                                          onClick={() => deleteEffect(a._id)}
                                          title="Delete this effect entirely"
                                          aria-label="Delete effect"
                                          className="shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-blood/15 hover:border-blood/45 hover:text-blood transition-colors"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedEffectId(expanded ? null : a._id)}
                                      className="mt-1.5 flex items-center justify-center gap-1.5 w-full cursor-pointer text-[10px] uppercase tracking-wider font-black text-gold/55 hover:text-gold/85 transition-colors"
                                    >
                                      <Settings className="w-3 h-3" />
                                      Additional Settings
                                      <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                                    </button>
                                    {expanded && (
                                      <div className="mt-1 pl-1">
                                        <FieldRow label="Level Limit" hint="Range of levels required to apply this effect.">
                                          <div className="flex items-center gap-2 w-full">
                                            <Input
                                              type="number"
                                              value={a.level?.min ?? ''}
                                              placeholder="0"
                                              onChange={e => patchLevel(a._id, { min: e.target.value === '' ? null : parseInt(e.target.value) })}
                                              autoComplete="off"
                                              className="h-8 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin"
                                            />
                                            <span className="text-[10px] uppercase tracking-wider text-ink/40 shrink-0 select-none">to</span>
                                            <Input
                                              type="number"
                                              value={a.level?.max ?? ''}
                                              placeholder="∞"
                                              onChange={e => patchLevel(a._id, { max: e.target.value === '' ? null : parseInt(e.target.value) })}
                                              autoComplete="off"
                                              className="h-8 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin"
                                            />
                                          </div>
                                        </FieldRow>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </ActivitySection>
                        );
                      })()}

                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end shrink-0 px-5 py-2 border-t border-gold/15 bg-gold/[0.03]">
                 <Button
                  onClick={() => setEditingId(null)}
                  className="btn-gold-solid px-8 h-8 text-xs"
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
          @apply text-[9px] uppercase text-ink/45 font-black tracking-widest;
        }
        .form-group-custom {
          @apply relative border-t border-gold/5 pt-4 mt-4 first:border-0 first:pt-0 first:mt-0;
        }
      `}</style>
    </div>
  );
}
