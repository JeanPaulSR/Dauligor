import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import {
  CompendiumEditorShell,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import MarkdownEditor from '../../components/MarkdownEditor';
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';
import ActiveEffectEditor, { type FoundryActiveEffect } from '../../components/compendium/ActiveEffectEditor';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import { type SemanticActivity } from '../../types/activities';

// ─── Enchant restriction vocab (mirrors ActivityEditor's enchant kind) ──────
// Foundry's enchantable item types ("" = any).
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
// Physical types (have quantity) — gate the Allow Magical option.
const ENCHANT_PHYSICAL_TYPES = new Set(['weapon', 'equipment', 'consumable', 'container', 'loot', 'tool']);
// Item Type → which category taxonomy supplies "Valid Categories".
const ENCHANT_CATEGORY_COLLECTION: Record<string, string> = {
  weapon: 'weaponCategories',
  equipment: 'armorCategories',
  tool: 'toolCategories',
  consumable: 'consumableCategories',
  loot: 'lootCategories',
};
const RESTRICTION_COLLECTIONS = [
  'weaponCategories', 'armorCategories', 'toolCategories',
  'consumableCategories', 'lootCategories', 'itemProperties',
] as const;

const RARITIES: { value: string; label: string }[] = [
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'veryRare', label: 'Very Rare' },
  { value: 'legendary', label: 'Legendary' },
  { value: 'artifact', label: 'Artifact' },
];
const ATTUNEMENTS: { value: string; label: string }[] = [
  { value: '', label: 'Not Required' },
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
];
const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];

type TaxRow = { id: string; identifier?: string; name: string; valid_types?: any };

type EnchantForm = {
  name: string;
  identifier: string;
  sourceId: string;
  page: string;
  description: string;
  imageUrl: string;
  restrictionType: string;
  restrictionCategories: string[];
  restrictionProperties: string[];
  allowMagical: boolean;
  activities: SemanticActivity[];
  effects: FoundryActiveEffect[];
  riders: any;            // preserved on edit; not authored in this MVP
  magicalBonus: number | '';
  rarity: string;
  attunement: string;
  priceValue: number | '';
  priceDenom: string;
  tagIds: string[];
};

const BLANK: EnchantForm = {
  name: '', identifier: '', sourceId: '', page: '', description: '', imageUrl: '',
  restrictionType: '', restrictionCategories: [], restrictionProperties: [], allowMagical: false,
  activities: [], effects: [], riders: {}, magicalBonus: '', rarity: '', attunement: '',
  priceValue: '', priceDenom: 'gp', tagIds: [],
};

function hydrate(row: any): EnchantForm {
  const r = row.restrictions || {};
  const price = row.price || {};
  return {
    name: row.name || '',
    identifier: row.identifier || '',
    sourceId: row.sourceId || '',
    page: row.page || '',
    description: row.description || '',
    imageUrl: row.imageUrl || '',
    restrictionType: r.type || '',
    restrictionCategories: Array.isArray(r.categories) ? r.categories.map(String) : [],
    restrictionProperties: Array.isArray(r.properties) ? r.properties.map(String) : [],
    allowMagical: !!r.allowMagical,
    activities: Array.isArray(row.activities) ? row.activities : [],
    effects: Array.isArray(row.effects) ? row.effects : [],
    riders: row.riders && typeof row.riders === 'object' ? row.riders : {},
    magicalBonus: typeof row.magicalBonus === 'number' ? row.magicalBonus : '',
    rarity: row.rarity || '',
    attunement: row.attunement || '',
    priceValue: typeof price.value === 'number' ? price.value : '',
    priceDenom: price.denomination || 'gp',
    tagIds: Array.isArray(row.tags) ? row.tags.map(String) : [],
  };
}

export default function EnchantmentsEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';

  const [enchantments, setEnchantments] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [restrictionData, setRestrictionData] = useState<Record<string, TaxRow[]>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<EnchantForm>(BLANK);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [e, s, tg, tgg] = await Promise.all([
          fetchCollection<any>('enchantments', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', {}),
        ]);
        if (!active) return;
        setEnchantments(e);
        setSources(s);
        setTags(tg.map((x: any) => normalizeTagRow(x)));
        setTagGroups(tgg.map((g: any) => ({ id: String(g.id), name: String(g.name) })));
      } catch (err) {
        console.error('[EnchantmentsEditor] load failed', err);
        toast.error('Failed to load enchantments');
      } finally {
        if (active) setLoading(false);
      }
    })();
    // Restriction taxonomies load independently (same set ActivityEditor uses).
    RESTRICTION_COLLECTIONS.forEach((coll) => {
      fetchCollection<TaxRow>(coll, { orderBy: 'name ASC' })
        .then((rows) => { if (active) setRestrictionData((prev) => ({ ...prev, [coll]: rows })); })
        .catch(() => {});
    });
    return () => { active = false; };
  }, [isAdmin]);

  // Valid Categories for the chosen Item Type.
  const categoryOptions = useMemo<{ id: string; name: string }[]>(() => {
    const coll = ENCHANT_CATEGORY_COLLECTION[form.restrictionType];
    if (!coll) return [];
    return (restrictionData[coll] || []).map((r) => ({ id: String(r.identifier || r.id), name: r.name }));
  }, [restrictionData, form.restrictionType]);

  // Valid Properties = item_properties whose valid_types includes the Item Type.
  const propertyOptions = useMemo<{ id: string; name: string }[]>(() => {
    if (!form.restrictionType) return [];
    const rows = restrictionData['itemProperties'] || [];
    return rows
      .filter((p) => {
        const vt = p.valid_types;
        const types = Array.isArray(vt) ? vt : (() => { try { return JSON.parse((vt as string) || '[]'); } catch { return []; } })();
        return Array.isArray(types) && types.includes(form.restrictionType);
      })
      .map((p) => ({ id: String(p.identifier || p.id), name: p.name }));
  }, [restrictionData, form.restrictionType]);

  const showAllowMagical = form.restrictionType === '' || ENCHANT_PHYSICAL_TYPES.has(form.restrictionType);

  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.abbreviation || s.name])),
    [sources],
  );

  const selectRow = (id: string) => {
    setSelectedId(id);
    const row = enchantments.find((r) => r.id === id);
    if (row) setForm(hydrate(row));
  };
  const onNew = () => {
    setSelectedId(null);
    setForm({ ...BLANK, sourceId: sources[0]?.id || '' });
  };
  const onReset = () => {
    const row = selectedId ? enchantments.find((r) => r.id === selectedId) : null;
    setForm(row ? hydrate(row) : { ...BLANK, sourceId: sources[0]?.id || '' });
  };

  // Toggle helper for the category / property chip rows.
  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) { toast.error('Enchantment name is required'); return; }
    setSaving(true);
    try {
      const id = selectedId || crypto.randomUUID();
      const payload: Record<string, any> = {
        name: form.name.trim(),
        identifier: form.identifier.trim() || slugify(form.name),
        sourceId: form.sourceId || null,
        page: form.page || null,
        description: form.description || '',
        imageUrl: form.imageUrl || null,
        restrictions: {
          allowMagical: showAllowMagical ? form.allowMagical : false,
          type: form.restrictionType || '',
          categories: form.restrictionCategories,
          properties: form.restrictionProperties,
        },
        activities: form.activities,
        effects: form.effects,
        riders: form.riders || {},
        magicalBonus: form.magicalBonus === '' ? null : Number(form.magicalBonus),
        rarity: form.rarity || null,
        attunement: form.attunement || '',
        price: form.priceValue === '' ? {} : { value: Number(form.priceValue), denomination: form.priceDenom },
        tags: form.tagIds,
        updatedAt: new Date().toISOString(),
      };
      await upsertDocument('enchantments', id, payload);
      toast.success(`Enchantment ${selectedId ? 'updated' : 'created'}`);
      const updated = await fetchCollection<any>('enchantments', { orderBy: 'name ASC' });
      setEnchantments(updated);
      setSelectedId(id);
    } catch (err) {
      console.error('[EnchantmentsEditor] save failed', err);
      toast.error('Failed to save enchantment');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this enchantment? This cannot be undone.')) return;
    try {
      await deleteDocument('enchantments', selectedId);
      toast.success('Enchantment deleted');
      setEnchantments((prev) => prev.filter((r) => r.id !== selectedId));
      setSelectedId(null);
      setForm(BLANK);
    } catch (err) {
      console.error('[EnchantmentsEditor] delete failed', err);
      toast.error('Failed to delete enchantment');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enchantments;
    return enchantments.filter((r) =>
      (r.name || '').toLowerCase().includes(q) || (r.identifier || '').toLowerCase().includes(q),
    );
  }, [enchantments, search]);

  const listColumns: EditorListColumn<any>[] = [
    { key: 'name', label: 'Enchantment', width: 'minmax(0,1fr)', render: (r) => <span className="text-xs font-bold text-ink truncate">{r.name}</span> },
    { key: 'type', label: 'Applies To', width: '110px', align: 'center', render: (r) => <span className="text-[10px] text-ink/65">{r.restrictions?.type ? (ENCHANT_ITEM_TYPE_OPTIONS.find((o) => o.value === r.restrictions.type)?.label || r.restrictions.type) : 'Any'}</span> },
    { key: 'rarity', label: 'Rarity', width: '90px', align: 'center', render: (r) => <span className="text-[10px] text-ink/65">{r.rarity || '—'}</span> },
  ];

  const editorSubTabs: EditorSubTab[] = [
    {
      key: 'basics', label: 'Basics',
      render: () => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="field-label">Name</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="field-input h-9" />
            </div>
            <div className="space-y-1">
              <Label className="field-label">Identifier</Label>
              <Input value={form.identifier} onChange={(e) => setForm((p) => ({ ...p, identifier: e.target.value }))} placeholder="auto from name" className="field-input h-9 font-mono text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_72px] gap-3">
            <div className="space-y-1">
              <Label className="field-label">Source</Label>
              <select value={form.sourceId} onChange={(e) => setForm((p) => ({ ...p, sourceId: e.target.value }))} className="field-input h-9 w-full px-2">
                <option value="">— None —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Page</Label>
              <Input value={form.page} onChange={(e) => setForm((p) => ({ ...p, page: e.target.value }))} className="field-input h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="field-label">Image</Label>
            <ImageUpload currentImageUrl={form.imageUrl} storagePath={`images/enchantments/${selectedId || 'draft'}/`} onUpload={(url) => setForm((p) => ({ ...p, imageUrl: url }))} imageType="icon" compact className="h-[80px] w-[80px]" />
          </div>
          <div className="space-y-1">
            <Label className="field-label">Description</Label>
            <MarkdownEditor value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="What this enchantment does…" minHeight="140px" maxHeight="320px" />
          </div>
        </div>
      ),
    },
    {
      key: 'restrictions', label: 'Restrictions',
      render: () => (
        <div className="space-y-4">
          <p className="text-[11px] text-ink/55 leading-snug">Gate which items this enchantment can be applied to (Foundry's Enchant-activity restrictions).</p>
          <div className="space-y-1">
            <Label className="field-label">Item Type</Label>
            <select
              value={form.restrictionType}
              onChange={(e) => setForm((p) => ({ ...p, restrictionType: e.target.value, restrictionCategories: [], restrictionProperties: [] }))}
              className="field-input h-9 w-full px-2"
            >
              {ENCHANT_ITEM_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {categoryOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="field-label">Valid Categories <span className="text-ink/40 normal-case font-normal">— which categories of that type</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {categoryOptions.map((c) => {
                  const on = form.restrictionCategories.includes(c.id);
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setForm((p) => ({ ...p, restrictionCategories: toggleIn(p.restrictionCategories, c.id) }))}
                      className={`px-2 py-1 text-[11px] border transition-colors ${on ? 'border-gold bg-gold/15 text-ink' : 'border-gold/20 text-ink/55 hover:border-gold/50'}`}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {propertyOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="field-label">Valid Properties <span className="text-ink/40 normal-case font-normal">— must be present to apply</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {propertyOptions.map((c) => {
                  const on = form.restrictionProperties.includes(c.id);
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setForm((p) => ({ ...p, restrictionProperties: toggleIn(p.restrictionProperties, c.id) }))}
                      className={`px-2 py-1 text-[11px] border transition-colors ${on ? 'border-gold bg-gold/15 text-ink' : 'border-gold/20 text-ink/55 hover:border-gold/50'}`}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showAllowMagical && (
            <label className="flex items-center gap-2 text-xs text-ink/80 cursor-pointer">
              <Checkbox checked={form.allowMagical} onCheckedChange={(c) => setForm((p) => ({ ...p, allowMagical: !!c }))} />
              Allow already-magical items to be enchanted
            </label>
          )}
        </div>
      ),
    },
    {
      key: 'activities', label: 'Activities',
      render: () => (
        <div className="space-y-3">
          <p className="text-[11px] text-ink/55 leading-snug">Activities this enchantment grants to the item it's applied to — e.g. a magic weapon's <em>swipe</em> attack, a wand's cast, a save effect. Authored exactly like an item's activities; they're added to the enchanted item when applied.</p>
          <ActivityEditor
            activities={form.activities}
            onChange={(acts) => setForm((p) => ({ ...p, activities: acts }))}
            context="item"
            availableEffects={form.effects}
            onAvailableEffectsChange={(fx) => setForm((p) => ({ ...p, effects: fx }))}
            defaultEffectImg={form.imageUrl || null}
          />
        </div>
      ),
    },
    {
      key: 'effects', label: 'Effects',
      render: () => (
        <div className="space-y-3">
          <p className="text-[11px] text-ink/55 leading-snug">The Active Effect changes this enchantment applies (name override, <span className="font-mono">system.magicalBonus</span>, damage riders, AC…). Use the <span className="font-mono">enchantment</span> type for the changes that ride the enchanted item. Shared with the Activities tab's effect associations.</p>
          <ActiveEffectEditor
            effects={form.effects}
            onChange={(fx) => setForm((p) => ({ ...p, effects: fx }))}
            defaultImg={form.imageUrl || null}
          />
        </div>
      ),
    },
    {
      key: 'economy', label: 'Magic & Economy',
      render: () => (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="field-label">Magic Bonus</Label>
              <Input type="number" value={form.magicalBonus} onChange={(e) => setForm((p) => ({ ...p, magicalBonus: e.target.value === '' ? '' : Number(e.target.value) }))} placeholder="+N" className="field-input h-9" />
            </div>
            <div className="space-y-1">
              <Label className="field-label">Rarity Conferred</Label>
              <select value={form.rarity} onChange={(e) => setForm((p) => ({ ...p, rarity: e.target.value }))} className="field-input h-9 w-full px-2">
                <option value="">— None —</option>
                {RARITIES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Attunement</Label>
              <select value={form.attunement} onChange={(e) => setForm((p) => ({ ...p, attunement: e.target.value }))} className="field-input h-9 w-full px-2">
                {ATTUNEMENTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1 max-w-[240px]">
            <Label className="field-label">Price Delta <span className="text-ink/40 normal-case font-normal">— economy value added</span></Label>
            <div className="grid grid-cols-[1fr_60px] gap-1">
              <Input type="number" value={form.priceValue} onChange={(e) => setForm((p) => ({ ...p, priceValue: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
              <select value={form.priceDenom} onChange={(e) => setForm((p) => ({ ...p, priceDenom: e.target.value }))} className="field-input h-9 px-1">
                {DENOMINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const tagsSubTabs: TagsSubTab[] = [
    {
      key: 'tags', label: 'Tags',
      render: () => (
        <TagPicker
          tags={tags}
          tagGroups={tagGroups}
          selectedIds={form.tagIds}
          onChange={(next) => setForm((p) => ({ ...p, tagIds: next }))}
          hint="Tag this enchantment to group it in browsers."
          emptyHint="No tags available yet."
        />
      ),
    },
  ];

  return (
    <CompendiumEditorShell<any>
      entityName={{ singular: 'Enchantment', plural: 'Enchantments' }}
      backPath="/compendium"
      modes={[{ key: 'manual-editor', label: 'Manual Editor', render: null }]}
      defaultModeKey="manual-editor"
      manualEditorModeKey="manual-editor"
      isAdmin={isAdmin}
      listRows={filtered}
      listColumns={listColumns}
      loading={loading}
      selectedId={selectedId}
      onSelect={selectRow}
      onNew={onNew}
      getRowId={(r) => String(r.id)}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search enchantments…"
      activeFilterCount={0}
      isFilterOpen={false}
      setIsFilterOpen={() => {}}
      resetFilters={() => {}}
      identityName={form.name}
      identitySourceAbbrev={form.sourceId ? String(sourceAbbrevById[form.sourceId] || '') : undefined}
      identitySubtitle={form.rarity ? `Enchantment · ${form.rarity}` : 'Enchantment'}
      onSave={handleSave}
      onDelete={selectedId ? handleDelete : undefined}
      onReset={onReset}
      saving={saving}
      formId="enchantment-manual-editor-form"
      editorSubTabs={editorSubTabs}
      tagsSubTabs={tagsSubTabs}
      tagsSuperTabCount={form.tagIds.length}
      renderPreview={(id) => {
        if (!id) return <div className="p-4 text-xs text-ink/40 italic">Select an enchantment to preview.</div>;
        const row = enchantments.find((r) => r.id === id);
        if (!row) return null;
        const effectCount = Array.isArray(row.effects) ? row.effects.length : 0;
        const activityCount = Array.isArray(row.activities) ? row.activities.length : 0;
        const appliesTo = row.restrictions?.type ? (ENCHANT_ITEM_TYPE_OPTIONS.find((o) => o.value === row.restrictions.type)?.label || row.restrictions.type) : 'Any';
        return (
          <div className="p-4 space-y-2 text-xs">
            <div className="font-bold text-ink text-sm">{row.name}</div>
            <div className="text-ink/65">Applies to: <span className="text-ink">{appliesTo}</span></div>
            {row.rarity && <div className="text-ink/65">Rarity: <span className="text-ink">{row.rarity}</span></div>}
            {typeof row.magicalBonus === 'number' && <div className="text-ink/65">Magic bonus: <span className="text-ink">+{row.magicalBonus}</span></div>}
            <div className="text-ink/65">Activities: <span className="text-ink">{activityCount}</span> · Effects: <span className="text-ink">{effectCount}</span></div>
          </div>
        );
      }}
    />
  );
}
