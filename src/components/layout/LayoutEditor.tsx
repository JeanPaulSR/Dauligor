import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, LayoutGrid, Star, BookMarked, Type, ImageIcon, Minus, Square, Columns3, Megaphone, Lock, EyeOff, Link2, Hash,
  ChevronUp, ChevronDown, Trash2, Copy, X, GripVertical, Search, ChevronLeft,
  ChevronsLeftRight, ChevronsRightLeft,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import MarkdownEditor from '../MarkdownEditor';
import { ImageUpload } from '../ui/ImageUpload';
import { cn } from '../../lib/utils';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { searchReferences } from '../../lib/references';
import { searchSystemPages, searchSystemEntries } from '../../lib/systemPages';
import {
  makeBlock, isContainer, makePlaceholderRef, BLOCK_TYPE_META, LAYOUT_BLOCK_TYPES, ENTITY_PICKER_KINDS,
  PLACEHOLDER_TITLE, PLACEHOLDER_DESCRIPTION,
  type LayoutBlock, type LayoutBlockType, type ContainerBlock, type EntityRef,
} from '../../lib/layoutBlocks';

const ICONS: Record<string, any> = { Sparkles, LayoutGrid, Star, BookMarked, Type, ImageIcon, Minus, Square, Columns3, Megaphone, Lock, EyeOff, Link2, Hash };

/** Visible text overrides — defaults are surface-neutral; a host (campaign,
 *  article, …) passes its own wording so the editor reads naturally there. */
export interface LayoutEditorLabels {
  title?: string;                 // header / section title
  titleSuffix?: string;           // e.g. the campaign / article name shown after the title
  description?: string;           // boxed-mode subtitle
  previewLabel?: string;          // preview pane head
  emptyPreviewTitle?: string;     // empty-state line in the preview pane
  emptyPreviewHint?: string;      // empty-state sub-line
  saveLabel?: string;             // save button (enabled)
  savedLabel?: string;            // save button (nothing to save)
  restoreLabel?: string;          // restore-default button
  backLabel?: string;             // fullscreen back button
  noun?: string;                  // used in toasts / confirm dialogs (e.g. "homepage layout")
  seedBanner?: React.ReactNode;   // banner shown when the layout was seeded from a default
}

interface LayoutEditorProps {
  /** Load the saved blocks for this surface. Empty array → seedDefault (if any) or an empty canvas.
   *  Ignored (and unnecessary) in controlled mode — the host owns the block state. */
  load?: () => Promise<LayoutBlock[]>;
  /** Persist the full block list (replace-all). Drives the built-in Save button.
   *  Omit in controlled mode — the host saves blocks as part of its own flow. */
  save?: (blocks: LayoutBlock[]) => Promise<void>;
  /** Render the live preview for the given blocks (host supplies the surface
   *  renderer — e.g. LayoutBlocks with campaign reco, or with an article's viewContext). */
  renderPreview: (blocks: LayoutBlock[]) => React.ReactNode;
  /** Controlled mode: the host owns the block list. When set, internal load/seed/
   *  save/dirty tracking are skipped and edits flow out through onBlocksChange. */
  controlled?: { blocks: LayoutBlock[]; onBlocksChange: (blocks: LayoutBlock[]) => void };
  /** Embedded mode: render ONLY the three panes (no header, Save/Restore actions,
   *  seed banner, or body-class management) so a host page can supply its own
   *  chrome and unified save. The panes fill their flex parent. */
  embedded?: boolean;
  /** Optional seed used when load() is empty and for the "Restore Default" button.
   *  Omit to start blank with no restore affordance. */
  seedDefault?: () => LayoutBlock[];
  /** Which block types the add-block picker offers (filtered by group). Default = all. */
  allowedTypes?: LayoutBlockType[];
  /** R2 path image blocks upload into. */
  imageStoragePath?: string;
  /** localStorage key for the resizable pane widths (keep stable per surface). */
  paneStorageKey?: string;
  /** Fullscreen route mode: mounts the admin-page-fullscreen body class, shows a
   *  Back header, locks to the viewport, and enables the draggable pane resizers.
   *  Off (default) = the in-tab boxed layout. */
  fullscreen?: boolean;
  /** Called by the Back button in fullscreen mode. */
  onBack?: () => void;
  labels?: LayoutEditorLabels;
  /** Host-supplied inspector fields for block types the generic editor can't edit
   *  on its own (e.g. a `secret` block needing era/campaign data). Rendered below
   *  the built-in inspector fields; return null to defer to the built-in editor. */
  renderInspectorExtras?: (block: LayoutBlock, set: (patch: Record<string, any>) => void) => React.ReactNode;
}

/* Pane widths (px) for the resizable Structure | Preview | Inspector layout —
   only the side panes are sized; the preview is flex-1. Persisted per browser. */
const DEFAULT_PANE_KEY = 'dauligor:layoutEditor:panes:v1';
const TREE_MIN = 180, TREE_MAX = 420, TREE_DEFAULT = 248;
const INSP_MIN = 260, INSP_MAX = 520, INSP_DEFAULT = 320;
function loadPaneWidths(key: string): { tree: number; insp: number } {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw);
      const tree = Math.min(TREE_MAX, Math.max(TREE_MIN, Number(p.tree) || TREE_DEFAULT));
      const insp = Math.min(INSP_MAX, Math.max(INSP_MIN, Number(p.insp) || INSP_DEFAULT));
      return { tree, insp };
    }
  } catch { /* ignore */ }
  return { tree: TREE_DEFAULT, insp: INSP_DEFAULT };
}
/* Whether the middle live-preview pane is collapsed (persisted per surface, so a
   user who prefers a wide edit area keeps it that way across visits). */
function loadPreviewCollapsed(key: string): boolean {
  try { return localStorage.getItem(`${key}:previewCollapsed`) === '1'; } catch { return false; }
}

/* ── tree mutation helpers (operate on a deep clone, return new tree) ── */
const clone = (blocks: LayoutBlock[]): LayoutBlock[] => JSON.parse(JSON.stringify(blocks));
function findBlock(blocks: LayoutBlock[], id: string): LayoutBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (isContainer(b)) { const f = findBlock(b.children, id); if (f) return f; }
  }
  return null;
}
function findParentList(blocks: LayoutBlock[], id: string): { list: LayoutBlock[]; index: number } | null {
  const i = blocks.findIndex((b) => b.id === id);
  if (i >= 0) return { list: blocks, index: i };
  for (const b of blocks) {
    if (isContainer(b)) { const r = findParentList(b.children, id); if (r) return r; }
  }
  return null;
}
function isDescendant(blocks: LayoutBlock[], ancestorId: string, id: string): boolean {
  const a = findBlock(blocks, ancestorId);
  if (!a || !isContainer(a)) return false;
  return findBlock(a.children, id) !== null;
}

export default function LayoutEditor({
  load, save, renderPreview, controlled, embedded = false, seedDefault, allowedTypes,
  imageStoragePath = 'images/layout', paneStorageKey = DEFAULT_PANE_KEY,
  fullscreen = false, onBack, labels = {}, renderInspectorExtras,
}: LayoutEditorProps) {
  const L = {
    title: 'Layout',
    description: '',
    previewLabel: 'Live preview',
    emptyPreviewTitle: 'No blocks yet.',
    emptyPreviewHint: 'Add a block to get started.',
    saveLabel: 'Save Layout',
    savedLabel: 'Saved',
    restoreLabel: 'Restore Default',
    backLabel: 'Back',
    noun: 'layout',
    ...labels,
  };
  const pickerTypes = allowedTypes ?? LAYOUT_BLOCK_TYPES;
  const isControlled = !!controlled;
  const resizable = fullscreen || embedded;

  // In controlled mode the host owns the block list; otherwise we keep our own.
  const [internalBlocks, setInternalBlocks] = useState<LayoutBlock[]>([]);
  const blocks = controlled ? controlled.blocks : internalBlocks;
  const setBlocks = (updater: LayoutBlock[] | ((prev: LayoutBlock[]) => LayoutBlock[])): void => {
    if (controlled) {
      const next = typeof updater === 'function'
        ? (updater as (p: LayoutBlock[]) => LayoutBlock[])(controlled.blocks)
        : updater;
      controlled.onBlocksChange(next);
    } else {
      setInternalBlocks(updater as any);
    }
  };

  const [loading, setLoading] = useState(!isControlled && !!load);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [seededFromDefault, setSeededFromDefault] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; pos: 'before' | 'after' | 'into' } | null>(null);
  const [addAt, setAddAt] = useState<{ containerId: string | null } | null>(null);
  // Resizable pane widths (fullscreen mode only).
  const [paneW, setPaneW] = useState<{ tree: number; insp: number }>(() => loadPaneWidths(paneStorageKey));
  // Collapse the middle live-preview pane to give the inspector the full edit width.
  const [previewCollapsed, setPreviewCollapsed] = useState<boolean>(() => loadPreviewCollapsed(paneStorageKey));

  useUnsavedChangesWarning(!isControlled && dirty);

  // Fullscreen mode: strip the global <main> padding + hide footer + lock body
  // scroll, per the documented admin-page-fullscreen recipe (components.md).
  // Skipped when embedded — the host page owns its own layout/body class.
  useEffect(() => {
    if (!fullscreen || embedded) return;
    document.documentElement.classList.add('admin-page-fullscreen');
    document.body.classList.add('admin-page-fullscreen');
    return () => {
      document.documentElement.classList.remove('admin-page-fullscreen');
      document.body.classList.remove('admin-page-fullscreen');
    };
  }, [fullscreen, embedded]);

  // Persist pane widths.
  useEffect(() => {
    try { localStorage.setItem(paneStorageKey, JSON.stringify(paneW)); } catch { /* ignore */ }
  }, [paneW, paneStorageKey]);
  // Persist the preview-collapsed preference.
  useEffect(() => {
    try { localStorage.setItem(`${paneStorageKey}:previewCollapsed`, previewCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [previewCollapsed, paneStorageKey]);

  useEffect(() => {
    // Controlled / no-loader: the host supplies the blocks; nothing to fetch.
    if (isControlled || !load) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const loaded = await load();
        if (cancelled) return;
        if (loaded.length === 0 && seedDefault) {
          setBlocks(seedDefault());
          setSeededFromDefault(true);
        } else {
          setBlocks(loaded);
          setSeededFromDefault(false);
        }
      } catch (err) {
        console.error('Failed to load layout:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Drag-to-resize a side pane. `which` = which pane the handle controls; the
  // tree handle grows rightward, the inspector handle grows leftward.
  const startResize = useCallback((which: 'tree' | 'insp', e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === 'tree' ? paneW.tree : paneW.insp;
    const min = which === 'tree' ? TREE_MIN : INSP_MIN;
    const max = which === 'tree' ? TREE_MAX : INSP_MAX;
    const onMove = (ev: PointerEvent) => {
      const delta = which === 'tree' ? ev.clientX - startX : startX - ev.clientX;
      const next = Math.min(max, Math.max(min, startW + delta));
      setPaneW((p) => ({ ...p, [which]: next }));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [paneW.tree, paneW.insp]);

  const selected = useMemo(() => (selectedId ? findBlock(blocks, selectedId) : null), [blocks, selectedId]);
  const canSave = dirty || seededFromDefault;

  // Plain functions (not memoized) so they always close over the current
  // `setBlocks` — which routes to the host in controlled mode.
  const mutate = (fn: (draft: LayoutBlock[]) => void) => {
    setBlocks((prev) => { const draft = clone(prev); fn(draft); return draft; });
    setDirty(true);
  };

  const updateBlock = (id: string, patch: Record<string, any>) => {
    mutate((draft) => { const b = findBlock(draft, id); if (b) Object.assign(b, patch); });
  };

  const removeBlock = (id: string) => {
    mutate((draft) => { const p = findParentList(draft, id); if (p) p.list.splice(p.index, 1); });
    if (selectedId === id) setSelectedId(null);
  };
  const duplicateBlock = (id: string) => {
    mutate((draft) => {
      const p = findParentList(draft, id); if (!p) return;
      const copy: LayoutBlock = JSON.parse(JSON.stringify(p.list[p.index]));
      const reid = (b: LayoutBlock) => { b.id = crypto.randomUUID(); if (isContainer(b)) b.children.forEach(reid); };
      reid(copy);
      p.list.splice(p.index + 1, 0, copy);
    });
  };
  const moveByArrow = (id: string, dir: -1 | 1) => {
    mutate((draft) => {
      const p = findParentList(draft, id); if (!p) return;
      const j = p.index + dir;
      if (j < 0 || j >= p.list.length) return;
      [p.list[p.index], p.list[j]] = [p.list[j], p.list[p.index]];
    });
  };
  const addBlock = (type: LayoutBlockType, containerId: string | null) => {
    const b = makeBlock(type, crypto.randomUUID());
    mutate((draft) => {
      if (containerId) { const c = findBlock(draft, containerId); if (c && isContainer(c)) c.children.push(b); }
      else draft.push(b);
    });
    setSelectedId(b.id);
    setAddAt(null);
  };
  // Sync a Columns block's column count. Growing adds empty columns; shrinking
  // moves the dropped columns' blocks into the last kept column so nothing is
  // lost. (Columns are managed here, never added/removed individually.)
  const setColumnCount = (id: string, n: number) => {
    const target = Math.max(2, Math.min(4, Math.round(n)));
    mutate((draft) => {
      const b = findBlock(draft, id);
      if (!b || b.blockType !== 'columns') return;
      b.columns = target as 2 | 3 | 4;
      const cols = b.children;
      while (cols.length < target) cols.push(makeBlock('column', crypto.randomUUID()));
      if (cols.length > target) {
        const keep = cols.slice(0, target);
        const last = keep[target - 1];
        cols.slice(target).forEach((ec) => { if (isContainer(ec) && isContainer(last)) last.children.push(...ec.children); });
        b.children = keep;
      }
    });
  };

  const performDrop = (targetId: string, pos: 'before' | 'after' | 'into') => {
    if (!dragId || dragId === targetId || isDescendant(blocks, dragId, targetId)) { setDragId(null); setDropInfo(null); return; }
    mutate((draft) => {
      const p = findParentList(draft, dragId); if (!p) return;
      const [moved] = p.list.splice(p.index, 1);
      if (pos === 'into') {
        const c = findBlock(draft, targetId);
        if (c && isContainer(c)) c.children.push(moved);
      } else {
        const t = findParentList(draft, targetId);
        if (t) t.list.splice(t.index + (pos === 'after' ? 1 : 0), 0, moved);
      }
    });
    setSelectedId(dragId);
    setDragId(null);
    setDropInfo(null);
  };

  const handleSave = async () => {
    if (!save) return;
    setSaving(true);
    try {
      await save(blocks);
      setDirty(false);
      setSeededFromDefault(false);
      toast.success(`${capitalize(L.noun)} saved`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || `Failed to save ${L.noun}`);
    } finally {
      setSaving(false);
    }
  };

  // Restore the seeded default layout. Destructive (replaces the current blocks),
  // so confirm first. Leaves the result DIRTY + flagged as seeded so the user can
  // Save it (or navigate away to keep their existing saved layout untouched).
  const handleRestoreDefault = () => {
    if (!seedDefault) return;
    if (!window.confirm(`Replace the current ${L.noun} with the default? This discards your unsaved changes to the layout — you can still Save or leave without saving.`)) return;
    setBlocks(seedDefault());
    setSelectedId(null);
    setSeededFromDefault(true);
    setDirty(true);
    toast('Default layout restored — Save to apply');
  };

  // Ctrl/Cmd+S — only when this editor owns its save (uncontrolled, has a saver).
  useEffect(() => {
    if (embedded || !save) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSave && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave, saving, blocks, embedded]);

  if (loading) return <p className="description-text py-6">Loading {L.noun}…</p>;

  const actions = (
    <div className="flex items-center gap-2 shrink-0">
      {seedDefault && (
        <Button onClick={handleRestoreDefault} disabled={saving} variant="outline" className="border-gold/25 text-ink/75 hover:text-gold">
          {L.restoreLabel}
        </Button>
      )}
      <Button onClick={handleSave} disabled={saving || !canSave} className="btn-gold-solid">
        {saving ? 'Saving…' : canSave ? L.saveLabel : L.savedLabel}
      </Button>
    </div>
  );

  // The three panes + their drag handles. Side-pane widths come from `paneW` when
  // resizable (fullscreen or embedded); in boxed mode they're the fixed defaults.
  const treeWidth = resizable ? paneW.tree : TREE_DEFAULT;
  const inspWidth = resizable ? paneW.insp : INSP_DEFAULT;
  const panes = (
    <div className={`browser-panel ${resizable ? 'flex-1 min-h-0' : 'h-[calc(100vh-15rem)] min-h-[540px]'}`}>
      {/* Structure tree */}
      <div className="browser-sidebar shrink-0" style={{ width: treeWidth }}>
        <div className="pane-head">Structure</div>
        <div className="flex-grow overflow-y-auto custom-scrollbar p-2">
          <BlockTree
            blocks={blocks} selectedId={selectedId} dragId={dragId} dropInfo={dropInfo}
            onSelect={setSelectedId}
            onDragStart={setDragId}
            onDragEndAll={() => { setDragId(null); setDropInfo(null); }}
            onHover={setDropInfo}
            onDrop={performDrop}
            onAddInside={(cid) => setAddAt({ containerId: cid })}
          />
        </div>
        <div className="p-2 border-t border-gold/25">
          <Button onClick={() => setAddAt({ containerId: null })} className="btn-gold w-full h-8 text-xs">Add block</Button>
        </div>
      </div>

      {resizable && <ResizeHandle onPointerDown={(e) => startResize('tree', e)} />}

      {/* Live preview — collapsible to a thin rail so the inspector can take the
          full edit width. Click the rail (or the header chevron) to toggle. */}
      {previewCollapsed ? (
        <button
          type="button"
          onClick={() => setPreviewCollapsed(false)}
          title="Show live preview"
          aria-label="Show live preview"
          className="group shrink-0 w-9 flex flex-col items-center gap-2 py-3 border-l border-gold/25 bg-background/10 hover:bg-gold/10 transition-colors"
        >
          <ChevronsLeftRight className="w-4 h-4 text-ink/45 group-hover:text-gold" />
          <span className="[writing-mode:vertical-rl] rotate-180 pane-head !p-0 select-none">{L.previewLabel}</span>
        </button>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col bg-background/10">
          <div className="pane-head flex items-center justify-between pr-1">
            <span>{L.previewLabel}</span>
            <button
              type="button"
              onClick={() => setPreviewCollapsed(true)}
              title="Collapse live preview"
              aria-label="Collapse live preview"
              className="p-1 text-ink/35 hover:text-gold transition-colors"
            >
              <ChevronsRightLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-grow overflow-y-auto custom-scrollbar p-4">
            {blocks.length === 0 ? (
              <div className="empty-state h-full"><p className="description-text">{L.emptyPreviewTitle}</p><p className="label-text text-gold/45 mt-1">{L.emptyPreviewHint}</p></div>
            ) : (
              // Clicks are swallowed so preview links don't navigate away mid-edit.
              <div onClickCapture={(e) => e.preventDefault()}>
                {renderPreview(blocks)}
              </div>
            )}
          </div>
        </div>
      )}

      {resizable && !previewCollapsed && <ResizeHandle onPointerDown={(e) => startResize('insp', e)} />}

      {/* Inspector — grows to fill the freed space when the preview is collapsed. */}
      <div
        className={cn('border-l border-gold/25 bg-gold/5 flex flex-col', previewCollapsed ? 'flex-1 min-w-0' : 'shrink-0')}
        style={previewCollapsed ? undefined : { width: inspWidth }}
      >
        <div className="pane-head">Inspector</div>
        <div className="flex-grow overflow-y-auto custom-scrollbar">
          {selected ? (
            <Inspector
              key={selected.id}
              block={selected}
              parent={findParentList(blocks, selected.id)}
              onUpdate={updateBlock}
              onMove={moveByArrow}
              onDuplicate={duplicateBlock}
              onRemove={removeBlock}
              onAddInside={(cid) => setAddAt({ containerId: cid })}
              onColumnCount={setColumnCount}
              imageStoragePath={imageStoragePath}
              renderExtras={renderInspectorExtras}
            />
          ) : (
            <p className="insp-empty">Select a block in the structure tree to edit it.</p>
          )}
        </div>
      </div>
    </div>
  );

  const seedBanner = seededFromDefault && !dirty && L.seedBanner;

  const pickerModal = addAt && <AddBlockPicker containerId={addAt.containerId} allowedTypes={pickerTypes} onPick={(t) => addBlock(t, addAt.containerId)} onClose={() => setAddAt(null)} />;

  // ── Embedded mode: just the panes; the host page owns chrome + save. ──
  if (embedded) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {panes}
        {pickerModal}
        {EDITOR_STYLE}
      </div>
    );
  }

  // ── Fullscreen route mode: edge-to-edge, back header, resizable panes ──
  if (fullscreen) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col w-full px-3 sm:px-4 py-2 lg:py-3 gap-2">
        <div className="flex items-center gap-3 shrink-0 pb-2 border-b border-gold/25">
          <Button variant="ghost" onClick={() => onBack?.()} className="text-ink/65 hover:text-gold gap-2 px-2">
            <ChevronLeft className="w-4 h-4" /> {L.backLabel}
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-serif font-bold text-ink truncate">
              {L.title}{L.titleSuffix ? <span className="text-ink/45 font-normal">· {L.titleSuffix}</span> : null}
            </h2>
          </div>
          {actions}
        </div>
        {seedBanner}
        {panes}
        {pickerModal}
        {EDITOR_STYLE}
      </div>
    );
  }

  // ── Boxed in-tab mode (legacy fallback) ──
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="h2-title">{L.title}</h2>
          {L.description && <p className="field-hint mt-1">{L.description}</p>}
        </div>
        {actions}
      </div>
      {seedBanner}
      {panes}
      {pickerModal}
      {EDITOR_STYLE}
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A vertical drag handle between two panes (fullscreen resizable layout). */
function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      className="group relative w-1.5 shrink-0 cursor-col-resize bg-gold/15 hover:bg-gold/35 transition-colors"
      title="Drag to resize"
    >
      {/* Wider invisible hit-area + a centered grip dot-line on hover. */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-0.5 rounded bg-gold/45 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

const EDITOR_STYLE = (
  <style>{`
    .pane-head{font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(26,26,26,.4);padding:10px 12px 6px;font-weight:700;}
    .dark .pane-head{color:rgba(255,255,255,.4);}
    .insp-empty{padding:30px 16px;text-align:center;color:var(--muted-foreground);font-style:italic;font-family:var(--font-serif);font-size:13px;}
  `}</style>
);

/* ════════════════════ Structure tree ════════════════════ */
interface TreeProps {
  blocks: LayoutBlock[]; selectedId: string | null; dragId: string | null;
  dropInfo: { id: string; pos: 'before' | 'after' | 'into' } | null;
  onSelect: (id: string) => void; onDragStart: (id: string) => void; onDragEndAll: () => void;
  onHover: (info: { id: string; pos: 'before' | 'after' | 'into' } | null) => void;
  onDrop: (id: string, pos: 'before' | 'after' | 'into') => void;
  onAddInside: (containerId: string) => void;
  depth?: number;
}
function BlockTree(p: TreeProps) {
  const { blocks, depth = 0 } = p;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className={depth > 0 ? 'ml-3.5 border-l border-dashed border-gold/25 pl-1' : ''}>
      {blocks.map((b) => {
        // `column` cells are rendered by their parent `columns` block as labeled
        // sections (ColumnsSections), never as a generic draggable row.
        if (b.blockType === 'column') return null;
        const meta = BLOCK_TYPE_META[b.blockType];
        const Icon = ICONS[meta.icon] ?? LayoutGrid;
        const isC = isContainer(b);
        const sel = p.selectedId === b.id;
        const di = p.dropInfo?.id === b.id ? p.dropInfo.pos : null;
        return (
          <div key={b.id}>
            <div
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                p.onDragStart(b.id);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox (and some others) won't START a drag unless dataTransfer
                // carries data — without this, dragging silently does nothing and
                // only the up/down arrows work.
                try { e.dataTransfer.setData('text/plain', b.id); } catch { /* some browsers throw outside a real drag */ }
              }}
              onDragEnd={p.onDragEndAll}
              onDragOver={(e) => {
                if (!p.dragId || p.dragId === b.id) return;
                e.preventDefault(); e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                const pos = (e.clientY - r.top) > r.height / 2 ? 'after' : 'before';
                p.onHover({ id: b.id, pos });
              }}
              onDrop={(e) => {
                if (!p.dragId || p.dragId === b.id) return;
                e.preventDefault(); e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                p.onDrop(b.id, (e.clientY - r.top) > r.height / 2 ? 'after' : 'before');
              }}
              onClick={() => p.onSelect(b.id)}
              className={cn(
                'flex items-center gap-1.5 px-1.5 py-1.5 cursor-pointer border border-transparent transition-colors text-xs',
                sel ? 'bg-gold/25 border-r-[3px] border-r-gold text-gold font-semibold' : 'hover:bg-gold/15 text-ink/85',
                p.dragId === b.id && 'opacity-40',
                di === 'before' && 'shadow-[inset_0_2px_0_var(--gold)]',
                di === 'after' && 'shadow-[inset_0_-2px_0_var(--gold)]',
              )}
            >
              <GripVertical className="w-3.5 h-3.5 text-ink/35 shrink-0 cursor-grab" />
              {isC ? (
                <button onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [b.id]: !c[b.id] })); }} className="w-3 text-ink/45 text-[9px] shrink-0">
                  {collapsed[b.id] ? '▸' : '▾'}
                </button>
              ) : <span className="w-3 shrink-0" />}
              <Icon className="w-3.5 h-3.5 text-gold shrink-0" />
              <span className="flex-1 truncate">{meta.label}</span>
            </div>

            {isC && !collapsed[b.id] && b.blockType === 'columns' && (
              <ColumnsSections columns={b as ContainerBlock} tree={p} depth={depth} />
            )}
            {isC && !collapsed[b.id] && b.blockType !== 'columns' && (
              <NestZone block={b as ContainerBlock} active={p.dragId != null && p.dragId !== b.id && !isDescendant(blocks, p.dragId, b.id)} isOver={di === 'into'} onHover={() => p.onHover({ id: b.id, pos: 'into' })} onDrop={() => p.onDrop(b.id, 'into')}>
                <BlockTree {...p} blocks={(b as ContainerBlock).children} depth={depth + 1} />
              </NestZone>
            )}
          </div>
        );
      })}
      {/* Trailing drop zone — a real target for "move to the very end" of this
          list. Without it the only after-the-last hit area is the bottom half of
          the last row, which is easy to miss. Shown only while dragging. */}
      {p.dragId && blocks.length > 0 && (() => {
        const lastId = blocks[blocks.length - 1].id;
        const over = p.dropInfo?.id === lastId && p.dropInfo.pos === 'after';
        return (
          <div
            onDragOver={(e) => { if (!p.dragId) return; e.preventDefault(); e.stopPropagation(); p.onHover({ id: lastId, pos: 'after' }); }}
            onDrop={(e) => { if (!p.dragId) return; e.preventDefault(); e.stopPropagation(); p.onDrop(lastId, 'after'); }}
            className={cn('h-7 mt-0.5 border border-dashed transition-colors', over ? 'border-gold bg-gold/15' : 'border-transparent')}
          />
        );
      })()}
    </div>
  );
}
function NestZone({ block, active, isOver, onHover, onDrop, children }: { block: ContainerBlock; active: boolean; isOver: boolean; onHover: () => void; onDrop: () => void; children: React.ReactNode }) {
  return (
    <div className="ml-3.5 border-l border-dashed border-gold/25 pl-1"
      onDragOver={(e) => { if (!active) return; e.preventDefault(); onHover(); }}
      onDrop={(e) => { if (!active) return; e.preventDefault(); onDrop(); }}>
      <div className={cn('px-2 py-1 mb-0.5 text-[10px] italic border border-dashed', isOver ? 'border-gold text-gold bg-gold/15' : 'border-transparent text-ink/35')}>
        {block.children.length ? 'drop here to nest' : 'empty — drop a block here to nest it'}
      </div>
      {children}
    </div>
  );
}

/** Renders a `columns` block's cells as labeled "Column 1 / 2 / …" sections in
 *  the tree, so it's unambiguous which column a block lives in. Each section is
 *  its own drop-into target with a "+ Add" button; its blocks render via a
 *  nested BlockTree (with before/after reorder + the trailing drop zone). */
function ColumnsSections({ columns, tree: p, depth }: { columns: ContainerBlock; tree: TreeProps; depth: number }) {
  return (
    <div className="ml-3.5 border-l border-dashed border-gold/25 pl-1 space-y-1.5 mt-0.5">
      {columns.children.map((col, ci) => {
        const active = p.dragId != null && p.dragId !== col.id && !isDescendant([columns], p.dragId, col.id);
        const over = p.dropInfo?.id === col.id && p.dropInfo.pos === 'into';
        const colChildren = isContainer(col) ? col.children : [];
        return (
          <div key={col.id}>
            <div className="flex items-center justify-between px-1">
              <span className="section-label">Column {ci + 1}</span>
              <button onClick={() => p.onAddInside(col.id)} className="field-hint hover:text-gold">+ Add</button>
            </div>
            <div
              onDragOver={(e) => { if (!active) return; e.preventDefault(); e.stopPropagation(); p.onHover({ id: col.id, pos: 'into' }); }}
              onDrop={(e) => { if (!active) return; e.preventDefault(); e.stopPropagation(); p.onDrop(col.id, 'into'); }}
              className={cn('ml-1 border-l border-dashed pl-1', over ? 'border-gold' : 'border-gold/25')}
            >
              {colChildren.length === 0 ? (
                <div className={cn('px-2 py-1 text-[10px] italic border border-dashed', over ? 'border-gold text-gold bg-gold/15' : 'border-transparent text-ink/35')}>
                  empty — drop or “+ Add” a block
                </div>
              ) : (
                <BlockTree {...p} blocks={colChildren} depth={depth + 1} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════ Inspector ════════════════════ */
interface InspectorProps {
  block: LayoutBlock;
  parent: { list: LayoutBlock[]; index: number } | null;
  onUpdate: (id: string, patch: Record<string, any>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAddInside: (containerId: string) => void;
  onColumnCount: (id: string, n: number) => void;
  imageStoragePath: string;
  renderExtras?: (block: LayoutBlock, set: (patch: Record<string, any>) => void) => React.ReactNode;
}
function Inspector({ block, parent, onUpdate, onMove, onDuplicate, onRemove, onAddInside, onColumnCount, imageStoragePath, renderExtras }: InspectorProps) {
  const meta = BLOCK_TYPE_META[block.blockType];
  const i = parent?.index ?? 0;
  const n = parent?.list.length ?? 1;
  const set = (patch: Record<string, any>) => onUpdate(block.id, patch);
  const extras = renderExtras?.(block, set);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-1 pb-3 border-b border-gold/25">
        <span className="h3-title flex-1">{meta.label}</span>
        <button disabled={i === 0} onClick={() => onMove(block.id, -1)} className="p-1.5 text-ink/45 hover:text-gold disabled:opacity-20" aria-label="Move up"><ChevronUp className="w-4 h-4" /></button>
        <button disabled={i === n - 1} onClick={() => onMove(block.id, 1)} className="p-1.5 text-ink/45 hover:text-gold disabled:opacity-20" aria-label="Move down"><ChevronDown className="w-4 h-4" /></button>
        <button onClick={() => onDuplicate(block.id)} className="p-1.5 text-ink/45 hover:text-gold" aria-label="Duplicate"><Copy className="w-4 h-4" /></button>
        <button onClick={() => onRemove(block.id)} className="p-1.5 text-ink/45 hover:text-blood" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
      </div>

      {block.blockType === 'hero' && (<>
        <Field label="Title"><Input autoComplete="off" className="field-input" value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="Stories in Dauligor" /></Field>
        <Field label="Subtitle (BBCode)"><MarkdownEditor value={block.subtitle} onChange={(v) => set({ subtitle: v })} placeholder="A welcome line…" /></Field>
        <Seg label="Alignment" value={block.align} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} onChange={(v) => set({ align: v })} />
        <Seg label="Size" value={block.size} options={[['normal', 'Normal'], ['large', 'Large']]} onChange={(v) => set({ size: v })} />
      </>)}

      {block.blockType === 'text' && (<>
        <Field label="Body (BBCode)"><MarkdownEditor value={block.body} onChange={(v) => set({ body: v })} placeholder="Write text…" /></Field>
        <Seg label="Width" value={block.width} options={[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]} onChange={(v) => set({ width: v })} />
      </>)}

      {block.blockType === 'note' && (<>
        <p className="field-hint">Shown only to staff on the article — never to players.</p>
        <Field label="Storyteller Note (BBCode)"><MarkdownEditor value={block.body} onChange={(v) => set({ body: v })} placeholder="Plot hooks, background, DM-only details…" /></Field>
      </>)}

      {block.blockType === 'image' && (<>
        <Field label="Image"><ImageUpload currentImageUrl={block.url || ''} onUpload={(url) => set({ url })} storagePath={imageStoragePath} /></Field>
        <Field label="Caption (optional)"><Input autoComplete="off" className="field-input" value={block.caption} onChange={(e) => set({ caption: e.target.value })} placeholder="A short caption" /></Field>
        <Seg label="Height" value={block.height} options={[['small', 'S'], ['medium', 'M'], ['large', 'L']]} onChange={(v) => set({ height: v })} />
        <Field label="Links to (optional)"><Input autoComplete="off" className="field-input" value={block.link} onChange={(e) => set({ link: e.target.value })} placeholder="/wiki/article/…" /></Field>
      </>)}

      {block.blockType === 'divider' && (
        <Seg label="Style" value={block.style} options={[['line', 'Line'], ['dots', 'Dots'], ['space', 'Space']]} onChange={(v) => set({ style: v })} />
      )}

      {block.blockType === 'callout' && (<>
        <Field label="Heading"><Input autoComplete="off" className="field-input" value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="Character Creation" /></Field>
        <Field label="Body (BBCode)"><MarkdownEditor value={block.body} onChange={(v) => set({ body: v })} placeholder="A short message…" /></Field>
        <Seg label="Style" value={block.style} options={[['soft', 'Soft (dashed)'], ['plain', 'Plain']]} onChange={(v) => set({ style: v })} />
        <fieldset className="config-fieldset"><legend className="section-label px-1">Button (optional)</legend>
          <Field label="Label"><Input autoComplete="off" className="field-input" value={block.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} placeholder="Browse Sources" /></Field>
          <Field label="Links to"><Input autoComplete="off" className="field-input" value={block.buttonLink} onChange={(e) => set({ buttonLink: e.target.value })} placeholder="/sources" /></Field>
          <p className="field-hint">The button shows only when both label and link are set.</p>
        </fieldset>
      </>)}

      {block.blockType === 'recommended' && (<>
        <Field label="Heading (optional)"><Input autoComplete="off" className="field-input" value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="Recommended for this campaign" /></Field>
        <Seg label="Source" value={block.source} options={[['auto', 'Campaign pick'], ['specific', 'Specific entity']]} onChange={(v) => set({ source: v })} />
        {block.source === 'specific'
          ? <Field label="Entity"><EntityRefPicker mode="single" value={block.ref} onChange={(ref) => set({ ref })} /></Field>
          : <p className="field-hint">Uses the campaign's recommended lore (set under Campaign Info → Recommended Lore).</p>}
        <Seg label="Layout" value={block.layout} options={[['side', 'Side image'], ['stacked', 'Stacked']]} onChange={(v) => set({ layout: v })} />
      </>)}

      {block.blockType === 'entity-feature' && (<>
        <Field label="Heading (optional)"><Input autoComplete="off" className="field-input" value={block.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Featured entity"><EntityRefPicker mode="single" value={block.ref} onChange={(ref) => set({ ref })} /></Field>
        <Seg label="Image side" value={block.imageSide} options={[['left', 'Left'], ['right', 'Right']]} onChange={(v) => set({ imageSide: v })} />
        <Toggle label="Show excerpt" value={block.excerpt} onChange={(v) => set({ excerpt: v })} />
      </>)}

      {block.blockType === 'reference' && (<>
        <Field label="Referenced entity"><EntityRefPicker mode="single" value={block.ref} onChange={(ref) => set({ ref })} /></Field>
        <Seg label="Display" value={block.display} options={[['inline', 'Inline'], ['card', 'Card'], ['link', 'Link']]} onChange={(v) => set({ display: v })} />
        <p className="field-hint">Inline shows the entity's text in-flow; Card shows an image tile; Link shows just a link.</p>
      </>)}

      {block.blockType === 'definition' && (<>
        <Field label="Name"><Input autoComplete="off" className="field-input" value={block.name} onChange={(e) => set({ name: e.target.value })} placeholder="Prone" /></Field>
        <Field label="Anchor / reference id"><Input autoComplete="off" className="field-input font-mono" value={block.anchor} onChange={(e) => set({ anchor: e.target.value })} placeholder="prone" /></Field>
        <Field label="Body (BBCode)"><MarkdownEditor value={block.body} onChange={(v) => set({ body: v })} placeholder="The entry's rules text…" /></Field>
        <p className="field-hint">A system-page entry — the target a reference resolves to. The anchor is its <code>&amp;kind[anchor]</code> / <code>#anchor</code> id (lowercase slug).</p>
      </>)}

      {block.blockType === 'entity-row' && (<>
        <Field label="Heading"><Input autoComplete="off" className="field-input" value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="The World of Dauligor" /></Field>
        <Toggle label="Show heading" value={block.showHeading} onChange={(v) => set({ showHeading: v })} />
        <fieldset className="config-fieldset"><legend className="section-label px-1">Content</legend>
          <Field label="Entities"><EntityRefPicker mode="multi" value={block.refs} onChange={(refs) => set({ refs })} /></Field>
        </fieldset>
        <fieldset className="config-fieldset"><legend className="section-label px-1">Appearance</legend>
          <Stepper label="Columns" value={block.columns} min={1} max={4} onChange={(v) => set({ columns: v })} />
          <Seg label="Card style" value={block.card} options={[['image', 'Image'], ['compact', 'Compact'], ['list', 'List']]} onChange={(v) => set({ card: v })} />
          <Toggle label="Show excerpts" value={block.excerpt} onChange={(v) => set({ excerpt: v })} />
          {block.card !== 'list' && block.columns >= 2 && (
            <p className="field-hint">To make a card wider, expand it under Content and set its Card width.</p>
          )}
        </fieldset>
      </>)}

      {block.blockType === 'group' && (<>
        <Field label="Title"><Input autoComplete="off" className="field-input" value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="Section title" /></Field>
        <Toggle label="Show title" value={block.showTitle} onChange={(v) => set({ showTitle: v })} />
        <Seg label="Style" value={block.style} options={[['card', 'Card'], ['bordered', 'Bordered'], ['plain', 'Plain']]} onChange={(v) => set({ style: v })} />
        <Button onClick={() => onAddInside(block.id)} className="btn-gold w-full h-8 text-xs">Add block inside</Button>
        <p className="field-hint">Or drag any block onto this group in the structure tree to nest it.</p>
      </>)}

      {block.blockType === 'columns' && (<>
        <Stepper label="Columns" value={block.columns} min={2} max={4} onChange={(v) => onColumnCount(block.id, v)} />
        <Seg label="Gap" value={block.gap} options={[['small', 'S'], ['medium', 'M'], ['large', 'L']]} onChange={(v) => set({ gap: v })} />
        <p className="field-hint">Each column is its own section in the structure tree — open this block there to fill Column 1, Column 2, … separately (add a block or drag one in). Reducing the count merges the last column's blocks into the previous one, so nothing is lost.</p>
      </>)}

      {/* Host-supplied editors for block types the generic editor can't edit
          on its own (e.g. a `secret` block's era/campaign reveal controls). */}
      {extras}
    </div>
  );
}

/* ════════════════════ Entity picker ════════════════════ */
async function searchEntities(kindValue: string, mode: 'ref' | 'system', query: string): Promise<EntityRef[]> {
  if (mode === 'system') {
    const [pages, entries] = await Promise.all([searchSystemPages(query, 12), searchSystemEntries(query, 12)]);
    return [
      ...pages.map((r) => ({ kind: r.kind, id: r.id, name: r.name })),
      ...entries.map((r) => ({ kind: r.kind, id: r.id, name: r.name })),
    ];
  }
  const rows = await searchReferences(kindValue, query, 20);
  return rows.map((r) => ({ kind: String(r.kind), id: r.id, name: r.name }));
}

function EntityRefPicker({ mode, value, onChange }: {
  mode: 'single' | 'multi';
  value: EntityRef | EntityRef[] | null;
  onChange: (v: any) => void;
}) {
  const [kind, setKind] = useState<string>('article');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityRef[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const kindMeta = ENTITY_PICKER_KINDS.find((k) => k.value === kind) ?? ENTITY_PICKER_KINDS[0];

  const list: EntityRef[] = mode === 'multi' ? (Array.isArray(value) ? value : []) : [];
  const single: EntityRef | null = mode === 'single' ? (value as EntityRef | null) : null;

  // Debounced search on query / kind change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchEntities(kindMeta.value, kindMeta.mode, query.trim());
        if (!cancelled) setResults(r);
      } finally { if (!cancelled) setBusy(false); }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, kind, open, kindMeta.value, kindMeta.mode]);

  // Click-outside closes.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);

  const pick = (r: EntityRef) => {
    if (mode === 'single') { onChange(r); setOpen(false); setQuery(''); }
    else {
      // Dedupe real entities by kind+id; placeholders (id '') are name-only and
      // may legitimately repeat, so never blocked.
      if (r.kind !== 'placeholder' && list.some((x) => x.kind === r.kind && x.id === r.id)) return;
      onChange([...list, r]); setQuery('');
    }
  };

  // multi chip reorder
  const [chipDrag, setChipDrag] = useState<number | null>(null);
  const reorder = (to: number) => {
    if (chipDrag == null || chipDrag === to) return;
    const next = [...list]; const [m] = next.splice(chipDrag, 1); next.splice(to, 0, m); onChange(next); setChipDrag(null);
  };
  // Per-card override editing (title / description / span). One chip expanded at
  // a time. `updateAt` patches a single ref, dropping empty/default overrides so
  // they fall back to the resolved entity / Placeholder · Coming-Soon defaults.
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const updateAt = (idx: number, patch: Partial<EntityRef>) => {
    onChange(list.map((r, j) => {
      if (j !== idx) return r;
      const next: EntityRef = { ...r, ...patch };
      if (!next.title) delete next.title;
      if (!next.description) delete next.description;
      if (!next.span || next.span <= 1) delete next.span;
      return next;
    }));
  };

  return (
    <div className="space-y-2">
      {mode === 'multi' && (
        list.length === 0
          ? <p className="field-hint">No entities yet — add some below.</p>
          : <div className="data-table">
              <div className="data-table-body">
                {list.map((r, idx) => {
                  const ph = r.kind === 'placeholder';
                  const expanded = editIdx === idx;
                  return (
                  <div key={`${r.kind}:${r.id}:${idx}`} className={cn(chipDrag === idx && 'opacity-40')}>
                    {/* Summary row — drag to reorder; chevron toggles the override editor. */}
                    <div draggable
                      onDragStart={(e) => { setChipDrag(idx); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* noop */ } }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => reorder(idx)}
                      className="data-table-row grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-center">
                      <GripVertical className="w-3.5 h-3.5 text-ink/35 cursor-grab" />
                      <span className={cn('text-xs font-serif truncate', !(r.title || r.name || r.id) && 'italic text-ink/45')} title={r.title || r.name}>
                        {r.title || r.name || (ph ? 'Empty card' : r.id)}
                        {!!r.span && r.span > 1 && <span className="label-text ml-1.5 text-gold/75">×{r.span}</span>}
                      </span>
                      <span className="label-text">{kindLabel(r.kind)}</span>
                      <button onClick={() => setEditIdx(expanded ? null : idx)} className={cn('text-ink/35 hover:text-gold', expanded && 'text-gold')} aria-label="Edit card">
                        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !expanded && '-rotate-90')} />
                      </button>
                      <button onClick={() => { onChange(list.filter((_, j) => j !== idx)); if (expanded) setEditIdx(null); }} className="text-ink/35 hover:text-blood" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    {/* Per-card overrides: heading ("what it says"), description
                        ("what its description says"), and column span. Empty fields
                        fall back to the resolved entity / Placeholder · Coming Soon. */}
                    {expanded && (
                      <div className="px-2 py-2 space-y-2 bg-gold/5 border-t border-gold/15">
                        <div className="space-y-1">
                          <label className="field-label">Card title</label>
                          <Input autoComplete="off" className="field-input text-xs" value={r.title || ''} placeholder={r.name || PLACEHOLDER_TITLE} onChange={(e) => updateAt(idx, { title: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="field-label">Description (BBCode)</label>
                          <MarkdownEditor value={r.description || ''} placeholder={ph ? PLACEHOLDER_DESCRIPTION : "Uses the entity's own summary"} onChange={(v) => updateAt(idx, { description: v })} />
                        </div>
                        <div className="space-y-1">
                          <label className="field-label">Card width (columns)</label>
                          <div className="flex border border-gold/25 w-fit">
                            {[1, 2, 3, 4].map((num) => {
                              const active = (r.span || 1) === num;
                              return (
                                <button key={num} onClick={() => updateAt(idx, { span: num })}
                                  className={cn('w-8 text-[11px] py-1 transition-colors', num > 1 && 'border-l border-gold/15', active ? 'bg-gold text-[var(--primary-foreground)] font-semibold' : 'bg-card text-ink/65 hover:bg-gold/5')}>
                                  {num}
                                </button>
                              );
                            })}
                          </div>
                          <p className="field-hint">1 = normal. Wider cards are capped at the row's column count.</p>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
      )}
      {mode === 'multi' && (
        <button
          onClick={() => onChange([...list, makePlaceholderRef('')])}
          className="btn-gold w-full h-8 text-xs">
          + Add empty card
        </button>
      )}
      {mode === 'single' && single && (
        <div className="data-table"><div className="data-table-row grid grid-cols-[1fr_auto_auto] gap-2 items-center">
          <span className="text-xs font-serif truncate" title={single.name}>{single.name || single.id}</span>
          <span className="label-text">{kindLabel(single.kind)}</span>
          <button onClick={() => onChange(null)} className="text-ink/35 hover:text-blood" aria-label="Clear"><X className="w-3.5 h-3.5" /></button>
        </div></div>
      )}

      <div ref={boxRef} className="relative">
        <div className="flex gap-2">
          <select autoComplete="off" className="field-input w-[42%] text-xs" value={kind} onChange={(e) => { setKind(e.target.value); setResults([]); }}>
            {ENTITY_PICKER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-ink/35 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input autoComplete="off" className="field-input pl-7 text-xs" value={query} placeholder={`Search ${kindMeta.label.toLowerCase()}…`}
              onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
          </div>
        </div>
        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+2px)] z-30 bg-card border border-gold max-h-56 overflow-y-auto custom-scrollbar shadow-lg">
            {busy && <p className="px-3 py-2 text-[11px] text-ink/45 italic">Searching…</p>}
            {!busy && results.length === 0 && !query.trim() && (
              <p className="px-3 py-2 text-[11px] text-ink/45 italic">Type to search, or add a placeholder.</p>
            )}
            {!busy && results.map((r, i) => (
              <button key={`${r.kind}:${r.id}:${i}`} onClick={() => pick(r)} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gold/15 transition-colors flex items-center justify-between gap-2">
                <span className="truncate font-serif">{r.name || r.id}</span>
                <span className="label-text shrink-0">{kindLabel(r.kind)}</span>
              </button>
            ))}
            {/* Placeholder affordance — name a card slot without a real entity,
                exactly like the legacy "(Article not found)" tiles. Always offered
                once something's typed, even when there are real matches. */}
            {!busy && query.trim() && (
              <button onClick={() => pick(makePlaceholderRef(query.trim()))}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gold/15 transition-colors flex items-center justify-between gap-2 border-t border-gold/15">
                <span className="truncate font-serif italic text-ink/75">Add “{query.trim()}” as placeholder</span>
                <span className="label-text shrink-0 text-ink/35">Placeholder</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function kindLabel(kind: string): string {
  const k = ENTITY_PICKER_KINDS.find((x) => x.value === kind);
  if (k) return k.label.replace(/s$/, '');
  // system-page kinds carry the page identifier as kind — title-case it.
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/* ════════════════════ Add-block popover ════════════════════ */
function AddBlockPicker({ containerId, allowedTypes, onPick, onClose }: { containerId: string | null; allowedTypes: LayoutBlockType[]; onPick: (t: LayoutBlockType) => void; onClose: () => void }) {
  const groups: [string, LayoutBlockType[]][] = [
    ['Content', allowedTypes.filter((t) => BLOCK_TYPE_META[t].group === 'content')],
    ['Containers', allowedTypes.filter((t) => BLOCK_TYPE_META[t].group === 'container')],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border border-gold w-full max-w-md max-h-[80vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header flex items-center justify-between">
          <span className="dialog-title">{containerId ? 'Add block inside' : 'Add block'}</span>
          <button onClick={onClose} className="text-ink/45 hover:text-blood"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          {groups.map(([gn, types]) => (
            <div key={gn}>
              <p className="section-label px-1 mb-1">{gn}</p>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => {
                  const meta = BLOCK_TYPE_META[t];
                  const Icon = ICONS[meta.icon] ?? LayoutGrid;
                  return (
                    <button key={t} onClick={() => onPick(t)} className="compendium-card flex items-start gap-2.5 p-3 text-left">
                      <Icon className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-ink font-serif">{meta.label}</div>
                        <div className="text-[11px] text-ink/55 leading-snug">{meta.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════ tiny inspector controls ════════════════════ */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="field-label">{label}</label>{children}</div>;
}
function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="field-label">{label}</label>
      <div className="flex border border-gold/25">
        {options.map(([v, l], i) => (
          <button key={v} onClick={() => onChange(v)}
            className={cn('flex-1 text-[11px] py-1.5 transition-colors', i > 0 && 'border-l border-gold/15', value === v ? 'bg-gold text-[var(--primary-foreground)] font-semibold' : 'bg-card text-ink/65 hover:bg-gold/5')}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-center gap-2.5 cursor-pointer">
      <span className={cn('w-[34px] h-[19px] rounded-full relative transition-colors shrink-0', value ? 'bg-gold' : 'bg-ink/25')}>
        <span className={cn('absolute top-0.5 w-[15px] h-[15px] rounded-full bg-white transition-all', value ? 'left-[17px]' : 'left-0.5')} />
      </span>
      <span className="text-[12.5px]">{label}</span>
    </button>
  );
}
function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="field-label">{label}</label>
      <div className="inline-flex border border-gold/25">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="px-3 py-1.5 text-ink/65 hover:bg-gold/15 hover:text-gold disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-ink/65" aria-label="Decrease">−</button>
        <span className="px-4 py-1.5 text-sm border-x border-gold/25 min-w-[40px] text-center">{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="px-3 py-1.5 text-ink/65 hover:bg-gold/15 hover:text-gold disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-ink/65" aria-label="Increase">+</button>
      </div>
    </div>
  );
}
