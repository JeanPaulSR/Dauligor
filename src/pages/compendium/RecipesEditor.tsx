import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import {
  CompendiumEditorShell,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import SingleSelectSearch, { type SingleSelectSearchOption } from '../../components/ui/SingleSelectSearch';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import MarkdownEditor from '../../components/MarkdownEditor';
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';

// ─── Recipe form shape (camelCase, mirrors the recipes table) ──────────────
type OutputType = 'item' | 'enchantment' | 'enchant-item';
type RecipeInput = { itemId: string; quantity: number };

type RecipeForm = {
  name: string;
  identifier: string;
  sourceId: string;
  page: string;
  description: string;
  imageUrl: string;
  disciplineId: string;
  outputType: OutputType;
  outputItemId: string;
  outputEnchantmentId: string;
  outputBaseItemId: string;
  outputQuantity: number;
  inputs: RecipeInput[];
  goldCostValue: number | '';
  goldCostDenom: string;
  craftTimeValue: number | '';
  craftTimeUnit: string;
  craftChecks: number | '';
  craftDifficultyDC: number | '';
  minLevel: number | '';
  tagIds: string[];
};

const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];
const TIME_UNITS = ['minute', 'hour', 'day', 'week'];
const OUTPUT_TYPES: { value: OutputType; label: string; hint: string }[] = [
  { value: 'item', label: 'Item', hint: 'Produces a catalog item (potion, gear, material…)' },
  { value: 'enchantment', label: 'Enchantment', hint: 'Crafts an enchantment definition itself' },
  { value: 'enchant-item', label: 'Enchant a base', hint: 'Apply an enchantment to a base item → a magic item' },
];

const BLANK: RecipeForm = {
  name: '', identifier: '', sourceId: '', page: '', description: '', imageUrl: '',
  disciplineId: '', outputType: 'item', outputItemId: '', outputEnchantmentId: '',
  outputBaseItemId: '', outputQuantity: 1, inputs: [],
  goldCostValue: '', goldCostDenom: 'gp', craftTimeValue: '', craftTimeUnit: 'hour',
  craftChecks: '', craftDifficultyDC: '', minLevel: '', tagIds: [],
};

function hydrate(row: any): RecipeForm {
  const gold = row.goldCost || {};
  const time = row.craftTime || {};
  const req = row.craftRequirements || {};
  return {
    name: row.name || '',
    identifier: row.identifier || '',
    sourceId: row.sourceId || '',
    page: row.page || '',
    description: row.description || '',
    imageUrl: row.imageUrl || '',
    disciplineId: row.disciplineId || '',
    outputType: (row.outputType as OutputType) || 'item',
    outputItemId: row.outputItemId || '',
    outputEnchantmentId: row.outputEnchantmentId || '',
    outputBaseItemId: row.outputBaseItemId || '',
    outputQuantity: typeof row.outputQuantity === 'number' ? row.outputQuantity : 1,
    inputs: Array.isArray(row.inputs)
      ? row.inputs.map((i: any) => ({ itemId: i.itemId || '', quantity: Number(i.quantity) || 1 }))
      : [],
    goldCostValue: typeof gold.value === 'number' ? gold.value : '',
    goldCostDenom: gold.denomination || 'gp',
    craftTimeValue: typeof time.value === 'number' ? time.value : '',
    craftTimeUnit: time.unit || 'hour',
    craftChecks: typeof row.craftChecks === 'number' ? row.craftChecks : '',
    craftDifficultyDC: typeof row.craftDifficultyDC === 'number' ? row.craftDifficultyDC : '',
    minLevel: typeof req.minLevel === 'number' ? req.minLevel : '',
    tagIds: Array.isArray(row.tags) ? row.tags.map(String) : [],
  };
}

export default function RecipesEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';

  const [recipes, setRecipes] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [disciplines, setDisciplines] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [enchantments, setEnchantments] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<RecipeForm>(BLANK);
  const [search, setSearch] = useState('');

  // ── Load every catalog the editor references ──
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [r, s, d, it, en, tg, tgg] = await Promise.all([
          fetchCollection<any>('recipes', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('craftingDisciplines', { orderBy: 'sort ASC, name ASC' }),
          fetchCollection<any>('items', { select: 'id, name, item_type, rarity', orderBy: 'name ASC' }),
          fetchCollection<any>('enchantments', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', {}),
        ]);
        if (!active) return;
        setRecipes(r);
        setSources(s);
        setDisciplines(d);
        setItems(it);
        setEnchantments(en);
        setTags(tg.map((x: any) => normalizeTagRow(x)));
        setTagGroups(tgg.map((g: any) => ({ id: String(g.id), name: String(g.name) })));
      } catch (err) {
        console.error('[RecipesEditor] load failed', err);
        toast.error('Failed to load recipes');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isAdmin]);

  // ── Picker option lists ──
  const itemOptions: SingleSelectSearchOption[] = useMemo(
    () => items.map((it) => ({ id: String(it.id), name: String(it.name), hint: it.item_type ? String(it.item_type) : undefined })),
    [items],
  );
  const enchantmentOptions: SingleSelectSearchOption[] = useMemo(
    () => enchantments.map((en) => ({ id: String(en.id), name: String(en.name), hint: en.rarity ? String(en.rarity) : undefined })),
    [enchantments],
  );
  const disciplineOptions: SingleSelectSearchOption[] = useMemo(
    () => disciplines.map((d) => ({ id: String(d.id), name: String(d.name) })),
    [disciplines],
  );
  const disciplineNameById = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.id, d.name])),
    [disciplines],
  );
  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.abbreviation || s.name])),
    [sources],
  );

  // ── Selection / lifecycle ──
  const selectRow = (id: string) => {
    setSelectedId(id);
    const row = recipes.find((r) => r.id === id);
    if (row) setForm(hydrate(row));
  };

  const onNew = () => {
    setSelectedId(null);
    setForm({ ...BLANK, sourceId: sources[0]?.id || '' });
  };

  const onReset = () => {
    const row = selectedId ? recipes.find((r) => r.id === selectedId) : null;
    setForm(row ? hydrate(row) : { ...BLANK, sourceId: sources[0]?.id || '' });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) { toast.error('Recipe name is required'); return; }
    setSaving(true);
    try {
      const id = selectedId || crypto.randomUUID();
      const craftRequirements: Record<string, any> = {};
      if (form.minLevel !== '') craftRequirements.minLevel = Number(form.minLevel);
      const payload: Record<string, any> = {
        name: form.name.trim(),
        identifier: form.identifier.trim() || slugify(form.name),
        sourceId: form.sourceId || null,
        page: form.page || null,
        description: form.description || '',
        imageUrl: form.imageUrl || null,
        disciplineId: form.disciplineId || null,
        outputType: form.outputType,
        outputItemId: form.outputType === 'item' ? (form.outputItemId || null) : null,
        outputEnchantmentId: form.outputType === 'item' ? null : (form.outputEnchantmentId || null),
        outputBaseItemId: form.outputType === 'enchant-item' ? (form.outputBaseItemId || null) : null,
        outputQuantity: form.outputQuantity || 1,
        inputs: form.inputs.filter((i) => i.itemId).map((i) => ({ itemId: i.itemId, quantity: Number(i.quantity) || 1 })),
        goldCost: form.goldCostValue === '' ? {} : { value: Number(form.goldCostValue), denomination: form.goldCostDenom },
        craftTime: form.craftTimeValue === '' ? {} : { value: Number(form.craftTimeValue), unit: form.craftTimeUnit },
        craftChecks: form.craftChecks === '' ? null : Number(form.craftChecks),
        craftDifficultyDC: form.craftDifficultyDC === '' ? null : Number(form.craftDifficultyDC),
        craftRequirements,
        tags: form.tagIds,
        updatedAt: new Date().toISOString(),
      };
      await upsertDocument('recipes', id, payload);
      toast.success(`Recipe ${selectedId ? 'updated' : 'created'}`);
      const updated = await fetchCollection<any>('recipes', { orderBy: 'name ASC' });
      setRecipes(updated);
      setSelectedId(id);
    } catch (err) {
      console.error('[RecipesEditor] save failed', err);
      toast.error('Failed to save recipe');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this recipe? This cannot be undone.')) return;
    try {
      await deleteDocument('recipes', selectedId);
      toast.success('Recipe deleted');
      setRecipes((prev) => prev.filter((r) => r.id !== selectedId));
      setSelectedId(null);
      setForm(BLANK);
    } catch (err) {
      console.error('[RecipesEditor] delete failed', err);
      toast.error('Failed to delete recipe');
    }
  };

  // ── Filtered list ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) =>
      (r.name || '').toLowerCase().includes(q) || (r.identifier || '').toLowerCase().includes(q),
    );
  }, [recipes, search]);

  const listColumns: EditorListColumn<any>[] = [
    { key: 'name', label: 'Recipe', width: 'minmax(0,1fr)', render: (r) => <span className="text-xs font-bold text-ink truncate">{r.name}</span> },
    { key: 'output', label: 'Output', width: '108px', align: 'center', render: (r) => <span className="text-[10px] text-ink/65">{r.outputType}</span> },
    { key: 'discipline', label: 'Discipline', width: '108px', align: 'center', render: (r) => <span className="text-[10px] text-ink/65">{disciplineNameById[r.disciplineId] || '—'}</span> },
  ];

  // ── Editor sub-tabs ──
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
          <div className="grid grid-cols-[1fr_1fr_72px] gap-3">
            <div className="space-y-1">
              <Label className="field-label">Source</Label>
              <select value={form.sourceId} onChange={(e) => setForm((p) => ({ ...p, sourceId: e.target.value }))} className="field-input h-9 w-full px-2">
                <option value="">— None —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Discipline</Label>
              <SingleSelectSearch value={form.disciplineId} onChange={(v) => setForm((p) => ({ ...p, disciplineId: v }))} options={disciplineOptions} placeholder="Select discipline…" className="w-full" triggerClassName="w-full h-9" />
            </div>
            <div className="space-y-1">
              <Label className="field-label">Page</Label>
              <Input value={form.page} onChange={(e) => setForm((p) => ({ ...p, page: e.target.value }))} className="field-input h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="field-label">Image</Label>
            <ImageUpload currentImageUrl={form.imageUrl} storagePath={`images/recipes/${selectedId || 'draft'}/`} onUpload={(url) => setForm((p) => ({ ...p, imageUrl: url }))} imageType="icon" compact className="h-[80px] w-[80px]" />
          </div>
          <div className="space-y-1">
            <Label className="field-label">Description</Label>
            <MarkdownEditor value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="How this recipe works…" minHeight="160px" maxHeight="360px" />
          </div>
        </div>
      ),
    },
    {
      key: 'output', label: 'Output',
      render: () => (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="field-label">What does this recipe make?</Label>
            <div className="grid grid-cols-3 gap-2">
              {OUTPUT_TYPES.map((ot) => (
                <button
                  key={ot.value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, outputType: ot.value }))}
                  className={`text-left p-2 border rounded text-xs transition-colors ${form.outputType === ot.value ? 'border-gold bg-gold/10' : 'border-gold/15 hover:border-gold/40'}`}
                >
                  <div className="font-bold text-ink">{ot.label}</div>
                  <div className="text-[10px] text-ink/55 mt-0.5 leading-snug">{ot.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {form.outputType === 'item' && (
            <div className="grid grid-cols-[1fr_90px] gap-3">
              <div className="space-y-1">
                <Label className="field-label">Output Item</Label>
                <SingleSelectSearch value={form.outputItemId} onChange={(v) => setForm((p) => ({ ...p, outputItemId: v }))} options={itemOptions} placeholder="Select item…" noEntitiesText="No items in the catalog yet." className="w-full" triggerClassName="w-full h-9" />
              </div>
              <div className="space-y-1">
                <Label className="field-label">Quantity</Label>
                <Input type="number" value={form.outputQuantity} onChange={(e) => setForm((p) => ({ ...p, outputQuantity: Number(e.target.value) || 1 }))} className="field-input h-9" />
              </div>
            </div>
          )}

          {form.outputType === 'enchantment' && (
            <div className="space-y-1">
              <Label className="field-label">Output Enchantment</Label>
              <SingleSelectSearch value={form.outputEnchantmentId} onChange={(v) => setForm((p) => ({ ...p, outputEnchantmentId: v }))} options={enchantmentOptions} placeholder="Select enchantment…" noEntitiesText="No enchantments authored yet." className="w-full" triggerClassName="w-full h-9" />
            </div>
          )}

          {form.outputType === 'enchant-item' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="field-label">Enchantment to Apply</Label>
                <SingleSelectSearch value={form.outputEnchantmentId} onChange={(v) => setForm((p) => ({ ...p, outputEnchantmentId: v }))} options={enchantmentOptions} placeholder="Select enchantment…" noEntitiesText="No enchantments authored yet." className="w-full" triggerClassName="w-full h-9" />
              </div>
              <div className="space-y-1">
                <Label className="field-label">
                  Base Item <span className="text-ink/40 normal-case font-normal">— leave empty to allow any valid base</span>
                </Label>
                <SingleSelectSearch value={form.outputBaseItemId} onChange={(v) => setForm((p) => ({ ...p, outputBaseItemId: v }))} options={itemOptions} placeholder="Any valid base…" className="w-full" triggerClassName="w-full h-9" />
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'inputs', label: 'Inputs & Cost',
      render: () => (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="field-label">Material / Item Inputs</Label>
              <button type="button" onClick={() => setForm((p) => ({ ...p, inputs: [...p.inputs, { itemId: '', quantity: 1 }] }))} className="text-[10px] text-gold flex items-center gap-1 hover:text-gold/70">
                <Plus className="w-3 h-3" /> Add input
              </button>
            </div>
            {form.inputs.length === 0 && <p className="text-[10px] text-ink/40 italic">No inputs yet — add the materials/items this recipe consumes.</p>}
            {form.inputs.map((inp, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_64px_28px] gap-2 items-center">
                <SingleSelectSearch
                  value={inp.itemId}
                  onChange={(v) => setForm((p) => { const next = [...p.inputs]; next[idx] = { ...next[idx], itemId: v }; return { ...p, inputs: next }; })}
                  options={itemOptions}
                  placeholder="Select item…"
                  className="w-full"
                  triggerClassName="w-full h-8"
                />
                <Input
                  type="number"
                  value={inp.quantity}
                  onChange={(e) => setForm((p) => { const next = [...p.inputs]; next[idx] = { ...next[idx], quantity: Number(e.target.value) || 1 }; return { ...p, inputs: next }; })}
                  className="field-input h-8"
                />
                <button type="button" onClick={() => setForm((p) => ({ ...p, inputs: p.inputs.filter((_, i) => i !== idx) }))} className="text-blood/70 hover:text-blood p-1" aria-label="Remove input">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="field-label">Gold Cost</Label>
              <div className="grid grid-cols-[1fr_60px] gap-1">
                <Input type="number" value={form.goldCostValue} onChange={(e) => setForm((p) => ({ ...p, goldCostValue: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
                <select value={form.goldCostDenom} onChange={(e) => setForm((p) => ({ ...p, goldCostDenom: e.target.value }))} className="field-input h-9 px-1">
                  {DENOMINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Crafting Time</Label>
              <div className="grid grid-cols-[1fr_78px] gap-1">
                <Input type="number" value={form.craftTimeValue} onChange={(e) => setForm((p) => ({ ...p, craftTimeValue: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
                <select value={form.craftTimeUnit} onChange={(e) => setForm((p) => ({ ...p, craftTimeUnit: e.target.value }))} className="field-input h-9 px-1">
                  {TIME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Checks</Label>
              <Input type="number" value={form.craftChecks} onChange={(e) => setForm((p) => ({ ...p, craftChecks: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
            </div>
            <div className="space-y-1">
              <Label className="field-label">Difficulty (DC)</Label>
              <Input type="number" value={form.craftDifficultyDC} onChange={(e) => setForm((p) => ({ ...p, craftDifficultyDC: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
            </div>
            <div className="space-y-1">
              <Label className="field-label">Min Character Level</Label>
              <Input type="number" value={form.minLevel} onChange={(e) => setForm((p) => ({ ...p, minLevel: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
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
          hint="Tag this recipe to group it in browsers."
          emptyHint="No tags available yet."
        />
      ),
    },
  ];

  return (
    <CompendiumEditorShell<any>
      entityName={{ singular: 'Recipe', plural: 'Recipes' }}
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
      searchPlaceholder="Search recipes…"
      activeFilterCount={0}
      isFilterOpen={false}
      setIsFilterOpen={() => {}}
      resetFilters={() => {}}
      identityName={form.name}
      identitySourceAbbrev={form.sourceId ? String(sourceAbbrevById[form.sourceId] || '') : undefined}
      identitySubtitle={form.outputType ? `Output · ${form.outputType}` : undefined}
      onSave={handleSave}
      onDelete={selectedId ? handleDelete : undefined}
      onReset={onReset}
      saving={saving}
      formId="recipe-manual-editor-form"
      editorSubTabs={editorSubTabs}
      tagsSubTabs={tagsSubTabs}
      tagsSuperTabCount={form.tagIds.length}
      renderPreview={(id) => {
        if (!id) return <div className="p-4 text-xs text-ink/40 italic">Select a recipe to preview.</div>;
        const row = recipes.find((r) => r.id === id);
        if (!row) return null;
        return (
          <div className="p-4 space-y-2 text-xs">
            <div className="font-bold text-ink text-sm">{row.name}</div>
            <div className="text-ink/65">Output: <span className="text-ink">{row.outputType}</span></div>
            <div className="text-ink/65">Discipline: <span className="text-ink">{disciplineNameById[row.disciplineId] || '—'}</span></div>
            <div className="text-ink/65">Inputs: <span className="text-ink">{Array.isArray(row.inputs) ? row.inputs.length : 0}</span></div>
            {typeof row.craftDifficultyDC === 'number' && <div className="text-ink/65">DC: <span className="text-ink">{row.craftDifficultyDC}</span></div>}
          </div>
        );
      }}
    />
  );
}
