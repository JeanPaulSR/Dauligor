import React, { useMemo, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  Tabs,
  TabsContent,
} from '../../components/ui/tabs';
import { AccentTabsList } from '../../components/ui/AccentTabsList';
import { slugify } from '../../lib/utils';
import {
  HeartPulse,
  Plus,
  Trash2,
  Download,
  Upload,
  X,
  Zap,
  Layers,
} from 'lucide-react';
import MarkdownEditor from '../../components/MarkdownEditor';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';
import EntityListSection, {
  type ColumnDef,
} from '../../components/compendium/EntityListSection';
import EntityEditModal, {
  FormSectionHeading,
} from '../../components/compendium/EntityEditModal';

// Taxonomy-tab config mirrors AdminProficiencies.tsx — no foundry alias,
// no source dropdown, no basic-rules toggle, with the Order column on.
// Centralising here in StatusesEditor (rather than importing across
// pages) keeps each page self-contained.
const TAXONOMY_TAB_BASE = {
  includeAbility: false,
  includeFoundryAlias: false,
  includeSource: false,
  includeBasicRules: false,
  includeOrder: true,
} as const;

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
  custom: 'bg-gold/25 text-gold border-gold/35',
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
  // Categories drive the per-condition category dropdown below. Empty
  // until seeded by migration 20260511-0043 (PHB / Combat / Spell /
  // System Extras) — new categories authored after that show up here
  // automatically.
  const [categories, setCategories] = useState<ConditionCategoryRow[]>([]);

  // Page tab. "conditions" = the rich condition form + list (the
  // historical body of this page). "categories" = the ProficiencyEntityShell
  // (taxonomy mode) for `conditionCategories`, moved here from
  // AdminProficiencies so both halves of the status-condition stack
  // live on /admin/statuses.
  const [activeTab, setActiveTab] = useState<'conditions' | 'categories'>('conditions');

  // Conditions tab — toolbar + table + modal state. Mirrors the
  // ProficiencyEntityShell pattern so both tabs on this page read the
  // same way visually.
  //   • `conditionSearch` filters the table; matches against name,
  //     identifier, source label, and category name.
  //   • `conditionSort` drives the sortable headers. Default is by
  //     `order` ascending, which matches the load-time sort.
  //   • `conditionModalOpen` controls the edit/create dialog. The
  //     modal is conditionally rendered (`if (!open) return null` inside
  //     the dialog component below) for the same reason the shell does
  //     it — @base-ui keeps the popup mounted across the close
  //     animation otherwise.
  //   • `pendingDeleteId` queues a delete confirmation so we can swap
  //     `window.confirm` for the styled ConfirmDialog.
  const [conditionSearch, setConditionSearch] = useState('');
  type ConditionSortKey = 'name' | 'identifier' | 'source' | 'category' | 'order';
  type SortDir = 'asc' | 'desc';
  const [conditionSort, setConditionSort] = useState<{ key: ConditionSortKey; dir: SortDir }>({
    key: 'order',
    dir: 'asc',
  });
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Modal-internal top-level tab. Identity stays above the strip
  // (always visible — name/identifier/source/category are the basic
  // facts about a condition). Below the strip, the form splits into:
  //   • 'details'    — Metadata + Description (the "what is this")
  //   • 'automation' — Implied Conditions + Effect Changes (the "what
  //                    does it do when applied")
  // Defaults to 'details' since most edits start by tweaking the
  // description text or order. Matches the FeatureModalHero /
  // ClassEditor pattern using the shared Tabs primitive.
  type EditTab = 'details' | 'automation';
  const [editTab, setEditTab] = useState<EditTab>('details');

  const isAdmin = userProfile?.role === 'admin';

  // Derived: filtered + sorted view of `items` for the table. Memoised
  // so the table doesn't re-sort on every unrelated state change (form
  // edits, tab toggles, etc.).
  const visibleConditions = useMemo(() => {
    const q = conditionSearch.trim().toLowerCase();
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const filtered = !q
      ? items
      : items.filter((it) => {
          const cat = it.category_id ? categoryNameById.get(it.category_id) || '' : '';
          return (
            it.name.toLowerCase().includes(q) ||
            (it.identifier || '').toLowerCase().includes(q) ||
            (it.source || '').toLowerCase().includes(q) ||
            cat.toLowerCase().includes(q)
          );
        });

    const dirMult = conditionSort.dir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      switch (conditionSort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dirMult;
        case 'identifier':
          return (a.identifier || '').localeCompare(b.identifier || '') * dirMult;
        case 'source':
          return (a.source || '').localeCompare(b.source || '') * dirMult;
        case 'category': {
          const ca = a.category_id ? categoryNameById.get(a.category_id) || '' : '';
          const cb = b.category_id ? categoryNameById.get(b.category_id) || '' : '';
          return ca.localeCompare(cb) * dirMult;
        }
        case 'order':
        default: {
          // Treat missing order as +Infinity so blank rows sort last in
          // ascending order regardless of the direction multiplier.
          const oa = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
          const ob = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
          if (oa === ob) return a.name.localeCompare(b.name);
          return (oa - ob) * dirMult;
        }
      }
    });
    return sorted;
  }, [items, categories, conditionSearch, conditionSort]);

  // Flip-or-set sort. Clicking the active column toggles direction;
  // clicking a new column always defaults to ascending.
  const toggleConditionSort = (key: ConditionSortKey) => {
    setConditionSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  // ── Data loading ────────────────────────────────────────────────────────────

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
      } catch (err) {
        console.error('Error loading statuses:', err);
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
      setConditionModalOpen(false);
    } catch (err) {
      console.error('Error saving status:', err);
      toast.error('Failed to save status condition');
    }
  };

  /**
   * Two-step delete: callers (the table-row trash button + the modal's
   * footer Delete) queue the id, and the styled `ConfirmDialog` actually
   * carries out the destructive call. Mirrors the shell's
   * `requestDelete` → `confirmDelete` pattern so both editors on this
   * page surface the same confirmation chrome instead of mixing
   * `window.confirm` with the dauligor dialog.
   */
  const confirmConditionDelete = async () => {
    if (!isAdmin || !pendingDeleteId) return;
    const id = pendingDeleteId;
    try {
      await deleteDocument('statuses', id);
      setItems(prev => prev.filter(it => it.id !== id));
      toast.success('Status condition deleted');
      // If the modal was open on this row, close it; otherwise leave
      // the modal state alone (delete-from-row case).
      if (editingItem?.id === id) {
        resetForm();
        setConditionModalOpen(false);
      }
    } catch (err) {
      console.error('Error deleting status:', err);
      toast.error('Failed to delete status condition');
    } finally {
      setPendingDeleteId(null);
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
    setEditTab('details');
    setConditionModalOpen(true);
  };

  /** Open the modal in create mode — clears any in-flight edit. */
  const openCreateCondition = () => {
    resetForm();
    setEditTab('details');
    setConditionModalOpen(true);
  };

  /**
   * Modal close handler. Always propagates the requested value (the
   * Dialog primitive may internally sync `true` for focus/animation
   * bookkeeping — only responding to `false` would wedge the popup in
   * a half-closed state, same gotcha the shell documents).
   */
  const handleConditionModalOpenChange = (next: boolean) => {
    setConditionModalOpen(next);
    if (!next) resetForm();
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
      <div className="text-center py-20 text-ink/45 font-serif italic">
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
          </div>
          <p className="text-ink/65 font-serif italic">
            Define the status conditions available in your game — default D&amp;D 5e conditions,
            custom homebrew conditions, and imported Foundry condition types.
          </p>
          {activeTab === 'conditions' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-widest border border-blue-500/30 bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
                {dnd5eCount} D&amp;D 5e
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest border border-gold/35 bg-gold/15 text-gold px-2 py-0.5 rounded">
                {customCount} Custom / Imported
              </span>
            </div>
          )}
        </div>

        {/* Top-right action buttons only apply to the Conditions tab —
            the Categories tab's ProficiencyEntityShell renders its own
            Add affordance inside its toolbar. */}
        {activeTab === 'conditions' && (
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowImport(true)}
              className="border-gold/25 text-gold/75 hover:text-gold hover:bg-gold/15 gap-2 text-xs"
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

      {/* Page-level tab strip — same chevron-style ChevronTabsList
          as the modal's Details/Automation strip so the two layers
          of tabs on this page (page-level + modal-internal) read
          consistently. Wrapped in a `<Tabs>` so the primitive owns
          the controlled state and keyboard navigation; we don't
          render <TabsContent> here because the body sections below
          are conditionally rendered against the same `activeTab`
          state for the existing inline structure (kept intact to
          minimise diff). */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'conditions' | 'categories')}
        className="border-b border-gold/15 pb-4"
      >
        <AccentTabsList
          active={activeTab}
          tabs={[
            { value: 'conditions', label: 'Conditions', icon: HeartPulse },
            { value: 'categories', label: 'Condition Categories', icon: Layers },
          ]}
        />
      </Tabs>

      {/* ── Conditions tab body ──────────────────────────────── */}
      {activeTab === 'categories' && (
        <ProficiencyEntityShell
          userProfile={userProfile}
          hideHeader
          table="conditionCategories"
          singular="Condition Category"
          plural="Condition Categories"
          icon={Layers}
          description="Groupings for status conditions surfaced as the badge next to each condition in the Active Effect picker (PHB Conditions, Combat States, Spell States, System Extras, or your own). Edit the seeded categories or add new ones; status_conditions.category_id references rows here."
          {...TAXONOMY_TAB_BASE}
        />
      )}

      {/* ── Conditions tab body ──────────────────────────────────────────── */}
      {/* Driven by the shared EntityListSection. The column definitions
          carry per-cell render callbacks so condition-specific bits
          (the icon tile, the colored source chip, the implied/AE-count
          summary under the name, the delete-on-hover) all live inline
          with the column they belong to. */}
      {activeTab === 'conditions' && (() => {
        const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
        const cols: ColumnDef<StatusCondition>[] = [
          {
            key: 'icon',
            label: '',
            width: '40px',
            minBreakpoint: 'always',
            render: (item) => (
              <div className="w-8 h-8 rounded border border-gold/15 bg-background/50 flex items-center justify-center overflow-hidden">
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-full h-full object-contain p-0.5"
                  />
                ) : (
                  <HeartPulse className="w-3.5 h-3.5 text-gold/45" />
                )}
              </div>
            ),
          },
          {
            key: 'name',
            label: 'Name',
            width: 'minmax(0,1fr)',
            sortable: true,
            minBreakpoint: 'always',
            render: (item) => (
              <div className="min-w-0">
                <div className="text-xs font-bold text-ink truncate">
                  {item.name}
                </div>
                {/* Secondary meta line (implied / AE count) lives
                    under the name when something's there to show.
                    Defensive Array.isArray guards because cached
                    payloads can occasionally surface implied_ids /
                    changes as raw strings if d1.ts's auto-parse list
                    ever misses the column. */}
                {((Array.isArray(item.implied_ids) && item.implied_ids.length > 0) ||
                  (Array.isArray(item.changes) && item.changes.length > 0)) && (
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {Array.isArray(item.implied_ids) && item.implied_ids.length > 0 && (
                      <span className="text-[9px] text-ink/45 uppercase tracking-widest font-bold truncate">
                        → {item.implied_ids.join(', ')}
                      </span>
                    )}
                    {Array.isArray(item.changes) && item.changes.length > 0 && (
                      <span className="text-[9px] text-ink/45 font-bold uppercase tracking-widest flex items-center gap-0.5">
                        <Zap className="w-2.5 h-2.5 text-gold/35" />
                        {item.changes.length} change
                        {item.changes.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'identifier',
            label: 'Identifier',
            width: '140px',
            sortable: true,
            minBreakpoint: 'sm',
            render: (item) => (
              <div className="text-[10px] text-ink/55 font-mono truncate">
                {item.identifier}
              </div>
            ),
          },
          {
            key: 'source',
            label: 'Source',
            width: '110px',
            sortable: true,
            minBreakpoint: 'md',
            render: (item) => (
              <span
                className={`text-[9px] font-bold uppercase tracking-widest border px-1.5 py-0.5 rounded ${
                  SOURCE_COLORS[item.source] || SOURCE_COLORS.custom
                }`}
              >
                {SOURCE_LABELS[item.source] || item.source}
              </span>
            ),
          },
          {
            key: 'category',
            label: 'Category',
            width: '130px',
            sortable: true,
            minBreakpoint: 'md',
            render: (item) => (
              <div className="text-[10px] text-ink/75 truncate">
                {(item.category_id && categoryNameById.get(item.category_id)) || '—'}
              </div>
            ),
          },
          {
            key: 'order',
            label: 'Order',
            width: '60px',
            sortable: true,
            minBreakpoint: 'sm',
            render: (item) => (
              <div className="text-[10px] text-ink/65 font-mono">
                {typeof item.order === 'number' ? item.order : '—'}
              </div>
            ),
          },
          {
            key: 'actions',
            label: '',
            width: '48px',
            minBreakpoint: 'always',
            render: (item) => (
              <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteId(item.id!);
                  }}
                  className="text-blood p-1 hover:bg-blood/10 rounded"
                  title="Delete"
                  type="button"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ),
          },
        ];

        return (
          <EntityListSection
            search={conditionSearch}
            onSearchChange={setConditionSearch}
            searchPlaceholder="Search conditions…"
            visibleCount={visibleConditions.length}
            totalCount={items.length}
            createLabel="New Condition"
            onCreate={openCreateCondition}
            columns={cols}
            rows={visibleConditions}
            rowKey={(item) => item.id!}
            rowTitle={(item) => item.description || ''}
            rowIsActive={(item) => editingItem?.id === item.id}
            onRowClick={startEdit}
            sortKey={conditionSort.key}
            sortDir={conditionSort.dir}
            onSortChange={(key) => toggleConditionSort(key as ConditionSortKey)}
            loading={loading}
            emptyState={
              <div className="p-12 text-center">
                <HeartPulse className="w-8 h-8 text-gold/25 mx-auto mb-3" />
                <p className="text-ink/45 font-serif italic text-sm mb-4">
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
            }
            noMatchMessage={`No conditions match “${conditionSearch}”.`}
          />
        );
      })()}

      {/* ── Condition edit modal ────────────────────────────────────────────
          Driven by the shared EntityEditModal: it owns the Dialog
          primitive, the 10/80/10 viewport-relative sizing, the
          minimal title bar (label + close), the scrollable body
          (custom-scrollbar + dialog-body padding/spacing), and the
          standard Delete/Cancel/Save footer. The form sections
          rendered as children stay condition-specific (icon upload,
          source enum, implied chips, effect changes, Details vs
          Automation sub-tabs). */}
      <EntityEditModal
        open={conditionModalOpen}
        onOpenChange={handleConditionModalOpenChange}
        onSubmit={handleSave}
        headerLabel={editingItem ? 'Editing Condition' : 'New Condition'}
        srTitle={
          editingItem
            ? `Editing ${form.name || 'condition'}`
            : 'New condition'
        }
        srDescription={
          editingItem
            ? 'Edit the status condition details below.'
            : 'Create a new status condition.'
        }
        isEditing={!!editingItem}
        saveLabel={editingItem ? 'Save Changes' : 'Create Condition'}
        saveDisabled={!form.name}
        onDelete={
          editingItem ? () => setPendingDeleteId(editingItem.id!) : undefined
        }
      >
        {/* The shared EntityEditModal owns the dialog-body wrapper
            (with custom-scrollbar + the dialog-body class's built-in
            space-y-5 between sections), so the children below are
            just the form sections. */}
                {/* Identity — now the merged "what is this condition"
                    block: image upload on the left (taller, so it
                    visually anchors the two rows of fields next to
                    it), and a 2x2 grid on the right holding Name +
                    Identifier on row 1 and Source + Category on row
                    2. Categorization no longer needs its own section
                    — at four fields it fits comfortably inside the
                    same grid, and keeping it next to Name avoids the
                    user having to bounce between sections to set the
                    basic attributes of a condition. */}
                <section className="space-y-3">
                  <FormSectionHeading>Identity</FormSectionHeading>
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start">
                    {/* Image tile — fixed-size square matching the
                        128×128 native size status-condition icons are
                        stored at. The previous attempt to stretch the
                        tile to match the 2x2 field grid's height via
                        `aspect-square + h-auto + w-auto` collapsed:
                        with no intrinsic dimension to derive from
                        (the ImageUpload child uses w-full h-full, so
                        it doesn't push out the parent), the box had
                        no size to enforce a square aspect on. A flat
                        fixed size renders predictably and happens to
                        align with the 2-row field grid since each
                        field row is ~58px tall (label + h-10 input)
                        and 2 rows + gap-3 ≈ 128px. */}
                    <div className="w-24 h-24 sm:w-32 sm:h-32 shrink-0">
                      <ImageUpload
                        compact
                        imageType="icon"
                        storagePath="icons/statuses/"
                        currentImageUrl={form.img || ''}
                        onUpload={(url) => setForm((f) => ({ ...f, img: url || null }))}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="field-label">Name</label>
                        <Input
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          className="field-input h-10 text-sm"
                          required
                          autoFocus
                          placeholder="e.g. Blinded"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="field-label">Identifier</label>
                        <Input
                          value={form.identifier}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, identifier: e.target.value }))
                          }
                          placeholder={slugify(form.name || 'blinded')}
                          className="field-input h-10 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="field-label">Source</label>
                        <Select
                          value={form.source}
                          onValueChange={(v: 'dnd5e' | 'custom' | 'imported') =>
                            setForm((f) => ({ ...f, source: v }))
                          }
                        >
                          <SelectTrigger className="field-input h-10 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dnd5e">D&amp;D 5e</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                            <SelectItem value="imported">Imported</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="field-label">Category</label>
                        <Select
                          value={form.category_id ?? '__none__'}
                          onValueChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              category_id: v === '__none__' ? null : v,
                            }))
                          }
                        >
                          <SelectTrigger className="field-input h-10 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Uncategorised</SelectItem>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Top-level tab strip — Details vs Automation.
                    Mirrors the FeatureModalHero / ClassEditor tab
                    pattern using the shared Tabs primitive
                    (src/components/ui/tabs.tsx) so the underline-
                    active styling, focus ring, and ARIA wiring all
                    come for free. Identity stays above this strip
                    (always visible — basic facts about the
                    condition); the strip toggles between:
                      • Details — Metadata + Description (the "what
                        is this condition")
                      • Automation — Implied Conditions + Effect
                        Changes (the "what does it do when applied")
                    The Automation tab shows a small gold dot when
                    either child has populated state, so users can
                    tell at a glance that the tab carries content
                    without having to switch in to check. */}
                {(() => {
                  const impliedCount = (form.impliedStatuses || []).length;
                  const changesCount = (form.changes || []).length;
                  const hasAutomation = impliedCount > 0 || changesCount > 0;
                  return (
                    <Tabs
                      value={editTab}
                      onValueChange={(v) => setEditTab(v as EditTab)}
                      className="w-full"
                    >
                      {/* Modal sub-tab strip — driven by the shared
                          ChevronTabsList. The Automation tab carries
                          a dot indicator when either implied or
                          effects are populated, so the user sees at
                          a glance whether the hidden tab holds
                          state. */}
                      <AccentTabsList
                        active={editTab}
                        tabs={[
                          { value: 'details', label: 'Details' },
                          {
                            value: 'automation',
                            label: 'Automation',
                            showDot: hasAutomation,
                            dotTitle: `${impliedCount} implied · ${changesCount} effect change${changesCount !== 1 ? 's' : ''}`,
                          },
                        ]}
                      />

                      {/* Details tab — Metadata first (small structural
                          fields up top where they're easy to reach),
                          then the Description markdown editor. */}
                      <TabsContent value="details" className="mt-6 space-y-6">
                        <section className="space-y-3">
                          <FormSectionHeading>Metadata</FormSectionHeading>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="field-label">Order</label>
                              <Input
                                type="number"
                                value={form.order ?? ''}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    order:
                                      e.target.value === '' ? null : Number(e.target.value),
                                  }))
                                }
                                className="field-input h-10 text-sm font-mono"
                              />
                              <p className="field-hint">Lower numbers appear first.</p>
                            </div>
                            <div className="space-y-1">
                              <label className="field-label">Reference</label>
                              <Input
                                value={form.reference || ''}
                                onChange={(e) =>
                                  setForm((f) => ({ ...f, reference: e.target.value }))
                                }
                                placeholder="Compendium.dnd5e.rules…"
                                className="field-input h-10 text-xs font-mono"
                              />
                              <p className="field-hint">
                                Foundry compendium reference (optional).
                              </p>
                            </div>
                          </div>
                        </section>

                        <section className="space-y-3">
                          <FormSectionHeading>Description</FormSectionHeading>
                          <MarkdownEditor
                            value={form.description || ''}
                            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                            placeholder="SRD condition description..."
                          />
                        </section>
                      </TabsContent>

                      {/* Automation tab — Implied Conditions (chip
                          picker) above Effect Changes (key/mode/value
                          editor). Both stacked since they're related
                          in purpose: how this condition behaves once
                          applied to a creature. */}
                      <TabsContent value="automation" className="mt-6 space-y-6">
                        <section className="space-y-3">
                          <FormSectionHeading>Implied Conditions</FormSectionHeading>
                          <p className="field-hint">
                            Conditions this one implies (e.g., Paralyzed → Incapacitated).
                          </p>
                          {items.filter((i) => i.id !== editingItem?.id).length === 0 ? (
                            <p className="text-[11px] text-ink/35 italic">
                              No other conditions to choose from yet.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {items
                                .filter((i) => i.id !== editingItem?.id)
                                .map((i) => {
                                  const active = (form.impliedStatuses || []).includes(
                                    i.identifier,
                                  );
                                  return (
                                    <button
                                      key={i.id}
                                      type="button"
                                      onClick={() => toggleImplied(i.identifier)}
                                      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border transition-colors ${
                                        active
                                          ? 'bg-gold/25 border-gold/45 text-gold'
                                          : 'bg-card border-gold/15 text-ink/45 hover:text-ink/75'
                                      }`}
                                    >
                                      {i.name}
                                    </button>
                                  );
                                })}
                            </div>
                          )}
                        </section>

                        <section className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <FormSectionHeading>Effect Changes</FormSectionHeading>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={addChange}
                              className="h-7 px-2 text-gold/75 hover:text-gold text-xs"
                            >
                              <Plus className="w-3.5 h-3.5 mr-1" /> Add change
                            </Button>
                          </div>
                          <p className="field-hint">
                            Active Effect changes applied when this condition is set.
                          </p>
                          {(form.changes || []).length === 0 ? (
                            <p className="text-[11px] text-ink/35 italic">
                              No mechanical changes defined.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {(form.changes || []).map((change, idx) => (
                                <div key={idx} className="flex gap-1.5 items-start">
                                  <div className="flex-1 space-y-1">
                                    <Input
                                      value={change.key}
                                      onChange={(e) =>
                                        updateChange(idx, { key: e.target.value })
                                      }
                                      placeholder="system.attributes.movement.walk"
                                      className="h-8 bg-background/50 border-gold/15 font-mono text-xs placeholder:text-ink/25"
                                    />
                                    <div className="flex gap-1">
                                      <Select
                                        value={String(change.mode)}
                                        onValueChange={(v) =>
                                          updateChange(idx, { mode: Number(v) })
                                        }
                                      >
                                        <SelectTrigger className="h-8 bg-background/50 border-gold/15 text-xs flex-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {CHANGE_MODES.map((m) => (
                                            <SelectItem key={m.value} value={String(m.value)}>
                                              {m.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Input
                                        value={change.value}
                                        onChange={(e) =>
                                          updateChange(idx, { value: e.target.value })
                                        }
                                        placeholder="value"
                                        className="h-8 bg-background/50 border-gold/15 font-mono text-xs flex-1 placeholder:text-ink/25"
                                      />
                                    </div>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeChange(idx)}
                                    className="h-8 w-7 p-0 text-red-400/60 hover:text-red-400 shrink-0"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </TabsContent>
                    </Tabs>
                  );
                })()}
      </EntityEditModal>

      {/* Destructive-action confirmation — styled with the dauligor
          ConfirmDialog rather than window.confirm, matching the
          categories tab and the shell's behaviour. */}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteId(null);
        }}
        title="Delete this status condition?"
        description={(() => {
          const target = items.find((i) => i.id === pendingDeleteId);
          return target?.name ? (
            <>
              You're about to remove{' '}
              <strong className="text-ink">{target.name}</strong>. This
              can't be undone.
            </>
          ) : (
            'This action cannot be undone.'
          );
        })()}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmConditionDelete}
      />

      {/* ── Import JSON modal ───────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-gold/25 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">

            <div className="flex items-center justify-between p-6 border-b border-gold/15 shrink-0">
              <div>
                <h2 className="text-lg font-serif font-bold text-ink">
                  Import Status Conditions
                </h2>
                <p className="text-xs text-ink/55 mt-0.5">
                  Paste a Foundry{' '}
                  <code className="font-mono text-gold/75">conditionTypes</code>{' '}
                  object or an array of condition objects
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setShowImport(false); setImportJson(''); setImportError(''); }}
                className="h-8 w-8 p-0 text-ink/45 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
              <textarea
                value={importJson}
                onChange={e => { setImportJson(e.target.value); setImportError(''); }}
                placeholder={`{\n  "blinded": { "label": "Blinded", "icon": "...", "reference": "..." },\n  "charmed": { "label": "Charmed", ... }\n}`}
                className="w-full h-64 bg-background/50 border border-gold/15 rounded-lg p-3 font-mono text-xs text-ink/85 resize-none focus:outline-none focus:ring-1 focus:ring-gold/35 placeholder:text-ink/25"
              />
              {importError && (
                <p className="text-xs text-red-400 font-semibold">{importError}</p>
              )}
              <div className="bg-gold/5 border border-gold/15 rounded-lg p-3 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold/65">Accepted Formats</p>
                <p className="text-[11px] text-ink/55 font-mono">
                  {'{ "blinded": { "label": "...", "icon": "...", "reference": "..." } }'}
                </p>
                <p className="text-[11px] text-ink/55 font-mono">
                  {'[ { "id": "blinded", "name": "Blinded", "img": "..." } ]'}
                </p>
              </div>
            </div>

            <div className="flex gap-2 p-6 border-t border-gold/15 shrink-0">
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
                className="border-gold/25 text-gold/65 hover:text-gold hover:bg-gold/15"
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
