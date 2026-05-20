// =============================================================================
// ProposalEditorWrapper — provides the proposal-accumulator context to
// editors mounted under /proposals/edit/*.
// =============================================================================
//
// The wrapper is the boundary between two parallel route prefixes:
//
//   /compendium/<thing>/manage    →  admin direct write, no wrapper
//   /proposals/edit/<thing>       →  this wrapper around the SAME editor
//
// Inside the wrapper:
//   - useProposalAccumulator(entityType) returns a queueing writer
//     instead of firing each mutation immediately.
//   - Submit Changes drains the queue as one POST against the active
//     block (or prompts pick/create if no block is open).
//   - beforeunload guards against accidental navigation away with
//     unsubmitted edits.
//
// Phase 4.2 (current): scaffolding only. Drop Edits affordances
// (entity / section / field) land in Phase 4.3.
// =============================================================================

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { auth } from '../../lib/firebase';
import {
  ProposalAccumulatorContext,
  postQueuedChanges,
  type ProposalAccumulatorContextValue,
  type QueuedChange,
} from '../../lib/proposalAccumulator';
import { useBlock } from '../../lib/proposalBlock';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PickOrCreateBlockDialog } from './PickOrCreateBlockDialog';
import type { ProposalEntityType } from '../../lib/proposalAware';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import type { FocusMode } from '../../lib/proposalAccumulator';
import { cn } from '../../lib/utils';

const ENTITY_LABELS: Record<ProposalEntityType, string> = {
  tag: 'Tags',
  tag_group: 'Tag Groups',
  spell_rule: 'Spell Rules',
  spell_rule_application: 'Spell Rule Applications',
  class_spell_list: 'Class Spell Lists',
  spell: 'Spells',
  class: 'Classes',
  subclass: 'Subclasses',
  feat: 'Feats',
  item: 'Items',
  unique_option_group: 'Option Groups',
  unique_option_item: 'Option Items',
};

export type ProposalEditorWrapperProps = {
  /**
   * Entity type(s) this editor handles. A single value (back-compat
   * with Phase 4.5a–c) is normalized to a one-element array. The
   * dropEntity helper uses this list to filter which server-side
   * drafts to dedup against / DELETE when the user drops an entity.
   */
  entityType: ProposalEntityType | ProposalEntityType[];
  /**
   * Multi-work editors with large catalogs (Spells, Feats, Items)
   * opt in to a `[ My Drafts | Browse Base ]` segmented toggle at the
   * top of the wrapper. Single-work editors (Classes, Subclasses)
   * leave this off — the toggle has no list to filter. Defaults to
   * `false`; current Tags / Spell Rules / Spell Lists wiring (4.5a–c)
   * stays in the simple mode.
   */
  enableFocusMode?: boolean;
  children: ReactNode;
};

export function ProposalEditorWrapper({
  entityType,
  enableFocusMode = false,
  children,
}: ProposalEditorWrapperProps) {
  const entityTypes = useMemo<ProposalEntityType[]>(
    () => (Array.isArray(entityType) ? entityType : [entityType]),
    [entityType],
  );
  const primaryEntityType = entityTypes[0];
  const [focusMode, setFocusMode] = useState<FocusMode>('drafts');
  const {
    activeBundleId,
    activeBundle,
    drafts: allDrafts,
    openBlocks,
    startBlock,
    setActiveBlock,
    refresh: refreshBlock,
    refreshOpenBlocks,
  } = useBlock();
  // Subset of the block's drafts that belong to entity types this
  // editor handles. Used by `flushToBundle` to dedup queue entries
  // against existing same-bundle drafts and by `dropEntity` to know
  // which server-side drafts to DELETE alongside the local queue.
  const drafts = useMemo(
    () =>
      allDrafts.filter((d) =>
        entityTypes.includes(d.entity_type as ProposalEntityType),
      ),
    [allDrafts, entityTypes],
  );

  const [queue, setQueue] = useState<QueuedChange[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Ref-mirror of `queue` for synchronous access inside flushToBundle.
  // React state updates from `queueChange` (called inside pre-flush
  // callbacks) are batched and won't be visible to the SAME flush
  // invocation otherwise — the closure-captured `queue` array would
  // still be the pre-flush snapshot. The ref always points at the
  // latest list so the drain sees pre-flush additions immediately.
  const queueRef = useRef<QueuedChange[]>([]);
  // Pre-flush callbacks registered by child editors. Each is called
  // before the queue is drained; they typically call queueChange to
  // capture the current form state (replacing per-editor Save buttons).
  const preFlushCallbacks = useRef<Set<() => Promise<void> | void>>(
    new Set(),
  );
  const registerPreFlush = useCallback(
    (callback: () => Promise<void> | void) => {
      preFlushCallbacks.current.add(callback);
      return () => {
        preFlushCallbacks.current.delete(callback);
      };
    },
    [],
  );

  // Replacement for useQueueOperations that keeps `queueRef` in
  // lockstep with `queue` state. The helper hook only sets state;
  // we need both for the pre-flush-then-drain dance.
  const queueChange = useCallback(
    (change: Omit<QueuedChange, 'queue_id'>) => {
      const queue_id = `q-${crypto.randomUUID()}`;
      const entry: QueuedChange = { ...change, queue_id };
      queueRef.current = [...queueRef.current, entry];
      setQueue(queueRef.current);
      return queue_id;
    },
    [],
  );
  const resetQueue = useCallback(() => {
    queueRef.current = [];
    setQueue([]);
  }, []);
  // Wrapped setQueue so callers (dropFields, dropField, dropEntity)
  // that previously mutated `queue` via setQueue keep working —
  // their updates need to mirror into queueRef too. Replace
  // useQueueOperations's exposure of raw setQueue.
  const setQueueMirrored = useCallback(
    (next: QueuedChange[] | ((prev: QueuedChange[]) => QueuedChange[])) => {
      setQueue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        queueRef.current = resolved;
        return resolved;
      });
    },
    [],
  );

  // Drain the queue against a known bundleId. Caller is responsible
  // for ensuring the bundle exists (via setActiveBlock or startBlock)
  // before invoking this.
  //
  // Passes `drafts` to `postQueuedChanges` so it can dedupe — queue
  // entries that target an entity already represented by a draft in
  // the block PATCH that draft instead of POSTing a redundant
  // revision (avoids "create then edit" landing as CREATE + UPDATE
  // in the same bundle).
  const flushToBundle = useCallback(
    async (bundleId: string) => {
      setSubmitting(true);
      try {
        // Run pre-flush callbacks first. Editors register these to
        // capture their current form state via `queueChange` —
        // populating the queue at flush time, which is what makes the
        // wrapper's Submit Changes button stand in for per-editor
        // Save buttons. Sequential await so editors don't race each
        // other.
        for (const cb of preFlushCallbacks.current) {
          await cb();
        }

        // After pre-flush, `queueRef.current` is the authoritative
        // list (the React `queue` state lags by one render).
        const currentQueue = queueRef.current;
        if (currentQueue.length === 0) return { submitted: 0 };

        // Only drafts in THIS bundle are dedup-eligible — a draft from
        // a different bundle (impossible today since only one is
        // active, but defensive) shouldn't get patched here.
        const sameBundleDrafts = drafts.filter(
          (d) => d.bundle_id === bundleId,
        );
        const result = await postQueuedChanges(
          currentQueue,
          bundleId,
          sameBundleDrafts,
        );
        resetQueue();
        // Refresh the BlockProvider's local cache so the navbar
        // pill + Block tab show the new draft count immediately.
        void refreshBlock();
        return result;
      } finally {
        setSubmitting(false);
      }
    },
    [drafts, refreshBlock, resetQueue],
  );

  /* --------------------------------------------------------------- */
  /* Drop Edits (Phase 4.3)                                            */
  /* --------------------------------------------------------------- */

  const isEntityDirty = useCallback(
    (entityId: string) => queue.some((q) => q.entity_id === entityId),
    [queue],
  );

  const isFieldDirty = useCallback(
    (entityId: string, fieldName: string) => {
      const entry = queue.find((q) => q.entity_id === entityId);
      if (!entry || entry.operation === 'delete') return false;
      const payload = entry.proposed_payload;
      if (!payload) return false;
      return Object.prototype.hasOwnProperty.call(payload, fieldName);
    },
    [queue],
  );

  const dropFields = useCallback(
    (entityId: string, fieldNames: string[]) => {
      if (fieldNames.length === 0) return;
      setQueueMirrored((q) =>
        q
          .map((entry) => {
            if (entry.entity_id !== entityId) return entry;
            if (entry.operation === 'delete') return entry;
            const payload = entry.proposed_payload;
            if (!payload) return entry;
            const next: Record<string, any> = {};
            for (const [k, v] of Object.entries(payload)) {
              if (!fieldNames.includes(k)) next[k] = v;
            }
            return { ...entry, proposed_payload: next };
          })
          // If the resulting payload has nothing meaningful (only an
          // `id` key, or nothing at all), the queue entry no longer
          // represents a change — drop it. Creates with only `id`
          // would be empty creates, which we never want to submit.
          .filter((entry) => {
            if (entry.entity_id !== entityId) return true;
            if (entry.operation === 'delete') return true;
            const payload = entry.proposed_payload;
            if (!payload) return false;
            const keys = Object.keys(payload).filter((k) => k !== 'id');
            return keys.length > 0;
          }),
      );
    },
    [],
  );

  const dropField = useCallback(
    (entityId: string, fieldName: string) => {
      dropFields(entityId, [fieldName]);
    },
    [dropFields],
  );

  const dropEntity = useCallback(
    async (entityId: string) => {
      // 1. Clear from local queue.
      setQueueMirrored((q) => q.filter((entry) => entry.entity_id !== entityId));
      // 2. Delete any matching server-side drafts in the active block.
      //    Drafts only exist if a block is active and the user has
      //    previously submitted at least once.
      const matchingDrafts = activeBundleId
        ? drafts.filter((d) => d.entity_id === entityId)
        : [];
      if (matchingDrafts.length === 0) return;
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Not signed in.');
        // DELETE /api/proposals/:id (withdraw — drafts hard-delete server-side).
        await Promise.all(
          matchingDrafts.map((d) =>
            fetch(`/api/proposals/${encodeURIComponent(d.id)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${idToken}` },
            }).then((res) => {
              if (!res.ok) {
                return res.json().catch(() => ({})).then((b: any) => {
                  throw new Error(
                    b?.error || `Failed to delete draft (HTTP ${res.status})`,
                  );
                });
              }
            }),
          ),
        );
        void refreshBlock();
      } catch (err: any) {
        toast.error(err?.message || 'Failed to drop entity drafts.');
      }
    },
    [activeBundleId, drafts, refreshBlock],
  );

  const contextValue: ProposalAccumulatorContextValue = useMemo(
    () => ({
      queue,
      queueChange,
      flushToBundle,
      resetQueue,
      submitting,
      isEntityDirty,
      isFieldDirty,
      dropEntity,
      dropField,
      dropFields,
      focusModeEnabled: enableFocusMode,
      focusMode,
      setFocusMode,
      registerPreFlush,
    }),
    [
      queue,
      queueChange,
      flushToBundle,
      resetQueue,
      submitting,
      isEntityDirty,
      isFieldDirty,
      dropEntity,
      dropField,
      dropFields,
      enableFocusMode,
      focusMode,
      registerPreFlush,
    ],
  );

  // Submit Changes button handler.
  const handleSubmit = useCallback(async () => {
    // Pre-flush registered → editor will capture form state at flush
    // time, so an empty queue here is normal. Skip the "nothing to
    // submit" short-circuit and let flushToBundle decide (it returns
    // `{ submitted: 0 }` if pre-flush ends up not queuing anything).
    const canFlush = queue.length > 0 || preFlushCallbacks.current.size > 0;
    if (!canFlush) {
      toast.message('No queued changes to submit.');
      return;
    }
    if (!activeBundleId) {
      // Refresh the open-blocks list so the picker is up to date.
      void refreshOpenBlocks();
      setPickerOpen(true);
      return;
    }
    try {
      const { submitted } = await flushToBundle(activeBundleId);
      if (submitted === 0) {
        toast.message('No changes to submit.');
        return;
      }
      toast.success(
        `Added ${submitted} change${submitted === 1 ? '' : 's'} to the block.`,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit changes.');
    }
  }, [queue.length, activeBundleId, flushToBundle, refreshOpenBlocks]);

  // PickOrCreateBlockDialog callbacks.
  const handlePickerPick = useCallback(
    async (bundleId: string) => {
      setActiveBlock(bundleId);
      try {
        const { submitted } = await flushToBundle(bundleId);
        toast.success(
          `Added ${submitted} change${submitted === 1 ? '' : 's'} to the block.`,
        );
      } catch (err: any) {
        toast.error(err?.message || 'Failed to submit changes.');
      }
    },
    [setActiveBlock, flushToBundle],
  );

  const handlePickerCreate = useCallback(
    async (name: string, description: string | null) => {
      try {
        const id = await startBlock(name, description);
        const { submitted } = await flushToBundle(id);
        toast.success(
          `Created "${name}" and added ${submitted} change${submitted === 1 ? '' : 's'}.`,
        );
      } catch (err: any) {
        toast.error(err?.message || 'Failed to create block.');
      }
    },
    [startBlock, flushToBundle],
  );

  // beforeunload + in-app navigation guard (uses the same shared
  // hook ClassEditor relies on). The hook installs:
  //   - a beforeunload listener for tab close / hard refresh
  //   - a capture-phase click handler that intercepts <a> clicks
  //     and surfaces a confirm-leave modal before routing
  useUnsavedChangesWarning(queue.length > 0);

  const entityLabel = ENTITY_LABELS[primaryEntityType] ?? primaryEntityType;
  // Submit Changes is enabled when:
  //   - submitting is off AND
  //   - there's something queued, OR an editor has registered a
  //     pre-flush callback (the editor will capture form state at
  //     click time, replacing per-editor Save buttons).
  const hasPreFlush = preFlushCallbacks.current.size > 0;
  const submitDisabled = submitting || (queue.length === 0 && !hasPreFlush);
  const submitLabel = submitting
    ? 'Submitting…'
    : queue.length === 0
      ? 'Submit Changes'
      : `Submit ${queue.length} Change${queue.length === 1 ? '' : 's'}`;

  return (
    <ProposalAccumulatorContext.Provider value={contextValue}>
      <div className="space-y-4">
        <ProposalEditorHeader
          entityLabel={entityLabel}
          activeBundleName={activeBundle?.name ?? null}
          activeBundleDescription={activeBundle?.description ?? null}
          queueCount={queue.length}
          submitLabel={submitLabel}
          submitting={submitting}
          disabled={submitDisabled}
          onSubmit={handleSubmit}
          focusModeEnabled={enableFocusMode}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
        />
        {children}
      </div>
      <PickOrCreateBlockDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        openBlocks={openBlocks}
        onPick={handlePickerPick}
        onCreate={handlePickerCreate}
      />
    </ProposalAccumulatorContext.Provider>
  );
}

type HeaderProps = {
  entityLabel: string;
  activeBundleName: string | null;
  activeBundleDescription: string | null;
  queueCount: number;
  submitLabel: string;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => void;
  focusModeEnabled: boolean;
  focusMode: FocusMode;
  onFocusModeChange: (next: FocusMode) => void;
};

function ProposalEditorHeader({
  entityLabel,
  activeBundleName,
  activeBundleDescription,
  queueCount,
  submitLabel,
  submitting,
  disabled,
  onSubmit,
  focusModeEnabled,
  focusMode,
  onFocusModeChange,
}: HeaderProps) {
  return (
    <div className="sticky top-0 z-30 -mx-4 px-4 py-3 bg-blood/10 border-b border-blood/30 backdrop-blur supports-backdrop-filter:bg-blood/5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="text-[9px] font-bold uppercase tracking-widest border-blood/30 text-blood"
            >
              Proposal editor
            </Badge>
            <span className="text-sm font-semibold">{entityLabel}</span>
            {queueCount > 0 && (
              <Badge
                variant="outline"
                className="text-[9px] border-gold/40 text-gold"
              >
                {queueCount} queued
              </Badge>
            )}
          </div>
          {activeBundleName ? (
            <p className="text-xs text-ink/70 leading-snug">
              <span className="font-semibold">Block:</span>{' '}
              <span>{activeBundleName}</span>
              {activeBundleDescription && (
                <>
                  {' — '}
                  <span className="text-ink/60">{activeBundleDescription}</span>
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-ink/60 italic">
              No active block. Submit Changes will prompt to pick or create one.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {focusModeEnabled && (
            <FocusModeToggle value={focusMode} onChange={onFocusModeChange} />
          )}
          <Button
            onClick={onSubmit}
            disabled={disabled}
            className="gap-1.5 bg-gold text-white"
          >
            <Send className="w-3.5 h-3.5" />
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FocusModeToggle — segmented control for multi-work editors.                 */
/*                                                                              */
/* Drafts mode = show only entries the user has staged. Browse Base mode =     */
/* render the live catalog read-only with an "Edit Base [Name]" per entry      */
/* (editor decides how to implement the visual; the wrapper just owns the     */
/* mode flag in context).                                                     */
/* -------------------------------------------------------------------------- */

function FocusModeToggle({
  value,
  onChange,
}: {
  value: FocusMode;
  onChange: (next: FocusMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Focus mode"
      className="inline-flex rounded-md border border-foreground/15 p-0.5 bg-background/30"
    >
      <button
        type="button"
        onClick={() => onChange('drafts')}
        className={cn(
          'px-2.5 py-1 text-[10px] uppercase tracking-widest rounded transition-colors',
          value === 'drafts'
            ? 'bg-gold/15 text-gold font-bold'
            : 'text-ink/60 hover:text-ink',
        )}
        aria-pressed={value === 'drafts'}
      >
        My Drafts
      </button>
      <button
        type="button"
        onClick={() => onChange('browse')}
        className={cn(
          'px-2.5 py-1 text-[10px] uppercase tracking-widest rounded transition-colors',
          value === 'browse'
            ? 'bg-gold/15 text-gold font-bold'
            : 'text-ink/60 hover:text-ink',
        )}
        aria-pressed={value === 'browse'}
      >
        Browse Base
      </button>
    </div>
  );
}
