// =============================================================================
// useProposalDraftOptions
// =============================================================================
//
// Cross-reference picker overlay for proposal mode. A class authored in a
// block references scaling columns / option groups / (sub)classes by id —
// but those referenced entities may themselves be drafts in the same block,
// not live rows. Entity pickers fetch the LIVE catalog, so a just-created
// draft is invisible and unselectable. This hook returns the active-block
// draft CREATEs for an entity type, flattened to a picker-friendly shape so
// a consumer can concat them onto its live options:
//
//   const liveGroups = useLiveOptionGroups();
//   const draftGroups = useProposalDraftOptions('unique_option_group');
//   const options = [...liveGroups, ...draftGroups]; // draftGroups carry __draft
//
// Because the proposal system preserves client-minted ids through approval,
// a reference authored against a draft id resolves the moment the block
// approves (see the cross-referential-cluster design doc). The picker only
// needs to make the draft *selectable*.
//
// Scope: CREATE drafts only. Updates to existing rows already appear in the
// live fetch (selection is by id, which is unchanged), so they don't need
// re-injecting. Returns [] outside a <ProposalEditorWrapper> (the underlying
// useProposalEntityDrafts is wrapper-gated), so pickers on admin-direct
// routes are unaffected.
// =============================================================================

import { useMemo } from 'react';
import { useProposalEntityDrafts } from './useProposalEntityDrafts';
import type { ProposalEntityType } from '../lib/proposalAware';

export type DraftOption = {
  /** Client-minted UUID — stable through approval. */
  id: string;
  /** Best-effort display label from the draft payload's `name`. */
  name: string;
  /** Marker so the picker can render an "in this block" affordance. */
  __draft: true;
};

/**
 * Optional parent-scope filter, mirroring `useBlockDraftedList`'s options.
 * For PARENT-OWNED entity types (features, scaling columns) pass the owner
 * so, e.g., a class's feature picker doesn't surface a sibling subclass's
 * draft features. Omit for global catalogs (option groups, feats).
 */
export interface DraftOptionFilter {
  /** Restrict to draft CREATEs owned by this parent id. */
  parentId?: string;
  /** Parent discriminator (e.g. 'class' | 'subclass' | 'item'). */
  parentType?: string;
  /** Payload field holding the parent id. Defaults to `parent_id`. */
  parentKey?: string;
}

export function useProposalDraftOptions(
  entityType: ProposalEntityType | null,
  filter?: DraftOptionFilter,
): DraftOption[] {
  const drafts = useProposalEntityDrafts(entityType);
  const parentId = filter?.parentId;
  const parentType = filter?.parentType;
  const parentKey = filter?.parentKey ?? 'parent_id';
  return useMemo(() => {
    const out: DraftOption[] = [];
    // `createdIds` is the set of ids the user is CREATING in the active
    // block (no live row yet) — exactly the entities the live fetch can't
    // see. `byId` holds the merged payload for each.
    for (const id of drafts.createdIds) {
      const payload = drafts.byId.get(id);
      // Parent-scope filter (mirrors useBlockDraftedList): when a parent is
      // specified, skip draft creates owned by a different parent so a class
      // picker won't list a subclass's features, and vice-versa.
      if (parentId !== undefined && String(payload?.[parentKey] ?? '') !== String(parentId)) continue;
      if (parentType !== undefined && String(payload?.parent_type ?? '') !== String(parentType)) continue;
      const rawName =
        payload && typeof payload.name === 'string' ? payload.name.trim() : '';
      out.push({
        id,
        name: rawName || '(unnamed draft)',
        __draft: true,
      });
    }
    return out;
  }, [drafts, parentId, parentType, parentKey]);
}
