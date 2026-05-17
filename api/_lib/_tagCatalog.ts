// Builder for the public tag catalog endpoint served at
// `/api/module/tags/catalog.json`. Mirrors the role
// `/api/module/sources/catalog.json` plays for sources — a one-shot
// public read of every spell-classified tag + tag group so the
// Foundry Prepare Spells manager can:
//
//   1. Resolve `tagIds` on spell summaries to human-readable names
//      (replacing the opaque D1 row ids the summary currently ships).
//   2. Render the same "Tag Groups" filter axis the public
//      `/compendium/spells` page exposes via `<TagGroupFilter>`.
//
// Filtering: tag groups are restricted to those classified for spell
// content (`classifications LIKE '%spell%'`) — the same WHERE the app
// uses when loading tagGroups for the SpellList page. Tags are
// returned for those groups only, so the payload stays bounded by
// spell-relevant taxonomy rather than the entire taxonomy of every
// surface (lore, classes, items, etc).
//
// Live read with a short HTTP cache (60 seconds, matches the per-class
// spell-list endpoint's policy). Tag edits propagate to the Foundry
// module on the next manager open. D1 cost is two cheap reads.
//
// Schema parallels the source catalog: `kind` discriminator,
// `schemaVersion: 1`, plus `tagGroups: []` and `tags: []`.

import { executeD1QueryInternal } from "./d1-internal.js";

const parseJsonField = (val: any, fallback: any) => {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const trimString = (val: any) => String(val ?? "").trim();

export interface ModuleTagGroup {
  id: string;
  name: string;
  classifications: string[];
  description: string;
}

export interface ModuleTag {
  id: string;
  groupId: string;
  name: string;
  slug: string;
  // Two-level hierarchy: parent_tag_id is set for subtags, NULL for
  // roots. The Foundry manager uses this to (a) render subtags under
  // their parent in the filter UI, (b) ancestor-expand a spell's
  // tagIds before include-matching (a spell tagged with a subtag is
  // treated as carrying the parent too, mirroring the app's
  // expandTagsWithAncestors behavior — see
  // docs/database/structure/tags.md "Hierarchical query matching").
  parentTagId: string | null;
}

export interface ModuleTagCatalog {
  kind: "dauligor.tag-catalog.v1";
  schemaVersion: 1;
  source: {
    system: "dauligor";
    entity: "tag-catalog";
    id: "dynamic-d1-library";
  };
  tagGroups: ModuleTagGroup[];
  tags: ModuleTag[];
}

/**
 * Build the spell-classified tag catalog. Two D1 queries:
 *   1. Tag groups where `classifications` contains "spell".
 *   2. Tags belonging to those groups.
 *
 * The classification filter uses SQLite's `LIKE '%spell%'` over the
 * JSON column — that's how the app's `fetchCollection('tagGroups',
 * { where: "classifications LIKE '%spell%'" })` queries the same data,
 * and it's correct as long as group authors don't name a non-spell
 * classification with "spell" as a substring (none today).
 */
export async function buildTagCatalog(): Promise<ModuleTagCatalog> {
  const groupsRes = await executeD1QueryInternal({
    sql: "SELECT id, name, classifications, description FROM tag_groups WHERE classifications LIKE '%spell%' ORDER BY name ASC",
  });
  const groupRows = (groupsRes.results || []) as Array<{
    id: string;
    name: string;
    classifications: string | null;
    description: string | null;
  }>;

  const tagGroups: ModuleTagGroup[] = groupRows.map((row) => ({
    id: String(row.id),
    name: trimString(row.name),
    classifications: parseJsonField(row.classifications, []),
    description: trimString(row.description),
  }));

  const groupIdSet = new Set(tagGroups.map((g) => g.id));
  if (groupIdSet.size === 0) {
    return {
      kind: "dauligor.tag-catalog.v1",
      schemaVersion: 1,
      source: { system: "dauligor", entity: "tag-catalog", id: "dynamic-d1-library" },
      tagGroups: [],
      tags: [],
    };
  }

  // Parameterized IN clause — D1 doesn't expand array params, so we
  // construct the placeholder list explicitly.
  const placeholders = tagGroups.map(() => "?").join(",");
  const tagsRes = await executeD1QueryInternal({
    sql: `SELECT id, group_id, name, slug, parent_tag_id FROM tags WHERE group_id IN (${placeholders}) ORDER BY name ASC`,
    params: tagGroups.map((g) => g.id),
  });
  const tagRows = (tagsRes.results || []) as Array<{
    id: string;
    group_id: string;
    name: string;
    slug: string;
    parent_tag_id: string | null;
  }>;

  const tags: ModuleTag[] = tagRows.map((row) => ({
    id: String(row.id),
    groupId: String(row.group_id),
    name: trimString(row.name),
    slug: trimString(row.slug),
    parentTagId: row.parent_tag_id ? String(row.parent_tag_id) : null,
  }));

  return {
    kind: "dauligor.tag-catalog.v1",
    schemaVersion: 1,
    source: { system: "dauligor", entity: "tag-catalog", id: "dynamic-d1-library" },
    tagGroups,
    tags,
  };
}
