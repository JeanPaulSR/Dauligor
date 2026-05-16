import { batchQueryD1, queryD1, fetchCollection } from './d1';
import {
  deriveSpellFilterFacets,
  explainSpellAgainstRule,
  getClauses,
  isMultiClauseRoot,
  matchAnyClause,
  type RuleClause,
  type RuleClauseRoot,
  type RuleExplanation,
  type RuleQuery,
  type SpellMatchInput,
  type TagIndex,
} from './spellFilters';
export type {
  RuleClause,
  RuleClauseRoot,
  RuleExplanation,
  RuleExplanationAxis,
} from './spellFilters';
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
  /**
   * Either a legacy single-clause `RuleQuery` (one set of axis + tag
   * filters that all must match) or a multi-clause root
   * `{ clauses: RuleQuery[] }` (OR of clauses — a spell matches the
   * rule if any clause matches). See `lib/spellFilters.ts ::
   * RuleClauseRoot` for the dispatch rules.
   *
   * The editor (`pages/compendium/SpellRulesEditor.tsx`) saves the
   * multi-clause shape only when the user has authored >1 clause;
   * single-clause rules round-trip to the flat legacy shape so any
   * downstream JSON consumer sees no change.
   *
   * Code that needs to read individual clauses should use
   * `getClauses(rule.query)` rather than poking at `.tagStates`
   * etc. directly — that helper hides the union-discrimination so
   * single- and multi-clause rules share one code path.
   */
  query: RuleClauseRoot;
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
  // Accepts either a flat `RuleQuery` or the multi-clause
  // `{ clauses: RuleQuery[] }` root — JSON.stringify handles both.
  // Typed as the union so callers (multi-clause editor in commit 2)
  // can pass the wider shape without casting.
  query: RuleClauseRoot;
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
  // OR-of-clauses dispatch: legacy flat queries are treated as a
  // single clause, multi-clause shapes (`{ clauses: [...] }`) match
  // if any clause matches. See `lib/spellFilters.ts :: matchAnyClause`.
  return matchAnyClause(spell, rule.query, tagIndex?.parentByTagId, tagIndex);
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

  // Multi-clause dispatch. Run the per-clause explainer for every
  // clause; the rule "matched" iff any clause matched. The returned
  // explanation prefers the FIRST passing clause (so the UI can show
  // "matched via clause #2: …"); if no clause matched, return the
  // first clause's failure so the user sees a concrete reason rather
  // than an empty trace.
  //
  // For single-clause rules (`getClauses` returns one element), this
  // collapses to the previous behaviour with zero overhead.
  const clauses = getClauses(rule.query);
  if (clauses.length === 0) {
    // Defensive: editor shouldn't allow saving zero-clause rules,
    // but if one slips through (legacy data, manual JSON edit) the
    // rule rejects every spell — surface that explicitly.
    return {
      matched: false,
      axes: [
        {
          axis: 'tags',
          pass: false,
          reason: 'Rule has no clauses — matches nothing',
        },
      ],
    };
  }
  const traces = clauses.map((clause) =>
    explainSpellAgainstRule(
      spell,
      clause,
      tagIndex?.parentByTagId,
      tagIndex,
      tagNamesById,
    ),
  );
  // Multi-clause: tag the explanation with which clause won. For
  // single-clause we don't bother — the existing UI doesn't need
  // the extra prefix.
  const isMulti = isMultiClauseRoot(rule.query) && traces.length > 1;
  const matchedIdx = traces.findIndex((t) => t.matched);
  if (matchedIdx >= 0) {
    const matched = traces[matchedIdx];
    if (!isMulti) return matched;
    return {
      matched: true,
      axes: matched.axes.map((a, i) =>
        i === 0
          ? {
              ...a,
              reason: `Clause ${matchedIdx + 1} of ${traces.length} matched · ${a.reason}`,
            }
          : a,
      ),
    };
  }
  // No clause matched — return the first failure with a multi-clause
  // header on the leading axis so the user knows we tried every
  // alternative.
  const first = traces[0];
  if (!isMulti) return first;
  return {
    matched: false,
    axes: first.axes.map((a, i) =>
      i === 0
        ? {
            ...a,
            reason: `No clause matched (tried ${traces.length}) · clause 1 first failure: ${a.reason}`,
          }
        : a,
    ),
  };
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

/**
 * Targeted recompute: re-evaluate every applied class-level rule
 * against ONE spell that just changed (typically because tags moved
 * or a facet was edited) and apply the resulting deltas to
 * `class_spell_lists`.
 *
 * Unlike `rebuildClassSpellListFromAppliedRules`, which wipes and
 * re-inserts the entire rule-driven slice for a class, this:
 *   - Touches only the rows for this spell across every class
 *   - Inserts a row where the new evaluation says "yes" and no row
 *     existed
 *   - Deletes rows where the new evaluation says "no" and a row
 *     existed (and the source is `rule:<rule_id>` — manual rows are
 *     never touched)
 *
 * The decoupled spell-list endpoint (`/api/module/<source>/classes/
 * <class>/spells.json`) reads live from `class_spell_lists`, so the
 * downstream effect is: edit a spell's tags, save, and the next
 * Foundry import on any affected class picks up the new pool — no
 * class rebake needed.
 *
 * Returns a summary describing how many `(class, rule)` pairs were
 * touched and what direction. Useful for both logging and for
 * surfacing "added to 3 lists / removed from 1 list" toasts in the
 * editor.
 *
 * Synchronous-on-save by design (per the architecture chosen May
 * 2026 — see `docs/features/foundry-export.md` "Spell list
 * decoupling"). For very large rule sets we may need to debounce,
 * but the typical Dauligor world has <100 rules × <30 spells edited
 * per session, well within latency budget.
 */
export async function recomputeAppliedRulesForSpell(spellId: string): Promise<{
  inserted: Array<{ classId: string; ruleId: string }>;
  removed: Array<{ classId: string; ruleId: string }>;
}> {
  const inserted: Array<{ classId: string; ruleId: string }> = [];
  const removed: Array<{ classId: string; ruleId: string }> = [];

  // Pull this spell with the same field shape the rebuild path
  // expects — facets + level + school + source_id + tags. Mirrors
  // `classExport.ts:rebuildSpellRuleAllowlists` so the matcher sees
  // an identical shape regardless of which call path drives it.
  const spellRows = await queryD1<any>(
    `SELECT id, source_id, level, school, tags, foundry_data, concentration, ritual,
            components_vocal, components_somatic, components_material
       FROM spells
       WHERE id = ?
       LIMIT 1`,
    [spellId],
  );
  const row = spellRows[0];
  if (!row) {
    // Spell was deleted — drop every rule:* row that referenced it.
    // Manual rows stay (their absence is a separate concern).
    const droppedRows = await queryD1<{ class_id: string; source: string }>(
      `SELECT class_id, source FROM class_spell_lists
        WHERE spell_id = ? AND source LIKE 'rule:%'`,
      [spellId],
    );
    if (droppedRows.length > 0) {
      await queryD1(
        `DELETE FROM class_spell_lists
          WHERE spell_id = ? AND source LIKE 'rule:%'`,
        [spellId],
      );
      for (const r of droppedRows) {
        const ruleId = r.source.replace(/^rule:/, '');
        removed.push({ classId: r.class_id, ruleId });
      }
    }
    return { inserted, removed };
  }

  const facets = deriveSpellFilterFacets(row);
  const tags = Array.isArray(row.tags)
    ? row.tags.map((t: any) => String(t))
    : (typeof row.tags === 'string' ? safeParseTagArray(row.tags) : []);
  const spellInput: SpellMatchInput & { id: string } = {
    ...facets,
    id: String(row.id),
    level: Number(row.level) || 0,
    school: String(row.school ?? ''),
    source_id: row.source_id ?? null,
    tags,
  };

  // All class-applied rules, plus the tag index for hierarchical
  // matching. One fetch each — cheaper than per-rule queries when
  // the spell touches more than one rule.
  const [allApplications, allRules, tagRows, existingRuleRows] = await Promise.all([
    queryD1<{ rule_id: string; applies_to_id: string }>(
      `SELECT rule_id, applies_to_id FROM spell_rule_applications
        WHERE applies_to_type = 'class'`,
    ),
    queryD1<any>(`SELECT * FROM spell_rules`),
    fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' }),
    queryD1<{ class_id: string; source: string; id: string }>(
      `SELECT class_id, source, id FROM class_spell_lists
        WHERE spell_id = ? AND source LIKE 'rule:%'`,
      [spellId],
    ),
  ]);
  const tagIndex = buildTagIndex(tagRows);
  const ruleById = new Map<string, SpellRule>();
  for (const r of allRules) ruleById.set(String(r.id), deserializeRule(r));

  // Pre-compute "which `(class, rule)` pairs currently hold a row
  // for this spell" so we can diff against the next evaluation.
  const existingByClassRule = new Map<string, string>(); // `${classId}|${ruleId}` -> rowId
  for (const r of existingRuleRows) {
    const ruleId = r.source.replace(/^rule:/, '');
    existingByClassRule.set(`${r.class_id}|${ruleId}`, r.id);
  }

  // Walk every `(rule, class)` application. For each, check whether
  // the spell now matches the rule. INSERT if matches and no row,
  // DELETE if doesn't match and row exists. Stable batch under D1's
  // bound-parameter limits — typical apps have <100 applications
  // total, well within budget.
  const inserts: { sql: string; params: any[] }[] = [];
  const deletes: { sql: string; params: any[] }[] = [];
  const seenPairs = new Set<string>();
  for (const app of allApplications) {
    const rule = ruleById.get(app.rule_id);
    if (!rule) continue;
    const pairKey = `${app.applies_to_id}|${app.rule_id}`;
    if (seenPairs.has(pairKey)) continue; // (rule,class) duplicates guard
    seenPairs.add(pairKey);

    const shouldHave = spellMatchesRule(spellInput, rule, tagIndex);
    const existingRowId = existingByClassRule.get(pairKey);

    if (shouldHave && !existingRowId) {
      inserts.push({
        sql: `INSERT INTO class_spell_lists (id, class_id, spell_id, source)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(class_id, spell_id) DO NOTHING`,
        params: [crypto.randomUUID(), app.applies_to_id, spellId, `rule:${app.rule_id}`],
      });
      inserted.push({ classId: app.applies_to_id, ruleId: app.rule_id });
    } else if (!shouldHave && existingRowId) {
      deletes.push({
        sql: `DELETE FROM class_spell_lists WHERE id = ?`,
        params: [existingRowId],
      });
      removed.push({ classId: app.applies_to_id, ruleId: app.rule_id });
    }
  }

  // Also DELETE stale rows whose `(class, rule)` pair is no longer
  // in `spell_rule_applications` (rule was unapplied since the row
  // was inserted). Without this they'd linger as orphans.
  for (const [pairKey, rowId] of existingByClassRule) {
    if (seenPairs.has(pairKey)) continue;
    const [classId, ruleId] = pairKey.split('|');
    deletes.push({
      sql: `DELETE FROM class_spell_lists WHERE id = ?`,
      params: [rowId],
    });
    removed.push({ classId, ruleId });
  }

  if (inserts.length || deletes.length) {
    await batchQueryD1([...deletes, ...inserts]);
  }
  return { inserted, removed };
}

function safeParseTagArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function deserializeRule(row: any): SpellRule {
  // `query` is JSON. Either shape is valid:
  //   - Legacy flat `RuleQuery` (every rule written before
  //     multi-clause support), or
  //   - Multi-clause `{ clauses: RuleQuery[] }` (`RuleClauseRoot`).
  // The matcher dispatch (`matchAnyClause` / `getClauses` in
  // `lib/spellFilters.ts`) handles both at evaluation time, and the
  // editor decides at save time whether to serialize as flat or
  // multi-clause based on whether the user has authored multiple
  // clauses.
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    query: parseJsonObject(row.query) as RuleClauseRoot,
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
