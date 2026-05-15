import { batchQueryD1, queryD1 } from './d1';
import { deriveSpellFilterFacets, type SpellFilterFacets } from './spellFilters';

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
 * Fetch the spells on a class's spell list, joined with the spells row so the
 * UI can render names / levels / schools without a second round-trip.
 */
export async function fetchClassSpellList(classId: string): Promise<ClassSpellListSummary[]> {
  // Pulls the spell shell fields needed both for display and for client-side
  // filter bucketing (foundry_data + property columns) so ClassView and the
  // manager don't need a second per-spell fetch to filter.
  const sql = `
    SELECT
      s.id, s.name, s.identifier, s.level, s.school, s.image_url, s.source_id, s.tags,
      s.foundry_data, s.concentration, s.ritual,
      s.components_vocal, s.components_somatic, s.components_material,
      s.required_tags, s.prerequisite_text,
      csl.id AS membership_id,
      csl.source AS membership_source,
      csl.added_at AS added_at
    FROM class_spell_lists csl
    JOIN spells s ON s.id = csl.spell_id
    WHERE csl.class_id = ?
    ORDER BY s.level ASC, s.name ASC
  `;
  const rows = await queryD1<any>(sql, [classId]);
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
    membershipId: r.membership_id,
    membershipSource: r.membership_source,
    addedAt: r.added_at,
    ...deriveSpellFilterFacets(r),
  }));
}

/**
 * Fetch the set of spell IDs on a class's list. Cheaper than fetchClassSpellList
 * when the caller only needs membership checks.
 */
export async function fetchClassSpellIds(classId: string): Promise<Set<string>> {
  const rows = await queryD1<{ spell_id: string }>(
    `SELECT spell_id FROM class_spell_lists WHERE class_id = ?`,
    [classId],
  );
  return new Set(rows.map(r => r.spell_id));
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
    let staleRuleCount = 0;
    for (const rid of ruleIds) {
      const updatedAt = ruleUpdatedAtById.get(rid) ?? null;
      if (!lastRebuiltAt) {
        // Class never rebuilt — every applied rule is stale.
        staleRuleCount += 1;
      } else if (updatedAt && updatedAt > lastRebuiltAt) {
        staleRuleCount += 1;
      }
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
 */
export async function fetchClassesForSpell(spellId: string): Promise<ClassMembership[]> {
  const sql = `
    SELECT c.id, c.name, c.identifier
    FROM class_spell_lists csl
    JOIN classes c ON c.id = csl.class_id
    WHERE csl.spell_id = ?
    ORDER BY c.name ASC
  `;
  return queryD1<ClassMembership>(sql, [spellId]);
}

// D1 caps bound parameters per statement. Stay well under the limit when fanning
// out IN-clauses across the spell catalogue (which can run to 200+ rows).
const D1_PARAM_CHUNK = 90;

/**
 * Bulk variant: return a map of spell_id → ClassMembership[]. Chunked under D1's
 * bound-parameter limit so one logical call works regardless of catalogue size.
 */
export async function fetchClassesForSpells(spellIds: string[]): Promise<Map<string, ClassMembership[]>> {
  const result = new Map<string, ClassMembership[]>();
  if (spellIds.length === 0) return result;
  for (let i = 0; i < spellIds.length; i += D1_PARAM_CHUNK) {
    const chunk = spellIds.slice(i, i + D1_PARAM_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const sql = `
      SELECT csl.spell_id AS spell_id, c.id, c.name, c.identifier
      FROM class_spell_lists csl
      JOIN classes c ON c.id = csl.class_id
      WHERE csl.spell_id IN (${placeholders})
      ORDER BY c.name ASC
    `;
    const rows = await queryD1<any>(sql, chunk);
    for (const row of rows) {
      const existing = result.get(row.spell_id) || [];
      existing.push({ id: row.id, name: row.name, identifier: row.identifier });
      result.set(row.spell_id, existing);
    }
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
