import { batchQueryD1, queryD1, fetchCollection } from './d1';
import {
  explainSpellAgainstRule,
  matchSpellAgainstRule,
  type RuleExplanation,
  type RuleQuery,
  type SpellMatchInput,
  type TagIndex,
} from './spellFilters';
export type { RuleExplanation, RuleExplanationAxis } from './spellFilters';
import { buildTagIndex } from './tagHierarchy';

/**
 * Standalone Spell Rules — the bulk-grant spell-curation primitive.
 *
 * A rule pairs a tag-query with a per-rule list of "always include" spell IDs.
 * Rules can be APPLIED to any consumer (class, subclass, feat, feature, background,
 * item, unique_option_item) via the `spell_rule_applications` junction table.
 *
 * For classes, "applying" a rule means it contributes to the class's master spell list
 * (`class_spell_lists`) at rebuild time. For other consumer types, the application is
 * stored but acts as a Layer-2 input — character spell-pool computation will read it
 * to know which spells the consumer grants access to.
 */

export type ConsumerType =
  | 'class'
  | 'subclass'
  | 'feat'
  | 'feature'
  | 'background'
  | 'item'
  | 'unique_option_item';

export const CONSUMER_TYPES: ConsumerType[] = [
  'class', 'subclass', 'feat', 'feature', 'background', 'item', 'unique_option_item',
];

export type SpellRule = {
  id: string;
  name: string;
  description: string;
  query: RuleQuery;
  manualSpells: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type SpellRuleApplication = {
  id: string;
  ruleId: string;
  appliesToType: ConsumerType;
  appliesToId: string;
  createdAt?: string;
};

// ---------------------------------------------------------------------------
// Rule CRUD
// ---------------------------------------------------------------------------

export async function fetchAllRules(): Promise<SpellRule[]> {
  const rows = await queryD1<any>(
    `SELECT id, name, description, query, manual_spells, created_at, updated_at
     FROM spell_rules
     ORDER BY name COLLATE NOCASE ASC`,
  );
  return rows.map(deserializeRule);
}

export async function fetchRule(id: string): Promise<SpellRule | null> {
  const rows = await queryD1<any>(
    `SELECT id, name, description, query, manual_spells, created_at, updated_at
     FROM spell_rules WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? deserializeRule(rows[0]) : null;
}

export async function saveRule(rule: {
  id?: string | null;
  name: string;
  description?: string;
  query: RuleQuery;
  manualSpells: string[];
}): Promise<string> {
  const id = rule.id || crypto.randomUUID();
  const now = new Date().toISOString();
  await queryD1(
    `INSERT INTO spell_rules (id, name, description, query, manual_spells, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       query = excluded.query,
       manual_spells = excluded.manual_spells,
       updated_at = excluded.updated_at`,
    [id, rule.name, rule.description || '', JSON.stringify(rule.query), JSON.stringify(rule.manualSpells), now, now],
  );
  return id;
}

export async function deleteRule(id: string): Promise<void> {
  // ON DELETE CASCADE on spell_rule_applications.rule_id sweeps the junction rows.
  // Orphan class_spell_lists rows (source = 'rule:<id>') are left in place; the next
  // rebuild for any affected class will clean them out. This avoids a full sweep on
  // delete and keeps the operation cheap.
  await queryD1(`DELETE FROM spell_rules WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------------------
// Rule application (junction)
// ---------------------------------------------------------------------------

export async function fetchRuleApplications(ruleId: string): Promise<SpellRuleApplication[]> {
  const rows = await queryD1<any>(
    `SELECT id, rule_id, applies_to_type, applies_to_id, created_at
     FROM spell_rule_applications WHERE rule_id = ?
     ORDER BY applies_to_type, applies_to_id`,
    [ruleId],
  );
  return rows.map(deserializeApplication);
}

export async function fetchAppliedRulesFor(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<SpellRule[]> {
  const rows = await queryD1<any>(
    `SELECT r.id, r.name, r.description, r.query, r.manual_spells, r.created_at, r.updated_at
     FROM spell_rules r
     JOIN spell_rule_applications a ON a.rule_id = r.id
     WHERE a.applies_to_type = ? AND a.applies_to_id = ?
     ORDER BY r.name COLLATE NOCASE ASC`,
    [consumerType, consumerId],
  );
  return rows.map(deserializeRule);
}

export async function fetchApplicationCounts(): Promise<Record<string, number>> {
  // For the rule list page — show "Applied to N consumers" per rule in one query.
  const rows = await queryD1<any>(
    `SELECT rule_id, COUNT(*) AS n FROM spell_rule_applications GROUP BY rule_id`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.rule_id] = Number(r.n);
  return out;
}

export async function applyRule(
  ruleId: string,
  consumerType: ConsumerType,
  consumerId: string,
): Promise<void> {
  await queryD1(
    `INSERT INTO spell_rule_applications (id, rule_id, applies_to_type, applies_to_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(rule_id, applies_to_type, applies_to_id) DO NOTHING`,
    [crypto.randomUUID(), ruleId, consumerType, consumerId],
  );
}

export async function unapplyRule(
  ruleId: string,
  consumerType: ConsumerType,
  consumerId: string,
): Promise<void> {
  await queryD1(
    `DELETE FROM spell_rule_applications
     WHERE rule_id = ? AND applies_to_type = ? AND applies_to_id = ?`,
    [ruleId, consumerType, consumerId],
  );
}

// ---------------------------------------------------------------------------
// Rebuild (class-side; other consumer types are Layer 2 work)
// ---------------------------------------------------------------------------

/** True if the spell satisfies the rule — query match OR explicit manual_spells inclusion.
 *
 *  Callers that have a TagIndex already in hand (typically the rebuild path,
 *  which builds it once per run) should pass it so rich tagStates rules
 *  evaluate correctly. Without it, rich rules short-circuit to "match" via
 *  the defensive fallback in matchSpellAgainstRule. */
export function spellMatchesRule(
  spell: SpellMatchInput & { id: string },
  rule: SpellRule,
  tagIndex?: TagIndex,
): boolean {
  if (rule.manualSpells.includes(spell.id)) return true;
  return matchSpellAgainstRule(spell, rule.query, tagIndex?.parentByTagId, tagIndex);
}

/**
 * Explainer-form companion to `spellMatchesRule`. Returns a structured
 * trace describing which axes the rule constrains, whether each axis
 * approved the spell, and the human-readable reason — used by the
 * SpellListManager row-level inspector so admins can debug "why is
 * this spell on / off this rule's match set".
 *
 * Special cases:
 *   - Manual-spell membership wins regardless of the query. We emit a
 *     synthetic single-axis trace so the UI can show "Manually
 *     pinned" without confusing the user with the underlying filter.
 *   - Empty rule (no axes constrained anywhere) returns
 *     `{ matched: true, axes: [] }`. The caller can render this as
 *     "Matches everything (no filters set)".
 *
 * `tagNamesById` is optional and only used to humanize tag-axis
 * failure reasons ("missing Confuse" instead of "missing
 * 7c780920-..."). Callers that already have a tag dictionary should
 * pass it; otherwise the reason carries the raw id.
 */
export function explainSpellMatch(
  spell: SpellMatchInput & { id: string },
  rule: SpellRule,
  tagIndex?: TagIndex,
  tagNamesById?: Map<string, string>,
): RuleExplanation {
  if (rule.manualSpells.includes(spell.id)) {
    return {
      matched: true,
      axes: [
        {
          axis: 'tags', // arbitrary — UI distinguishes via the `reason`
          pass: true,
          reason: 'Manually pinned to this rule (bypasses filters)',
        },
      ],
    };
  }
  return explainSpellAgainstRule(
    spell,
    rule.query,
    tagIndex?.parentByTagId,
    tagIndex,
    tagNamesById,
  );
}

/**
 * Replace the rule-driven slice of a class's spell list with current matches from
 * every rule applied to that class. Manual rows (`source = 'manual'`) are preserved.
 */
export async function rebuildClassSpellListFromAppliedRules(
  classId: string,
  spells: (SpellMatchInput & { id: string })[],
): Promise<{ added: number; rules: number }> {
  const rules = await fetchAppliedRulesFor('class', classId);

  // Wipe rule-driven rows in one statement (no IN-clause explosion).
  await queryD1(
    `DELETE FROM class_spell_lists WHERE class_id = ? AND source LIKE 'rule:%'`,
    [classId],
  );

  if (rules.length === 0) return { added: 0, rules: 0 };

  // Fetch tag rows once (id + parent + group) and build the index that
  // rich-tag rules need. Cheap compared to the per-spell match loop.
  const tagRows = await fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' });
  const tagIndex = buildTagIndex(tagRows);

  const inserts: { sql: string; params: any[] }[] = [];
  let added = 0;
  for (const rule of rules) {
    const source = `rule:${rule.id}`;
    for (const spell of spells) {
      if (!spellMatchesRule(spell, rule, tagIndex)) continue;
      inserts.push({
        sql: `
          INSERT INTO class_spell_lists (id, class_id, spell_id, source)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(class_id, spell_id) DO NOTHING
        `,
        params: [crypto.randomUUID(), classId, spell.id, source],
      });
      added++;
    }
  }

  if (inserts.length > 0) await batchQueryD1(inserts);
  return { added, rules: rules.length };
}

/**
 * Preview what a rebuild for this class WOULD change without
 * actually mutating anything. Used by:
 *   1. The pre-rebuild confirmation dialog in SpellListManager
 *      (toAdd / toRemove / staying counts before the user commits).
 *   2. The auto-rebuild-on-save flow in SpellRulesEditor (decides
 *      whether the delta is small enough to apply silently without
 *      asking the user).
 *
 * Computes the "new rule-driven set" = union of every applied rule's
 * matches against the supplied spell catalogue, then diffs against
 * the currently persisted rule:% rows in class_spell_lists.
 *
 * Manual rows (source = 'manual') are NEVER part of this diff —
 * the rebuild path leaves them alone, so they're irrelevant to
 * what's about to change.
 */
export async function computeClassRebuildDelta(
  classId: string,
  spells: (SpellMatchInput & { id: string })[],
  tagIndex?: TagIndex,
): Promise<{ toAdd: string[]; toRemove: string[]; staying: string[] }> {
  const [rules, currentRuleSet] = await Promise.all([
    fetchAppliedRulesFor('class', classId),
    queryD1<{ spell_id: string }>(
      `SELECT spell_id FROM class_spell_lists WHERE class_id = ? AND source LIKE 'rule:%'`,
      [classId],
    ),
  ]);
  const current = new Set(currentRuleSet.map(r => r.spell_id));

  // Build tagIndex on demand if the caller didn't supply one. Most
  // call sites have it cached; the rebuild path builds it once
  // per run.
  let resolvedTagIndex = tagIndex;
  if (!resolvedTagIndex) {
    const tagRows = await fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' });
    resolvedTagIndex = buildTagIndex(tagRows);
  }

  const next = new Set<string>();
  for (const rule of rules) {
    for (const s of spells) {
      if (spellMatchesRule(s, rule, resolvedTagIndex)) next.add(s.id);
    }
  }

  const toAdd: string[] = [];
  const toRemove: string[] = [];
  const staying: string[] = [];
  for (const id of next) {
    if (current.has(id)) staying.push(id);
    else toAdd.push(id);
  }
  for (const id of current) {
    if (!next.has(id)) toRemove.push(id);
  }
  return { toAdd, toRemove, staying };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function deserializeRule(row: any): SpellRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    query: parseJsonObject(row.query) as RuleQuery,
    manualSpells: parseJsonArray(row.manual_spells).map(String),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeApplication(row: any): SpellRuleApplication {
  return {
    id: row.id,
    ruleId: row.rule_id,
    appliesToType: row.applies_to_type as ConsumerType,
    appliesToId: row.applies_to_id,
    createdAt: row.created_at,
  };
}

function parseJsonObject(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function parseJsonArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}
