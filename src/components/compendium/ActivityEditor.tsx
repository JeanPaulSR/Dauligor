import React, { useEffect, useRef, useState } from 'react';
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
import HealingEditor from './activity/HealingEditor';
import SummonEditor from './activity/SummonEditor';
import TransformEditor from './activity/TransformEditor';
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

// Activity kinds in Foundry's add-activity order (CONFIG.DND5E.activityTypes,
// alphabetical) with Foundry's exact labels (DND5E.<TYPE>.Title — note "Use"
// for utility, "Cast"/"Check" not "Cast Spell"/"Ability Check").
const ACTIVITY_KINDS: { kind: ActivityKind; label: string; icon: any }[] = [
  { kind: 'attack', label: 'Attack', icon: Swords },
  { kind: 'cast', label: 'Cast', icon: Wand2 },
  { kind: 'check', label: 'Check', icon: Dices },
  { kind: 'damage', label: 'Damage', icon: Zap },
  { kind: 'enchant', label: 'Enchant', icon: Sparkles },
  { kind: 'forward', label: 'Forward', icon: ArrowRight },
  { kind: 'heal', label: 'Heal', icon: Heart },
  { kind: 'save', label: 'Save', icon: Shield },
  { kind: 'summon', label: 'Summon', icon: Boxes },
  { kind: 'transform', label: 'Transform', icon: RefreshCw },
  { kind: 'utility', label: 'Use', icon: Wrench },
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

// Enchant restriction "Item Type" options — Foundry's enchantable item types
// (CONFIG.Item, filtered to enchantableTypes) with "" = Any Enchantable Type.
const ENCHANT_ITEM_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any Enchantable Type' },
  { value: 'container', label: 'Container' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'feat', label: 'Feature' },
  { value: 'loot', label: 'Loot' },
  { value: 'spell', label: 'Spell' },
  { value: 'tool', label: 'Tool' },
  { value: 'weapon', label: 'Weapon' },
];
// Item types Foundry treats as "physical" (their data model has a `quantity`) —
// this is what gates the Allow Magical checkbox (plus the "Any" case).
const ENCHANT_PHYSICAL_TYPES = new Set(['weapon', 'equipment', 'consumable', 'container', 'loot', 'tool']);
// Per-Item-Type "Valid Categories" source collection (Foundry's itemCategories).
// "Valid Properties" come from the item_properties table filtered by each row's
// valid_types (Foundry's validProperties), so every enchantable type resolves.
// All admin-managed (keys = Foundry trait keys), so the picks round-trip.
const ENCHANT_CATEGORY_COLLECTION: Record<string, string> = {
  weapon: 'weaponCategories',
  equipment: 'armorCategories',
  tool: 'toolCategories',
  consumable: 'consumableCategories',
  loot: 'lootCategories',
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
    // Foundry's BaseForwardActivityData deletes duration/range/target/effects
    // from the schema — a Forward only carries `activity.id` (the triggered
    // activity) plus activation/consumption/uses. Keep our shape in lockstep.
    delete sanitized.duration;
    delete sanitized.range;
    delete sanitized.target;
    delete sanitized.effects;
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
  // Summon's Effect tab ("Summoning") carries Foundry's inner Profiles | Changes sub-tabs.
  const [activeSummonTab, setActiveSummonTab] = useState('profiles');
  // Transform's Effect tab ("Transformation") carries inner Profiles | Settings sub-tabs.
  const [activeTransformTab, setActiveTransformTab] = useState('profiles');
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
  // Skills + tools feed the Check activity's "Associated Skills or Tools"
  // multi-select (Foundry's check.associated). Identifiers are the Foundry
  // skill/tool keys (acr, inv, thieves, …) so the picked set round-trips.
  const [skills, setSkills] = useState<{ id: string; identifier?: string; name: string }[]>([]);
  const [tools, setTools] = useState<{ id: string; identifier?: string; name: string }[]>([]);
  // Enchant restriction Category/Property options keyed by collection name
  // (weaponCategories / weaponProperties / armorCategories / toolCategories);
  // surfaced per Item Type via ENCHANT_CATEGORY_COLLECTION + item_properties.valid_types.
  const [restrictionData, setRestrictionData] = useState<Record<string, { id: string; identifier?: string; name: string }[]>>({});
  // Our spell compendium feeds the Cast activity's "Spell to Cast" picker —
  // authors search-and-assign one of our own spells instead of pasting a raw
  // Foundry UUID. We persist the picked spell's `identifier` (slug) in
  // `spell.uuid`; the module's class-import-service resolves slug → the
  // exported spell's compendium UUID on import. Lazily fetched the first time a
  // Cast activity is opened (effect below) so non-casting edits don't pay for
  // the (potentially large) spell list.
  const [spells, setSpells] = useState<{ id: string; identifier?: string; name: string; level?: number }[]>([]);
  // Our spell rules feed the Transform activity's "Retained Spell Lists" — Foundry
  // uses its spell-list registry; we substitute our own rules (app-handled).
  const [spellRules, setSpellRules] = useState<{ id: string; identifier?: string; name: string }[]>([]);

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
    fetchCollection<{ id: string; identifier?: string; name: string }>('skills', { orderBy: 'name ASC' })
      .then(setSkills)
      .catch(() => {});
    fetchCollection<{ id: string; identifier?: string; name: string }>('tools', { orderBy: 'name ASC' })
      .then(setTools)
      .catch(() => {});
    (['weaponCategories', 'armorCategories', 'toolCategories', 'consumableCategories', 'lootCategories', 'itemProperties'] as const).forEach(coll => {
      fetchCollection<{ id: string; identifier?: string; name: string }>(coll, { orderBy: 'name ASC' })
        .then(rows => setRestrictionData(prev => ({ ...prev, [coll]: rows })))
        .catch(() => {});
    });
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

  // "Associated Skills or Tools" options for the Check activity — the app's
  // skills + tools collections (identifier = the Foundry key), badged so the
  // picker shows which is which (Foundry groups them in its dropdown).
  const associatedOptions = [
    ...skills.map(s => ({ id: s.identifier || s.id, name: s.name, hint: 'Skill' })),
    ...tools.map(t => ({ id: t.identifier || t.id, name: t.name, hint: 'Tool' })),
  ];

  // "Ignored Properties" options for the Cast activity — the spell-valid rows
  // from the admin-managed `item_properties` table (valid_types includes
  // "spell": Verbal/Somatic/Material/Concentration/Ritual), matching Foundry's
  // propertyOptions. identifier = the Foundry property key so the set
  // round-trips. Falls back to the bundled component trio when unseeded.
  const ignoredPropertyOptions = (() => {
    const rows = (restrictionData['itemProperties'] || []).filter(p => {
      const vt = (p as { valid_types?: unknown }).valid_types;
      const types = Array.isArray(vt)
        ? vt
        : (() => { try { return JSON.parse((vt as string) || '[]'); } catch { return []; } })();
      return Array.isArray(types) && types.includes('spell');
    });
    return rows.length
      ? rows.map(p => ({ id: p.identifier || p.id, name: p.name }))
      : SPELL_PROPERTIES.map(p => ({ id: p, name: p === 'vocal' ? 'Verbal' : p[0].toUpperCase() + p.slice(1) }));
  })();

  const activityList = Array.isArray(activities) 
    ? activities 
    : Object.values(activities);

  // Hosts pass an inline `onChange` (new identity every render), so keying the
  // normalize effect on `onChange` made it re-run on EVERY parent render and
  // re-emit the whole activities array from a snapshot — a narrow window in
  // which a just-added activity could be clobbered back out. Hold the latest
  // onChange in a ref and key the effect to the activities VALUE only, so it
  // fires exactly when the input changes (e.g. a freshly-loaded legacy row that
  // needs sanitizing), never on unrelated re-renders.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    const normalized = activityList.map(sanitizeActivity);
    if (JSON.stringify(normalized) !== JSON.stringify(activityList)) {
      onChangeRef.current(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  // Lazy-load the spell compendium only once a Cast activity is actually being
  // edited — feeds the "Spell to Cast" picker. d1.ts caches the response, so
  // reopening a cast (or a second editor on the page) is free.
  useEffect(() => {
    const kind = editingId ? activityList.find(a => a.id === editingId)?.kind : null;
    if (kind !== 'cast' || spells.length) return;
    fetchCollection<{ id: string; identifier?: string; name: string; level?: number }>('spells', { orderBy: 'name ASC' })
      .then(setSpells)
      .catch(() => {});
  }, [editingId, activityList, spells.length]);

  // Lazy-load our spell rules only once a Transform activity is being edited —
  // feeds the "Retained Spell Lists" multi-select (our analogue to Foundry's
  // spell-list registry).
  useEffect(() => {
    const kind = editingId ? activityList.find(a => a.id === editingId)?.kind : null;
    if (kind !== 'transform' || spellRules.length) return;
    fetchCollection<{ id: string; identifier?: string; name: string }>('spellRules', { orderBy: 'name ASC' })
      .then(setSpellRules)
      .catch(() => {});
  }, [editingId, activityList, spellRules.length]);

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
      // Default name = the kind's Foundry label (utility ⇒ "Use", not
      // "Utility"); every other kind's label already equals its capitalized
      // slug, so only utility changes.
      name: ACTIVITY_KINDS.find(k => k.kind === kind)?.label || (kind.charAt(0).toUpperCase() + kind.slice(1)),
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
      // Match Foundry's fresh check: no ability (derives from the skill), no
      // associated skills/tools, DC as a custom formula (so it's editable).
      newActivity.check = { ability: '', associated: [], dc: { calculation: '' } };
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
      delete newActivity.effects;
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
  // Foundry gates the damage-part Scaling field on `activity.canScaleDamage`
  // (consumption.scaling.allowed || isScaledScroll || item.system.canScaleDamage).
  // Spells always scale (item.system.canScaleDamage === true); otherwise the
  // activity's own consumption "Allow Scaling" toggle drives it. Hiding it on a
  // plain damage activity avoids a dead field, matching Foundry's damage-part UI.
  const canScaleDamage = !!editingActivity?.consumption?.scaling?.allowed || context === 'spell';

  // A linked spell (Cast) or target activity (Forward) drives this activity's
  // activation/duration/range/target unless each section is overridden —
  // Foundry's _setOverride. The override toggles only surface once a source is
  // linked (an empty "Spell to Cast" ⇒ no toggles, fields freely editable).
  const overrideNoun = editingActivity?.kind === 'cast'
    ? (editingActivity.spell?.uuid ? 'spell' : null)
    : editingActivity?.kind === 'forward'
      ? (editingActivity.activity?.id ? 'activity' : null)
      : null;
  const canOverrideSections = !!overrideNoun;

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
            {/* One flat, ungrouped list of every activity kind in Foundry's
                order (ACTIVITY_KINDS = CONFIG.DND5E.activityTypes, alphabetical) —
                Foundry's add-activity dialog has no "Advanced" delimiter. */}
            <div className="space-y-0.5">
              {ACTIVITY_KINDS.map(({ kind, label, icon: Icon }) => (
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
                          {editingActivity.kind === 'summon'
                            ? <><Boxes className="w-3.5 h-3.5" /> Summoning</>
                            : editingActivity.kind === 'transform'
                              ? <><RefreshCw className="w-3.5 h-3.5" /> Transformation</>
                              : <><Zap className="w-3.5 h-3.5" /> Effect</>}
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
                      {(showsTemplatePrompt || editingActivity.kind === 'summon') && (
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
                          {/* Summon adds a second prompt (summon.prompt) here — Foundry's
                              Identity › Behavior, not the Summoning tab. */}
                          {editingActivity.kind === 'summon' && (
                            <FieldRow
                              label="Summon Prompt"
                              hint="Should the player be prompted to place the summons? Players will still be able to summon from the chat card if prompt is disabled."
                              inline
                            >
                              <Checkbox
                                checked={editingActivity.summon?.prompt}
                                onCheckedChange={checked => updateSummon({ prompt: !!checked })}
                              />
                            </FieldRow>
                          )}
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
                          canOverride={canOverrideSections}
                          overrideNoun={overrideNoun || 'spell'}
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
                          canOverride={canOverrideSections}
                          overrideNoun={overrideNoun || 'spell'}
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
                              {/* Foundry renders save.ability (a SetField) as a multi-select
                                  dropdown of the six abilities — not toggle badges. */}
                              <Select
                                multiple
                                value={editingActivity.save!.abilities || []}
                                onValueChange={(vals: string[]) => handleUpdateActivity(editingId!, {
                                  save: { ...editingActivity.save!, abilities: vals }
                                })}
                              >
                                <SelectTrigger className="field-input border-gold/15 text-xs">
                                  <SelectValue placeholder="None">
                                    {(value: unknown) => {
                                      const arr = Array.isArray(value) ? (value as string[]) : [];
                                      if (!arr.length) return '';
                                      return arr.map(v => attrLabel(v)).join(', ');
                                    }}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {ABILITY_OPTIONS.map(ability => (
                                    <SelectItem key={ability} value={ability}>{attrLabel(ability)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FieldRow>
                          )}
                          {editingActivity.check && (
                            <>
                              <FieldRow label="Associated Skills or Tools" hint="Present ability checks using proficiency and bonuses with these skills or tools.">
                                <Select
                                  multiple
                                  value={editingActivity.check.associated || []}
                                  onValueChange={(vals: string[]) => handleUpdateActivity(editingId!, {
                                    check: { ...editingActivity.check!, associated: vals }
                                  })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue placeholder="None">
                                      {(value: unknown) => {
                                        const arr = Array.isArray(value) ? (value as string[]) : [];
                                        if (!arr.length) return '';
                                        return arr.map(v => associatedOptions.find(o => o.id === v)?.name || v).join(', ');
                                      }}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectLabel className="text-[10px] font-black uppercase tracking-wider text-gold/55 px-2 pt-2 pb-1">Skills</SelectLabel>
                                      {skills.map(s => (
                                        <SelectItem key={s.identifier || s.id} value={s.identifier || s.id}>{s.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                    <SelectGroup>
                                      <SelectLabel className="text-[10px] font-black uppercase tracking-wider text-gold/55 px-2 pt-2 pb-1">Tools</SelectLabel>
                                      {tools.map(t => (
                                        <SelectItem key={t.identifier || t.id} value={t.identifier || t.id}>{t.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </FieldRow>
                              <FieldRow label="Check Ability" hint="Ability to use when making the check.">
                                <Select
                                  value={editingActivity.check.ability || '__blank'}
                                  onValueChange={val => handleUpdateActivity(editingId!, {
                                    check: { ...editingActivity.check!, ability: val === '__blank' ? '' : val }
                                  })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__blank" className="min-h-7 items-center">{' '}</SelectItem>
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
                            label={isHeal ? 'Healing' : isAttack ? 'Attack Damage' : editingActivity.kind === 'save' ? 'Save Damage' : 'Damage'}
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
                            {isHeal ? (
                              // Heal carries exactly one healing formula (Foundry's
                              // `healing` is a single part, not a list) — render the
                              // label-left field-damage layout, no add/remove.
                              <HealingEditor
                                part={parts[0] || {}}
                                onChange={(patch) => setParts([{ ...(parts[0] || {}), ...patch }])}
                                typeOptions={typeOptions}
                                canScale={canScaleDamage}
                              />
                            ) : parts.length === 0 ? (
                              <EmptyRow>None</EmptyRow>
                            ) : (
                              <DamagePartEditor parts={parts} onChange={setParts} typeOptions={typeOptions} canScale={canScaleDamage} />
                            )}
                          </ActivitySection>
                        );
                      })()}

                      {/* ── Casting Details ── Foundry parity (cast-spell.hbs +
                          cast-details.hbs): a spell link (we search our own
                          compendium and assign one — Foundry takes a raw UUID /
                          dropped item) followed by Casting Ability, Casting Level
                          (only for a linked leveled spell), Ignored Properties,
                          and the attack/DC Override Values. NOTE: a linked spell
                          drives the activity's Activation/Duration/Targeting in
                          Foundry unless each is set to override — see the override
                          toggles (not yet implemented here). */}
                      {editingActivity.spell && (
                        <ActivitySection label="Casting Details">
                          <FieldRow label="Spell to Cast" hint="Search your spell compendium and assign the spell this activity casts.">
                            <SingleSelectSearch
                              value={editingActivity.spell.uuid || ''}
                              onChange={(val) => handleUpdateActivity(editingId!, { spell: { ...editingActivity.spell!, uuid: val } })}
                              options={spells.map(s => ({
                                id: s.identifier || s.id,
                                name: s.name,
                                hint: s.level === 0 ? 'Cantrip' : (s.level ? `Lvl ${s.level}` : undefined),
                              }))}
                              placeholder="Select a spell…"
                              noEntitiesText="No spells in the compendium yet."
                              triggerClassName="w-full"
                            />
                          </FieldRow>
                          <FieldRow label="Casting Ability" hint="Ability to override the creature's normal spellcasting ability.">
                            <Select
                              value={editingActivity.spell.ability || '__default'}
                              onValueChange={val => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, ability: val === '__default' ? '' : val }
                              })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue placeholder="Spellcasting" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__default">Spellcasting</SelectItem>
                                <SelectItem value="str">Strength</SelectItem>
                                <SelectItem value="dex">Dexterity</SelectItem>
                                <SelectItem value="con">Constitution</SelectItem>
                                <SelectItem value="int">Intelligence</SelectItem>
                                <SelectItem value="wis">Wisdom</SelectItem>
                                <SelectItem value="cha">Charisma</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          {(() => {
                            const selectedSpell = spells.find(s => (s.identifier || s.id) === editingActivity.spell!.uuid);
                            // Foundry only renders Casting Level for a linked,
                            // leveled spell (cantrips have no level options).
                            if (!selectedSpell || !selectedSpell.level) return null;
                            const ord = (l: number) => `${l}${l === 1 ? 'st' : l === 2 ? 'nd' : l === 3 ? 'rd' : 'th'} Level`;
                            return (
                              <FieldRow label="Casting Level" hint="Base level to cast the spell, if different than the spell's level.">
                                <Select
                                  value={editingActivity.spell.level ? String(editingActivity.spell.level) : '__default'}
                                  onValueChange={val => handleUpdateActivity(editingId!, {
                                    spell: { ...editingActivity.spell!, level: val === '__default' ? null : parseInt(val) }
                                  })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue placeholder="Spell's level" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__default" className="min-h-7 items-center">{`Spell's level (${selectedSpell.level})`}</SelectItem>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => (
                                      <SelectItem key={l} value={String(l)}>{ord(l)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FieldRow>
                            );
                          })()}
                          <FieldRow label="Ignored Properties" hint="Spell components & tags to ignore while casting.">
                            <Select
                              multiple
                              value={editingActivity.spell.properties || []}
                              onValueChange={(vals: string[]) => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, properties: vals }
                              })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                <SelectValue placeholder="None">
                                  {(value: unknown) => {
                                    const arr = Array.isArray(value) ? (value as string[]) : [];
                                    if (!arr.length) return '';
                                    return arr.map(v => ignoredPropertyOptions.find(o => o.id === v)?.name || v).join(', ');
                                  }}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {ignoredPropertyOptions.map(o => (
                                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Display in Spellbook" hint="Display spell in the Spells tab of the character sheet." inline>
                            <Checkbox
                              checked={editingActivity.spell.spellbook}
                              onCheckedChange={checked => updateSpell({ spellbook: !!checked })}
                            />
                          </FieldRow>
                          <FieldRow label="Override Values" hint="Override the spell's normal attack bonus & DC when casting." inline>
                            <Checkbox
                              checked={editingActivity.spell.challenge?.override}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, override: !!checked } }
                              })}
                            />
                          </FieldRow>
                          {editingActivity.spell.challenge?.override && (
                            <>
                              <FieldRow label="Attack Bonus" hint="Flat to hit bonus in place of the spell's normal attack bonus.">
                                <Input
                                  type="number"
                                  value={editingActivity.spell.challenge.attack ?? ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, attack: e.target.value === '' ? null : parseInt(e.target.value) } }
                                  })}
                                  className="field-input border-gold/15 text-xs text-center no-number-spin"
                                />
                              </FieldRow>
                              <FieldRow label="Save DC" hint="Flat DC to use in place of the spell's normal save DC.">
                                <Input
                                  type="number"
                                  value={editingActivity.spell.challenge.save ?? ''}
                                  onChange={e => handleUpdateActivity(editingId!, {
                                    spell: { ...editingActivity.spell!, challenge: { ...editingActivity.spell!.challenge, save: e.target.value === '' ? null : parseInt(e.target.value) } }
                                  })}
                                  className="field-input border-gold/15 text-xs text-center no-number-spin"
                                />
                              </FieldRow>
                            </>
                          )}
                        </ActivitySection>
                      )}


                      {editingActivity.enchant && (() => {
                        const ench = editingActivity.enchant;
                        const assoc = ench.effects || [];
                        const canAuthor = !!onAvailableEffectsChange;
                        // Enchantments are enchantment-TYPE Active Effects on the parent
                        // (Foundry filters item.effects by type === "enchantment"); the
                        // activity associates them by id in `enchant.effects`.
                        const enchantments = availableEffects.filter(fx => fx._id && fx.type === 'enchantment');
                        const linkedIds = new Set(assoc.map(a => a._id));
                        const unlinked = enchantments.filter(fx => !linkedIds.has(fx._id));
                        const setAssoc = (next: typeof assoc) => handleUpdateActivity(editingId!, { enchant: { ...ench, effects: next } });
                        const associate = (id: string) => { if (id && !linkedIds.has(id)) setAssoc([...assoc, { _id: id, level: { min: null, max: null } }]); };
                        const dissociate = (id: string) => setAssoc(assoc.filter(a => a._id !== id));
                        const patchLevel = (id: string, patch: { min?: number | null; max?: number | null }) =>
                          setAssoc(assoc.map(a => a._id === id ? { ...a, level: { ...a.level, ...patch } } : a));
                        // Riders: extra activities / effects / items this enchantment grants to
                        // the enchanted item while applied (removed with it). Activities come from
                        // this feature's OTHER activities; effects from its effects; items = UUIDs.
                        const patchRiders = (id: string, patch: Record<string, unknown>) =>
                          setAssoc(assoc.map(a => (a._id === id ? { ...a, riders: { ...((a as any).riders || {}), ...patch } } : a)) as typeof assoc);
                        const siblingActivities = activityList.filter(act => act.id !== editingId).map(act => ({ id: act.id, name: act.name || act.kind }));
                        const riderEffectOptions = availableEffects.filter(fx => fx._id).map(fx => ({ id: fx._id!, name: fx.name || 'Effect' }));
                        const createEnchantment = () => {
                          if (!onAvailableEffectsChange) return;
                          const fx: FoundryActiveEffect = {
                            _id: makeFoundryId(), name: 'New Enchantment', img: defaultEffectImg || null,
                            description: '', disabled: false, transfer: false, tint: '#ffffff',
                            changes: [], statuses: [], type: 'enchantment', sort: 0,
                          };
                          onAvailableEffectsChange([...availableEffects, fx]);
                          setAssoc([...assoc, { _id: fx._id!, level: { min: null, max: null } }]);
                        };
                        const renameEnchantment = (id: string, name: string) =>
                          onAvailableEffectsChange?.(availableEffects.map(fx => fx._id === id ? { ...fx, name } : fx));
                        const deleteEnchantment = (id: string) => {
                          onAvailableEffectsChange?.(availableEffects.filter(fx => fx._id !== id));
                          dissociate(id);
                        };
                        const rType = ench.restrictions?.type || '';
                        const isTypePhysical = !rType || ENCHANT_PHYSICAL_TYPES.has(rType);
                        const setRestriction = (patch: Record<string, unknown>) =>
                          handleUpdateActivity(editingId!, { enchant: { ...ench, restrictions: { ...(ench.restrictions || {}), ...patch } } });
                        return (
                          <>
                            {/* ── Enchantments ── Foundry's "Enchantments" sub-tab: create/associate
                                enchantment-type effects, each with an Additional Settings tray. */}
                            <ActivitySection label="Enchantments" onAdd={canAuthor ? createEnchantment : undefined} addLabel="Create new enchantment">
                              {unlinked.length > 0 && (
                                <div className="py-2">
                                  <SingleSelectSearch
                                    value=""
                                    onChange={(id) => associate(id)}
                                    options={unlinked.map(fx => ({ id: fx._id!, name: fx.name || 'Enchantment' }))}
                                    placeholder="Associate an existing enchantment…"
                                    noEntitiesText="No unlinked enchantments."
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
                                            onChange={e => renameEnchantment(a._id, e.target.value)}
                                            autoComplete="off"
                                            className="flex-1 h-7 bg-background/40 border-gold/15 text-xs"
                                            placeholder={fx ? 'Enchantment name' : 'Missing enchantment'}
                                          />
                                        ) : (
                                          <span className={`flex-1 text-xs truncate ${fx ? 'text-ink/85' : 'text-blood/60 italic'}`}>{fx?.name || '(missing enchantment)'}</span>
                                        )}
                                        <button type="button" onClick={() => dissociate(a._id)} title="Remove from this activity" aria-label="Dissociate enchantment" className="shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-gold/20 hover:text-gold transition-colors">
                                          <Minus className="w-3.5 h-3.5" />
                                        </button>
                                        {canAuthor && (
                                          <button type="button" onClick={() => deleteEnchantment(a._id)} title="Delete this enchantment entirely" aria-label="Delete enchantment" className="shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-blood/15 hover:border-blood/45 hover:text-blood transition-colors">
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                      <button type="button" onClick={() => setExpandedEffectId(expanded ? null : a._id)} className="mt-1.5 flex items-center justify-center gap-1.5 w-full cursor-pointer text-[10px] uppercase tracking-wider font-black text-gold/55 hover:text-gold/85 transition-colors">
                                        <Settings className="w-3 h-3" />
                                        Additional Settings
                                        <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                                      </button>
                                      {expanded && (
                                        <div className="mt-1 pl-1">
                                          <FieldRow label="Level Limit" hint="Range of levels required to use this enchantment.">
                                            <div className="flex items-center gap-2 w-full">
                                              <Input type="number" value={a.level?.min ?? ''} placeholder="0" onChange={e => patchLevel(a._id, { min: e.target.value === '' ? null : parseInt(e.target.value) })} autoComplete="off" className="h-8 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin" />
                                              <span className="text-[10px] uppercase tracking-wider text-ink/40 shrink-0 select-none">to</span>
                                              <Input type="number" value={a.level?.max ?? ''} placeholder="∞" onChange={e => patchLevel(a._id, { max: e.target.value === '' ? null : parseInt(e.target.value) })} autoComplete="off" className="h-8 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin" />
                                            </div>
                                          </FieldRow>
                                          <FieldRow label="Additional Activities" hint="These additional activities will be added to the enchanted item when this enchantment is applied, and removed when the enchantment is removed.">
                                            <Select multiple value={((a as any).riders?.activity as string[]) || []} onValueChange={(vals: string[]) => patchRiders(a._id, { activity: vals })}>
                                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                                <SelectValue placeholder="None">
                                                  {(value: unknown) => {
                                                    const arr = Array.isArray(value) ? (value as string[]) : [];
                                                    if (!arr.length) return '';
                                                    return arr.map(v => siblingActivities.find(o => o.id === v)?.name || v).join(', ');
                                                  }}
                                                </SelectValue>
                                              </SelectTrigger>
                                              <SelectContent>
                                                {siblingActivities.length === 0
                                                  ? <SelectItem value="__none" disabled>No other activities</SelectItem>
                                                  : siblingActivities.map(act => <SelectItem key={act.id} value={act.id}>{act.name}</SelectItem>)}
                                              </SelectContent>
                                            </Select>
                                          </FieldRow>
                                          <FieldRow label="Additional Effects" hint="These additional effects will be added to the enchanted item when this enchantment is applied, and removed when the enchantment is removed.">
                                            <Select multiple value={((a as any).riders?.effect as string[]) || []} onValueChange={(vals: string[]) => patchRiders(a._id, { effect: vals })}>
                                              <SelectTrigger className="field-input border-gold/15 text-xs">
                                                <SelectValue placeholder="None">
                                                  {(value: unknown) => {
                                                    const arr = Array.isArray(value) ? (value as string[]) : [];
                                                    if (!arr.length) return '';
                                                    return arr.map(v => riderEffectOptions.find(o => o.id === v)?.name || v).join(', ');
                                                  }}
                                                </SelectValue>
                                              </SelectTrigger>
                                              <SelectContent>
                                                {riderEffectOptions.length === 0
                                                  ? <SelectItem value="__none" disabled>No effects</SelectItem>
                                                  : riderEffectOptions.map(fx => <SelectItem key={fx.id} value={fx.id}>{fx.name}</SelectItem>)}
                                              </SelectContent>
                                            </Select>
                                          </FieldRow>
                                          <FieldRow label="Additional Items" hint="These additional items will be added to the creature when one of its items is enchanted, and will be removed if the enchantment is ever removed.">
                                            <Input
                                              value={Array.isArray((a as any).riders?.item) ? (a as any).riders.item.join(', ') : ((a as any).riders?.item || '')}
                                              onChange={e => patchRiders(a._id, { item: parseCsv(e.target.value) })}
                                              autoComplete="off"
                                              placeholder="Item UUIDs (comma-separated)"
                                              className="field-input border-gold/15 text-xs font-mono"
                                            />
                                          </FieldRow>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </ActivitySection>
                            {/* ── Restrictions ── Foundry's "Restrictions" sub-tab. */}
                            <ActivitySection label="Restrictions">
                              <FieldRow label="Item Type" hint="Type of item to which this enchantment can be applied.">
                                <Select
                                  value={rType || '__any'}
                                  onValueChange={val => setRestriction({ type: val === '__any' ? '' : val })}
                                >
                                  <SelectTrigger className="field-input border-gold/15 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ENCHANT_ITEM_TYPE_OPTIONS.map(o => (
                                      <SelectItem key={o.value || '__any'} value={o.value || '__any'}>{o.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FieldRow>
                              {(() => {
                                // Valid Categories (per-type collection) + Valid Properties
                                // (item_properties filtered by valid_types) — Foundry's
                                // categoryOptions / propertyOptions, for every enchantable type.
                                const catColl = ENCHANT_CATEGORY_COLLECTION[rType];
                                const catRows = (catColl ? restrictionData[catColl] : undefined) || [];
                                const propRows = (restrictionData['itemProperties'] || []).filter((p: any) => {
                                  try { return JSON.parse(p.valid_types || '[]').includes(rType); } catch { return false; }
                                });
                                if (!catRows.length && !propRows.length) return null;
                                return (
                                  <>
                                    {catRows.length > 0 && (
                                      <FieldRow label="Valid Categories" hint="Specific item categories to which this enchantment can be applied.">
                                        <Select multiple value={ench.restrictions?.categories || []} onValueChange={(vals: string[]) => setRestriction({ categories: vals })}>
                                          <SelectTrigger className="field-input border-gold/15 text-xs">
                                            <SelectValue placeholder="Any">
                                              {(value: unknown) => {
                                                const arr = Array.isArray(value) ? (value as string[]) : [];
                                                return arr.length ? arr.map(v => catRows.find(r => (r.identifier || r.id) === v)?.name || v).join(', ') : '';
                                              }}
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            {catRows.map(r => (
                                              <SelectItem key={r.identifier || r.id} value={r.identifier || r.id}>{r.name}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </FieldRow>
                                    )}
                                    {propRows.length > 0 && (
                                      <FieldRow label="Valid Properties" hint="Specific item properties which must be present for this enchantment to be applied.">
                                        <Select multiple value={ench.restrictions?.properties || []} onValueChange={(vals: string[]) => setRestriction({ properties: vals })}>
                                          <SelectTrigger className="field-input border-gold/15 text-xs">
                                            <SelectValue placeholder="Any">
                                              {(value: unknown) => {
                                                const arr = Array.isArray(value) ? (value as string[]) : [];
                                                return arr.length ? arr.map(v => propRows.find((r: any) => (r.identifier || r.id) === v)?.name || v).join(', ') : '';
                                              }}
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            {propRows.map((r: any) => (
                                              <SelectItem key={r.identifier || r.id} value={r.identifier || r.id}>{r.name}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </FieldRow>
                                    )}
                                  </>
                                );
                              })()}
                              {isTypePhysical && (
                                <FieldRow label="Allow Magical" hint="Allow physical items that are already magical to be enchanted." inline>
                                  <Checkbox
                                    checked={ench.restrictions?.allowMagical}
                                    onCheckedChange={checked => setRestriction({ allowMagical: !!checked })}
                                  />
                                </FieldRow>
                              )}
                            </ActivitySection>
                          </>
                        );
                      })()}

                      {/* ── Triggered Activity ── Foundry parity (forward-effect.hbs):
                          the entire Effect tab is a single "Triggered Activity"
                          dropdown listing the item's OTHER activities (Forward
                          excluded — no chaining), with a leading blank to clear it.
                          A Forward has no effects/duration/range/target (the schema
                          deletes them), so there is NO Applied Effects section here —
                          it only redirects to the chosen activity with its own
                          consumption & scaling. */}
                      {editingActivity.kind === 'forward' && (
                        <ActivitySection label="Triggered Activity">
                          <div className="py-2">
                            <Select
                              value={editingActivity.activity?.id || '__none'}
                              onValueChange={val => handleUpdateActivity(editingId!, { activity: { id: val === '__none' ? '' : val } })}
                            >
                              <SelectTrigger className="field-input border-gold/15 text-xs w-full">
                                <SelectValue placeholder=" " />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none" className="min-h-7 items-center">{' '}</SelectItem>
                                {activityList
                                  .filter(a => a.id !== editingId && a.kind !== 'forward')
                                  .map(a => (
                                    <SelectItem key={a.id} value={a.id}>{a.name || ACTIVITY_KINDS.find(k => k.kind === a.kind)?.label || a.kind}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </ActivitySection>
                      )}

                      {editingActivity.summon && (
                        <div className="space-y-1">
                          {/* Foundry's Summoning tab splits into Profiles | Changes sub-tabs. */}
                          <div className="flex justify-center border-b border-gold/15 mb-1">
                            <Tabs value={activeSummonTab} onValueChange={setActiveSummonTab} className="bg-transparent border-none">
                              <TabsList variant="line" className="h-12 p-0 gap-12">
                                <TabsTrigger value="profiles" className="tab-trigger-custom-small">
                                  <Boxes className="w-3.5 h-3.5" /> Profiles
                                </TabsTrigger>
                                <TabsTrigger value="changes" className="tab-trigger-custom-small">
                                  <Settings className="w-3.5 h-3.5" /> Changes
                                </TabsTrigger>
                              </TabsList>
                            </Tabs>
                          </div>
                          <SummonEditor
                            tab={activeSummonTab as 'profiles' | 'changes'}
                            summon={editingActivity.summon}
                            onChange={updateSummon}
                            abilityOptions={ABILITY_OPTIONS.map(a => ({ value: a, label: attrLabel(a) }))}
                            makeId={makeFoundryId}
                          />
                        </div>
                      )}

                      {editingActivity.transform && (
                        <div className="space-y-1">
                          {/* Foundry's Transformation tab splits into Profiles | Settings sub-tabs. */}
                          <div className="flex justify-center border-b border-gold/15 mb-1">
                            <Tabs value={activeTransformTab} onValueChange={setActiveTransformTab} className="bg-transparent border-none">
                              <TabsList variant="line" className="h-12 p-0 gap-12">
                                <TabsTrigger value="profiles" className="tab-trigger-custom-small">
                                  <Boxes className="w-3.5 h-3.5" /> Profiles
                                </TabsTrigger>
                                <TabsTrigger value="settings" className="tab-trigger-custom-small">
                                  <Settings className="w-3.5 h-3.5" /> Settings
                                </TabsTrigger>
                              </TabsList>
                            </Tabs>
                          </div>
                          <TransformEditor
                            tab={activeTransformTab as 'profiles' | 'settings'}
                            transform={editingActivity.transform}
                            onChange={updateTransform}
                            makeId={makeFoundryId}
                            spellListOptions={spellRules.map(r => ({ value: r.identifier || r.id, label: r.name }))}
                          />
                        </div>
                      )}

                      {/* ── Applied Effects ── Foundry parity (activity-effects.hbs):
                          ➕ creates a new effect on the parent and associates it; an
                          associate dropdown links existing effects; each row has a
                          dissociate (−) and delete (🗑) control plus a collapsible
                          "Additional Settings" tray holding the Level Limit. Deep
                          edits (changes/keys) still happen in the Effects tab. Hidden for the
                          enchant kind (its own Enchantments manager above) and forward
                          (Foundry's Forward has no effects — only a Triggered Activity). */}
                      {(editingActivity.kind === 'summon'
                        ? activeSummonTab === 'changes'
                        : !['enchant', 'forward', 'transform'].includes(editingActivity.kind)) && (() => {
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

                      {/* ── Roll ── Utility (Use) parity (utility-effect.hbs): Foundry
                          renders Applied Effects FIRST, then this Roll fieldset with only
                          Roll Label / Roll Formula / Visible to All (no prompt control). */}
                      {editingActivity.roll && (
                        <ActivitySection label="Roll">
                          <FieldRow label="Roll Label" hint="Display name for the rolling button.">
                            <Input
                              value={editingActivity.roll.name || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), name: e.target.value }
                              })}
                              autoComplete="off"
                              className="field-input border-gold/15 text-xs"
                              placeholder="Roll"
                            />
                          </FieldRow>
                          <FieldRow label="Roll Formula" hint="Formula for an arbitrary roll.">
                            <Input
                              value={editingActivity.roll.formula || ''}
                              onChange={e => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), formula: e.target.value }
                              })}
                              autoComplete="off"
                              className="field-input border-gold/15 text-xs font-mono"
                              placeholder="1d20 + @prof"
                            />
                          </FieldRow>
                          <FieldRow label="Visible to All" hint="Display the rolling button in chat for all players." inline>
                            <Checkbox
                              checked={editingActivity.roll.visible}
                              onCheckedChange={checked => handleUpdateActivity(editingId!, {
                                roll: { ...(editingActivity.roll || {}), visible: !!checked }
                              })}
                            />
                          </FieldRow>
                        </ActivitySection>
                      )}

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
