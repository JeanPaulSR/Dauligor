// =============================================================================
// BlockReviewBody — the creator's own "Option C" review, inline.
// =============================================================================
//
// Renders the SAME split-pane the admin uses (BlockReviewPane) directly inside
// the active block card on My Proposals → Block, so a content-creator always
// sees their whole block — rail of grouped changes + field-level diff — exactly
// as the reviewer will, without opening anything.
//
// Per-change actions in the detail pane:
//   - "Open in editor"     → jump back to the editor for that draft,
//   - "Remove from block"   → un-stage it (one-more-click inline confirm; no
//                             stacked modal). The parent does the DELETE.
//
// Submitting the block is a separate header action on the card (with its own
// confirm) — this component is purely the review surface.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Trash2, ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { BlockReviewPane, type ReviewRevision } from './BlockReviewPane';
import type { RefNames } from './proposalReviewFormat';
import type { DraftRevision } from '../../lib/proposalBlock';
import { fetchCollection } from '../../lib/d1';

export type BlockReviewBodyProps = {
  drafts: DraftRevision[];
  loading?: boolean;
  /** Un-stage a draft (parent DELETEs it + refreshes the block). */
  onRemoveDraft: (draft: DraftRevision) => void;
  /** Jump to the editor for this draft (parent navigates). */
  onContinueEditing: (draft: DraftRevision) => void;
  minHeightClass?: string;
  scrollMaxHeightClass?: string;
};

export function BlockReviewBody({
  drafts,
  loading = false,
  onRemoveDraft,
  onContinueEditing,
  minHeightClass = 'min-h-[300px]',
  scrollMaxHeightClass = 'max-h-[60vh]',
}: BlockReviewBodyProps) {
  // First click on Remove arms it (stores the revision id); second click on
  // the SAME revision actually removes. Switching the selected revision shows
  // the un-armed button again (renderRevisionActions only runs for the
  // currently-selected revision).
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null);

  // Fetch tag names once so `tag_ids` resolve to names instead of slugs/ids in
  // the diff. Best-effort: on failure the ids just stay raw. Keyed by both id
  // and slug since payloads may reference either.
  const [tagNames, setTagNames] = useState<RefNames | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<any>('tags', { orderBy: 'name ASC' });
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const t of rows) {
          if (!t?.name) continue;
          if (t.id) m.set(String(t.id), String(t.name));
          if (t.slug) m.set(String(t.slug), String(t.name));
        }
        setTagNames(m);
      } catch {
        /* non-fatal — unresolved tag ids fall back to raw */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // id → original DraftRevision, so the pane's ReviewRevision callbacks can
  // recover the draft the parent handlers expect.
  const byId = useMemo(() => {
    const m = new Map<string, DraftRevision>();
    for (const d of drafts) m.set(d.id, d);
    return m;
  }, [drafts]);

  // DraftRevision → ReviewRevision. status is always 'draft'; no proposer
  // identity (it's the creator's own block), so the pane shows "staged · time".
  const revisions = useMemo<ReviewRevision[]>(
    () =>
      drafts.map((d) => ({
        id: d.id,
        entity_type: d.entity_type as ReviewRevision['entity_type'],
        entity_id: d.entity_id,
        operation: d.operation,
        proposed_payload: d.proposed_payload,
        snapshot_at_proposal: d.snapshot_at_proposal,
        proposed_at: d.proposed_at,
        status: 'draft',
        notes_from_proposer: d.notes_from_proposer,
      })),
    [drafts],
  );

  return (
    <BlockReviewPane
      revisions={revisions}
      loading={loading}
      emptyLabel="No changes staged yet — use New / Edit above to make a change."
      extraRefNames={tagNames}
      minHeightClass={minHeightClass}
      scrollMaxHeightClass={scrollMaxHeightClass}
      renderRevisionActions={(rev) => {
        const draft = byId.get(rev.id);
        if (!draft) return null;
        const armed = armedRemoveId === rev.id;
        return (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setArmedRemoveId(null);
                onContinueEditing(draft);
              }}
              className="gap-1.5 border-gold/35 text-gold hover:bg-gold/15"
            >
              Open in editor <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            {armed ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setArmedRemoveId(null)}
                  className="border-ink/25 text-ink/65 hover:bg-ink/5"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setArmedRemoveId(null);
                    onRemoveDraft(draft);
                  }}
                  className="gap-1.5 bg-blood text-white hover:bg-blood/90"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Confirm remove
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => setArmedRemoveId(rev.id)}
                className="gap-1.5 border-blood/30 text-blood hover:bg-blood/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove from block
              </Button>
            )}
          </>
        );
      }}
    />
  );
}
