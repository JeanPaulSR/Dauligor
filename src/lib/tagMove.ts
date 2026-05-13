// =============================================================================
// Tag move (reparent) operation
// =============================================================================
//
// Changes a tag's `parent_tag_id` to promote a subtag to root, demote a
// root under another root, or switch a subtag's parent. Validates the
// 2-level depth cap that the editor UI enforces — the schema doesn't
// (SQLite CHECK can't run subqueries) so the move helper is the last
// line of defence against accidental depth-3 creations.
//
// Cross-group moves (changing both `group_id` and `parent_tag_id`) are
// NOT supported here — they have implications for the `(group_id,
// COALESCE(parent_tag_id, ''), slug)` uniqueness invariant and for
// every consumer that filters by group. Spin that off as its own
// helper if/when it's needed.
// =============================================================================

import { queryD1, updateDocument } from './d1';

export interface MoveOptions {
  /** Tag id being moved. */
  tagId: string;
  /** New parent. `null` = promote to root. */
  newParentId: string | null;
}

interface TagRowLite {
  id: string;
  group_id: string;
  parent_tag_id: string | null;
}

async function fetchTagLite(id: string): Promise<TagRowLite | null> {
  const rows = await queryD1<TagRowLite>(
    `SELECT id, group_id, parent_tag_id FROM tags WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Reparent a tag. Throws on every violation of the 2-level invariant:
 *
 *  - `tagId` must exist.
 *  - `newParentId === tagId` → cycle, rejected.
 *  - When `newParentId` is non-null:
 *      - it must exist
 *      - it must be a ROOT tag (`parent_tag_id IS NULL`) — otherwise
 *        the move creates depth 3.
 *      - it must live in the same group as `tagId` (cross-group moves
 *        are out of scope here, see file header).
 *      - `tagId` must not currently have subtags — those would be
 *        promoted to depth 3 the moment their parent becomes a
 *        subtag itself.
 *
 * When all checks pass, runs a single `UPDATE tags SET parent_tag_id = ?
 * WHERE id = ?`. Tag usage counts are unaffected — references stay on
 * the same tag id — so no cache invalidation needed.
 */
export async function moveTagToParent({ tagId, newParentId }: MoveOptions): Promise<void> {
  if (!tagId) throw new Error('Move requires a tag id.');
  if (newParentId === tagId) throw new Error('Cannot make a tag its own parent.');

  const tag = await fetchTagLite(tagId);
  if (!tag) throw new Error('Tag no longer exists.');

  // Promotion to root is always allowed.
  if (newParentId !== null) {
    const parent = await fetchTagLite(newParentId);
    if (!parent) throw new Error('Destination parent tag no longer exists.');
    if (parent.parent_tag_id) {
      throw new Error('Destination must be a root tag — sub-sub-tags are not supported.');
    }
    if (parent.group_id !== tag.group_id) {
      throw new Error('Cross-group moves are not supported yet.');
    }
    // If `tag` has subtags, demoting it under another root would push
    // its children to depth 3.
    const childRows = await queryD1<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tags WHERE parent_tag_id = ?`,
      [tagId],
    );
    const childCount = Number(childRows[0]?.n) || 0;
    if (childCount > 0) {
      throw new Error(
        `This tag has ${childCount} subtag${childCount === 1 ? '' : 's'}. ` +
        `Promote them to root or move them elsewhere before demoting this tag.`,
      );
    }
  }

  // Single-column UPDATE — use the real-UPDATE helper rather than
  // upsertDocument, since partial upserts trip NOT NULL on group_id /
  // name / slug. See `docs/database/structure/tags.md` migration traps.
  await updateDocument('tags', tagId, { parent_tag_id: newParentId });
}
