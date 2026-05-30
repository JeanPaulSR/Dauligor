// =============================================================================
// useBlockDraftPickerOptions  (Part C — cross-reference picker overlay)
// =============================================================================
//
// Thin wrapper over `useProposalDraftOptions` for the cross-reference pickers.
// A content-creator building, say, a class in a proposal block also drafts the
// entities it references (features, option groups/items, feats, scaling columns)
// in the SAME block — those drafts have no live row yet, so the catalog fetch a
// picker relies on can't see them. This returns the active block's CREATE drafts
// for `entityType`, display-name-suffixed with "(in this block)", ready to spread
// into a picker's live option array:
//
//   const liveFeats = useLiveFeats();
//   const featDrafts = useBlockDraftPickerOptions('feat');
//   <AdvancementManager availableFeats={[...liveFeats, ...featDrafts]} … />
//
// Returns `[]` outside a <ProposalEditorWrapper> (the underlying hook is
// wrapper-gated), so admin-direct pickers are unchanged. DISPLAY-ONLY — never
// merge these into a save payload (the live row's own create handles that; the
// reference resolves on approval because client-minted ids are preserved).
//
// Centralizing the "(in this block)" affordance here means it's one place to
// restyle (e.g. a real badge) during the roadmap step-3 shared-widget cleanup.
// =============================================================================

import { useMemo } from 'react';
import { useProposalDraftOptions, type DraftOption, type DraftOptionFilter } from './useProposalDraftOptions';
import type { ProposalEntityType } from '../lib/proposalAware';

export function useBlockDraftPickerOptions(
  entityType: ProposalEntityType | null,
  filter?: DraftOptionFilter,
): DraftOption[] {
  const drafts = useProposalDraftOptions(entityType, filter);
  return useMemo(
    () => drafts.map((d) => ({ ...d, name: `${d.name} (in this block)` })),
    [drafts],
  );
}
