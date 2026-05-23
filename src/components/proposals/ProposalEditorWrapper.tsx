// =============================================================================
// ProposalEditorWrapper
// =============================================================================
//
// Provides the proposal-accumulator context to editors mounted under
// /proposals/edit/*. Boundary between the two parallel route prefixes:
//
//   /compendium/<thing>/manage    →  admin direct write, no wrapper
//   /proposals/edit/<thing>       →  this wrapper around the SAME editor
//
// See docs/architecture/proposal-editor-pattern.md for the full
// pattern + the editor-wiring checklist. The wrapper is responsible
// for:
//
//   - Hosting the in-memory queue (useState in this component).
//     Survives intra-page state changes; resets on route remount
//     (so navigating between /new and /edit/<id> on the same entity
//     destroys the queue — that's why single-work editors use the
//     pendingCreateId convention to stay on /new after a create).
//   - Mounting body.proposal-editor-active for the lifetime of this
//     route, so global <main>'s top padding gets stripped (see
//     src/index.css). Without this, every editor under the wrapper
//     would render with a ~32px gap above the wrapper header.
//   - Rendering the sticky "PROPOSAL EDITOR | <entity>" header
//     strip with active block info + Submit Changes button + (for
//     multi-work editors) the In Block / Full Catalog focus toggle.
//     The strip uses `-mx-4 px-4` to bleed past <main>'s padding;
//     a CSS override under body.spell-list-fullscreen zeroes that
//     bleed for full-bleed editors so the strip doesn't spill over
//     the sidebar.
//   - Pre-flush registration: child editors register callbacks via
//     proposalContext.registerPreFlush(). At submit time the wrapper
//     awaits each before draining the queue, so editors can capture
//     their current form state without firing per-row Save buttons.
//   - Drop Edits affordances (dropEntity / dropFields / dropField)
//     for surgical un-proposing of queued / drafted changes.
//   - beforeunload guard so the user doesn't accidentally lose
//     unsubmitted edits.
//   - PickOrCreateBlockDialog when Submit Changes runs with no
//     active block bound.
//   - Review-mode chrome (<ReviewBanner /> + <fieldset disabled>)
//     when the URL carries ?review=<proposalId> for a non-rejected
//     proposal.
// =============================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Send, FilePen, Library } from 'lucide-react';
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
import { useProposalReview } from '../../lib/proposalReview';
import { ReviewBanner } from './ReviewBanner';
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
  /**
   * Opt-in flag for editors whose admin-direct route uses the
   * `admin-page-fullscreen` / `h-[calc(100vh-4rem)]` shell and want
   * the same behaviour on `/proposals/edit/*`. When set, the wrapper
   * swaps its `space-y-4` outer for `flex flex-col h-full gap-4` and
   * wraps the children slot in `flex-1 min-h-0 flex flex-col`, so a
   * child using `h-full` (or `flex-1`) actually fills the available
   * height instead of collapsing to its content. The child is still
   * responsible for mounting the body class — the wrapper only
   * provides the parent flex shell.
   *
   * Defaults to `false` so editors that rely on natural document
   * scroll (Spell Rules, Spell Lists, Classes, Subclasses, etc.)
   * keep their existing layout untouched.
   */
  fullscreen?: boolean;
  children: ReactNode;
};

export function ProposalEditorWrapper({
  entityType,
  enableFocusMode = false,
  fullscreen = false,
  children,
}: ProposalEditorWrapperProps) {
  // Strip the global `<main>` top padding (py-8 = 32px) for the
  // lifetime of any proposal-edit page. Without this, every editor
  // that doesn't separately opt into `body.spell-list-fullscreen`
  // (Tags, Option Groups, etc.) renders with a visible ~32px gap
  // between the top navbar and the wrapper's "PROPOSAL EDITOR | …"
  // header strip. The full-bleed spell editors don't suffer from
  // this because they already strip the same padding via
  // spell-list-fullscreen. CSS rule lives next to the existing
  // fullscreen overrides in index.css.
  useEffect(() => {
    document.body.classList.add('proposal-editor-active');
    return () => {
      document.body.classList.remove('proposal-editor-active');
    };
  }, []);

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
      //
      //    CREATE drafts carry `entity_id: null` on the server (the
      //    proposal endpoint forcibly nulls it — there's no live row
      //    to point at yet). Their effective id lives at
      //    `proposed_payload.id`. Match on both columns so undo
      //    catches both `update-on-live-row` drafts AND
      //    `create-of-new-row` drafts.
      const matchingDrafts = activeBundleId
        ? drafts.filter((d) =>
            d.entity_id === entityId ||
            (d.proposed_payload &&
              typeof d.proposed_payload.id === 'string' &&
              d.proposed_payload.id === entityId),
          )
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

  // Save Progress button handler (also called via `submitNow` from
  // editors' per-entity Save in proposal mode — see context value).
  // Declared BEFORE contextValue because the context exposes it as
  // `submitNow`.
  const handleSubmit = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;
      // Pre-flush registered → editor will capture form state at flush
      // time, so an empty queue here is normal. Skip the "nothing to
      // save" short-circuit and let flushToBundle decide (it returns
      // `{ submitted: 0 }` if pre-flush ends up not queuing anything).
      const canFlush = queue.length > 0 || preFlushCallbacks.current.size > 0;
      if (!canFlush) {
        if (!silent) toast.message('No queued changes to save.');
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
          if (!silent) toast.message('No changes to save.');
          return;
        }
        if (!silent) {
          toast.success(
            `Saved ${submitted} change${submitted === 1 ? '' : 's'} to the block.`,
          );
        }
      } catch (err: any) {
        toast.error(err?.message || 'Failed to save progress.');
      }
    },
    [queue.length, activeBundleId, flushToBundle, refreshOpenBlocks],
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
      submitNow: handleSubmit,
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
      handleSubmit,
    ],
  );

  // PickOrCreateBlockDialog callbacks.
  const handlePickerPick = useCallback(
    async (bundleId: string) => {
      setActiveBlock(bundleId);
      try {
        const { submitted } = await flushToBundle(bundleId);
        toast.success(
          `Saved ${submitted} change${submitted === 1 ? '' : 's'} to the block.`,
        );
      } catch (err: any) {
        toast.error(err?.message || 'Failed to save progress.');
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
  // Hide the wrapper's header chrome (including Submit Changes) when
  // the editor is in read-only review mode — the user is inspecting a
  // past submission, not staging new work. Rejected proposals stay
  // editable, so the header stays visible for them too. We trust the
  // route navigation: if `?review=<id>` resolved, the user clicked
  // through from /my-proposals, which means the proposal already
  // belongs in this editor (hybrid editors like TagsExplorer cover
  // multiple entity_types, so a per-entity-type filter would
  // false-negative the tag_group proposals on the tags route).
  const reviewMode = useProposalReview();
  const isReadOnlyReview = !!reviewMode && reviewMode.isReadOnly;
  // Submit Changes is enabled when:
  //   - submitting is off AND
  //   - there's something queued, OR an editor has registered a
  //     pre-flush callback (the editor will capture form state at
  //     click time, replacing per-editor Save buttons).
  const hasPreFlush = preFlushCallbacks.current.size > 0;
  const submitDisabled = submitting || (queue.length === 0 && !hasPreFlush);
  // Button label is "Save Progress" — this stages everything currently
  // queued (plus anything pre-flush callbacks emit at click time) into
  // pending_revisions as drafts within the active block. The block
  // itself is what later gets submitted for admin review; that's a
  // separate action on the BlockPanel. User feedback (2026-05-21
  // production test) showed "Submit Changes" was misread as "send to
  // admin" — "Save Progress" matches the actual semantic.
  const submitLabel = submitting
    ? 'Saving…'
    : queue.length === 0
      ? 'Save Progress'
      : `Save ${queue.length} Change${queue.length === 1 ? '' : 's'}`;

  return (
    <ProposalAccumulatorContext.Provider value={contextValue}>
      <div
        className={
          fullscreen
            // Explicit viewport-bound height (4rem = --navbar-height)
            // because App.tsx wraps every route in an `animate-in
            // fade-in` div with no flex/height behaviour — that broken
            // intermediate link means `h-full` here would resolve
            // against a content-sized parent (circular) and collapse
            // the whole stack to content height. The fullscreen body
            // class (mounted by the child editor) hides the global
            // footer + locks body overflow at lg+, so the explicit
            // 100vh-4rem matches the visible content area exactly.
            ? 'flex flex-col h-[calc(100vh-4rem)] gap-4'
            : 'space-y-4'
        }
      >
        {/* Review banner sits above the header (or alone for read-only
            reviews). Rejected proposals get BOTH the banner AND the
            header — the header's Submit Changes is how the user
            resubmits after editing. */}
        {reviewMode && <ReviewBanner />}
        {!isReadOnlyReview && (
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
        )}
        {isReadOnlyReview ? (
          // Disable all form controls inside the editor when read-only.
          // <fieldset disabled> cascades to every nested input/select/
          // textarea/button — no per-input wiring required.
          <fieldset
            disabled
            className={cn(
              'border-0 p-0 m-0 disabled:opacity-95',
              fullscreen ? 'flex-1 min-h-0 flex flex-col' : 'space-y-4',
            )}
          >
            {children}
          </fieldset>
        ) : (
          // In fullscreen mode the child editor is expected to apply
          // `flex-1 min-h-0 flex flex-col` to its outer container so it
          // grows into the flex-column slot we set up above. No extra
          // wrapping div needed; an intermediate `h-full` indirection
          // was unreliable across browsers (height:100% inside a
          // flex-1 parent doesn't always resolve to a definite size).
          children
        )}
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
    /*
      `-mx-4 px-4` is the bleed trick: negative margin pulls the bg
      back over main's `px-4` so the strip reaches the viewport
      edges, while the internal px-4 keeps content aligned with the
      rest of the page. Fullscreen editors (Spells / Spell Rules /
      Spell Lists) set body.spell-list-fullscreen, which strips
      main's padding — at that point the -mx-4 has nothing to bleed
      PAST and instead spills LEFT over the sidebar. CSS rule in
      index.css zeroes the negative margin under that body class.
    */
    <div className="proposal-editor-strip sticky top-0 z-30 -mx-4 px-4 py-3 bg-blood/10 border-b border-blood/30 backdrop-blur supports-backdrop-filter:bg-blood/5">
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
              No active block. Save Progress will prompt to pick or create one.
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
  // Labels favored clarity over brevity after user feedback:
  // "My Drafts" / "Browse Base" weren't self-explanatory for new
  // proposers. "In Block" + the pen icon reads as "what I'm
  // editing right now"; "Full Catalog" + the library icon reads as
  // "everything in the compendium". Title tooltips spell out the
  // exact filter for assistive tech and curious users.
  return (
    <div
      role="group"
      aria-label="What you see in the list"
      className="inline-flex rounded-md border border-foreground/15 p-0.5 bg-background/30"
    >
      <button
        type="button"
        onClick={() => onChange('drafts')}
        title="Show only entries you've created, edited, or marked Edit Base in this block."
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-widest rounded transition-colors',
          value === 'drafts'
            ? 'bg-gold/15 text-gold font-bold'
            : 'text-ink/60 hover:text-ink',
        )}
        aria-pressed={value === 'drafts'}
      >
        <FilePen className="w-3 h-3" />
        In Block
      </button>
      <button
        type="button"
        onClick={() => onChange('browse')}
        title="Browse the full compendium catalog. Entries are read-only until you click Edit Base."
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-widest rounded transition-colors',
          value === 'browse'
            ? 'bg-gold/15 text-gold font-bold'
            : 'text-ink/60 hover:text-ink',
        )}
        aria-pressed={value === 'browse'}
      >
        <Library className="w-3 h-3" />
        Full Catalog
      </button>
    </div>
  );
}
