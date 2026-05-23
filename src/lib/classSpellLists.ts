import { batchQueryD1, queryD1, fetchCollection } from './d1';
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
 * Fetch membership-row ids keyed by spell id for a class. Lets the
 * proposal-mode flow in SpellListManager submit deletes by row id
 * (the writer needs a single entity_id) without paying for the
 * full join `fetchClassSpellList` does. Admin direct-writes still
 * call `removeSpellsFromClassList` which deletes by composite key
 * and doesn't need this map.
 */
export async function fetchClassSpellMembershipIds(
  classId: string,
): Promise<Map<string, string>> {
  const rows = await queryD1<{ id: string; spell_id: string }>(
    `SELECT id, spell_id FROM class_spell_lists WHERE class_id = ?`,
    [classId],
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.spell_id, r.id);
  return map;
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

/** Just the rule-driven slice (source LIKE 'rule:%'). Used by Rebuild preview. */
export async function fetchClassRuleSpellIds(classId: string): Promise<Set<string>> {
  const rows = await queryD1<{ spell_id: string }>(
    `SELECT spell_id FROM class_spell_lists WHERE class_id = ? AND source LIKE 'rule:%'`,
    [classId],
  );
  return new Set(rows.map(r => r.spell_id));
}

/** ISO timestamp of the most recent rule-driven insert for this class, or null. */
export async function fetchLastClassRuleRebuildAt(classId: string): Promise<string | null> {
  const rows = await queryD1<{ last_at: string | null }>(
    `SELECT MAX(added_at) AS last_at FROM class_spell_lists WHERE class_id = ? AND source LIKE 'rule:%'`,
    [classId],
  );
  return rows[0]?.last_at || null;
}

/**
 * Two of our DATETIME columns are stored in different shapes:
 *   - `class_spell_lists.added_at` comes from SQLite's
 *     `CURRENT_TIMESTAMP` → `YYYY-MM-DD HH:MM:SS` (no T, no Z)
 *   - `spell_rules.updated_at` comes from `new Date().toISOString()` in
 *     `src/lib/spellRules.ts :: upsertRule` → `YYYY-MM-DDTHH:MM:SS.sssZ`
 *
 * Lexically comparing those two strings is wrong: ASCII `T` (0x54) >
 * ` ` (0x20), so the ISO form is ALWAYS lexically greater on the same
 * day even when the wall clock says the rebuild happened later. That's
 * the "every class is always stale even right after rebuild" bug.
 *
 * Normalize both to ms-since-epoch before comparing. SQLite's
 * CURRENT_TIMESTAMP is documented UTC, so when the string lacks a `T`/
 * `Z` we splice them in to force UTC parsing (otherwise JS treats it as
 * local time and tz-shifts the value).
 */
export function parseTimestampMs(s: string | null | undefined): number {
  if (!s) return 0;
  // ISO already (has T) — let Date handle it. Both `...Z` and naked-no-zone
  // ISO parse to the right UTC instant in practice; we don't strip the
  // millis component.
  if (s.includes('T')) return new Date(s).getTime();
  // SQLite `YYYY-MM-DD HH:MM:SS` — promote to UTC ISO and parse.
  const isoish = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)
    ? s.replace(' ', 'T') + 'Z'
    : s;
  const t = new Date(isoish).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Cross-class stale audit. Returns one row per class that has at
 * least one applied rule AND is in a "needs rebuild" state, i.e.:
 *   - the class has never been rebuilt (no rule:% rows in
 *     class_spell_lists), OR
 *   - at least one applied rule has been edited since the class's
 *     last rebuild timestamp.
 *
 * Powers the global "Rebuild All Stale Classes" button on
 * SpellListManager. Cheap — three aggregate queries, all
 * client-joined.
 *
 * Important: scoped to applies_to_type='class' because that's the
 * only consumer type whose data is currently baked into
 * class_spell_lists (per worker/migrations/20260509-1000).
 */
export async function fetchStaleClasses(): Promise<Array<{
  classId: string;
  className: string;
  staleRuleCount: number;
  lastRebuiltAt: string | null;
}>> {
  const [appsRows, ruleRows, lastRebuildRows, classRows] = await Promise.all([
    queryD1<{ applies_to_id: string; rule_id: string }>(
      `SELECT applies_to_id, rule_id FROM spell_rule_applications WHERE applies_to_type = 'class'`,
      [],
    ),
    queryD1<{ id: string; updated_at: string | null }>(
      `SELECT id, updated_at FROM spell_rules`,
      [],
    ),
    queryD1<{ class_id: string; last_at: string | null }>(
      `SELECT class_id, MAX(added_at) AS last_at FROM class_spell_lists WHERE source LIKE 'rule:%' GROUP BY class_id`,
      [],
    ),
    queryD1<{ id: string; name: string }>(
      `SELECT id, name FROM classes`,
      [],
    ),
  ]);

  const ruleUpdatedAtById = new Map<string, string | null>();
  for (const r of ruleRows) ruleUpdatedAtById.set(r.id, r.updated_at);

  const lastRebuildByClassId = new Map<string, string | null>();
  for (const r of lastRebuildRows) lastRebuildByClassId.set(r.class_id, r.last_at);

  const classNameById = new Map<string, string>();
  for (const c of classRows) classNameById.set(c.id, c.name);

  // Group applications by class.
  const rulesByClassId = new Map<string, string[]>();
  for (const a of appsRows) {
    if (!rulesByClassId.has(a.applies_to_id)) rulesByClassId.set(a.applies_to_id, []);
    rulesByClassId.get(a.applies_to_id)!.push(a.rule_id);
  }

  const out: Array<{ classId: string; className: string; staleRuleCount: number; lastRebuiltAt: string | null }> = [];
  for (const [classId, ruleIds] of rulesByClassId) {
    const lastRebuiltAt = lastRebuildByClassId.get(classId) ?? null;
    const lastRebuiltMs = parseTimestampMs(lastRebuiltAt);
    let staleRuleCount = 0;
    for (const rid of ruleIds) {
      const updatedAt = ruleUpdatedAtById.get(rid) ?? null;
      if (!lastRebuiltAt) {
        // Class never rebuilt — every applied rule is stale.
        staleRuleCount += 1;
        continue;
      }
      // Numeric ms-since-epoch comparison — see `parseTimestampMs`'s
      // header for why string compare doesn't work across the two
      // formats our DATETIME columns mix.
      const updatedMs = parseTimestampMs(updatedAt);
      if (updatedMs > lastRebuiltMs) staleRuleCount += 1;
    }
    if (staleRuleCount > 0) {
      out.push({
        classId,
        className: classNameById.get(classId) || classId,
        staleRuleCount,
        lastRebuiltAt,
      });
    }
  }
  out.sort((a, b) => a.className.localeCompare(b.className));
  return out;
}

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

/**
 * Add spells to a class's list. Idempotent on the (class_id, spell_id) pair —
 * existing rows are left alone via ON CONFLICT DO NOTHING. Always writes
 * `source = 'manual'`; rule-driven inserts (v1.1) will use a separate helper.
 */
export async function addSpellsToClassList(classId: string, spellIds: string[]): Promise<void> {
  if (spellIds.length === 0) return;
  const queries = spellIds.map(spellId => ({
    sql: `
      INSERT INTO class_spell_lists (id, class_id, spell_id, source)
      VALUES (?, ?, ?, 'manual')
      ON CONFLICT(class_id, spell_id) DO NOTHING
    `,
    params: [crypto.randomUUID(), classId, spellId],
  }));
  await batchQueryD1(queries);
}

/**
 * Remove spells from a class's list. Removes all rows for the (class_id, spell_id)
 * pairs regardless of source — manual or rule-driven. Chunked the same way as
 * fetchClassesForSpells; the class_id placeholder takes one slot per chunk.
 */
export async function removeSpellsFromClassList(classId: string, spellIds: string[]): Promise<void> {
  if (spellIds.length === 0) return;
  const chunkSize = D1_PARAM_CHUNK - 1;
  for (let i = 0; i < spellIds.length; i += chunkSize) {
    const chunk = spellIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    await queryD1(
      `DELETE FROM class_spell_lists WHERE class_id = ? AND spell_id IN (${placeholders})`,
      [classId, ...chunk],
    );
  }
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
