// =============================================================================
// Tag hierarchy helpers
// =============================================================================
//
// Shared utilities for working with the 2-level tag tree introduced in
// migration 20260512-1200_tags_parent_tag_id.sql. A tag with a non-null
// `parent_tag_id` is a "subtag" of that parent; tags with a null parent
// are roots. The UI doesn't allow deeper nesting; treat anything beyond
// depth 1 defensively.
//
// Consumers (pickers, filter chips, etc.) keep tags as a flat array
// internally — storage of "which tags is this entity tagged with" stays
// flat (an array of tag ids). The hierarchy is purely a rendering and
// ordering concern.
// =============================================================================

export interface TagWithHierarchy {
  id: string;
  name: string;
  /** Owning tag-group id, or null if ungrouped (shouldn't happen). */
  groupId: string | null;
  /** Parent tag id when this is a subtag; null for root tags. */
  parentTagId: string | null;
}

/**
 * Pull `parent_tag_id` from a raw D1 row, tolerating either snake_case
 * (D1 column) or camelCase (already-normalized state). Returns null
 * when absent — rows from before migration 20260512-1200 won't carry
 * the column and should be treated as roots.
 */
export function readParentTagId(row: any): string | null {
  if (!row) return null;
  if (typeof row.parent_tag_id === "string" && row.parent_tag_id) return row.parent_tag_id;
  if (typeof row.parentTagId === "string" && row.parentTagId) return row.parentTagId;
  return null;
}

/**
 * Normalize a raw `tags` row into the picker-friendly shape used by
 * SpellsEditor / SpellRulesEditor / SpellListManager / etc. Centralizes
 * the snake↔camel coercion so each consumer doesn't have to repeat
 * `t.group_id ?? t.groupId ?? null` boilerplate.
 */
export function normalizeTagRow(row: any): TagWithHierarchy {
  return {
    id: String(row?.id ?? ""),
    name: String(row?.name ?? ""),
    groupId: row?.group_id ?? row?.groupId ?? null,
    parentTagId: readParentTagId(row),
  };
}

/**
 * Return the input list reordered so each root is immediately followed
 * by its sorted subtags. Both levels alphabetize by name. Items whose
 * `parentTagId` references a tag NOT in the input are demoted to roots
 * (defensive — shouldn't happen with consistent data, but a missing
 * parent shouldn't drop a tag from the picker entirely).
 *
 * Generic over T so consumers with extended row shapes (e.g. carrying
 * extra fields) keep their full type through the reordering.
 */
export function orderTagsAsTree<
  T extends { id: string; name: string; parentTagId: string | null }
>(tags: T[]): T[] {
  const idSet = new Set(tags.map((t) => t.id));
  const parentOf = (t: T): string | null => {
    const p = t.parentTagId;
    return p && idSet.has(p) ? p : null;
  };

  const roots: T[] = [];
  const childrenByParent = new Map<string, T[]>();
  for (const t of tags) {
    const pid = parentOf(t);
    if (!pid) {
      roots.push(t);
    } else {
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid)!.push(t);
    }
  }

  const byName = (a: T, b: T) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
  roots.sort(byName);
  for (const arr of childrenByParent.values()) arr.sort(byName);

  const out: T[] = [];
  for (const root of roots) {
    out.push(root);
    const kids = childrenByParent.get(root.id);
    if (kids?.length) out.push(...kids);
  }
  return out;
}

/**
 * Glyph prefix used on subtag labels rendered as flat `{ value, label }`
 * chips (RuleFilterSection style). Picker components that render their
 * own JSX can inspect `parentTagId` directly and apply richer styling
 * instead of relying on the prefix.
 */
export const SUBTAG_LABEL_PREFIX = "↳ ";

/**
 * Convenience: format a label for flat-chip pickers, adding the subtag
 * prefix when the tag has a parent.
 */
export function tagPickerLabel(tag: TagWithHierarchy): string {
  return tag.parentTagId ? `${SUBTAG_LABEL_PREFIX}${tag.name}` : tag.name;
}

/**
 * Build a fast `tagId → parentTagId | null` lookup from an array of
 * tag rows. Used by `expandTagsWithAncestors` and any other code that
 * needs to walk up the hierarchy.
 *
 * Tolerates either snake-case or camel-case rows — pass raw D1 rows
 * directly without going through `normalizeTagRow`.
 */
export function buildTagParentMap(tags: Array<{ id: string; parent_tag_id?: string | null; parentTagId?: string | null }>): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const tag of tags) {
    if (!tag?.id) continue;
    const parent = (tag.parent_tag_id ?? tag.parentTagId ?? null) as string | null;
    map.set(tag.id, parent);
  }
  return map;
}

/**
 * Return the input tag ids plus every ANCESTOR (parent / grandparent /
 * …) reachable via `parentByTagId`. Result is a flat string array with
 * stable order (input first, ancestors after, deduped).
 *
 * This is the canonical "semantic tag set" expansion used by the spell
 * matcher: a spell tagged with `Conjure.Manifest` semantically IS also
 * a `Conjure` spell, so queries on the parent tag should pick it up.
 * Queries on the subtag stay specific (no descendant expansion happens
 * here — only ancestors).
 *
 * Defensive against cycles: tracks a visited set so a malformed parent
 * chain can't infinite-loop. SQLite's UNIQUE invariant on the new tags
 * table prevents legitimate cycles, but better safe than wedged.
 */
export function expandTagsWithAncestors(
  tagIds: readonly string[],
  parentByTagId: Map<string, string | null>,
): string[] {
  const out = new Set<string>();
  for (const tid of tagIds) {
    if (!tid) continue;
    let cursor: string | null = tid;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      out.add(cursor);
      cursor = parentByTagId.get(cursor) ?? null;
    }
  }
  return Array.from(out);
}
