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
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { auth } from '../../lib/firebase';
import {
  ProposalAccumulatorContext,
  postQueuedChanges,
  useQueueOperations,
  type ProposalAccumulatorContextValue,
  type QueuedChange,
} from '../../lib/proposalAccumulator';
import { useBlock } from '../../lib/proposalBlock';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PickOrCreateBlockDialog } from './PickOrCreateBlockDialog';
import type { ProposalEntityType } from '../../lib/proposalAware';

const ENTITY_LABELS: Record<ProposalEntityType, string> = {
  tag: 'Tags',
  tag_group: 'Tag Groups',
  spell_rule: 'Spell Rules',
  spell_rule_application: 'Spell Rule Applications',
  class_spell_list: 'Class Spell Lists',
  spell: 'Spells',
  class: 'Classes',
  unique_option_group: 'Option Groups',
  unique_option_item: 'Option Items',
};

export type ProposalEditorWrapperProps = {
  entityType: ProposalEntityType;
  children: ReactNode;
};

export function ProposalEditorWrapper({
  entityType,
  children,
}: ProposalEditorWrapperProps) {
  const {
    activeBundleId,
    activeBundle,
    drafts,
    openBlocks,
    startBlock,
    setActiveBlock,
    refresh: refreshBlock,
    refreshOpenBlocks,
  } = useBlock();

  const [queue, setQueue] = useState<QueuedChange[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { queueChange, resetQueue } = useQueueOperations(setQueue);

  // Drain the queue against a known bundleId. Caller is responsible
  // for ensuring the bundle exists (via setActiveBlock or startBlock)
  // before invoking this.
  const flushToBundle = useCallback(
    async (bundleId: string) => {
      if (queue.length === 0) return { submitted: 0 };
      setSubmitting(true);
      try {
        const result = await postQueuedChanges(queue, bundleId);
        setQueue([]);
        // Refresh the BlockProvider's local cache so the navbar
        // pill + Block tab show the new draft count immediately.
        void refreshBlock();
        return result;
      } finally {
        setSubmitting(false);
      }
    },
    [queue, refreshBlock],
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
      setQueue((q) =>
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
      setQueue((q) => q.filter((entry) => entry.entity_id !== entityId));
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
    ],
  );

  // Submit Changes button handler.
  const handleSubmit = useCallback(async () => {
    if (queue.length === 0) {
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

  // beforeunload warning when the queue is non-empty. react-router's
  // useBlocker would also guard SPA navigations — deferred to a later
  // pass since the API differs across router versions.
  useEffect(() => {
    if (queue.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chromium requires returnValue to trigger the prompt; the
      // actual string is ignored in modern browsers.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [queue.length]);

  const entityLabel = ENTITY_LABELS[entityType] ?? entityType;
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
          disabled={submitting || queue.length === 0}
          onSubmit={handleSubmit}
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
        <Button
          onClick={onSubmit}
          disabled={disabled}
          className="gap-1.5 bg-gold text-white flex-shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
