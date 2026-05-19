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

  const contextValue: ProposalAccumulatorContextValue = useMemo(
    () => ({
      queue,
      queueChange,
      flushToBundle,
      resetQueue,
      submitting,
    }),
    [queue, queueChange, flushToBundle, resetQueue, submitting],
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
