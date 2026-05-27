import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { upsertDocument, deleteDocument } from '../../lib/d1';
import { queueRebake } from '../../lib/moduleExport';

/**
 * Shared "Scaling Columns" sidebar — the small editor block that
 * lists an entity's scaling columns (Sneak Attack, Channel Divinity
 * Charges, Damage Dice, etc.), lets the author inline-rename them,
 * and links out to the full matrix editor for level-by-level value
 * authoring.
 *
 * Originally inlined inside ClassEditor; promoted to a shared
 * component when scaling columns became polymorphic across owners
 * (class, subclass, feat, race, background, item). Same UX, same
 * D1 paths — only the `(parentId, parentType)` pair varies.
 *
 * Why the panel writes directly to D1 on edit
 * --------------------------------------------
 * Each callsite carries its own loadTick / fetch loop; the panel
 * doesn't try to manage the columns array itself. It fires
 * upsertDocument on inline name changes (per-keystroke; legacy
 * pattern preserved from ClassEditor) and deleteDocument on
 * delete, then calls back via `onColumnsChanged` so the parent
 * can re-fetch. `queueRebake` keeps the module-export cache
 * invalidation honest.
 *
 * Owner types
 * -----------
 * 'class' / 'subclass' — pre-existing parents. Class features
 * (feats with feat_type='class' or 'subclass') do NOT get their
 * own scaling columns; they inherit from the parent class. The
 * other owner types — 'feat', 'race', 'background', 'item' —
 * own their columns directly.
 */

export type ScalingOwnerType =
  | 'class'
  | 'subclass'
  | 'feat'
  | 'race'
  | 'background'
  | 'item';

export interface ScalingColumnRow {
  id: string;
  name?: string;
  identifier?: string;
  type?: string;
  values?: Record<string, any> | string;
  parentId?: string;
  parentType?: ScalingOwnerType | string;
  [key: string]: any;
}

export interface ScalingColumnsPanelProps {
  /** The owning entity's id (class id, feat id, item id, etc.). */
  parentId: string;
  /** Which kind of entity owns these columns. Drives `parent_type` writes + URL params. */
  parentType: ScalingOwnerType;
  /** Pre-fetched columns for this parent. The panel does not re-fetch. */
  columns: ScalingColumnRow[];
  /**
   * Called after a delete (and optionally after edits) so the
   * parent can re-fetch and re-render with the canonical state.
   */
  onColumnsChanged: () => void;
  /** Sidebar header — defaults to "Scaling Columns". */
  label?: string;
  /** Singular noun for the empty state — defaults to "scaling column". */
  noun?: string;
}

/**
 * Walk the per-level `values` map and return a deduped list of
 * (level, value) pairs sorted ascending, with consecutive duplicate
 * values collapsed. This is the "breakpoints" view authors care
 * about — "+1d6 at 5, +2d6 at 11, +3d6 at 17" rather than
 * listing every level.
 *
 * Co-located with the panel so both ClassEditor and FeatsEditor get
 * the same dedup behavior without re-importing from each other.
 */
function getScalingBreakpoints(values: Record<string, any> = {}) {
  let lastValue: string | undefined;
  return Object.entries(values)
    .sort(([a], [b]) => Number(a) - Number(b))
    .filter(([, value]) => {
      const normalized = String(value ?? '');
      if (!normalized || normalized === lastValue) return false;
      lastValue = normalized;
      return true;
    });
}

export default function ScalingColumnsPanel({
  parentId,
  parentType,
  columns,
  onColumnsChanged,
  label = 'Scaling Columns',
  noun = 'scaling column',
}: ScalingColumnsPanelProps) {
  const handleDelete = async (scalingId: string) => {
    try {
      await deleteDocument('scaling_columns', scalingId);
      toast.success(`Scaling column deleted`);
      queueRebake('scalingColumn', scalingId);
      onColumnsChanged();
    } catch (error) {
      console.error('[ScalingColumnsPanel] delete failed:', error);
      toast.error(`Failed to delete ${noun}`);
    }
  };

  return (
    <div className="p-4 border border-gold/20 bg-card/50 space-y-4 rounded-xl">
      <div className="section-header">
        <h2 className="label-text text-gold uppercase tracking-tighter">{label}</h2>
        <Link to={`/compendium/scaling/new?parentId=${parentId}&parentType=${parentType}`}>
          <Button size="sm" className="h-6 btn-gold">
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </Link>
      </div>

      <div className="space-y-4">
        {columns.map((col) => {
          const valuesMap = (typeof col.values === 'string'
            ? (() => { try { return JSON.parse(col.values as string); } catch { return {}; } })()
            : col.values) as Record<string, any> || {};
          const breakpoints = getScalingBreakpoints(valuesMap);
          return (
            <div key={col.id} className="p-3 bg-gold/5 border border-gold/10 rounded space-y-2 group relative">
              <div className="flex items-center justify-between">
                <Input
                  value={col.name ?? ''}
                  onChange={(e) => {
                    // upsertDocument fires INSERT ... ON CONFLICT(id) DO UPDATE;
                    // SQLite checks NOT NULL on the insert-side row before
                    // routing to UPDATE, so we must supply parent_id +
                    // parent_type even on a name-only patch of an existing
                    // scaling column.
                    upsertDocument('scaling_columns', col.id, {
                      name: e.target.value,
                      parent_id: parentId,
                      parent_type: parentType,
                    });
                    queueRebake('scalingColumn', col.id);
                  }}
                  className="h-6 text-[11px] font-bold bg-transparent border-none p-0 focus-visible:ring-0"
                />
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={`/compendium/scaling/edit/${col.id}?parentId=${parentId}&parentType=${parentType}`}>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-gold">
                      <Edit className="w-3 h-3" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(col.id)}
                    className="h-5 w-5 p-0 text-blood"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <details className="group/details">
                <summary className="text-[9px] uppercase font-black tracking-widest text-gold/50 cursor-pointer select-none flex items-center justify-between hover:text-gold transition-colors [&::-webkit-details-marker]:hidden">
                  Breakpoints
                  <ChevronDown className="w-3 h-3 transition-transform group-open/details:rotate-180" />
                </summary>
                <div className="mt-2 space-y-2">
                  {breakpoints.length > 0 ? (
                    <div className="flex flex-col gap-1 w-full">
                      {breakpoints.map(([level, value]) => (
                        <div key={level} className="flex items-center gap-3 rounded border border-gold/10 bg-background/60 px-3 py-1.5 w-full">
                          <span className="text-[9px] font-black tracking-widest text-gold whitespace-nowrap min-w-[2.5rem]">Lvl {level}</span>
                          <div className="h-px bg-gold/10 flex-1" />
                          <span className="text-[11px] font-black text-ink">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-ink/30 italic">No saved matrix values yet.</p>
                  )}
                </div>
              </details>

              <div className="pt-1">
                <Link to={`/compendium/scaling/edit/${col.id}?parentId=${parentId}&parentType=${parentType}`}>
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[9px] font-bold uppercase tracking-widest text-gold/60 hover:text-gold hover:bg-gold/5 border border-gold/10">
                    Open Full Matrix Editor
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
        {columns.length === 0 && (
          <p className="text-[10px] text-ink/30 text-center italic py-4">
            No {noun}s defined.
          </p>
        )}
      </div>
    </div>
  );
}
