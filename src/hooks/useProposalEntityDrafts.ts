// =============================================================================
// useProposalEntityDrafts
// =============================================================================
//
// Collapses the four-line "useBlock + useMemo(getDraftedEntities)" dance
// that every proposal-aware editor was repeating. Returns the merged
// queue+drafts overlay for a single entity type — see
// docs/architecture/proposal-editor-pattern.md for the contract.
//
// Outside a <ProposalEditorWrapper> (admin direct routes, anywhere else)
// the hook returns empty maps so editors can call it unconditionally.
//
// Pass `null` for `entityType` when the editor doesn't know its entity
// type at render time (e.g. DevelopmentCompendiumManager is generic
// and its caller may not provide one). The hook returns empty maps in
// that case, same as outside a wrapper.
// =============================================================================

import { useMemo } from 'react';
import {
  getDraftedEntities,
  useProposalContextOptional,
} from '../lib/proposalAccumulator';
import { useBlock } from '../lib/proposalBlock';
import type { ProposalEntityType } from '../lib/proposalAware';

const EMPTY_RETURN = {
  byId: new Map<string, Record<string, any>>(),
  createdIds: new Set<string>(),
  deletedIds: new Set<string>(),
  deletedSources: new Map<string, Record<string, any>>(),
};

export function useProposalEntityDrafts(entityType: ProposalEntityType | null) {
  const ctx = useProposalContextOptional();
  const { drafts, activeBundleId } = useBlock();
  return useMemo(() => {
    if (!entityType) return EMPTY_RETURN;
    // Outside <ProposalEditorWrapper> (admin-direct route, navbar,
    // dashboards, etc.) return empty — block drafts must not leak
    // overlays onto admin-direct editors when an admin has an open
    // block elsewhere in the app.
    if (!ctx) return EMPTY_RETURN;
    return getDraftedEntities(entityType, ctx, drafts, activeBundleId);
  }, [entityType, ctx, drafts, activeBundleId]);
}
