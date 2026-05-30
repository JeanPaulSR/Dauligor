import React, { useState } from 'react';
import { Plus, Trash2, Edit, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContentLarge } from '../ui/dialog';
import { queueRebake } from '../../lib/moduleExport';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { actionLabel } from '../../lib/proposalAware';
import ScalingMatrixEditor from './ScalingMatrixEditor';
import { useBlockDraftedList } from '../../hooks/useBlockDraftedList';

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
 * Persistence (Part B — proposal-aware)
 * -------------------------------------
 * Writes route through `useProposalAccumulator('scaling_column', …)`,
 * which auto-routes by context:
 *   - admin / direct route → immediate `upsertDocument`/`deleteDocument`
 *     (same as the legacy path).
 *   - content-creator inside a <ProposalEditorWrapper> block → the write
 *     is QUEUED into the block instead of hitting the staff-only DB gate
 *     (which used to 403 a content-creator on `scaling_columns`).
 * `parent_type` may be any of the six `ScalingOwnerType`s — the proposal
 * approval side resolves all of them (per the cross-referential-cluster
 * design). Rename commits on blur (not per-keystroke) so block mode
 * doesn't flood the queue. `queueRebake` is skipped in block mode — the
 * module rebake fires on approval, not on queueing.
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
  /**
   * The active (effective) user profile. Drives the proposal-aware
   * writer: admins write directly; content-creators inside a block
   * queue the write. Omitting it makes the writer read-only (writes
   * throw) — every mount site should pass `effectiveProfile`.
   */
  userProfile?: any;
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
  userProfile,
  label = 'Scaling Columns',
  noun = 'scaling column',
}: ScalingColumnsPanelProps) {
  // Proposal-aware writer. Inside a <ProposalEditorWrapper> it queues
  // into the active block; on admin-direct routes it writes immediately.
  const writer = useProposalAccumulator('scaling_column', userProfile);
  // Null on admin-direct routes; non-null inside a block. Used to skip
  // the module rebake (it fires on approval, not on queueing).
  const inBlock = useProposalContextOptional() !== null;

  // F2 — own-list draft overlay. The parent passes the LIVE columns; in a block
  // a just-queued column has no live row yet, so merge the block's draft creates
  // (scoped to this parent) in so the author sees it in the panel instead of it
  // "vanishing." Returns `columns` unchanged on admin-direct routes.
  const displayColumns = useBlockDraftedList('scaling_column', columns, { parentId, parentType });

  // Local edit buffer for inline renames so typing stays responsive and
  // the write commits once on blur (block mode would otherwise queue one
  // change per keystroke).
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  // Full matrix-editor modal. `undefined` = closed; `null` = creating a
  // new column; a string = editing that column. Mounting the editor here
  // (inside the parent's proposal wrapper) instead of navigating to
  // /compendium/scaling/* keeps a content-creator's save inside the block.
  const [editingColumnId, setEditingColumnId] = useState<string | null | undefined>(undefined);
  const closeEditor = () => setEditingColumnId(undefined);

  const commitRename = async (col: ScalingColumnRow) => {
    const draft = nameDrafts[col.id];
    if (draft === undefined || draft === (col.name ?? '')) return;
    try {
      await writer.update(col.id, {
        name: draft,
        parent_id: parentId,
        parent_type: parentType,
      });
      if (!inBlock) queueRebake('scalingColumn', col.id);
      onColumnsChanged();
    } catch (error) {
      console.error('[ScalingColumnsPanel] rename failed:', error);
      toast.error(`Failed to rename ${noun}`);
    }
  };

  const handleDelete = async (scalingId: string) => {
    try {
      await writer.remove(scalingId);
      if (!inBlock) queueRebake('scalingColumn', scalingId);
      toast.success(actionLabel(writer.mode, 'deleted'));
      onColumnsChanged();
    } catch (error) {
      console.error('[ScalingColumnsPanel] delete failed:', error);
      toast.error(`Failed to delete ${noun}`);
    }
  };

  return (
    <>
    <div className="p-4 border border-gold/20 bg-card/50 space-y-4 rounded-xl">
      <div className="section-header">
        <h2 className="label-text text-gold uppercase tracking-tighter">{label}</h2>
        <Button size="sm" className="h-6 btn-gold" onClick={() => setEditingColumnId(null)}>
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>

      <div className="space-y-4">
        {displayColumns.map((col) => {
          const valuesMap = (typeof col.values === 'string'
            ? (() => { try { return JSON.parse(col.values as string); } catch { return {}; } })()
            : col.values) as Record<string, any> || {};
          const breakpoints = getScalingBreakpoints(valuesMap);
          return (
            <div key={col.id} className="p-3 bg-gold/5 border border-gold/10 rounded space-y-2 group relative">
              <div className="flex items-center justify-between">
                <Input
                  value={nameDrafts[col.id] ?? col.name ?? ''}
                  onChange={(e) =>
                    setNameDrafts((prev) => ({ ...prev, [col.id]: e.target.value }))
                  }
                  // Commit on blur (and on Enter) rather than per keystroke:
                  // in block mode a per-keystroke writer.update would queue
                  // a change for every character typed.
                  onBlur={() => commitRename(col)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  className="h-6 text-[11px] font-bold bg-transparent border-none p-0 focus-visible:ring-0"
                />
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-gold"
                    onClick={() => setEditingColumnId(col.id)}
                  >
                    <Edit className="w-3 h-3" />
                  </Button>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingColumnId(col.id)}
                  className="w-full h-6 text-[9px] font-bold uppercase tracking-widest text-gold/60 hover:text-gold hover:bg-gold/5 border border-gold/10"
                >
                  Open Full Matrix Editor
                </Button>
              </div>
            </div>
          );
        })}
        {displayColumns.length === 0 && (
          <p className="text-[10px] text-ink/30 text-center italic py-4">
            No {noun}s defined.
          </p>
        )}
      </div>
    </div>

    <Dialog open={editingColumnId !== undefined} onOpenChange={(open) => { if (!open) closeEditor(); }}>
      <DialogContentLarge className="dialog-content">
        {editingColumnId !== undefined && (
          <ScalingMatrixEditor
            columnId={editingColumnId}
            parentId={parentId}
            parentType={parentType}
            userProfile={userProfile}
            onSaved={() => { closeEditor(); onColumnsChanged(); }}
            onDeleted={() => { closeEditor(); onColumnsChanged(); }}
          />
        )}
      </DialogContentLarge>
    </Dialog>
    </>
  );
}
