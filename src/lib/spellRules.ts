import { queryD1, fetchCollection } from './d1';
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
  /**
   * Spell ids that would otherwise be in this rule's contribution
   * (either matched by query or listed in manualSpells) but should
   * be subtracted out. Added by migration 20260523-1500. Companion
   * to manualSpells, inverting its logic — "include despite query
   * miss" vs "exclude despite query hit (or manual hit)."
   *
   * Effective rule contribution:
   *     contribution = matches(query) ∪ manualSpells − manualExclusions
   *
   * Surfaces in the "Rule Membership" panel in SpellsEditor: when an
   * admin clicks "Remove from rule" on a query-matched row, the spell
   * id is pushed here rather than the query being edited (which would
   * affect every matched spell, not just the one).
   *
   * Always an array; never null in TypeScript even though the DB
   * column is nullable for legacy rule rows.
   */
  manualExclusions: string[];
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
    `SELECT id, name, description, query, manual_spells, manual_exclusions,
            created_at, updated_at
     FROM spell_rules
     ORDER BY name COLLATE NOCASE ASC`,
  );
  return rows.map(deserializeRule);
}

export async function fetchRule(id: string): Promise<SpellRule | null> {
  const rows = await queryD1<any>(
    `SELECT id, name, description, query, manual_spells, manual_exclusions,
            created_at, updated_at
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
  // Optional on the input shape so existing call sites that haven't
  // adopted the new column compile unchanged. The DB column defaults
  // to NULL; we serialise an empty array when the caller omits it
  // so reads always see a well-formed JSON array.
  manualExclusions?: string[];
}): Promise<string> {
  const id = rule.id || crypto.randomUUID();
  const now = new Date().toISOString();
  await queryD1(
    `INSERT INTO spell_rules (id, name, description, query, manual_spells,
                               manual_exclusions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       query = excluded.query,
       manual_spells = excluded.manual_spells,
       manual_exclusions = excluded.manual_exclusions,
       updated_at = excluded.updated_at`,
    [
      id,
      rule.name,
      rule.description || '',
      JSON.stringify(rule.query),
      JSON.stringify(rule.manualSpells),
      JSON.stringify(rule.manualExclusions ?? []),
      now,
      now,
    ],
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
    `SELECT r.id, r.name, r.description, r.query, r.manual_spells,
            r.manual_exclusions, r.created_at, r.updated_at
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

// Phase 4.4 removed `rebuildClassSpellListFromAppliedRules`,
// `computeClassRebuildDelta`, and `recomputeAppliedRulesForSpell`.
// All three were class_spell_lists writers — the rebuild path that
// wiped & re-inserted the rule-driven slice, the diff preview that
// powered the old "Rebuild from Rules" confirmation dialog, and the
// per-spell post-save recompute that kept those rows fresh.
//
// In the resolver world (P4.0-4.3) all three are unnecessary: the
// resolver reads applied-rule state at request time and serves the
// freshest possible spell-id set. No snapshot table to keep in sync.

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
    // manual_exclusions is NULL on legacy rule rows (added by migration
    // 20260523-1500). parseJsonArray returns [] for null/empty so the
    // type assertion `string[]` is always honoured at the TS level.
    manualExclusions: parseJsonArray(row.manual_exclusions).map(String),
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

// ---------------------------------------------------------------------------
// Rule membership from a spell's perspective
// ---------------------------------------------------------------------------
//
// These helpers power the "Rule Membership" panel in SpellsEditor:
// given a spell, what rules currently include it (and how), what rules
// could it be added to, and the four CRUD primitives the panel needs to
// flip a spell's membership in a rule's manual_spells / manual_exclusions
// arrays.
//
// The membership probe (`getRuleMembershipForSpell`) runs the same
// matcher the resolver uses, so "via: 'query'" and "via: 'manual'" are
// directly comparable to what the resolver computes when it builds a
// consumer's spell list. A spell that lives in a rule's
// `manual_exclusions` is treated as NOT a member of that rule — the
// exclusion wins regardless of how the spell would otherwise have
// matched, mirroring `ruleContribution` in spellListResolver.ts.
// ---------------------------------------------------------------------------

export type RuleMembership = {
  ruleId: string;
  ruleName: string;
  via: 'query' | 'manual';
  /** Every consumer this rule is currently applied to. */
  appliedTo: SpellRuleApplication[];
};

/**
 * Probe every rule against one spell. Returns the rules that currently
 * include it in their contribution, with the mechanism (`query` vs
 * `manual`) and the full list of consumers that have the rule applied.
 *
 * Cost: O(rules), plus one all-spells fetch is avoided because we only
 * need the one spell's facets + tags. Fine for the SpellsEditor panel
 * (called on spell select, not in a tight loop).
 */
export async function getRuleMembershipForSpell(
  spellId: string,
): Promise<RuleMembership[]> {
  const [spellRows, allRules, allApps, tagRows] = await Promise.all([
    queryD1<any>(
      `SELECT id, source_id, level, school, tags, foundry_data,
              concentration, ritual,
              components_vocal, components_somatic, components_material
         FROM spells WHERE id = ? LIMIT 1`,
      [spellId],
    ),
    fetchAllRules(),
    queryD1<any>(
      `SELECT id, rule_id, applies_to_type, applies_to_id, created_at
         FROM spell_rule_applications`,
    ),
    fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' }),
  ]);
  if (spellRows.length === 0) return [];
  const row = spellRows[0];
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
  const tagIndex = buildTagIndex(tagRows);

  // Bucket applications by rule for the O(1) join below.
  const appsByRuleId = new Map<string, SpellRuleApplication[]>();
  for (const a of allApps) {
    const list = appsByRuleId.get(String(a.rule_id)) ?? [];
    list.push(deserializeApplication(a));
    appsByRuleId.set(String(a.rule_id), list);
  }

  const result: RuleMembership[] = [];
  for (const rule of allRules) {
    // Exclusion wins — spell is in manual_exclusions → rule does NOT
    // include it, regardless of query / manualSpells. Surfaces in the
    // UI separately via getCandidateRulesForSpell (excluded rules are
    // candidates because adding them via manualSpells un-excludes).
    if (rule.manualExclusions.includes(spellId)) continue;
    const inManual = rule.manualSpells.includes(spellId);
    const queryMatches = !inManual
      && matchAnyClause(spellInput, rule.query, tagIndex.parentByTagId, tagIndex);
    if (!inManual && !queryMatches) continue;
    result.push({
      ruleId: rule.id,
      ruleName: rule.name,
      via: inManual ? 'manual' : 'query',
      appliedTo: appsByRuleId.get(rule.id) ?? [],
    });
  }
  return result;
}

/**
 * Rules where this spell is NOT currently a member. Powers the
 * "Add this spell to a rule…" picker — picking a candidate calls
 * `addSpellToRuleManual` to push the spell into that rule's
 * `manual_spells` array.
 *
 * Excluded-rule cases ARE candidates here: adding via the picker pops
 * the spell out of `manual_exclusions` and pushes it into
 * `manual_spells`, which is the user-friendly meaning of "include this
 * spell in this rule."
 */
export async function getCandidateRulesForSpell(
  spellId: string,
): Promise<Array<{ id: string; name: string }>> {
  const matched = await getRuleMembershipForSpell(spellId);
  const matchedIds = new Set(matched.map(m => m.ruleId));
  const allRules = await fetchAllRules();
  return allRules
    .filter(r => !matchedIds.has(r.id))
    .map(r => ({ id: r.id, name: r.name }));
}

/**
 * Push a spell id into a rule's `manual_spells` array. Idempotent.
 * Also removes the id from `manual_exclusions` if it was excluded,
 * so the two arrays never carry the same id simultaneously.
 */
export async function addSpellToRuleManual(
  spellId: string,
  ruleId: string,
): Promise<void> {
  const rule = await fetchRule(ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  const alreadyIncluded = rule.manualSpells.includes(spellId);
  const wasExcluded = rule.manualExclusions.includes(spellId);
  if (alreadyIncluded && !wasExcluded) return;
  await saveRule({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    query: rule.query,
    manualSpells: alreadyIncluded ? rule.manualSpells : [...rule.manualSpells, spellId],
    manualExclusions: wasExcluded
      ? rule.manualExclusions.filter(id => id !== spellId)
      : rule.manualExclusions,
  });
}

/** Pop a spell id out of a rule's `manual_spells` array. Idempotent. */
export async function removeSpellFromRuleManual(
  spellId: string,
  ruleId: string,
): Promise<void> {
  const rule = await fetchRule(ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  if (!rule.manualSpells.includes(spellId)) return;
  await saveRule({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    query: rule.query,
    manualSpells: rule.manualSpells.filter(id => id !== spellId),
    manualExclusions: rule.manualExclusions,
  });
}

/**
 * Push a spell id into a rule's `manual_exclusions` array. Idempotent.
 * Also pops the id out of `manual_spells` if it was manually added —
 * a spell shouldn't appear in both arrays. Used by the "Remove from
 * rule" button on query-matched rows in the SpellsEditor panel.
 */
export async function addRuleManualExclusion(
  spellId: string,
  ruleId: string,
): Promise<void> {
  const rule = await fetchRule(ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  const alreadyExcluded = rule.manualExclusions.includes(spellId);
  const wasManuallyIncluded = rule.manualSpells.includes(spellId);
  if (alreadyExcluded && !wasManuallyIncluded) return;
  await saveRule({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    query: rule.query,
    manualSpells: wasManuallyIncluded
      ? rule.manualSpells.filter(id => id !== spellId)
      : rule.manualSpells,
    manualExclusions: alreadyExcluded
      ? rule.manualExclusions
      : [...rule.manualExclusions, spellId],
  });
}

/**
 * Pop a spell id out of a rule's `manual_exclusions` array. Idempotent.
 * Used by the "Restore" / undo button in the SpellListManager
 * exceptions surface.
 */
export async function removeRuleManualExclusion(
  spellId: string,
  ruleId: string,
): Promise<void> {
  const rule = await fetchRule(ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  if (!rule.manualExclusions.includes(spellId)) return;
  await saveRule({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    query: rule.query,
    manualSpells: rule.manualSpells,
    manualExclusions: rule.manualExclusions.filter(id => id !== spellId),
  });
}
