// =============================================================================
// useBlockDraftedList  (Part C / F2 — own-list draft overlay)
// =============================================================================
//
// Merges the active proposal block's drafts into an editor's OWN live list so
// a just-queued create is visible (and a queued delete is marked) instead of
// "vanishing" because the list renders only the live DB fetch. Generalizes the
// pattern FeatsEditor pioneered in `displayEntries`:
//
//   - a live row being DELETEd in the block        → `__pendingDelete: true`
//   - a live row with a block UPDATE               → queued payload overlaid
//   - a block CREATE with no live row yet          → appended (denormalized to
//                                                     the editor's camelCase
//                                                     shape, tagged `__draft`)
//
// For PARENT-OWNED lists (scaling columns, features) pass `parentId`/`parentType`
// so only this parent's draft creates are appended — a block authoring two
// owners won't cross-contaminate their panels. Omit them for global catalogs
// (the option-group list). Returns `liveItems` unchanged outside a wrapper or
// when the block has no drafts, so admin-direct lists are untouched.
// =============================================================================

import { useMemo } from 'react';
import { useProposalEntityDrafts } from './useProposalEntityDrafts';
import { denormalizeCompendiumData } from '../lib/compendium';
import type { ProposalEntityType } from '../lib/proposalAware';

export interface BlockDraftedListOptions {
  /** Restrict appended draft CREATEs to those owned by this parent. */
  parentId?: string;
  /** Parent discriminator (e.g. 'class' | 'subclass' | 'feat' | 'item'). */
  parentType?: string;
  /**
   * Which payload field holds the parent id. Defaults to `parent_id`
   * (scaling columns, features). Some children use a different FK:
   * subclasses key on `class_id`, option items on `group_id`.
   */
  parentKey?: string;
}

export function useBlockDraftedList<T extends { id: string }>(
  entityType: ProposalEntityType | null,
  liveItems: T[],
  options?: BlockDraftedListOptions,
): T[] {
  const drafts = useProposalEntityDrafts(entityType);
  const parentId = options?.parentId;
  const parentType = options?.parentType;
  const parentKey = options?.parentKey ?? 'parent_id';
  return useMemo(() => {
    if (drafts.byId.size === 0 && drafts.deletedIds.size === 0) return liveItems;
    const merged: any[] = liveItems.map((e) => {
      if (drafts.deletedIds.has(String(e.id))) return { ...e, __pendingDelete: true };
      const overlay = drafts.byId.get(String(e.id));
      return overlay ? { ...e, ...denormalizeCompendiumData(overlay) } : e;
    });
    for (const [id, payload] of drafts.byId.entries()) {
      if (merged.some((e) => String(e.id) === id)) continue;
      if (parentId !== undefined && String(payload[parentKey] ?? '') !== String(parentId)) continue;
      if (parentType !== undefined && String(payload.parent_type ?? '') !== String(parentType)) continue;
      merged.push({ ...denormalizeCompendiumData(payload), id, __draft: true });
    }
    return merged as T[];
  }, [liveItems, drafts, parentId, parentType, parentKey]);
}
