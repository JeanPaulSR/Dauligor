import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import SingleSelectSearch from '../ui/SingleSelectSearch';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { cn } from '../../lib/utils';

/**
 * ContainerContentsPanel — the "Stored Items" editor for a catalog/template
 * container (the recipe layer; see migration 20260608-1200).
 *
 * A row is either a **reference** to a catalog item (`item_id` + `quantity`)
 * or a **custom** one-off (`is_custom = 1`, `custom_data = { name }`). This is
 * the recipe an "Explorer's Pack" carries — references to existing catalog
 * items with counts, no duplicate item rows.
 *
 * Persistence is direct + immediate against the `container_contents` table
 * (the same save-first model the Scaling tab uses): the container must already
 * have a stable id, so the panel only mounts once the item is saved.
 *
 * These rows are NEVER edited by a character. When a container is added to a
 * sheet or imported from Foundry, the recipe is expanded into independent
 * per-character copies in `character_inventory` — so removing an item from one
 * character's bag never touches this list.
 */

export interface ContainerContentRow {
  id: string;
  container_id: string;
  item_id?: string | null;
  is_custom?: number;
  custom_data?: any;
  quantity?: number;
  sort_order?: number;
}

interface ItemCatalogEntry {
  id: string;
  name?: string;
  itemType?: string;
  item_type?: string;
}

interface ContainerContentsPanelProps {
  /** The saved container's items.id. */
  containerId: string;
  /** Catalog of items to reference (the editor's already-loaded list). */
  itemCatalog: ItemCatalogEntry[];
}

export default function ContainerContentsPanel({ containerId, itemCatalog }: ContainerContentsPanelProps) {
  const [rows, setRows] = useState<ContainerContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [customName, setCustomName] = useState('');
  // Bump to force-remount the add-picker so it resets to its placeholder
  // after each pick (it's a controlled action trigger, value stays '').
  const [pickerKey, setPickerKey] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchCollection<ContainerContentRow>('containerContents', {
        where: 'container_id = ?',
        params: [containerId],
        orderBy: 'sort_order, created_at',
      });
      setRows(data);
    } catch (err) {
      console.error('[ContainerContentsPanel] load failed:', err);
      toast.error('Failed to load container contents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!containerId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId]);

  const catalogById = useMemo(() => {
    const m = new Map<string, ItemCatalogEntry>();
    for (const it of itemCatalog) m.set(String(it.id), it);
    return m;
  }, [itemCatalog]);

  // Pick list excludes the container itself (can't contain itself).
  const pickerOptions = useMemo(() =>
    itemCatalog
      .filter((it) => String(it.id) !== containerId)
      .map((it) => ({
        id: String(it.id),
        name: it.name || '(unnamed)',
        hint: it.itemType || it.item_type || undefined,
      })),
  [itemCatalog, containerId]);

  const nextSort = () => (rows.length ? Math.max(...rows.map((r) => r.sort_order || 0)) + 1 : 0);

  const addCatalog = async (itemId: string) => {
    if (!itemId) return;
    const now = new Date().toISOString();
    try {
      await upsertDocument('containerContents', crypto.randomUUID(), {
        container_id: containerId,
        item_id: itemId,
        is_custom: 0,
        quantity: 1,
        sort_order: nextSort(),
        created_at: now,
        updated_at: now,
      });
      setPickerKey((k) => k + 1);
      await load();
    } catch (err) {
      console.error('[ContainerContentsPanel] add failed:', err);
      toast.error('Failed to add item');
    }
  };

  const addCustom = async () => {
    const name = customName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    try {
      await upsertDocument('containerContents', crypto.randomUUID(), {
        container_id: containerId,
        item_id: null,
        is_custom: 1,
        custom_data: { name },
        quantity: 1,
        sort_order: nextSort(),
        created_at: now,
        updated_at: now,
      });
      setCustomName('');
      await load();
    } catch (err) {
      console.error('[ContainerContentsPanel] add custom failed:', err);
      toast.error('Failed to add custom item');
    }
  };

  const commitQty = async (row: ContainerContentRow) => {
    const draft = qtyDrafts[row.id];
    setQtyDrafts((p) => { const n = { ...p }; delete n[row.id]; return n; });
    if (draft === undefined) return;
    const qty = Math.max(1, parseInt(draft, 10) || 1);
    if (qty === (row.quantity ?? 1)) return;
    try {
      await upsertDocument('containerContents', row.id, {
        container_id: row.container_id,
        item_id: row.item_id ?? null,
        is_custom: row.is_custom ?? 0,
        custom_data: row.custom_data ?? null,
        quantity: qty,
        sort_order: row.sort_order ?? 0,
        updated_at: new Date().toISOString(),
      });
      await load();
    } catch (err) {
      console.error('[ContainerContentsPanel] qty update failed:', err);
      toast.error('Failed to update quantity');
    }
  };

  const remove = async (rowId: string) => {
    try {
      await deleteDocument('containerContents', rowId);
      await load();
    } catch (err) {
      console.error('[ContainerContentsPanel] remove failed:', err);
      toast.error('Failed to remove item');
    }
  };

  const rowLabel = (row: ContainerContentRow): { name: string; missing?: boolean; custom?: boolean } => {
    if (row.is_custom) {
      const cd = typeof row.custom_data === 'string'
        ? (() => { try { return JSON.parse(row.custom_data as string); } catch { return {}; } })()
        : (row.custom_data || {});
      return { name: cd?.name || 'Custom item', custom: true };
    }
    const found = row.item_id ? catalogById.get(String(row.item_id)) : undefined;
    if (!found) return { name: 'Missing item', missing: true };
    return { name: found.name || '(unnamed)' };
  };

  return (
    <fieldset className="config-fieldset">
      <legend className="section-label text-gold/60 px-1">Stored Items</legend>
      <p className="field-hint mb-2">
        The container's recipe — references to catalog items, with a quantity.
        Contents materialize as the character's own copies when this container is
        added to a sheet or imported, so editing a character's bag never changes
        this list.
      </p>

      {/* Add from catalog */}
      <div className="mb-3">
        <SingleSelectSearch
          key={pickerKey}
          value=""
          onChange={(val) => addCatalog(val)}
          options={pickerOptions}
          placeholder="Search items to add…"
          allowClear={false}
          triggerClassName="w-full"
        />
      </div>

      {/* Rows */}
      {loading ? (
        <p className="field-hint italic py-2">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-center py-3 text-ink/35 italic text-xs">No contents yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const { name, missing, custom } = rowLabel(row);
            return (
              <div
                key={row.id}
                className="flex items-center gap-2 rounded border border-gold/15 bg-background/40 px-2.5 py-1.5"
              >
                <span className={cn('flex-1 text-xs truncate', missing ? 'text-blood/70 italic' : 'text-ink/80')}>
                  {name}
                  {custom && <span className="ml-1.5 text-[9px] uppercase tracking-widest text-gold/55">custom</span>}
                </span>
                <span className="text-[10px] text-ink/40">×</span>
                <Input
                  type="number"
                  min={1}
                  value={qtyDrafts[row.id] ?? String(row.quantity ?? 1)}
                  onChange={(e) => setQtyDrafts((p) => ({ ...p, [row.id]: e.target.value }))}
                  onBlur={() => commitQty(row)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="h-7 w-16 text-center text-xs bg-background/50 border-gold/15 no-number-spin"
                />
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  className="text-blood/60 hover:text-blood shrink-0 transition-colors"
                  aria-label="Remove content"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add a custom one-off (not a catalog item). */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gold/10">
        <Input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="Custom item name…"
          className="h-7 flex-1 text-xs bg-background/50 border-gold/15"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customName.trim()}
          className="flex items-center gap-1 px-2 h-7 text-[10px] uppercase tracking-widest font-black text-gold/65 hover:text-gold border border-dashed border-gold/20 hover:border-gold/40 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3 h-3" /> Custom
        </button>
      </div>
    </fieldset>
  );
}
