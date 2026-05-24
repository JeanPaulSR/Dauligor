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
  // Spell + tag projections kept in sync with the source twin's
  // (`src/lib/spellListResolver.ts`) cache-friendly shapes:
  //   - spells: slim summary projection (no `foundry_data`) — bucket
  //     columns + component flags are persisted so the matcher reads
  //     them directly.
  //   - tags: ORDER BY name ASC with no select projection — matches
  //     the page-mount fetchCollection key on `/compendium/spell-lists`.
  // Pages Functions don't benefit from the in-app query cache so the
  // alignment is mostly for parity, but it keeps SQL identical across
  // both code paths (easier to debug, easier to mirror on next change).
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
      select:
        "id, name, identifier, level, school, source_id, image_url, tags, " +
        "concentration, ritual, " +
        "components_vocal, components_somatic, components_material, " +
        "activation_bucket, range_bucket, duration_bucket, shape_bucket, " +
        "activation_type, activation_value, activation_condition, " +
        "range_units, range_value, range_special, " +
        "duration_units, duration_value, " +
        "required_tags, prerequisite_text, " +
        "created_at, updated_at",
      orderBy: "name ASC",
    }),
    fetchCollection<any>("tags", { orderBy: "name ASC" }),
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

// =============================================================================
// Cron pre-warm (phase 4.5)
// =============================================================================
//
// Background task that keeps `consumer_spell_list_cache` warm so user
// reads of /compendium/spell-lists, /compendium/classes/view/<id>, and
// the in-app spell-list resolver all hit the cache. Without pre-warm,
// the first user after a spell / tag / rule edit pays a ~100ms
// recompute; with it, only the scheduled job pays.
//
// Why it lives in this file: the resolver compute path is already here
// (one source of truth on the server side), and the prewarm reuses it
// directly via `getConsumerSpellList`. The cache I/O helpers below
// mirror the source twin's (`src/lib/spellListResolver.ts`) shape but
// take a `D1Writer` shim instead of `queryD1` — Pages Functions can't
// import the in-app d1.ts module, and `executeD1QueryInternal` is
// already the canonical write path on the server side.
//
// This entire block is a no-op until the worker scheduled handler
// (P4.5.C) calls `/api/admin/prewarm-spell-cache`. Calling
// `prewarmAllConsumers` from elsewhere is fine — it just iterates
// every (consumer_type, consumer_id) pair with at least one applied
// rule and recomputes-and-writes any whose fingerprint went stale.
// =============================================================================

/**
 * Minimal write shim — the prewarm helpers need both reads (already
 * provided by ExportFetchers) and writes (cache row INSERT/UPDATE).
 * The endpoint implementation passes a thin wrapper around
 * `executeD1QueryInternal`.
 */
export type D1Writer = (sql: string, params?: any[]) => Promise<void>;

/**
 * Same composition as the source twin's `computeInputsFingerprint`:
 *
 *   c:<type>/<id> | r:<sorted rule_ids joined by ','> | s:<max spells.updated_at>
 *                 | t:<max tags.updated_at> | R:<max spell_rules.updated_at>
 *
 * Cheap (1 + 3 SELECT MAX queries) and unambiguous: any write that
 * could affect a consumer's resolved list bumps one of the MAX values
 * and thus the fingerprint. The fingerprint check is the entire
 * staleness signal for the cache — there's no TTL or invalidation
 * dance beyond it.
 */
async function computePrewarmFingerprint(
  consumerType: ConsumerType,
  consumerId: string,
  fetchers: ExportFetchers,
): Promise<string> {
  const { fetchCollection } = fetchers;
  const [appsRows, spellMax, tagMax, ruleMax] = await Promise.all([
    fetchCollection<{ rule_id: string }>("spellRuleApplications", {
      where: "applies_to_type = ? AND applies_to_id = ?",
      params: [consumerType, consumerId],
      select: "rule_id",
      orderBy: "rule_id",
    }),
    fetchCollection<{ m: string | null }>("spells", { select: "MAX(updated_at) AS m" }),
    fetchCollection<{ m: string | null }>("tags", { select: "MAX(updated_at) AS m" }),
    fetchCollection<{ m: string | null }>("spellRules", { select: "MAX(updated_at) AS m" }),
  ]);
  const ruleIds = appsRows.map(r => String(r.rule_id)).join(",");
  return [
    `c:${consumerType}/${consumerId}`,
    `r:${ruleIds}`,
    `s:${spellMax[0]?.m ?? "-"}`,
    `t:${tagMax[0]?.m ?? "-"}`,
    `R:${ruleMax[0]?.m ?? "-"}`,
  ].join("|");
}

type CacheRow = {
  fingerprint: string;
  spellIds: string[];
};

async function readPrewarmCacheRow(
  consumerType: ConsumerType,
  consumerId: string,
  fetchers: ExportFetchers,
): Promise<CacheRow | null> {
  const rows = await fetchers.fetchCollection<{
    inputs_fingerprint: string;
    spell_ids_json: string;
  }>("consumerSpellListCache", {
    where: "consumer_type = ? AND consumer_id = ?",
    params: [consumerType, consumerId],
    select: "inputs_fingerprint, spell_ids_json",
  });
  if (rows.length === 0) return null;
  const row = rows[0];
  let spellIds: string[];
  try {
    const parsed = JSON.parse(row.spell_ids_json);
    spellIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return null;
  }
  return { fingerprint: row.inputs_fingerprint, spellIds };
}

async function writePrewarmCacheRow(
  consumerType: ConsumerType,
  consumerId: string,
  fingerprint: string,
  spellIds: string[],
  writer: D1Writer,
): Promise<void> {
  await writer(
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

export type PrewarmConsumerResult = {
  consumerType: ConsumerType;
  consumerId: string;
  status: "hit" | "recomputed" | "error";
  /** Recompute duration in ms (only on "recomputed"). */
  durationMs?: number;
  /** Error message (only on "error"). */
  error?: string;
};

/**
 * Pre-warm a single consumer: fingerprint, compare, recompute on
 * miss. Idempotent — running twice in a row produces one "recomputed"
 * + one "hit". Returns a small diagnostic object so the endpoint can
 * report what it did.
 */
export async function prewarmConsumer(
  consumerType: ConsumerType,
  consumerId: string,
  fetchers: ExportFetchers,
  writer: D1Writer,
): Promise<PrewarmConsumerResult> {
  try {
    const fingerprint = await computePrewarmFingerprint(consumerType, consumerId, fetchers);
    const cached = await readPrewarmCacheRow(consumerType, consumerId, fetchers);
    if (cached && cached.fingerprint === fingerprint) {
      return { consumerType, consumerId, status: "hit" };
    }
    const t0 = Date.now();
    const fresh = await getConsumerSpellList(consumerType, consumerId, fetchers);
    await writePrewarmCacheRow(consumerType, consumerId, fingerprint, fresh, writer);
    return { consumerType, consumerId, status: "recomputed", durationMs: Date.now() - t0 };
  } catch (err: any) {
    return {
      consumerType,
      consumerId,
      status: "error",
      error: err?.message ?? String(err),
    };
  }
}

export type PrewarmSummary = {
  scanned: number;
  recomputed: number;
  hits: number;
  errors: number;
  durationMs: number;
  details: PrewarmConsumerResult[];
};

/**
 * Discover every consumer that has at least one applied rule (via
 * `spell_rule_applications`) and pre-warm each. A consumer with no
 * applied rules resolves to an empty list — the cache wouldn't save
 * any work and the read path short-circuits there anyway, so we skip.
 *
 * Returned `details` is bounded by the size of
 * `spell_rule_applications` (typically ~100 rows on a Dauligor world).
 * If the schema ever grows past a few thousand consumers, swap the
 * `details` return for `details: details.slice(0, 50)` and stash the
 * rest behind a separate `errors` array.
 */
export async function prewarmAllConsumers(
  fetchers: ExportFetchers,
  writer: D1Writer,
): Promise<PrewarmSummary> {
  const t0 = Date.now();
  const rows = await fetchers.fetchCollection<{
    applies_to_type: string;
    applies_to_id: string;
  }>("spellRuleApplications", {
    select: "DISTINCT applies_to_type, applies_to_id",
  });
  const details: PrewarmConsumerResult[] = [];
  // Sequential — D1 round-trips are quick enough that the natural
  // parallelism gain is small, and a serial loop keeps the worker
  // CPU budget steady (each consumer reuses the rule/spell/tag rows
  // fetched within its own call; cross-consumer sharing would need
  // a bigger refactor).
  for (const row of rows) {
    const consumerType = String(row.applies_to_type) as ConsumerType;
    const consumerId = String(row.applies_to_id);
    if (!consumerType || !consumerId) continue;
    const result = await prewarmConsumer(consumerType, consumerId, fetchers, writer);
    details.push(result);
  }
  const recomputed = details.filter(d => d.status === "recomputed").length;
  const hits = details.filter(d => d.status === "hit").length;
  const errors = details.filter(d => d.status === "error").length;
  return {
    scanned: details.length,
    recomputed,
    hits,
    errors,
    durationMs: Date.now() - t0,
    details,
  };
}
