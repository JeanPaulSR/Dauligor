// =============================================================================
// Spell list resolver — runtime query + opportunistic cache
// =============================================================================
//
// Companion to migration 20260523-1500. Replaces the v1 materialised
// `class_spell_lists` table in spirit — that table stays in place during
// the feature-flagged rollout, but this module is the new source of
// truth that the read paths will swap to in Phase 2.
//
// Resolution model:
//
//   getConsumerSpellList(type, id) =
//     ⋃ over rules applied to (type, id) of:
//         queryMatches(rule, spells) ∪ rule.manualSpells
//         − rule.manualExclusions
//
// One uniform code path serves every consumer type that
// spell_rule_applications supports:
//     class | subclass | feat | feature | background | item | unique_option_item
//
// The cache is purely an optimisation. Fingerprint comparison is cheap
// (4 SELECT MAX queries); a cache miss recomputes one consumer's full
// list, which for the typical Dauligor world is <100ms (5 rules ×
// 2000 spells in JS evaluation + 3 D1 round-trips).
//
// What this module does NOT do (yet):
//   • Read from class_spell_lists — that's still authoritative at the
//     current read paths. Phase 2 swaps them. This module exists in
//     parallel, callable but unwired.
//   • Handle "additional spells" advancements — those grant spells
//     outside the rule system. Phase 4 work, when advancement
//     integration lands.
//   • Special-case subclass inheritance — subclasses with no own
//     spell_rule_applications row resolve to an empty list here.
//     Inheritance ("subclass inherits parent's list unless replaced")
//     is the caller's job to compose (typically by resolving the
//     parent and merging).
// =============================================================================

import { queryD1, fetchCollection } from './d1';
import {
  deriveSpellFilterFacets,
  matchAnyClause,
  type SpellMatchInput,
  type TagIndex,
} from './spellFilters';
import { buildTagIndex } from './tagHierarchy';
import {
  fetchAppliedRulesFor,
  type ConsumerType,
  type SpellRule,
} from './spellRules';

// -----------------------------------------------------------------------------
// Spell projection used by the matcher
// -----------------------------------------------------------------------------

type SpellMatchRow = SpellMatchInput & { id: string };

function safeParseTagArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Light projection — only the columns the rule matcher reads. The full
 * spell row carries description / activities / effects / etc. which the
 * resolver doesn't need; trimming the projection keeps the hot
 * fetch-all-spells path cheap.
 */
async function fetchSpellsForMatching(): Promise<SpellMatchRow[]> {
  const rows = await queryD1<any>(
    `SELECT id, source_id, level, school, tags, foundry_data,
            concentration, ritual,
            components_vocal, components_somatic, components_material
       FROM spells`,
  );
  return rows.map((row: any) => {
    const facets = deriveSpellFilterFacets(row);
    return {
      ...facets,
      id: String(row.id),
      level: Number(row.level) || 0,
      school: String(row.school ?? ''),
      source_id: row.source_id ?? null,
      tags: safeParseTagArray(row.tags),
    };
  });
}

// -----------------------------------------------------------------------------
// Resolver — pure runtime query
// -----------------------------------------------------------------------------

/**
 * One rule's contribution to a consumer's spell list:
 *     matches(query) ∪ manual_spells − manual_exclusions
 *
 * Exclusion is rule-scoped, not consumer-scoped, by design (see
 * migration 20260523-1500 header). To exclude a spell from one
 * consumer but keep it for another, model that via the advancement
 * system (a custom replacement rule) rather than via the resolver.
 */
function ruleContribution(
  rule: SpellRule,
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

/**
 * Resolve a consumer's spell list. Pure runtime query — no cache, no
 * materialisation. Most callers should use `getCachedOrCompute` below
 * instead; this one is the underlying primitive (also useful in tests
 * and for the cache-miss path).
 *
 * Returns spell ids in no particular order — callers sort downstream
 * if they need stable ordering.
 */
export async function getConsumerSpellList(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<string[]> {
  const [appliedRules, spells, tagRows] = await Promise.all([
    fetchAppliedRulesFor(consumerType, consumerId),
    fetchSpellsForMatching(),
    fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' }),
  ]);
  if (appliedRules.length === 0) return [];
  const tagIndex = buildTagIndex(tagRows);
  const out = new Set<string>();
  for (const rule of appliedRules) {
    for (const id of ruleContribution(rule, spells, tagIndex)) {
      out.add(id);
    }
  }
  return Array.from(out);
}

// -----------------------------------------------------------------------------
// Provenance + exclusions — for the SpellListManager surfaces
// -----------------------------------------------------------------------------

export type SpellProvenance = {
  spellId: string;
  /**
   * Every rule that includes this spell in the consumer's contribution.
   * `reason` distinguishes a tag/filter query hit from an explicit
   * `manualSpells` add. Multiple entries are possible when several
   * applied rules all happen to match the same spell.
   */
  via: Array<{ ruleId: string; ruleName: string; reason: 'query' | 'manual' }>;
};

/**
 * Same as `getConsumerSpellList` but returns per-spell provenance.
 * Powers SpellListManager's "show me which rule put this spell here"
 * view — each row gets a chip linking back to the responsible rule.
 */
export async function getConsumerSpellListWithProvenance(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<SpellProvenance[]> {
  const [appliedRules, spells, tagRows] = await Promise.all([
    fetchAppliedRulesFor(consumerType, consumerId),
    fetchSpellsForMatching(),
    fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' }),
  ]);
  if (appliedRules.length === 0) return [];
  const tagIndex = buildTagIndex(tagRows);
  const result = new Map<string, SpellProvenance>();
  for (const rule of appliedRules) {
    const exclusions = new Set(rule.manualExclusions);
    for (const s of spells) {
      if (exclusions.has(s.id)) continue;
      let reason: 'query' | 'manual' | null = null;
      if (rule.manualSpells.includes(s.id)) reason = 'manual';
      else if (matchAnyClause(s, rule.query, tagIndex.parentByTagId, tagIndex)) reason = 'query';
      if (!reason) continue;
      let entry = result.get(s.id);
      if (!entry) {
        entry = { spellId: s.id, via: [] };
        result.set(s.id, entry);
      }
      entry.via.push({ ruleId: rule.id, ruleName: rule.name, reason });
    }
  }
  return Array.from(result.values());
}

export type ExcludedSpell = {
  spellId: string;
  ruleId: string;
  ruleName: string;
  /** Why the spell WOULD have been included if it weren't excluded. */
  wouldHaveBeenMatchedBy: 'query' | 'manual';
};

/**
 * Spells that some applied rule would have included via query or
 * manual_spells, but excluded via manual_exclusions. Powers the
 * "Exceptions" surface in SpellListManager — each entry says "this
 * rule excluded this spell, here's why it would've otherwise matched."
 *
 * Orphan exclusions (where the spell no longer matches and never
 * existed in manual_spells) aren't returned — they have no effect on
 * the resolved list, so surfacing them would be visual noise.
 */
export async function getConsumerExcludedSpells(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<ExcludedSpell[]> {
  const [appliedRules, spells, tagRows] = await Promise.all([
    fetchAppliedRulesFor(consumerType, consumerId),
    fetchSpellsForMatching(),
    fetchCollection<any>('tags', { select: 'id, parent_tag_id, group_id' }),
  ]);
  if (appliedRules.length === 0) return [];
  const tagIndex = buildTagIndex(tagRows);
  const result: ExcludedSpell[] = [];
  const spellsById = new Map(spells.map(s => [s.id, s]));
  for (const rule of appliedRules) {
    for (const spellId of rule.manualExclusions) {
      const s = spellsById.get(spellId);
      if (!s) continue; // deleted spell — orphan exclusion, skip
      let mechanism: 'query' | 'manual' | null = null;
      if (rule.manualSpells.includes(spellId)) mechanism = 'manual';
      else if (matchAnyClause(s, rule.query, tagIndex.parentByTagId, tagIndex)) mechanism = 'query';
      if (!mechanism) continue; // would never have matched, exclusion is no-op
      result.push({
        spellId,
        ruleId: rule.id,
        ruleName: rule.name,
        wouldHaveBeenMatchedBy: mechanism,
      });
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// Cache layer
// -----------------------------------------------------------------------------

/**
 * Composite fingerprint that uniquely identifies the inputs to a
 * consumer's spell list. Cheap (4 SELECT MAX queries + one
 * spell_rule_applications lookup); cache rows are valid for as long
 * as the fingerprint matches.
 *
 * Conservative composition: uses the GLOBAL max(spells.updated_at)
 * and max(tags.updated_at) instead of just the spells / tags
 * referenced by the applied rules. Net effect: any spell or tag
 * write invalidates every consumer's cache. Recompute cost on
 * invalidation is ~100ms per consumer, so this trades a bit of
 * cache thrash for simpler invalidation logic.
 *
 * If recompute thrash becomes a real bottleneck (probably never for
 * a typical Dauligor world), the fingerprint can be tightened to
 * reference-set max — at the cost of a more complex query.
 */
export async function computeInputsFingerprint(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<string> {
  const [appsRows, spellMax, tagMax, ruleMax] = await Promise.all([
    queryD1<{ rule_id: string }>(
      `SELECT rule_id FROM spell_rule_applications
        WHERE applies_to_type = ? AND applies_to_id = ?
        ORDER BY rule_id`,
      [consumerType, consumerId],
    ),
    queryD1<{ m: string | null }>(`SELECT MAX(updated_at) AS m FROM spells`),
    queryD1<{ m: string | null }>(`SELECT MAX(updated_at) AS m FROM tags`),
    queryD1<{ m: string | null }>(`SELECT MAX(updated_at) AS m FROM spell_rules`),
  ]);
  const ruleIds = appsRows.map(r => r.rule_id).join(',');
  return [
    `c:${consumerType}/${consumerId}`,
    `r:${ruleIds}`,
    `s:${spellMax[0]?.m ?? '-'}`,
    `t:${tagMax[0]?.m ?? '-'}`,
    `R:${ruleMax[0]?.m ?? '-'}`,
  ].join('|');
}

type CacheRow = {
  fingerprint: string;
  spellIds: string[];
  computedAt: string;
};

export async function readCache(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<CacheRow | null> {
  const rows = await queryD1<{
    inputs_fingerprint: string;
    spell_ids_json: string;
    computed_at: string;
  }>(
    `SELECT inputs_fingerprint, spell_ids_json, computed_at
       FROM consumer_spell_list_cache
       WHERE consumer_type = ? AND consumer_id = ?
       LIMIT 1`,
    [consumerType, consumerId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  let spellIds: string[];
  try {
    const parsed = JSON.parse(row.spell_ids_json);
    spellIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    // Corrupt cache row — treat as miss; resolver will overwrite it.
    return null;
  }
  return {
    fingerprint: row.inputs_fingerprint,
    spellIds,
    computedAt: row.computed_at,
  };
}

export async function writeCache(
  consumerType: ConsumerType,
  consumerId: string,
  fingerprint: string,
  spellIds: string[],
): Promise<void> {
  await queryD1(
    `INSERT INTO consumer_spell_list_cache (consumer_type, consumer_id,
       computed_at, inputs_fingerprint, spell_ids_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(consumer_type, consumer_id) DO UPDATE SET
       computed_at = excluded.computed_at,
       inputs_fingerprint = excluded.inputs_fingerprint,
       spell_ids_json = excluded.spell_ids_json`,
    [
      consumerType,
      consumerId,
      new Date().toISOString(),
      fingerprint,
      JSON.stringify(spellIds),
    ],
  );
}

/**
 * Manual cache buster. Mostly for the admin "Force cache refresh"
 * button + tests. Day-to-day invalidation is automatic via the
 * fingerprint check.
 */
export async function invalidateCache(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<void> {
  await queryD1(
    `DELETE FROM consumer_spell_list_cache
       WHERE consumer_type = ? AND consumer_id = ?`,
    [consumerType, consumerId],
  );
}

/**
 * The canonical read path. Compute the current fingerprint, compare to
 * the stored row, serve cached on hit, recompute + store on miss.
 *
 * Every read-side caller (Foundry export endpoint, SpellListManager,
 * ClassView, etc.) should call this rather than `getConsumerSpellList`
 * directly — the latter skips the cache and pays the full compute cost
 * every time.
 */
export async function getCachedOrCompute(
  consumerType: ConsumerType,
  consumerId: string,
): Promise<string[]> {
  const fingerprint = await computeInputsFingerprint(consumerType, consumerId);
  const cached = await readCache(consumerType, consumerId);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.spellIds;
  }
  const fresh = await getConsumerSpellList(consumerType, consumerId);
  await writeCache(consumerType, consumerId, fingerprint, fresh);
  return fresh;
}

// -----------------------------------------------------------------------------
// Parity helper — correctness spot-check
// -----------------------------------------------------------------------------

/**
 * Diff the legacy materialised `class_spell_lists` set against the new
 * resolver's output for one class. The materialised table is still
 * populated (it's what production has been running on); this helper
 * lets us spot-check that the new resolver matches it for any given
 * class before we delete the table in Phase 4.
 *
 * Returns four buckets:
 *   - `legacyOnly`: ids in the materialised table but NOT in the new
 *     resolver. If non-empty, the legacy table has rows the new model
 *     wouldn't produce — most likely orphaned `rule:<deleted_rule>`
 *     rows or manual rows that haven't been migrated into a rule's
 *     manual_spells yet (P4.2.5 / data migration).
 *   - `newOnly`: ids the new resolver returns that the legacy table
 *     doesn't have. Most likely the bulk-import / rule-application
 *     change trigger gaps the v1 system silently skipped — i.e. cases
 *     where the new path is actually MORE correct than the legacy one.
 *   - `both`: ids both paths agree on.
 *   - `summary`: convenience counts.
 *
 * Doesn't write anywhere — pure read + diff. Safe to call from any
 * read-side context. Goes away in Phase 4 alongside the legacy
 * `class_spell_lists` reads.
 */
export async function compareClassSpellListImpls(classId: string): Promise<{
  legacyOnly: string[];
  newOnly: string[];
  both: string[];
  summary: { legacy: number; new: number; agree: number; disagree: number };
}> {
  const [legacyRows, newIds] = await Promise.all([
    queryD1<{ spell_id: string }>(
      `SELECT spell_id FROM class_spell_lists WHERE class_id = ?`,
      [classId],
    ),
    // Skip the cache deliberately — we want a fresh recompute so the
    // diff reflects current state, not a possibly stale cache row.
    getConsumerSpellList('class', classId),
  ]);
  const legacySet = new Set(legacyRows.map(r => r.spell_id));
  const newSet = new Set(newIds);
  const legacyOnly: string[] = [];
  const newOnly: string[] = [];
  const both: string[] = [];
  for (const id of legacySet) {
    if (newSet.has(id)) both.push(id);
    else legacyOnly.push(id);
  }
  for (const id of newSet) {
    if (!legacySet.has(id)) newOnly.push(id);
  }
  return {
    legacyOnly,
    newOnly,
    both,
    summary: {
      legacy: legacySet.size,
      new: newSet.size,
      agree: both.length,
      disagree: legacyOnly.length + newOnly.length,
    },
  };
}
