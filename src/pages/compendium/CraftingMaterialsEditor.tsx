import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { upsertItem, deleteItem } from '../../lib/compendium';
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
import MarkdownEditor from '../../components/MarkdownEditor';
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';

// ─── Material form shape (camelCase, mirrors the crafting_materials table) ──
type MaterialForm = {
  name: string;
  identifier: string;
  sourceId: string;
  page: string;
  description: string;
  imageUrl: string;
  category: string;
  rarity: string;
  subtype: string;
  usedFor: string[];      // crafting_disciplines id array
  priceValue: number | '';
  priceDenom: string;
  weightValue: number | '';
  weightUnits: string;
  tagIds: string[];
};

// category × rarity-tier × subtype is the "slot" a recipe input matches against.
const CATEGORIES: { value: string; label: string }[] = [
  { value: 'reagent', label: 'Reagent' },
  { value: 'essence', label: 'Essence' },
  { value: 'magicalInk', label: 'Magical Ink' },
  { value: 'metal', label: 'Metal' },
  { value: 'hide', label: 'Hide' },
  { value: 'wood', label: 'Wood' },
  { value: 'part', label: 'Part' },
  { value: 'gem', label: 'Gem' },
  { value: 'cookingSupply', label: 'Cooking Supply' },
  { value: 'misc', label: 'Misc' },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

// `trivial` is the new bottom tier above `common` (bare TEXT, app-validated).
const RARITIES: { value: string; label: string }[] = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'veryRare', label: 'Very Rare' },
  { value: 'legendary', label: 'Legendary' },
];

// Subtype is freeform, discriminated by category — datalist nudges consistency
// (recipes will eventually slot-match on category + subtype + rarity).
const SUBTYPE_SUGGESTIONS: Record<string, string[]> = {
  reagent: ['curative', 'reactive', 'poisonous'],
  essence: ['arcane', 'divine', 'primal', 'psionic'],
  metal: ['iron', 'steel', 'mithril', 'adamantine', 'cold-iron', 'silver'],
  wood: ['softwood', 'hardwood', 'ironwood', 'duskwood'],
  hide: ['pelt', 'scale', 'leather', 'chitin'],
  gem: ['ornamental', 'semiprecious', 'precious'],
};

const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];
const WEIGHT_UNITS = ['lb', 'kg'];

const BLANK: MaterialForm = {
  name: '', identifier: '', sourceId: '', page: '', description: '', imageUrl: '',
  category: 'reagent', rarity: '', subtype: '', usedFor: [],
  priceValue: '', priceDenom: 'gp', weightValue: '', weightUnits: 'lb', tagIds: [],
};

function hydrate(row: any): MaterialForm {
  const price = row.price || {};
  const weight = row.weight || {};
  return {
    name: row.name || '',
    identifier: row.identifier || '',
    sourceId: row.sourceId || '',
    page: row.page || '',
    description: row.description || '',
    imageUrl: row.imageUrl || '',
    category: row.category || 'misc',
    rarity: row.rarity || '',
    subtype: row.subtype || '',
    usedFor: Array.isArray(row.usedFor) ? row.usedFor.map(String) : [],
    priceValue: typeof price.value === 'number' ? price.value : '',
    priceDenom: price.denomination || 'gp',
    weightValue: typeof weight.value === 'number' ? weight.value : '',
    weightUnits: weight.units || 'lb',
    tagIds: Array.isArray(row.tags) ? row.tags.map(String) : [],
  };
}

export default function CraftingMaterialsEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';

  const [materials, setMaterials] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [disciplines, setDisciplines] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialForm>(BLANK);
  const [search, setSearch] = useState('');

  // ── Load every catalog the editor references ──
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [m, s, d, tg, tgg] = await Promise.all([
          fetchCollection<any>('craftingMaterials', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('craftingDisciplines', { orderBy: 'sort ASC, name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', {}),
        ]);
        if (!active) return;
        setMaterials(m);
        setSources(s);
        setDisciplines(d);
        setTags(tg.map((x: any) => normalizeTagRow(x)));
        setTagGroups(tgg.map((g: any) => ({ id: String(g.id), name: String(g.name) })));
      } catch (err) {
        console.error('[CraftingMaterialsEditor] load failed', err);
        toast.error('Failed to load crafting materials');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isAdmin]);

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
    const row = materials.find((m) => m.id === id);
    if (row) setForm(hydrate(row));
  };
  const onNew = () => {
    setSelectedId(null);
    setForm({ ...BLANK, sourceId: sources[0]?.id || '' });
  };
  const onReset = () => {
    const row = selectedId ? materials.find((m) => m.id === selectedId) : null;
    setForm(row ? hydrate(row) : { ...BLANK, sourceId: sources[0]?.id || '' });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) { toast.error('Material name is required'); return; }
    if (!form.category) { toast.error('Category is required'); return; }
    setSaving(true);
    try {
      const id = selectedId || crypto.randomUUID();
      const existing = selectedId ? materials.find((m) => m.id === selectedId) : null;
      // Reuse the paired item id on edit; mint one on first save.
      const itemId = existing?.itemId || crypto.randomUUID();
      const identifier = form.identifier.trim() || slugify(form.name);
      const price = form.priceValue === '' ? {} : { value: Number(form.priceValue), denomination: form.priceDenom };
      const weight = form.weightValue === '' ? {} : { value: Number(form.weightValue), units: form.weightUnits };
      const now = new Date().toISOString();

      // 1. Mirror the backing carryable loot item (subtype 'material') so the
      //    material stacks/prices/sells/saves to a character sheet AND becomes a
      //    selectable recipe input (recipe inputs reference items rows). Shares
      //    name/identifier/source so its uniqueness matches this material's.
      await upsertItem(itemId, {
        name: form.name.trim(),
        identifier,
        source_id: form.sourceId || null,
        page: form.page || null,
        image_url: form.imageUrl || null,
        description: form.description || '',
        item_type: 'loot',
        type_subtype: 'material',
        rarity: form.rarity || 'none',
        weight,
        price,
        tagIds: form.tagIds,
        updated_at: now,
      });

      // 2. The crafting-domain row (camelCase table — skips the alias layer).
      await upsertDocument('craftingMaterials', id, {
        name: form.name.trim(),
        identifier,
        sourceId: form.sourceId || null,
        page: form.page || null,
        description: form.description || '',
        imageUrl: form.imageUrl || null,
        itemId,
        category: form.category,
        rarity: form.rarity || null,
        subtype: form.subtype.trim() || null,
        usedFor: form.usedFor,
        price,
        weight,
        tags: form.tagIds,
        updatedAt: now,
      });

      toast.success(`Material ${selectedId ? 'updated' : 'created'}`);
      const updated = await fetchCollection<any>('craftingMaterials', { orderBy: 'name ASC' });
      setMaterials(updated);
      setSelectedId(id);
    } catch (err) {
      console.error('[CraftingMaterialsEditor] save failed', err);
      toast.error('Failed to save material');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this material and its linked carryable item? This cannot be undone.')) return;
    try {
      const existing = materials.find((m) => m.id === selectedId);
      await deleteDocument('craftingMaterials', selectedId);
      // Best-effort: drop the paired item too. If it's referenced (recipe input /
      // inventory) the delete may fail — keep the material delete and warn.
      if (existing?.itemId) {
        try { await deleteItem(existing.itemId); }
        catch (e) { console.warn('[CraftingMaterialsEditor] backing item delete failed', e); }
      }
      toast.success('Material deleted');
      setMaterials((prev) => prev.filter((m) => m.id !== selectedId));
      setSelectedId(null);
      setForm(BLANK);
    } catch (err) {
      console.error('[CraftingMaterialsEditor] delete failed', err);
      toast.error('Failed to delete material');
    }
  };

  // ── Filtered list ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) =>
      (m.name || '').toLowerCase().includes(q) || (m.identifier || '').toLowerCase().includes(q),
    );
  }, [materials, search]);

  const listColumns: EditorListColumn<any>[] = [
    { key: 'name', label: 'Material', width: 'minmax(0,1fr)', render: (r) => <span className="text-xs font-bold text-ink truncate">{r.name}</span> },
    { key: 'category', label: 'Category', width: '120px', align: 'center', render: (r) => <span className="text-[10px] text-ink/65">{CATEGORY_LABEL[r.category] || r.category || '—'}</span> },
    { key: 'rarity', label: 'Rarity', width: '96px', align: 'center', render: (r) => <span className="text-[10px] text-ink/65">{r.rarity || '—'}</span> },
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
            <ImageUpload currentImageUrl={form.imageUrl} storagePath={`images/materials/${selectedId || 'draft'}/`} onUpload={(url) => setForm((p) => ({ ...p, imageUrl: url }))} imageType="icon" compact className="h-[80px] w-[80px]" />
          </div>
          <div className="space-y-1">
            <Label className="field-label">Description</Label>
            <MarkdownEditor value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="What this material is, where it comes from…" minHeight="140px" maxHeight="320px" />
          </div>
        </div>
      ),
    },
    {
      key: 'classification', label: 'Classification',
      render: () => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="field-label">Category</Label>
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} className="field-input h-9 w-full px-2">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Rarity Tier</Label>
              <select value={form.rarity} onChange={(e) => setForm((p) => ({ ...p, rarity: e.target.value }))} className="field-input h-9 w-full px-2">
                <option value="">— Unset —</option>
                {RARITIES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="field-label">Subtype <span className="text-ink/40 normal-case font-normal">— flavor within the category</span></Label>
            <Input
              list={`material-subtype-${form.category}`}
              value={form.subtype}
              onChange={(e) => setForm((p) => ({ ...p, subtype: e.target.value }))}
              placeholder={(SUBTYPE_SUGGESTIONS[form.category] || []).join(' · ') || 'e.g. flavor / grade / form'}
              className="field-input h-9"
            />
            <datalist id={`material-subtype-${form.category}`}>
              {(SUBTYPE_SUGGESTIONS[form.category] || []).map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label className="field-label">Used For <span className="text-ink/40 normal-case font-normal">— which disciplines consume this material</span></Label>
            {disciplines.length === 0 && <p className="text-[10px] text-ink/40 italic">No crafting disciplines defined yet — add them in Admin → Crafting Disciplines.</p>}
            <div className="flex flex-wrap gap-1.5">
              {disciplines.map((d) => {
                const on = form.usedFor.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, usedFor: on ? p.usedFor.filter((x) => x !== d.id) : [...p.usedFor, d.id] }))}
                    className={`px-2 py-1 text-[11px] border transition-colors ${on ? 'border-gold bg-gold/15 text-ink' : 'border-gold/20 text-ink/55 hover:border-gold/50'}`}
                  >
                    {d.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'commerce', label: 'Commerce',
      render: () => (
        <div className="space-y-4">
          <div className="border border-gold/20 bg-gold/5 px-3 py-2 text-[11px] text-ink/65 leading-snug">
            Price &amp; weight are shared with the linked carryable item (<span className="font-mono">loot · material</span>)
            this material creates on save — so it stacks, prices, and sells like any item, and can be selected as a recipe input.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="field-label">Price (per unit)</Label>
              <div className="grid grid-cols-[1fr_60px] gap-1">
                <Input type="number" value={form.priceValue} onChange={(e) => setForm((p) => ({ ...p, priceValue: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
                <select value={form.priceDenom} onChange={(e) => setForm((p) => ({ ...p, priceDenom: e.target.value }))} className="field-input h-9 px-1">
                  {DENOMINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="field-label">Weight (per unit)</Label>
              <div className="grid grid-cols-[1fr_60px] gap-1">
                <Input type="number" value={form.weightValue} onChange={(e) => setForm((p) => ({ ...p, weightValue: e.target.value === '' ? '' : Number(e.target.value) }))} className="field-input h-9" />
                <select value={form.weightUnits} onChange={(e) => setForm((p) => ({ ...p, weightUnits: e.target.value }))} className="field-input h-9 px-1">
                  {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
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
          hint="Tag this material to group it in browsers."
          emptyHint="No tags available yet."
        />
      ),
    },
  ];

  return (
    <CompendiumEditorShell<any>
      entityName={{ singular: 'Material', plural: 'Crafting Materials' }}
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
      searchPlaceholder="Search materials…"
      activeFilterCount={0}
      isFilterOpen={false}
      setIsFilterOpen={() => {}}
      resetFilters={() => {}}
      identityName={form.name}
      identitySourceAbbrev={form.sourceId ? String(sourceAbbrevById[form.sourceId] || '') : undefined}
      identitySubtitle={form.category ? `Material · ${CATEGORY_LABEL[form.category] || form.category}` : undefined}
      onSave={handleSave}
      onDelete={selectedId ? handleDelete : undefined}
      onReset={onReset}
      saving={saving}
      formId="crafting-material-manual-editor-form"
      editorSubTabs={editorSubTabs}
      tagsSubTabs={tagsSubTabs}
      tagsSuperTabCount={form.tagIds.length}
      renderPreview={(id) => {
        if (!id) return <div className="p-4 text-xs text-ink/40 italic">Select a material to preview.</div>;
        const row = materials.find((m) => m.id === id);
        if (!row) return null;
        const used = Array.isArray(row.usedFor) ? row.usedFor : [];
        return (
          <div className="p-4 space-y-2 text-xs">
            <div className="font-bold text-ink text-sm">{row.name}</div>
            <div className="text-ink/65">Category: <span className="text-ink">{CATEGORY_LABEL[row.category] || row.category || '—'}</span></div>
            {row.rarity && <div className="text-ink/65">Rarity: <span className="text-ink">{row.rarity}</span></div>}
            {row.subtype && <div className="text-ink/65">Subtype: <span className="text-ink">{row.subtype}</span></div>}
            <div className="text-ink/65">Used for: <span className="text-ink">{used.length ? used.map((d: string) => disciplineNameById[d] || d).join(', ') : '—'}</span></div>
            <div className="text-ink/65">Linked item: <span className="text-ink">{row.itemId ? 'yes' : '—'}</span></div>
          </div>
        );
      }}
    />
  );
}
