import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { slugify } from '../../lib/utils';
import { HeartPulse, Plus, Trash2, Download, Upload, X, Zap } from 'lucide-react';
import MarkdownEditor from '../../components/MarkdownEditor';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { Database, CloudOff, Layers } from 'lucide-react';
import SimplePropertyEditor from './SimplePropertyEditor';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EffectChange {
  key: string;
  mode: number;
  value: string;
  priority?: number | null;
}

// State item shape — includes both the D1 snake_case columns and the
// form-friendly camelCase aliases that are folded in on save. Treated as
// loose because state items go through { ...form, ...d1Data } merges.
interface StatusCondition {
  id?: string;
  identifier: string;
  name: string;
  // D1 snake_case columns (always present on freshly loaded rows)
  image_url?: string | null;
  implied_ids?: string[];
  reference?: string;
  description?: string;
  order?: number | null;
  changes?: EffectChange[];
  source: 'dnd5e' | 'custom' | 'imported';
  /** FK to condition_categories (added in migration 20260511-0043). */
  category_id?: string | null;
  created_at?: string;
  updated_at?: string;
  // Form-side aliases that get spread in after a save
  img?: string | null;
  impliedStatuses?: string[];
}

/** Row shape returned by D1 for `condition_categories`. */
interface ConditionCategoryRow {
  id: string;
  identifier: string;
  name: string;
  order?: number | null;
  description?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANGE_MODES = [
  { value: 0, label: 'Custom' },
  { value: 1, label: 'Multiply' },
  { value: 2, label: 'Add' },
  { value: 3, label: 'Downgrade' },
  { value: 4, label: 'Upgrade' },
  { value: 5, label: 'Override' },
];

const SOURCE_LABELS: Record<string, string> = {
  dnd5e: 'D&D 5e',
  custom: 'Custom',
  imported: 'Imported',
};

const SOURCE_COLORS: Record<string, string> = {
  dnd5e: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  custom: 'bg-gold/20 text-gold border-gold/30',
  imported: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const BLANK_FORM: Omit<StatusCondition, 'id'> = {
  identifier: '',
  name: '',
  img: null,
  reference: '',
  description: '',
  order: null,
  impliedStatuses: [],
  changes: [],
  source: 'custom',
  category_id: null,
};

// ─── Default D&D 5e Conditions ───────────────────────────────────────────────

const DEFAULT_DND5E_CONDITIONS: Omit<StatusCondition, 'id'>[] = [
  {
    identifier: 'blinded',
    name: 'Blinded',
    order: 1,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "A blinded creature can't see and automatically fails any ability check that requires sight. Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
  },
  {
    identifier: 'charmed',
    name: 'Charmed',
    order: 2,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects. The charmer has advantage on any ability check to interact socially with the creature.",
  },
  {
    identifier: 'deafened',
    name: 'Deafened',
    order: 3,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "A deafened creature can't hear and automatically fails any ability check that requires hearing.",
  },
  {
    identifier: 'diseased',
    name: 'Diseased',
    order: 4,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      'A diseased creature is afflicted by a disease. The specific effects depend on the disease in question.',
  },
  {
    identifier: 'exhaustion',
    name: 'Exhaustion',
    order: 5,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      'Exhaustion is measured in six levels. Effects are cumulative. **Lv1:** Disadvantage on ability checks. **Lv2:** Speed halved. **Lv3:** Disadvantage on attack rolls and saving throws. **Lv4:** Hit point maximum halved. **Lv5:** Speed reduced to 0. **Lv6:** Death.',
  },
  {
    identifier: 'frightened',
    name: 'Frightened',
    order: 6,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight. The creature can't willingly move closer to the source of its fear.",
  },
  {
    identifier: 'grappled',
    name: 'Grappled',
    order: 7,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [
      { key: 'system.attributes.movement.walk', mode: 5, value: '0' },
    ],
    description:
      "A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed. The condition ends if the grappler is incapacitated or if the grappled creature is removed from the grappler's reach.",
  },
  {
    identifier: 'incapacitated',
    name: 'Incapacitated',
    order: 8,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "An incapacitated creature can't take actions or reactions.",
  },
  {
    identifier: 'invisible',
    name: 'Invisible',
    order: 9,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "An invisible creature is impossible to see without the aid of magic or a special sense. For the purpose of hiding, the creature is heavily obscured. Attack rolls against the creature have disadvantage, and the creature's attack rolls have advantage.",
  },
  {
    identifier: 'paralyzed',
    name: 'Paralyzed',
    order: 10,
    source: 'dnd5e',
    impliedStatuses: ['incapacitated'],
    changes: [
      { key: 'system.attributes.movement.walk', mode: 5, value: '0' },
    ],
    description:
      "A paralyzed creature is incapacitated and can't move or speak. The creature automatically fails Strength and Dexterity saving throws. Attack rolls against the creature have advantage. Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
  },
  {
    identifier: 'petrified',
    name: 'Petrified',
    order: 11,
    source: 'dnd5e',
    impliedStatuses: ['incapacitated'],
    changes: [
      { key: 'system.attributes.movement.walk', mode: 5, value: '0' },
    ],
    description:
      "A petrified creature is transformed into a solid inanimate substance. It is incapacitated, can't move or speak, and is unaware of its surroundings. Attack rolls against it have advantage. It automatically fails Strength and Dexterity saving throws. It has resistance to all damage and is immune to poison and disease.",
  },
  {
    identifier: 'poisoned',
    name: 'Poisoned',
    order: 12,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      'A poisoned creature has disadvantage on attack rolls and ability checks.',
  },
  {
    identifier: 'prone',
    name: 'Prone',
    order: 13,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [],
    description:
      "A prone creature's only movement option is to crawl, unless it stands up and thereby ends the condition. The creature has disadvantage on attack rolls. An attack roll against it has advantage if the attacker is within 5 feet, otherwise the attack roll has disadvantage.",
  },
  {
    identifier: 'restrained',
    name: 'Restrained',
    order: 14,
    source: 'dnd5e',
    impliedStatuses: [],
    changes: [
      { key: 'system.attributes.movement.walk', mode: 5, value: '0' },
    ],
    description:
      "A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed. Attack rolls against it have advantage, and the creature's attack rolls have disadvantage. The creature has disadvantage on Dexterity saving throws.",
  },
  {
    identifier: 'stunned',
    name: 'Stunned',
    order: 15,
    source: 'dnd5e',
    impliedStatuses: ['incapacitated'],
    changes: [
      { key: 'system.attributes.movement.walk', mode: 5, value: '0' },
    ],
    description:
      "A stunned creature is incapacitated, can't move, and can speak only falteringly. The creature automatically fails Strength and Dexterity saving throws. Attack rolls against it have advantage.",
  },
  {
    identifier: 'unconscious',
    name: 'Unconscious',
    order: 16,
    source: 'dnd5e',
    impliedStatuses: ['incapacitated', 'prone'],
    changes: [
      { key: 'system.attributes.movement.walk', mode: 5, value: '0' },
    ],
    description:
      "An unconscious creature is incapacitated, can't move or speak, and is unaware of its surroundings. The creature drops whatever it's holding and falls prone. It automatically fails Strength and Dexterity saving throws. Attack rolls against it have advantage. Any attack that hits is a critical hit if the attacker is within 5 feet.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatusesEditor({ userProfile }: { userProfile: any }) {
  const [items, setItems] = useState<StatusCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  const [editingItem, setEditingItem] = useState<StatusCondition | null>(null);
  const [form, setForm] = useState<Omit<StatusCondition, 'id'>>(BLANK_FORM);
  const [isUsingD1, setIsUsingD1] = useState(false);
  // Categories drive the per-condition category dropdown below. Empty
  // until seeded by migration 20260511-0043 (PHB / Combat / Spell /
  // System Extras) — new categories authored after that show up here
  // automatically.
  const [categories, setCategories] = useState<ConditionCategoryRow[]>([]);

  // Page tab. "conditions" = the rich condition form + list (the
  // historical body of this page). "categories" = the SimplePropertyEditor
  // for `conditionCategories`, moved here from AdminProficiencies so
  // both halves of the status-condition stack live on /admin/statuses.
  const [activeTab, setActiveTab] = useState<'conditions' | 'categories'>('conditions');

  const isAdmin = userProfile?.role === 'admin';

  // ── Firestore subscription ──────────────────────────────────────────────────

  useEffect(() => {
    const loadItems = async () => {
      try {
        const [data, cats] = await Promise.all([
          fetchCollection<StatusCondition>('statuses'),
          fetchCollection<ConditionCategoryRow>('conditionCategories', { orderBy: '"order", name ASC' }),
        ]);
        setCategories(cats);
        setItems(
          data.sort((a: any, b: any) => {
            const oa = typeof a.order === 'number' ? a.order : 999;
            const ob = typeof b.order === 'number' ? b.order : 999;
            return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
          })
        );
        setIsUsingD1(true);
      } catch (err) {
        console.error('Error loading statuses:', err);
        setIsUsingD1(false);
      } finally {
        setLoading(false);
      }
    };
    loadItems();
  }, []);

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;

    const now = new Date().toISOString();
    const d1Data = {
      identifier: form.identifier.trim() || slugify(form.name),
      name: form.name,
      image_url: form.img ?? null,
      reference: form.reference,
      description: form.description,
      order: form.order ?? null,
      implied_ids: form.impliedStatuses,
      changes: form.changes,
      source: form.source,
      category_id: form.category_id ?? null,
      updated_at: now,
    };

    try {
      const targetId = editingItem?.id || crypto.randomUUID();
      if (!editingItem) {
        (d1Data as any).created_at = now;
      }
      await upsertDocument('statuses', targetId, d1Data);

      const stateItem = { id: targetId, ...form, ...d1Data };
      if (editingItem?.id) {
        setItems(prev => prev.map(it => it.id === targetId ? stateItem : it));
        toast.success('Status condition updated');
      } else {
        setItems(prev => [...prev, stateItem].sort((a: any, b: any) => {
          const oa = typeof a.order === 'number' ? a.order : 999;
          const ob = typeof b.order === 'number' ? b.order : 999;
          return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
        }));
        toast.success('Status condition created');
      }
      resetForm();
    } catch (err) {
      console.error('Error saving status:', err);
      toast.error('Failed to save status condition');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!isAdmin || !window.confirm('Delete this status condition?')) return;
    try {
      await deleteDocument('statuses', id);
      setItems(prev => prev.filter(it => it.id !== id));
      toast.success('Status condition deleted');
    } catch (err) {
      console.error('Error deleting status:', err);
      toast.error('Failed to delete status condition');
    }
  };

  const handleSeedDefaults = async () => {
    if (!isAdmin) return;
    const existing = new Set(items.map(i => i.identifier));
    const toAdd = DEFAULT_DND5E_CONDITIONS.filter(c => !existing.has(c.identifier));
    if (toAdd.length === 0) {
      toast.info('All default conditions already exist');
      return;
    }
    try {
      const now = new Date().toISOString();
      const newItems = await Promise.all(
        toAdd.map(async c => {
          const newId = crypto.randomUUID();
          const d1Data = {
            identifier: c.identifier,
            name: c.name,
            image_url: null,
            reference: '',
            description: c.description || '',
            order: c.order ?? null,
            implied_ids: c.impliedStatuses || [],
            changes: c.changes || [],
            source: c.source,
            created_at: now,
            updated_at: now,
          };
          await upsertDocument('statuses', newId, d1Data);
          return { id: newId, ...c, ...d1Data };
        })
      );
      setItems(prev => [...prev, ...newItems].sort((a: any, b: any) => {
        const oa = typeof a.order === 'number' ? a.order : 999;
        const ob = typeof b.order === 'number' ? b.order : 999;
        return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
      }));
      toast.success(`Added ${toAdd.length} default condition${toAdd.length !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Error seeding defaults:', err);
      toast.error('Failed to seed default conditions');
    }
  };

  const handleImportJson = async () => {
    setImportError('');
    let parsed: any;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      setImportError('Invalid JSON — paste a valid JSON object or array.');
      return;
    }

    type RawCondition = { identifier: string; name?: string; label?: string; img?: string; icon?: string; reference?: string; description?: string; order?: number };
    let conditions: RawCondition[] = [];

    if (Array.isArray(parsed)) {
      conditions = parsed.map((c: any) => ({
        identifier: c.id || c.identifier || slugify(c.name || c.label || ''),
        ...c,
      }));
    } else if (parsed && typeof parsed === 'object') {
      conditions = Object.entries(parsed).map(([key, val]: [string, any]) => ({
        identifier: key,
        name: val.label || val.name || key,
        img: val.icon || val.img,
        reference: val.reference,
        description: val.description,
        order: val.order,
      }));
    } else {
      setImportError('Expected a JSON object (conditionTypes map) or an array of condition objects.');
      return;
    }

    if (conditions.length === 0) {
      setImportError('No conditions found in JSON.');
      return;
    }

    const existing = new Set(items.map(i => i.identifier));
    const toAdd = conditions.filter(c => c.identifier && !existing.has(c.identifier));
    if (toAdd.length === 0) {
      setImportError('All conditions in the JSON already exist (matched by identifier).');
      return;
    }

    try {
      const now = new Date().toISOString();
      const newItems = await Promise.all(
        toAdd.map(async c => {
          const newId = crypto.randomUUID();
          const d1Data: Omit<StatusCondition, 'id'> = {
            identifier: c.identifier,
            name: c.name || c.label || c.identifier,
            image_url: (c.img || c.icon) ?? null,
            reference: c.reference || '',
            description: c.description || '',
            order: c.order ?? null,
            implied_ids: [],
            changes: [],
            source: 'imported',
            created_at: now,
            updated_at: now,
          };
          await upsertDocument('statuses', newId, d1Data);
          return { id: newId, ...d1Data };
        })
      );
      setItems(prev => [...prev, ...newItems]);
      toast.success(`Imported ${toAdd.length} status condition${toAdd.length !== 1 ? 's' : ''}`);
      setShowImport(false);
      setImportJson('');
    } catch (err) {
      console.error('Error importing statuses:', err);
      toast.error('Failed to import status conditions');
    }
  };

  // ── Form helpers ───────────────────────────────────────────────────────────

  const resetForm = () => {
    setEditingItem(null);
    setForm(BLANK_FORM);
  };

  const startEdit = (item: any) => {
    setEditingItem(item);
    setForm({
      identifier: item.identifier || '',
      name: item.name,
      img: item.image_url ?? null,
      reference: item.reference || '',
      description: item.description || '',
      order: item.order ?? null,
      impliedStatuses: item.implied_ids || [],
      changes: item.changes || [],
      source: item.source || 'custom',
      category_id: item.category_id ?? null,
    });
  };

  const addChange = () =>
    setForm(f => ({ ...f, changes: [...(f.changes || []), { key: '', mode: 2, value: '' }] }));

  const updateChange = (i: number, patch: Partial<EffectChange>) =>
    setForm(f => ({ ...f, changes: (f.changes || []).map((c, idx) => idx === i ? { ...c, ...patch } : c) }));

  const removeChange = (i: number) =>
    setForm(f => ({ ...f, changes: (f.changes || []).filter((_, idx) => idx !== i) }));

  const toggleImplied = (identifier: string) =>
    setForm(f => ({
      ...f,
      impliedStatuses: (f.impliedStatuses || []).includes(identifier)
        ? (f.impliedStatuses || []).filter(s => s !== identifier)
        : [...(f.impliedStatuses || []), identifier],
    }));

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="text-center py-20 text-ink/40 font-serif italic">
        Access Denied. Admins only.
      </div>
    );
  }

  const dnd5eCount = items.filter(i => i.source === 'dnd5e').length;
  const customCount = items.filter(i => i.source !== 'dnd5e').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">

      {/* Page header */}
      <div className="flex items-center gap-3 text-gold mb-2">
        <HeartPulse className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Admin Tools</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">
              Status Conditions
            </h1>
            {isUsingD1 ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Database className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">D1 Linked</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Legacy Firebase</span>
              </div>
            )}
          </div>
          <p className="text-ink/60 font-serif italic">
            Define the status conditions available in your game — default D&amp;D 5e conditions,
            custom homebrew conditions, and imported Foundry condition types.
          </p>
          {activeTab === 'conditions' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-widest border border-blue-500/30 bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
                {dnd5eCount} D&amp;D 5e
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest border border-gold/30 bg-gold/10 text-gold px-2 py-0.5 rounded">
                {customCount} Custom / Imported
              </span>
            </div>
          )}
        </div>

        {/* Top-right action buttons only apply to the Conditions tab —
            the Categories tab's SimplePropertyEditor renders its own
            Add affordance. */}
        {activeTab === 'conditions' && (
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowImport(true)}
              className="border-gold/20 text-gold/70 hover:text-gold hover:bg-gold/10 gap-2 text-xs"
            >
              <Upload className="w-3.5 h-3.5" /> Import JSON
            </Button>
            <Button
              type="button"
              onClick={handleSeedDefaults}
              className="btn-primary gap-2 text-xs"
            >
              <Download className="w-3.5 h-3.5" /> Seed D&amp;D 5e Defaults
            </Button>
          </div>
        )}
      </div>

      {/* Tab strip — mirrors AdminProficiencies' visual style. Lets
          authors flip between the rich Conditions editor and the
          Categories SimplePropertyEditor without leaving the page. */}
      <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-4">
        {([
          { id: 'conditions', label: 'Conditions', icon: HeartPulse },
          { id: 'categories', label: 'Condition Categories', icon: Layers },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors font-bold uppercase tracking-widest text-[10px] ${
              activeTab === tab.id
                ? 'bg-gold text-white shadow-sm'
                : 'bg-card text-ink/60 hover:text-ink hover:bg-gold/10'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Conditions tab body ──────────────────────────────── */}
      {activeTab === 'categories' && (
        <SimplePropertyEditor
          userProfile={userProfile}
          collectionName="conditionCategories"
          title="Condition Category"
          descriptionText="Groupings for status conditions surfaced as the badge next to each condition in the Active Effect picker (PHB Conditions, Combat States, Spell States, System Extras, or your own). Edit the seeded categories or add new ones; status_conditions.category_id references rows here."
          icon={Layers}
        />
      )}

      {activeTab === 'conditions' && (
      <div className="grid lg:grid-cols-3 gap-8">

        {/* ── Left: Form panel ────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-6">
          <h2 className="label-text text-gold">
            {editingItem ? 'Edit Condition' : 'New Condition'}
          </h2>

          <form onSubmit={handleSave} className="space-y-4 bg-card/50 p-6 rounded-lg border border-gold/10">

            {/* Icon + Name */}
            <div className="flex gap-3 items-start">
              <div className="w-14 h-14 shrink-0">
                <ImageUpload
                  compact
                  imageType="icon"
                  storagePath="icons/statuses/"
                  currentImageUrl={form.img || ''}
                  onUpload={url => setForm(f => ({ ...f, img: url || null }))}
                  className="w-full h-full"
                />
              </div>
              <div className="flex-1 space-y-2">
                <label className="field-label">Name</label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="h-9 bg-background/50 border-gold/10"
                  required
                />
              </div>
            </div>

            {/* Identifier */}
            <div className="space-y-2">
              <label className="field-label">Identifier</label>
              <Input
                value={form.identifier}
                onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))}
                placeholder={slugify(form.name || 'blinded')}
                className="h-9 bg-background/50 border-gold/10 font-mono text-xs placeholder:text-ink/20"
              />
              <p className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">
                Foundry condition key (e.g., blinded)
              </p>
            </div>

            {/* Source + Order */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="field-label">Source</label>
                <Select
                  value={form.source}
                  onValueChange={(v: 'dnd5e' | 'custom' | 'imported') =>
                    setForm(f => ({ ...f, source: v }))
                  }
                >
                  <SelectTrigger className="h-9 bg-background/50 border-gold/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dnd5e">D&amp;D 5e</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                    <SelectItem value="imported">Imported</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="field-label">Order</label>
                <Input
                  type="number"
                  value={form.order ?? ''}
                  onChange={e => setForm(f => ({ ...f, order: e.target.value === '' ? null : Number(e.target.value) }))}
                  className="h-9 bg-background/50 border-gold/10 font-mono"
                />
              </div>
            </div>

            {/* Category — FK to condition_categories. Drives the badge
                shown next to each condition in the Active Effect editor's
                Status Conditions picker (PHB Conditions / Combat States
                / Spell States / System Extras). "Uncategorised" stores
                null. Categories are seeded by migration 20260511-0043
                and authored via a future categories admin page if needed. */}
            <div className="space-y-2">
              <label className="field-label">Category</label>
              <Select
                value={form.category_id ?? '__none__'}
                onValueChange={(v) =>
                  setForm(f => ({ ...f, category_id: v === '__none__' ? null : v }))
                }
              >
                <SelectTrigger className="h-9 bg-background/50 border-gold/10 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Uncategorised</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">
                Groups conditions in the Active Effect picker
              </p>
            </div>

            {/* Reference */}
            <div className="space-y-2">
              <label className="field-label">Reference</label>
              <Input
                value={form.reference || ''}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                placeholder="Compendium.dnd5e.rules...."
                className="h-9 bg-background/50 border-gold/10 font-mono text-xs placeholder:text-ink/20"
              />
              <p className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">
                Foundry compendium reference (optional)
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="field-label">Description</label>
              <MarkdownEditor
                value={form.description || ''}
                onChange={v => setForm(f => ({ ...f, description: v }))}
                placeholder="SRD condition description..."
              />
            </div>

            {/* Implied conditions */}
            {items.length > 0 && (
              <div className="space-y-2">
                <label className="field-label">Implies Conditions</label>
                <div className="flex flex-wrap gap-1.5">
                  {items
                    .filter(i => i.id !== editingItem?.id)
                    .map(i => {
                      const active = (form.impliedStatuses || []).includes(i.identifier);
                      return (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => toggleImplied(i.identifier)}
                          className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border transition-colors ${
                            active
                              ? 'bg-gold/20 border-gold/40 text-gold'
                              : 'bg-card border-gold/10 text-ink/40 hover:text-ink/70'
                          }`}
                        >
                          {i.name}
                        </button>
                      );
                    })}
                </div>
                <p className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">
                  Conditions this one implies (e.g., Paralyzed → Incapacitated)
                </p>
              </div>
            )}

            {/* Effect changes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="field-label">Effect Changes</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addChange}
                  className="h-6 w-6 p-0 text-gold/60 hover:text-gold"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>

              {(form.changes || []).length === 0 ? (
                <p className="text-[10px] text-ink/30 italic">No mechanical changes defined.</p>
              ) : (
                <div className="space-y-2">
                  {(form.changes || []).map((change, idx) => (
                    <div key={idx} className="flex gap-1.5 items-start">
                      <div className="flex-1 space-y-1">
                        <Input
                          value={change.key}
                          onChange={e => updateChange(idx, { key: e.target.value })}
                          placeholder="system.attributes.movement.walk"
                          className="h-7 bg-background/50 border-gold/10 font-mono text-[10px] placeholder:text-ink/20"
                        />
                        <div className="flex gap-1">
                          <Select
                            value={String(change.mode)}
                            onValueChange={v => updateChange(idx, { mode: Number(v) })}
                          >
                            <SelectTrigger className="h-7 bg-background/50 border-gold/10 text-[10px] flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CHANGE_MODES.map(m => (
                                <SelectItem key={m.value} value={String(m.value)}>
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={change.value}
                            onChange={e => updateChange(idx, { value: e.target.value })}
                            placeholder="value"
                            className="h-7 bg-background/50 border-gold/10 font-mono text-[10px] flex-1 placeholder:text-ink/20"
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeChange(idx)}
                        className="h-7 w-6 p-0 text-red-400/60 hover:text-red-400 shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1 btn-primary" disabled={!form.name}>
                {editingItem ? 'Save Changes' : 'Create'}
              </Button>
              {editingItem && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  className="border-gold/20 text-gold/60 hover:text-gold hover:bg-gold/10"
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </div>

        {/* ── Right: Cards grid ────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          {loading ? (
            <div className="text-center py-10 opacity-50 font-serif italic text-sm">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 border border-dashed border-gold/20 rounded-xl text-center">
              <HeartPulse className="w-8 h-8 text-gold/20 mx-auto mb-3" />
              <p className="text-ink/40 font-serif italic text-sm mb-4">
                No status conditions defined yet.
              </p>
              <Button
                type="button"
                onClick={handleSeedDefaults}
                className="btn-primary gap-2 text-xs"
              >
                <Download className="w-3.5 h-3.5" /> Seed D&amp;D 5e Defaults
              </Button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {items.map(item => (
                <Card
                  key={item.id}
                  className={`border-gold/10 bg-card/40 hover:bg-card/60 transition-colors cursor-pointer ${
                    editingItem?.id === item.id ? 'ring-1 ring-gold shadow-sm' : ''
                  }`}
                  onClick={() => startEdit(item)}
                >
                  <CardContent className="p-4 flex items-start gap-3">

                    {/* Icon */}
                    <div className="w-10 h-10 rounded border border-gold/10 bg-background/50 flex items-center justify-center shrink-0 overflow-hidden">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        <HeartPulse className="w-4 h-4 text-gold/40" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="h3-title text-ink font-bold truncate">{item.name}</h3>
                          <div className="text-[10px] font-mono text-gold/50 font-black uppercase tracking-widest mt-0.5">
                            {item.identifier}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`text-[9px] font-bold uppercase tracking-widest border px-1.5 py-0.5 rounded ${
                              SOURCE_COLORS[item.source] || SOURCE_COLORS.custom
                            }`}
                          >
                            {SOURCE_LABELS[item.source] || item.source}
                          </span>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={e => handleDelete(e, item.id!)}
                              className="h-6 w-6 p-0 text-red-400/40 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Meta row. Defensive guards: d1.ts auto-parses
                          implied_ids / changes JSON, but older cached
                          payloads or stale Service Worker results can
                          surface either as a raw string — wrap in
                          Array.isArray rather than trust the type. */}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {Array.isArray(item.implied_ids) && item.implied_ids.length > 0 && (
                          <span className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">
                            → {item.implied_ids.join(', ')}
                          </span>
                        )}
                        {Array.isArray(item.changes) && item.changes.length > 0 && (
                          <span className="text-[9px] text-ink/40 font-bold uppercase tracking-widest flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5 text-gold/30" />
                            {item.changes.length} change{item.changes.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Import JSON modal ───────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-gold/20 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">

            <div className="flex items-center justify-between p-6 border-b border-gold/10 shrink-0">
              <div>
                <h2 className="text-lg font-serif font-bold text-ink">
                  Import Status Conditions
                </h2>
                <p className="text-xs text-ink/50 mt-0.5">
                  Paste a Foundry{' '}
                  <code className="font-mono text-gold/70">conditionTypes</code>{' '}
                  object or an array of condition objects
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setShowImport(false); setImportJson(''); setImportError(''); }}
                className="h-8 w-8 p-0 text-ink/40 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <textarea
                value={importJson}
                onChange={e => { setImportJson(e.target.value); setImportError(''); }}
                placeholder={`{\n  "blinded": { "label": "Blinded", "icon": "...", "reference": "..." },\n  "charmed": { "label": "Charmed", ... }\n}`}
                className="w-full h-64 bg-background/50 border border-gold/10 rounded-lg p-3 font-mono text-xs text-ink/80 resize-none focus:outline-none focus:ring-1 focus:ring-gold/30 placeholder:text-ink/20"
              />
              {importError && (
                <p className="text-xs text-red-400 font-semibold">{importError}</p>
              )}
              <div className="bg-gold/5 border border-gold/10 rounded-lg p-3 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Accepted Formats</p>
                <p className="text-[11px] text-ink/50 font-mono">
                  {'{ "blinded": { "label": "...", "icon": "...", "reference": "..." } }'}
                </p>
                <p className="text-[11px] text-ink/50 font-mono">
                  {'[ { "id": "blinded", "name": "Blinded", "img": "..." } ]'}
                </p>
              </div>
            </div>

            <div className="flex gap-2 p-6 border-t border-gold/10 shrink-0">
              <Button
                type="button"
                onClick={handleImportJson}
                disabled={!importJson.trim()}
                className="btn-primary flex-1"
              >
                Import
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowImport(false); setImportJson(''); setImportError(''); }}
                className="border-gold/20 text-gold/60 hover:text-gold hover:bg-gold/10"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
