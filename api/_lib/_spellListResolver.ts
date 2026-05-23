// =============================================================================
// Spell list resolver — Pages Functions server-side copy
// =============================================================================
//
// DRIFT CONTRACT: mirrors `src/lib/spellListResolver.ts`. The
// Pages Functions bundle can't import directly from `src/lib/*`
// (different rollup target, different tsconfig), so this is a
// hand-maintained twin. When the source changes, mirror the change
// here AND in `src/lib/spellListResolver.ts`.
//
// Differences vs. the source twin (intentional):
//   - No cache layer. The opportunistic `consumer_spell_list_cache`
//     table that the in-app resolver uses for read-after-write hot
//     paths is skipped here — Pages Functions are stateless and the
//     Foundry export endpoint runs infrequently enough that the
//     per-call recompute cost (~100ms) is dwarfed by the request
//     round-trip. Skipping cache also keeps this file simpler.
//   - Provenance / exclusion / parity helpers omitted. The Foundry
//     export pipeline only needs the bare spell-id set; the source
//     twin's `getConsumerSpellListWithProvenance` /
//     `getConsumerExcludedSpells` are app-UI surfaces only.
//
// Used by `_classSpellList.ts` to produce the spell-id pool for a
// class's Foundry export bundle.
// =============================================================================

import type { ExportFetchers } from "./_classExport.js";
import {
  deriveSpellFilterFacets,
  matchAnyClause,
  type RuleClauseRoot,
  type SpellMatchInput,
  type TagIndex,
} from "./_spellFilters.js";

export type ConsumerType =
  | 'class'
  | 'subclass'
  | 'feat'
  | 'feature'
  | 'background'
  | 'item'
  | 'unique_option_item';

/**
 * One rule's contribution to a consumer's spell list:
 *
 *     matches(query) ∪ manual_spells − manual_exclusions
 *
 * Same math as `ruleContribution` in src/lib/spellListResolver.ts.
 * Exclusion is rule-scoped, not consumer-scoped, by design.
 */
function ruleContribution(
  rule: ResolvedRule,
  spells: SpellMatchRow[],
  tagIndex: TagIndex,
): Set<string> {
  const inc = new Set<string>(rule.manualSpells);
  for (const s of spells) {
    if (inc.has(s.id)) continue;
    if (matchAnyClause(s, rule.query, tagIndex.parentByTagId, tagIndex)) {
      inc.add(s.id);
    }
  }
  for (const id of rule.manualExclusions) {
    inc.delete(id);
  }
  return inc;
}

type ResolvedRule = {
  id: string;
  name: string;
  query: RuleClauseRoot;
  manualSpells: string[];
  manualExclusions: string[];
};

type SpellMatchRow = SpellMatchInput & { id: string };

function safeParseStringArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw: any): any {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolve a consumer's spell list — union of every applied rule's
 * contribution. Pure runtime query, no cache. Returns spell ids in no
 * particular order; callers sort downstream if they need stable
 * ordering.
 *
 * Empty result when no rules are applied OR when no spell satisfies
 * any rule. Caller decides how to render that (typically an empty
 * Foundry spell-list bundle).
 */
export async function getConsumerSpellList(
  consumerType: ConsumerType,
  consumerId: string,
  fetchers: ExportFetchers,
): Promise<string[]> {
  const { fetchCollection } = fetchers;

  // Pull applied rules + their full row shape, all spells (light
  // projection for the matcher), and tag rows (for the tag index) in
  // parallel.
  const [appliedRows, ruleRowsRaw, spellRows, tagRows] = await Promise.all([
    fetchCollection<{ rule_id: string }>("spellRuleApplications", {
      where: "applies_to_type = ? AND applies_to_id = ?",
      params: [consumerType, consumerId],
      select: "rule_id",
    }),
    fetchCollection<any>("spellRules", {
      select: "id, name, query, manual_spells, manual_exclusions",
    }),
    fetchCollection<any>("spells", {
      select: "id, source_id, level, school, tags, foundry_data, " +
              "concentration, ritual, " +
              "components_vocal, components_somatic, components_material",
    }),
    fetchCollection<any>("tags", { select: "id, parent_tag_id, group_id" }),
  ]);

  const appliedRuleIds = new Set(appliedRows.map(r => String(r.rule_id)));
  if (appliedRuleIds.size === 0) return [];

  // Deserialize only the rules this consumer has applied. Mirrors the
  // source twin's `fetchAppliedRulesFor`, but inline since we already
  // have everything in scope.
  const appliedRules: ResolvedRule[] = ruleRowsRaw
    .filter((r: any) => appliedRuleIds.has(String(r.id)))
    .map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      query: safeParseObject(r.query) as RuleClauseRoot,
      manualSpells: safeParseStringArray(r.manual_spells),
      manualExclusions: safeParseStringArray(r.manual_exclusions),
    }));

  // Tag index — same shape as `buildTagIndex` in `src/lib/tagHierarchy.ts`.
  // Lifted inline here to avoid another drift-managed file.
  const parentByTagId = new Map<string, string | null>();
  const groupByTagId = new Map<string, string | null>();
  const tagIdsByGroup = new Map<string, string[]>();
  for (const t of tagRows) {
    if (!t?.id) continue;
    const id = String(t.id);
    parentByTagId.set(id, (t.parent_tag_id ?? null) as string | null);
    const groupId = (t.group_id ?? null) as string | null;
    groupByTagId.set(id, groupId);
    if (groupId) {
      if (!tagIdsByGroup.has(groupId)) tagIdsByGroup.set(groupId, []);
      tagIdsByGroup.get(groupId)!.push(id);
    }
  }
  const tagIndex: TagIndex = { parentByTagId, groupByTagId, tagIdsByGroup };

  // Project spells into the matcher's SpellMatchInput shape.
  const matchRows: SpellMatchRow[] = spellRows.map((row: any) => {
    const facets = deriveSpellFilterFacets(row);
    return {
      ...facets,
      id: String(row.id),
      level: Number(row.level) || 0,
      school: String(row.school ?? ''),
      source_id: row.source_id ?? null,
      tags: safeParseStringArray(row.tags),
    };
  });

  // Union of every applied rule's contribution.
  const out = new Set<string>();
  for (const rule of appliedRules) {
    for (const id of ruleContribution(rule, matchRows, tagIndex)) {
      out.add(id);
    }
  }
  return Array.from(out);
}
