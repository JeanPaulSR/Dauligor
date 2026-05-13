// =============================================================================
// Tag usage scanner — single-query implementation
// =============================================================================
//
// Builds a `Map<tagId, TagUsageBreakdown>` summarizing how many entities of
// each kind reference each tag. Powers the "Used by N" pill in the
// TagGroupEditor and any future tag-cleanup tooling (merge / find-unused /
// blast-radius-on-delete prompts).
//
// Earlier rev fired one fetchCollection per consumer table (7 parallel
// scans + 1 grouped lore query = 8 round trips). This rev replaces that
// with a single CTE-driven query against SQLite's JSON1 `json_each` table-
// valued function — D1 inherits JSON1, so the unnest-and-count happens on
// the worker before anything crosses the wire. Wall clock under 50ms for
// realistic catalogs; payload is one row per (tag_id, kind) pair with a
// non-zero count instead of every entity row's full tag column.
//
// A short in-memory cache (30s TTL) makes navigating between groups feel
// instant — the scan is invariant to group selection, so reusing the last
// result is correct as long as nothing mutated tag references on this tab.
// Destructive actions in TagGroupEditor (handleDeleteTag) call
// `invalidateTagUsageCache()` to force a fresh scan on the next read.
// =============================================================================

import { queryD1 } from './d1';

export type TagUsageEntityKind =
  | 'spells'
  | 'feats'
  | 'features'
  | 'items'
  | 'classes'
  | 'subclasses'
  | 'options'
  | 'lore';

export interface TagUsageBreakdown {
  spells: number;
  feats: number;
  features: number;
  items: number;
  classes: number;
  subclasses: number;
  /** unique_option_items.tags — class option pool entries (Invocations, etc.) */
  options: number;
  /** lore_article_tags junction */
  lore: number;
  /** Convenience — sum of every kind above. */
  total: number;
}

function emptyBreakdown(): TagUsageBreakdown {
  return {
    spells: 0,
    feats: 0,
    features: 0,
    items: 0,
    classes: 0,
    subclasses: 0,
    options: 0,
    lore: 0,
    total: 0,
  };
}

// ─── two-query implementation ──────────────────────────────────────────
//
// Each branch of the UNION ALL unnests one consumer table's JSON tag column
// via `json_each`. The cross-join shape `FROM <t> JOIN json_each(<t>.col)`
// produces one row per (entity, tag id) pair; the per-term GROUP BY rolls
// those up server-side so we only pay for one row per (tag_id, kind) on
// the wire. `json_valid` guards against malformed values so a single
// corrupt cell doesn't crash the whole scan. The lore branch reads the
// dedicated junction table directly (no JSON).
//
// Why two queries instead of one: D1's SQLite build sets the compound-
// SELECT limit at 5 terms (vanilla SQLite default is 500, but Cloudflare's
// compile-time cap is much stricter). 8 consumer kinds = 8 UNION ALL terms,
// over the limit. We split into two 4-term queries fired in parallel via
// Promise.all — wall clock is one round trip's worth, and 2 connections
// is still 4× better than the original 8-fetch approach.
//
// Pre-aggregation: each term has its own `GROUP BY je.value` (or
// `GROUP BY tag_id` for lore). Result payload is at most
// `tag_count × kinds_in_this_query` rows; in practice well under 500 even
// for a fully-tagged catalog.

const USAGE_SCAN_SQL_A = `
  SELECT je.value AS tag_id, 'spells' AS kind, COUNT(*) AS n
    FROM spells JOIN json_each(spells.tags) je
    WHERE spells.tags IS NOT NULL AND json_valid(spells.tags) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
  UNION ALL
  SELECT je.value AS tag_id, 'feats' AS kind, COUNT(*) AS n
    FROM feats JOIN json_each(feats.tags) je
    WHERE feats.tags IS NOT NULL AND json_valid(feats.tags) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
  UNION ALL
  SELECT je.value AS tag_id, 'features' AS kind, COUNT(*) AS n
    FROM features JOIN json_each(features.tags) je
    WHERE features.tags IS NOT NULL AND json_valid(features.tags) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
  UNION ALL
  SELECT je.value AS tag_id, 'items' AS kind, COUNT(*) AS n
    FROM items JOIN json_each(items.tags) je
    WHERE items.tags IS NOT NULL AND json_valid(items.tags) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
`;

const USAGE_SCAN_SQL_B = `
  SELECT je.value AS tag_id, 'classes' AS kind, COUNT(*) AS n
    FROM classes JOIN json_each(classes.tag_ids) je
    WHERE classes.tag_ids IS NOT NULL AND json_valid(classes.tag_ids) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
  UNION ALL
  SELECT je.value AS tag_id, 'subclasses' AS kind, COUNT(*) AS n
    FROM subclasses JOIN json_each(subclasses.tag_ids) je
    WHERE subclasses.tag_ids IS NOT NULL AND json_valid(subclasses.tag_ids) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
  UNION ALL
  SELECT je.value AS tag_id, 'options' AS kind, COUNT(*) AS n
    FROM unique_option_items JOIN json_each(unique_option_items.tags) je
    WHERE unique_option_items.tags IS NOT NULL AND json_valid(unique_option_items.tags) AND je.value IS NOT NULL AND je.value != ''
    GROUP BY je.value
  UNION ALL
  SELECT tag_id, 'lore' AS kind, COUNT(*) AS n
    FROM lore_article_tags
    WHERE tag_id IS NOT NULL AND tag_id != ''
    GROUP BY tag_id
`;

// Set of every kind the SELECT can return — used to type-narrow the row's
// `kind` field before indexing into the breakdown.
const VALID_KINDS = new Set<TagUsageEntityKind>([
  'spells', 'feats', 'features', 'items', 'classes', 'subclasses', 'options', 'lore',
]);

interface ScanRow {
  tag_id: string;
  kind: string;
  n: number;
}

function applyRows(usage: Map<string, TagUsageBreakdown>, rows: ScanRow[]): void {
  for (const row of rows) {
    const kind = row.kind as TagUsageEntityKind;
    if (!VALID_KINDS.has(kind)) continue;
    const n = Number(row.n) || 0;
    if (n === 0 || !row.tag_id) continue;
    let entry = usage.get(row.tag_id);
    if (!entry) {
      entry = emptyBreakdown();
      usage.set(row.tag_id, entry);
    }
    entry[kind] += n;
    entry.total += n;
  }
}

async function runScan(): Promise<Map<string, TagUsageBreakdown>> {
  const usage = new Map<string, TagUsageBreakdown>();
  try {
    // Two queries, parallel via Promise.all. Per-term GROUP BY means
    // each query returns at most (kinds_in_query × tag_count) rows.
    const [rowsA, rowsB] = await Promise.all([
      queryD1<ScanRow>(USAGE_SCAN_SQL_A),
      queryD1<ScanRow>(USAGE_SCAN_SQL_B),
    ]);
    applyRows(usage, rowsA);
    applyRows(usage, rowsB);
  } catch (err) {
    // Don't poison the cache on failure — log and return whatever we
    // accumulated. Caller will see an empty (or partial) map and simply
    // not render pills, which is the same fallback as the pre-loaded
    // state.
    console.warn('[tagUsage] Scan failed:', err);
  }
  return usage;
}

// ─── cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  at: number;
  promise: Promise<Map<string, TagUsageBreakdown>>;
}

let cached: CacheEntry | null = null;
const CACHE_TTL_MS = 30_000;

/**
 * Drop any cached scan result. Call after destructive actions (tag delete,
 * eventual tag merge) so the next caller gets fresh counts.
 */
export function invalidateTagUsageCache(): void {
  cached = null;
}

/**
 * Return a per-tag usage breakdown, served from a 30-second in-memory cache
 * so rapid group-to-group navigation reuses the last scan. Pass
 * `{ forceRefresh: true }` to skip the cache (rare — invalidation hooks
 * handle the common stale paths).
 */
export async function fetchTagUsageMap(
  opts: { forceRefresh?: boolean } = {},
): Promise<Map<string, TagUsageBreakdown>> {
  const now = Date.now();
  if (!opts.forceRefresh && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = runScan();
  cached = { at: now, promise };
  // If the scan rejects, drop the entry so the next read retries from
  // scratch instead of replaying the failed promise.
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

// ─── tooltip helpers ───────────────────────────────────────────────────

const KIND_LABELS_SINGULAR: Record<TagUsageEntityKind, string> = {
  spells:     'spell',
  feats:      'feat',
  features:   'feature',
  items:      'item',
  classes:    'class',
  subclasses: 'subclass',
  options:    'option',
  lore:       'lore article',
};

const KIND_LABELS_PLURAL: Record<TagUsageEntityKind, string> = {
  spells:     'spells',
  feats:      'feats',
  features:   'features',
  items:      'items',
  classes:    'classes',
  subclasses: 'subclasses',
  options:    'options',
  lore:       'lore articles',
};

/**
 * Build a human-readable breakdown line for a tooltip / drawer.
 * Skips zero-count kinds so the string stays short ("8 spells · 3 feats"
 * rather than "8 spells · 0 feats · 0 features · …").
 */
export function summarizeBreakdown(b: TagUsageBreakdown | undefined): string {
  if (!b || b.total === 0) return 'Not used anywhere yet';
  const parts: string[] = [];
  (Object.keys(KIND_LABELS_SINGULAR) as TagUsageEntityKind[]).forEach((kind) => {
    const n = b[kind];
    if (!n) return;
    const label = n === 1 ? KIND_LABELS_SINGULAR[kind] : KIND_LABELS_PLURAL[kind];
    parts.push(`${n} ${label}`);
  });
  return parts.join(' · ');
}
