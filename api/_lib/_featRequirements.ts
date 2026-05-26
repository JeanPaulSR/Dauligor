// Render a feat's `requirements_tree` to readable text — the same
// `formatRequirementText` pipeline the website uses on
// `/compendium/feats` and inside the Modular Option editor.
//
// Why this exists:
//   The Foundry importer's feat picker used to ship the raw
//   `feats.requirements` free-text column. That column is only
//   half the picture — feats authored against the rich requirement-
//   tree column (`requirements_tree`) get cross-entity references
//   like "Wizard 5+" or "Initiate of High Sorcery" resolved to
//   ENTITY NAMES, not "<unknown class>" placeholders. This module
//   walks the tree exactly the way the public site does so the
//   picker reads identically to the editor preview.
//
// Caller contract:
//   1. Call `collectFeatRequirementReferences(rows)` to scoop every
//      entity id any feat's tree references.
//   2. Call `buildFeatRequirementLookup(fetchers, refs)` to batch-
//      fetch names for those ids in ONE round of queries — avoids
//      O(N) per-feat fetches when many feats reference the same
//      entities (common case).
//   3. Call `renderFeatRequirementText(row, lookup)` per feat to
//      get the formatted text, falling back to the legacy free-text
//      column when the row has no tree.
//
// Mirrors `formatRequirementText` from `src/lib/requirements.ts`
// via the server-side copy at `_requirements.ts`. The lookup shape
// is identical to what `_classExport.ts` builds for option items.

import type { ExportFetchers } from "./_classExport.js";
import {
  parseRequirementTree,
  formatRequirementText,
  type Requirement,
  type RequirementFormatLookup,
} from "./_requirements.js";

const trimString = (val: any) => String(val ?? "").trim();

/**
 * Per-leaf-type sets of referenced entity IDs. Populated by
 * `collectFeatRequirementReferences` for every feat row whose
 * `requirements_tree` references an entity by PK.
 *
 * `option`: any unique-option-item id seen via `optionItem` or
 *           `feature` leaves (a class feature's option item).
 * `feat`:   feat ids referenced via `feature` leaves (some feats
 *           gate on another feat being taken, e.g. tiered feats).
 */
export interface FeatRequirementRefs {
  classIds: Set<string>;
  subclassIds: Set<string>;
  optionIds: Set<string>;
  featIds: Set<string>;
  spellIds: Set<string>;
  spellRuleIds: Set<string>;
}

export function emptyFeatRequirementRefs(): FeatRequirementRefs {
  return {
    classIds: new Set(),
    subclassIds: new Set(),
    optionIds: new Set(),
    featIds: new Set(),
    spellIds: new Set(),
    spellRuleIds: new Set(),
  };
}

/**
 * Walk every feat row's `requirements_tree` and collect referenced
 * entity PKs by type. Idempotent — the refs object is mutated in
 * place so the caller can fold multiple sources into one set.
 *
 * `feature` leaves get pushed into BOTH `optionIds` and `featIds`
 * because the leaf's `featureId` could point at either table
 * (the editor's "Feature" picker offers both as candidates).
 * The lookup builder dedupes server-side via Set semantics.
 */
export function collectFeatRequirementReferences(
  rows: any[],
  refs: FeatRequirementRefs = emptyFeatRequirementRefs(),
): FeatRequirementRefs {
  for (const row of rows) {
    const tree = parseRequirementTree(row?.requirements_tree);
    if (!tree) continue;
    walkRefs(tree, refs);
  }
  return refs;
}

function walkRefs(node: Requirement, refs: FeatRequirementRefs): void {
  if (node.kind === "leaf") {
    switch (node.type) {
      case "class":
      case "levelInClass":
        if (node.classId) refs.classIds.add(String(node.classId));
        break;
      case "subclass":
        if (node.subclassId) refs.subclassIds.add(String(node.subclassId));
        break;
      case "optionItem":
        if (node.itemId) refs.optionIds.add(String(node.itemId));
        break;
      case "feature":
        // Ambiguous target: could be a unique_option_item OR a feat.
        // Stash in both buckets so the lookup builder can resolve
        // against whichever table has a matching row.
        if (node.featureId) {
          refs.optionIds.add(String(node.featureId));
          refs.featIds.add(String(node.featureId));
        }
        break;
      case "spell":
        if (node.spellId) refs.spellIds.add(String(node.spellId));
        break;
      case "spellRule":
        if (node.spellRuleId) refs.spellRuleIds.add(String(node.spellRuleId));
        break;
      // abilityScore / proficiency / level / string are self-contained
      // — they don't reference an entity by id.
    }
    return;
  }
  for (const child of node.children ?? []) walkRefs(child, refs);
}

/**
 * Batch-fetch names for every referenced id and build the lookup
 * `formatRequirementText` wants. One query per leaf-type bucket,
 * each with an `IN (?, ?, …)` clause — far cheaper than per-feat
 * fetches when 100+ feats reference the same handful of classes.
 *
 * Skips empty buckets to avoid issuing `IN ()` (a SQLite syntax
 * error). The returned lookup always has every leaf-type field
 * populated as a (possibly empty) object so callers can pass it
 * straight to `formatRequirementText`.
 */
export async function buildFeatRequirementLookup(
  fetchers: ExportFetchers,
  refs: FeatRequirementRefs,
): Promise<RequirementFormatLookup> {
  const { fetchCollection } = fetchers;
  const lookup: RequirementFormatLookup = {
    classNameById: {},
    subclassNameById: {},
    optionItemNameById: {},
    featureNameById: {},
    spellNameById: {},
    spellRuleNameById: {},
  };

  // Each `fetchById` returns rows for the supplied id list. Empty
  // input → no-op resolved Promise so Promise.all stays clean.
  async function fetchById(
    collection: string,
    ids: Set<string>,
    select: string,
  ): Promise<any[]> {
    if (ids.size === 0) return [];
    const list = [...ids];
    const placeholders = list.map(() => "?").join(", ");
    return fetchCollection<any>(collection, {
      where: `id IN (${placeholders})`,
      params: list,
      select,
    });
  }

  const [classes, subclasses, options, feats, spells, rules] = await Promise.all([
    fetchById("classes", refs.classIds, "id, name"),
    fetchById("subclasses", refs.subclassIds, "id, name"),
    fetchById("unique_option_items", refs.optionIds, "id, name"),
    // Feats can be referenced as a feature leaf (e.g. "Initiate of
    // High Sorcery → Adept of the Red Robes" gates on the parent feat).
    fetchById("feats", refs.featIds, "id, name"),
    fetchById("spells", refs.spellIds, "id, name"),
    fetchById("spell_rules", refs.spellRuleIds, "id, name"),
  ]);

  for (const row of classes) lookup.classNameById![String(row.id)] = String(row.name ?? "");
  for (const row of subclasses) lookup.subclassNameById![String(row.id)] = String(row.name ?? "");
  // `optionItemNameById` is used by the `optionItem` leaf; `featureNameById`
  // by the `feature` leaf. The editor's "Feature" picker can pick from
  // either table, so we feed both id maps into `featureNameById` to
  // maximise resolution coverage. Option items also land in the
  // option-specific map so existing callers stay correct.
  for (const row of options) {
    const id = String(row.id);
    const name = String(row.name ?? "");
    lookup.optionItemNameById![id] = name;
    lookup.featureNameById![id] = name;
  }
  for (const row of feats) {
    const id = String(row.id);
    if (!lookup.featureNameById![id]) {
      lookup.featureNameById![id] = String(row.name ?? "");
    }
  }
  for (const row of spells) lookup.spellNameById![String(row.id)] = String(row.name ?? "");
  for (const row of rules) lookup.spellRuleNameById![String(row.id)] = String(row.name ?? "");

  return lookup;
}

/**
 * Format one feat row's prereqs.
 *
 * Order of preference:
 *   1. Render `requirements_tree` via `formatRequirementText` with
 *      the supplied lookup — the modern authoring surface.
 *   2. Fall back to the legacy `feats.requirements` free-text
 *      column for rows whose tree hasn't been authored yet.
 *
 * Returns the empty string when neither is available, so the
 * caller can simply truthy-check before rendering a "Prerequisites:"
 * line.
 */
export function renderFeatRequirementText(
  row: any,
  lookup: RequirementFormatLookup,
): string {
  const tree = parseRequirementTree(row?.requirements_tree);
  if (tree) {
    const text = formatRequirementText(tree, lookup);
    if (text) return text;
  }
  return trimString(row?.requirements);
}
