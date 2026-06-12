import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import {
  CompendiumEditorShell,
  type EditorSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import SingleSelectSearch, { type SingleSelectSearchOption } from '../../components/ui/SingleSelectSearch';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import MarkdownEditor from '../../components/MarkdownEditor';

// ─── Shop form (camelCase, mirrors the shops table) ────────────────────────
// A shop's pool is `shopItems`: each entry is an item it stocks, plus an optional
// price override (else the item's own price is used). Items are NOT in any shop
// by default — the pool is explicit.
type ShopItemRow = { itemId: string; priceValue: number | ''; priceDenom: string };
type ShopForm = {
  name: string;
  identifier: string;
  description: string;
  imageUrl: string;
  shopItems: ShopItemRow[];
};

const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];

const BLANK: ShopForm = { name: '', identifier: '', description: '', imageUrl: '', shopItems: [] };

function hydrate(row: any): ShopForm {
  return {
    name: row.name || '',
    identifier: row.identifier || '',
    description: row.description || '',
    imageUrl: row.imageUrl || '',
    shopItems: Array.isArray(row.shopItems)
      ? row.shopItems.map((s: any) => ({
          itemId: s.itemId || '',
          priceValue: typeof s.priceOverride?.value === 'number' ? s.priceOverride.value : '',
          priceDenom: s.priceOverride?.denomination || 'gp',
        }))
      : [],
  };
}

function formatPrice(p: any): string {
  if (!p || typeof p.value !== 'number') return '—';
  return `${p.value} ${p.denomination || 'gp'}`;
}

export default function ShopEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';

  const [shops, setShops] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ShopForm>(BLANK);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [s, it] = await Promise.all([
          fetchCollection<any>('shops', { orderBy: 'name ASC' }),
          fetchCollection<any>('items', { select: 'id, name, item_type, price', orderBy: 'name ASC' }),
        ]);
        if (!active) return;
        setShops(s);
        setItems(it);
      } catch (err) {
        console.error('[ShopEditor] load failed', err);
        toast.error('Failed to load shops');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isAdmin]);

  const itemOptions: SingleSelectSearchOption[] = useMemo(
    () => items.map((it) => ({ id: String(it.id), name: String(it.name), hint: it.item_type ? String(it.item_type) : undefined })),
    [items],
  );
  const itemById = useMemo(() => Object.fromEntries(items.map((it) => [String(it.id), it])), [items]);

  const selectRow = (id: string) => {
    setSelectedId(id);
    const row = shops.find((s) => s.id === id);
    if (row) setForm(hydrate(row));
  };
  const onNew = () => { setSelectedId(null); setForm(BLANK); };
  const onReset = () => {
    const row = selectedId ? shops.find((s) => s.id === selectedId) : null;
    setForm(row ? hydrate(row) : BLANK);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) { toast.error('Shop name is required'); return; }
    setSaving(true);
    try {
      const id = selectedId || crypto.randomUUID();
      const payload: Record<string, any> = {
        name: form.name.trim(),
        identifier: form.identifier.trim() || slugify(form.name),
        description: form.description || '',
        imageUrl: form.imageUrl || null,
        shopItems: form.shopItems
          .filter((s) => s.itemId)
          .map((s) => {
            const entry: Record<string, any> = { itemId: s.itemId };
            if (s.priceValue !== '') entry.priceOverride = { value: Number(s.priceValue), denomination: s.priceDenom };
            return entry;
          }),
        updatedAt: new Date().toISOString(),
      };
      await upsertDocument('shops', id, payload);
      toast.success(`Shop ${selectedId ? 'updated' : 'created'}`);
      const updated = await fetchCollection<any>('shops', { orderBy: 'name ASC' });
      setShops(updated);
      setSelectedId(id);
    } catch (err) {
      console.error('[ShopEditor] save failed', err);
      toast.error('Failed to save shop');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this shop? This cannot be undone.')) return;
    try {
      await deleteDocument('shops', selectedId);
      toast.success('Shop deleted');
      setShops((prev) => prev.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      setForm(BLANK);
    } catch (err) {
      console.error('[ShopEditor] delete failed', err);
      toast.error('Failed to delete shop');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.identifier || '').toLowerCase().includes(q));
  }, [shops, search]);

  const listColumns: EditorListColumn<any>[] = [
    { key: 'name', label: 'Shop', width: 'minmax(0,1fr)', render: (s) => <span className="text-xs font-bold text-ink truncate">{s.name}</span> },
    { key: 'count', label: 'Items', width: '70px', align: 'center', render: (s) => <span className="text-[10px] text-ink/65">{Array.isArray(s.shopItems) ? s.shopItems.length : 0}</span> },
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
          <div className="space-y-1">
            <Label className="field-label">Image</Label>
            <ImageUpload currentImageUrl={form.imageUrl} storagePath={`images/shops/${selectedId || 'draft'}/`} onUpload={(url) => setForm((p) => ({ ...p, imageUrl: url }))} imageType="icon" compact className="h-[80px] w-[80px]" />
          </div>
          <div className="space-y-1">
            <Label className="field-label">Description</Label>
            <MarkdownEditor value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="Who runs it, where it is, what it specializes in…" minHeight="140px" maxHeight="320px" />
          </div>
        </div>
      ),
    },
    {
      key: 'inventory', label: 'Inventory',
      render: () => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="field-label">Items for sale <span className="text-ink/40 normal-case font-normal">— leave price blank to use the item's own price</span></Label>
            <button type="button" onClick={() => setForm((p) => ({ ...p, shopItems: [...p.shopItems, { itemId: '', priceValue: '', priceDenom: 'gp' }] }))} className="text-[10px] text-gold flex items-center gap-1 hover:text-gold/70">
              <Plus className="w-3 h-3" /> Add item
            </button>
          </div>
          {form.shopItems.length === 0 && <p className="text-[10px] text-ink/40 italic">No items stocked yet — items are not in any shop by default.</p>}
          {form.shopItems.map((row, idx) => {
            const base = itemById[row.itemId]?.price;
            return (
              <div key={idx} className="grid grid-cols-[1fr_88px_56px_28px] gap-2 items-center">
                <SingleSelectSearch
                  value={row.itemId}
                  onChange={(v) => setForm((p) => { const next = [...p.shopItems]; next[idx] = { ...next[idx], itemId: v }; return { ...p, shopItems: next }; })}
                  options={itemOptions}
                  placeholder="Select item…"
                  className="w-full"
                  triggerClassName="w-full h-8"
                />
                <Input
                  type="number"
                  value={row.priceValue}
                  placeholder={base && typeof base.value === 'number' ? String(base.value) : 'price'}
                  onChange={(e) => setForm((p) => { const next = [...p.shopItems]; next[idx] = { ...next[idx], priceValue: e.target.value === '' ? '' : Number(e.target.value) }; return { ...p, shopItems: next }; })}
                  className="field-input h-8"
                  aria-label="Price override"
                />
                <select
                  value={row.priceDenom}
                  onChange={(e) => setForm((p) => { const next = [...p.shopItems]; next[idx] = { ...next[idx], priceDenom: e.target.value }; return { ...p, shopItems: next }; })}
                  className="field-input h-8 px-1"
                >
                  {DENOMINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <button type="button" onClick={() => setForm((p) => ({ ...p, shopItems: p.shopItems.filter((_, i) => i !== idx) }))} className="text-blood/70 hover:text-blood p-1" aria-label="Remove item">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ),
    },
  ];

  return (
    <CompendiumEditorShell<any>
      entityName={{ singular: 'Shop', plural: 'Shops' }}
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
      getRowId={(s) => String(s.id)}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search shops…"
      activeFilterCount={0}
      isFilterOpen={false}
      setIsFilterOpen={() => {}}
      resetFilters={() => {}}
      identityName={form.name}
      identitySubtitle={`${form.shopItems.length} item${form.shopItems.length === 1 ? '' : 's'}`}
      onSave={handleSave}
      onDelete={selectedId ? handleDelete : undefined}
      onReset={onReset}
      saving={saving}
      formId="shop-manual-editor-form"
      editorSubTabs={editorSubTabs}
      tagsSubTabs={[]}
      renderPreview={(id) => {
        if (!id) return <div className="p-4 text-xs text-ink/40 italic">Select a shop to preview.</div>;
        const row = shops.find((s) => s.id === id);
        if (!row) return null;
        const list = Array.isArray(row.shopItems) ? row.shopItems : [];
        return (
          <div className="p-4 space-y-2 text-xs">
            <div className="font-bold text-ink text-sm">{row.name}</div>
            <div className="text-ink/65">Items: <span className="text-ink">{list.length}</span></div>
            <ul className="space-y-0.5">
              {list.slice(0, 12).map((s: any, i: number) => (
                <li key={i} className="flex justify-between gap-3 text-ink/80">
                  <span className="truncate">{itemById[s.itemId]?.name || 'Unknown item'}</span>
                  <span className="text-ink/55 shrink-0">{formatPrice(s.priceOverride || itemById[s.itemId]?.price)}</span>
                </li>
              ))}
              {list.length > 12 && <li className="text-ink/40 italic">+{list.length - 12} more…</li>}
            </ul>
          </div>
        );
      }}
    />
  );
}
