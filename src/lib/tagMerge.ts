// =============================================================================
// Tag merge operation
// =============================================================================
//
// Atomically (best-effort — D1 forbids user-supplied BEGIN/COMMIT) retags
// every consumer reference from a source tag to a target tag, then deletes
// the source tag row.
//
// Used by the Tag Manager's tag-detail dialog when an admin picks
// "Merge into…" — solves the duplicate-tag problem ("Fire" and "Flame"
// both exist, consolidate everything to one).
//
// Consumer surface MUST match `src/lib/tagUsage.ts` — same list of tables
// and tag-column names. See `docs/database/structure/tags.md` (Tag
// consumers section) for the authoritative list. If you add a new
// tag-storing column anywhere, update BOTH files in the same commit or
// counts and merges will silently drift.
//
// Subtag protection: merging a tag that HAS subtags is rejected with a
// thrown Error. The caller is expected to surface a "delete or reparent
// the subtags first" message. We don't auto-reparent because the right
// destination (target's subtag list? promote to root? merge into a
// different parent?) is judgement-laden and silent reparenting is
// surprising.
// =============================================================================

import { queryD1 } from './d1';
import { invalidateTagUsageCache } from './tagUsage';

interface JsonArrayConsumer {
  /** SQL table name. */
  table: string;
  /** JSON-array column on that table holding tag ids. */
  column: string;
}

// Same surface tagUsage.ts scans. Keep in sync.
const JSON_ARRAY_CONSUMERS: JsonArrayConsumer[] = [
  { table: 'spells',              column: 'tags'    },
  { table: 'feats',               column: 'tags'    },
  { table: 'features',            column: 'tags'    },
  { table: 'items',               column: 'tags'    },
  { table: 'classes',             column: 'tag_ids' },
  { table: 'subclasses',          column: 'tag_ids' },
  { table: 'unique_option_items', column: 'tags'    },
];

/**
 * Build the per-table UPDATE statement that retags one column.
 *
 * Pattern:
 *   UPDATE <t> SET <col> = (
 *     SELECT json_group_array(v) FROM (
 *       SELECT DISTINCT CASE WHEN je.value = ? THEN ? ELSE je.value END AS v
 *       FROM json_each(<t>.<col>) je
 *     )
 *   )
 *   WHERE json_valid(<col>)
 *     AND EXISTS (SELECT 1 FROM json_each(<t>.<col>) je WHERE je.value = ?);
 *
 * - The inner json_each unpacks the row's tag array.
 * - CASE swaps the first `?` (source) with the second `?` (target);
 *   other tags pass through.
 * - SELECT DISTINCT collapses duplicates that arise when both source and
 *   target were already in the same array (e.g. an entity tagged with
 *   both "Fire" and "Flame" must end up with just one after merge).
 * - json_group_array rebuilds the array.
 * - The outer WHERE EXISTS limits rewrites to rows that actually carry
 *   the source tag, so we don't no-op-rewrite the entire table.
 * - `json_valid` guards against corrupt cells (same as tagUsage).
 *
 * Parameter order: [sourceId, targetId, sourceId]. D1's prepared
 * statement layer uses unnamed positional `?` placeholders, so the
 * source id appears twice in the params array — once for the CASE
 * comparison and once for the WHERE-EXISTS filter.
 */
function buildRetagSql({ table, column }: JsonArrayConsumer): string {
  return `
    UPDATE ${table} SET ${column} = (
      SELECT json_group_array(v) FROM (
        SELECT DISTINCT CASE WHEN je.value = ? THEN ? ELSE je.value END AS v
        FROM json_each(${table}.${column}) je
      )
    )
    WHERE json_valid(${column})
      AND EXISTS (SELECT 1 FROM json_each(${table}.${column}) je WHERE je.value = ?)
  `;
}

export interface MergeOptions {
  /** Tag id being merged away (gets deleted at the end). */
  sourceId: string;
  /** Tag id everything gets retagged TO. Must exist; must differ from source. */
  targetId: string;
}

/**
 * Validate that a merge is safe to run. Throws on:
 *   - source == target (the no-op self-merge)
 *   - source not present in the tags table
 *   - target not present in the tags table
 *   - source still has subtags (caller must collapse those first)
 *
 * Returns the subtag count for the source (0 when the check passes) so
 * the caller can surface it in error messages without re-querying.
 */
async function validateMerge({ sourceId, targetId }: MergeOptions): Promise<void> {
  if (!sourceId || !targetId) throw new Error('Merge requires both source and target tag ids.');
  if (sourceId === targetId) throw new Error('Cannot merge a tag into itself.');

  const tagRows = await queryD1<{ id: string }>(
    `SELECT id FROM tags WHERE id IN (?, ?)`,
    [sourceId, targetId],
  );
  const present = new Set(tagRows.map((r) => r.id));
  if (!present.has(sourceId)) throw new Error('Source tag no longer exists.');
  if (!present.has(targetId)) throw new Error('Target tag no longer exists.');

  const childRows = await queryD1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tags WHERE parent_tag_id = ?`,
    [sourceId],
  );
  const childCount = Number(childRows[0]?.n) || 0;
  if (childCount > 0) {
    throw new Error(
      `Source tag has ${childCount} subtag${childCount === 1 ? '' : 's'}. ` +
      `Reparent or delete them before merging.`,
    );
  }
}

/**
 * Retag every reference from `sourceId` to `targetId` across the
 * compendium, then delete the source tag.
 *
 * D1 doesn't accept user-supplied transactions, so the work is a
 * best-effort sequence: validate → retag JSON-array consumers in
 * parallel → retag lore junction (dedupe + update) → delete source.
 * If any step throws, the merge is partial — earlier UPDATEs land,
 * later ones don't, and the source tag is NOT deleted. That's the
 * safer failure mode (no orphaned references) but the caller should
 * surface a clear error and tell the admin to retry. Re-running the
 * same merge is idempotent: the retag UPDATEs become no-ops once all
 * references already point at `targetId`.
 *
 * Side effect: clears the tag-usage cache so the next read reflects
 * the new counts.
 */
export async function mergeTagInto(opts: MergeOptions): Promise<void> {
  await validateMerge(opts);
  const { sourceId, targetId } = opts;

  // Phase 1 — JSON-array consumer retags. All seven touch different
  // tables so they can run in parallel.
  //
  // Param order matches buildRetagSql's placeholder layout:
  //   [sourceId (CASE compare), targetId (replacement), sourceId (WHERE)]
  await Promise.all(
    JSON_ARRAY_CONSUMERS.map((consumer) =>
      queryD1(buildRetagSql(consumer), [sourceId, targetId, sourceId]),
    ),
  );

  // Phase 2 — lore_article_tags junction.
  //
  // The junction has a composite PRIMARY KEY (article_id, tag_id), so
  // we can't blindly UPDATE source -> target if an article is already
  // tagged with both (would trip the PK uniqueness). Step one removes
  // the duplicates; step two retags the rest.
  await queryD1(
    `DELETE FROM lore_article_tags
       WHERE tag_id = ?
         AND article_id IN (SELECT article_id FROM lore_article_tags WHERE tag_id = ?)`,
    [sourceId, targetId],
  );
  await queryD1(
    `UPDATE lore_article_tags SET tag_id = ? WHERE tag_id = ?`,
    [targetId, sourceId],
  );

  // Phase 3 — delete the now-unreferenced source.
  //
  // Order matters here: the FK from lore_article_tags is ON DELETE
  // CASCADE, so deleting the source BEFORE phase 2 would cascade away
  // the lore links instead of preserving them under the new target.
  await queryD1(`DELETE FROM tags WHERE id = ?`, [sourceId]);

  invalidateTagUsageCache();
}
