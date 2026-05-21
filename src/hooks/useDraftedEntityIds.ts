// =============================================================================
// useDraftedEntityIds
// =============================================================================
//
// Returns the union Set of entity ids the user has touched (any
// operation — CREATE / UPDATE / DELETE) on `entityType` in the active
// block. Catalog editors use this for:
//
//   - "My Drafts" filter — only show entries with a queued/drafted
//     write against them.
//   - Edit-base unlock gating — if the user already has a queued
//     edit on a base entity, the form is unlocked (it's their work).
//   - Row-render markers — yellow "queued/drafted" highlight in the
//     catalog list.
//
// Built on top of `useProposalEntityDrafts` — the same overlay that
// powers `displayEntries`. Pulls `byId.keys()` (UPDATEs + CREATEs)
// and `deletedIds` (DELETEs whose payload is wiped from byId) and
// returns the union.
//
// Important — applies the entity_id-null fallback transparently
// because useProposalEntityDrafts does. Hand-rolled scans of
// `proposalContext.queue` + `allDrafts.filter(d => d.entity_id ...)`
// would miss CREATE drafts (whose `entity_id` is forcibly null
// server-side; the real id lives in `proposed_payload.id`). Use this
// hook instead.
// =============================================================================

import { useMemo } from 'react';
import { useProposalEntityDrafts } from './useProposalEntityDrafts';
import type { ProposalEntityType } from '../lib/proposalAware';

export function useDraftedEntityIds(
  entityType: ProposalEntityType | null,
): Set<string> {
  const drafts = useProposalEntityDrafts(entityType);
  return useMemo(() => {
    return new Set<string>([
      ...Array.from(drafts.byId.keys()).map(String),
      ...Array.from(drafts.deletedIds).map(String),
    ]);
  }, [drafts]);
}
