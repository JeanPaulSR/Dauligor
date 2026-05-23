import { queryD1, fetchCollection } from './d1';
import { deriveSpellFilterFacets, matchAnyClause, type SpellFilterFacets } from './spellFilters';
import { buildTagIndex } from './tagHierarchy';
import { getCachedOrCompute } from './spellListResolver';
import { fetchAllRules } from './spellRules';

// D1 caps bound parameters per statement. Stay well under the limit when
// fanning out IN-clauses across the spell catalogue (which can run to 500+
// rows). Declared up-front so both `fetchSpellRowsByIds` and
// `fetchClassesForSpells` reference it as a hoisted constant.
const D1_PARAM_CHUNK = 90;

/**
 * Layer 1 v1 of the Spellbook Manager project: per-class master spell list.
 * Snapshot table (`class_spell_lists`) — hand-curated in v1, rule-driven in v1.1.
 * See docs/features/spellbook-manager.md for the project shape.
 */

export type ClassSpellListEntry = {
  id: string;
  class_id: string;
  spell_id: string;
  source: string; // 'manual' | 'rule:<rule_id>'
  added_at: string;
};

export type ClassSpellListSummary = SpellFilterFacets & {
  // Spell row fields (subset used in the UI)
  id: string;
  name: string;
  identifier: string;
  level: number;
  school: string;
  image_url: string | null;
  source_id: string | null;
  tags: string[];
  requiredTags: string[];
  prerequisiteText: string;
  // Membership metadata
  membershipId: string;
  membershipSource: string;
  addedAt: string;
};

export type ClassMembership = {
  id: string;
  name: string;
  identifier: string;
};

/**
 * Fetch the spells on a class's spell list. Delegates to the query-time
 * resolver (`getCachedOrCompute`) for the membership set, then fetches
 * the joined spell-row shape callers need for rendering.
 *
 * Known rough edge: `membershipId` / `membershipSource` / `addedAt` are
 * synthesised because the new model has no per-row membership identity
 * — proposal-mode delete paths that key off `membershipId` need
 * reworking (P4.3 / SpellListManager reposition). Reads work today;
 * writes that need to target a specific membership row don't.
 */
export async function fetchClassSpellList(classId: string): Promise<ClassSpellListSummary[]> {
  const spellIds = await getCachedOrCompute('class', classId);
  if (spellIds.length === 0) return [];
  const rows = await fetchSpellRowsByIds(spellIds);
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    identifier: r.identifier,
    level: Number(r.level || 0),
    school: r.school || '',
    image_url: r.image_url,
    source_id: r.source_id,
    tags: typeof r.tags === 'string' ? safeJsonArray(r.tags) : (Array.isArray(r.tags) ? r.tags : []),
    requiredTags: typeof r.required_tags === 'string' ? safeJsonArray(r.required_tags) : (Array.isArray(r.required_tags) ? r.required_tags : []),
    prerequisiteText: r.prerequisite_text || '',
    membershipId: '',
    membershipSource: 'resolver',
    addedAt: '',
    ...deriveSpellFilterFacets(r),
  }));
}

/**
 * Bulk fetch the joined-row shape used by `fetchClassSpellList` for a
 * known spell-id list. Used by the new-resolver branch (where the
 * resolver hands us ids and we still need the full display row).
 *
 * Chunked under D1's bound-parameter limit so a class with hundreds of
 * spells doesn't blow the IN clause.
 */
async function fetchSpellRowsByIds(spellIds: string[]): Promise<any[]> {
  if (spellIds.length === 0) return [];
  const out: any[] = [];
  for (let i = 0; i < spellIds.length; i += D1_PARAM_CHUNK) {
    const chunk = spellIds.slice(i, i + D1_PARAM_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const sql = `
      SELECT
        id, name, identifier, level, school, image_url, source_id, tags,
        foundry_data, concentration, ritual,
        components_vocal, components_somatic, components_material,
        required_tags, prerequisite_text
      FROM spells
      WHERE id IN (${placeholders})
      ORDER BY level ASC, name ASC
    `;
    const rows = await queryD1<any>(sql, chunk);
    out.push(...rows);
  }
  return out;
}

/**
 * Fetch the set of spell IDs on a class's list. Cheaper than
 * fetchClassSpellList when the caller only needs membership checks.
 * Delegates to the query-time resolver via `getCachedOrCompute`.
 */
export async function fetchClassSpellIds(classId: string): Promise<Set<string>> {
  const ids = await getCachedOrCompute('class', classId);
  return new Set(ids);
}

// Phase 4.4 + 4.6 removed:
//   - `fetchClassRuleSpellIds` / `fetchLastClassRuleRebuildAt` /
//     `parseTimestampMs` / `fetchStaleClasses` — stale-detection
//     helpers for the old "Rebuild Stale Classes" affordance.
//   - `addSpellsToClassList` / `removeSpellsFromClassList` /
//     `fetchClassSpellMembershipIds` — class_spell_lists writers
//     used by the legacy admin direct-write and proposal-mode
//     branches. Spell-list curation is now rule-routed (admin
//     edits `spell_rules.manual_spells` / `manual_exclusions`
//     directly; proposal-mode submits `spell_rule` updates that
//     mutate the same arrays).
// The `class_spell_lists` table itself is dropped by migration
// 20260523-1530_drop_class_spell_lists.sql.

/**
 * Reverse lookup: which classes carry this spell on their spell list.
 * Used by the public SpellList detail pane and ClassView's Spell List tab.
 *
 * Proposal D rewrite: instead of joining `class_spell_lists` (which the
 * rule-routed mutation path no longer touches), walks every applied
 * rule and checks whether the spell satisfies it. Equivalent semantics
 * to running the resolver against every class and asking "is this
 * spell in the resolved set?" — but cheaper for the single-spell case
 * because we evaluate one spell against N rules instead of N classes
 * each running the full resolver loop.
 *
 * Excludes subclasses from the surface — matches the legacy behaviour
 * (the old SQL joined only `classes`, not `subclasses`).
 */
export async function fetchClassesForSpell(spellId: string): Promise<ClassMembership[]> {
  const map = await fetchClassesForSpells([spellId]);
  return map.get(spellId) ?? [];
}

/**
 * Bulk variant: return a map of spell_id → ClassMembership[]. Single
 * walk over (rules × spells × tag index), then maps matching rules to
 * the classes that have those rules applied via
 * `spell_rule_applications`.
 *
 * Cost: 4 bulk D1 queries upfront (rules / class apps / classes / tags)
 * + ceil(N / 90) chunked spell-light fetches, then a pure-JS matrix
 * walk. For a catalogue of ~500 spells × ~30 rules, that's ~15k
 * matcher evaluations — fast enough to run on every detail-panel mount.
 */
export async function fetchClassesForSpells(spellIds: string[]): Promise<Map<string, ClassMembership[]>> {
  const result = new Map<string, ClassMembership[]>();
  if (spellIds.length === 0) return result;
  const requested = new Set(spellIds);

  // Shared bulk fetches.
  const [allRules, classApps, classRows, tagRows] = await Promise.all([
    fetchAllRules(),
    queryD1<{ rule_id: string; applies_to_id: string }>(
      `SELECT rule_id, applies_to_id FROM spell_rule_applications WHERE applies_to_type = 'class'`,
    ),
    queryD1<{ id: string; name: string; identifier: string }>(
      `SELECT id, name, identifier FROM classes ORDER BY name ASC`,
    ),
    fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' }),
  ]);

  if (allRules.length === 0 || classApps.length === 0) return result;

  // Rule id → list of class ids that have that rule applied.
  const classIdsByRule = new Map<string, string[]>();
  for (const a of classApps) {
    const list = classIdsByRule.get(String(a.rule_id)) ?? [];
    list.push(String(a.applies_to_id));
    classIdsByRule.set(String(a.rule_id), list);
  }

  // Class id → display membership.
  const classById = new Map<string, ClassMembership>(
    classRows.map(c => [String(c.id), {
      id: String(c.id),
      name: String(c.name),
      identifier: String(c.identifier),
    }]),
  );

  // Bulk-fetch the light spell projection (same shape the resolver uses).
  const spellRowsAll: any[] = [];
  for (let i = 0; i < spellIds.length; i += D1_PARAM_CHUNK) {
    const chunk = spellIds.slice(i, i + D1_PARAM_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await queryD1<any>(
      `SELECT id, source_id, level, school, tags, foundry_data,
              concentration, ritual,
              components_vocal, components_somatic, components_material
         FROM spells WHERE id IN (${placeholders})`,
      chunk,
    );
    spellRowsAll.push(...rows);
  }

  const tagIndex = buildTagIndex(tagRows);

  for (const spellRow of spellRowsAll) {
    const spellId = String(spellRow.id);
    if (!requested.has(spellId)) continue; // defensive
    const facets = deriveSpellFilterFacets(spellRow);
    const tags = Array.isArray(spellRow.tags)
      ? spellRow.tags.map((t: any) => String(t))
      : (typeof spellRow.tags === 'string' ? safeJsonArray(spellRow.tags) : []);
    const spellInput = {
      ...facets,
      id: spellId,
      level: Number(spellRow.level) || 0,
      school: String(spellRow.school ?? ''),
      source_id: spellRow.source_id ?? null,
      tags,
    } as const;

    // Collect every class that has at least one rule contributing
    // this spell. A rule contributes the spell when:
    //   - the spell isn't in the rule's manual_exclusions, AND
    //   - (it's in manual_spells OR matches the query)
    // Mirrors `ruleContribution` in spellListResolver.ts.
    const classIds = new Set<string>();
    for (const rule of allRules) {
      if (rule.manualExclusions.includes(spellId)) continue;
      const inManual = rule.manualSpells.includes(spellId);
      const queryMatches = !inManual
        && matchAnyClause(spellInput as any, rule.query, tagIndex.parentByTagId, tagIndex);
      if (!inManual && !queryMatches) continue;
      const ruleClassIds = classIdsByRule.get(rule.id);
      if (!ruleClassIds) continue;
      for (const cid of ruleClassIds) classIds.add(cid);
    }
    if (classIds.size === 0) continue;
    const memberships: ClassMembership[] = [];
    for (const cid of classIds) {
      const cm = classById.get(cid);
      if (cm) memberships.push(cm);
    }
    memberships.sort((a, b) => a.name.localeCompare(b.name));
    result.set(spellId, memberships);
  }

  return result;
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Rule-driven population moved to src/lib/spellRules.ts as part of the rule
// restructure (Layer 1 v1.1, migration 0022). Rules are now standalone entities
// applied to consumers via spell_rule_applications.
