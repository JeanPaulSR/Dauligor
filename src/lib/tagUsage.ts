// =============================================================================
// Tag usage scanner
// =============================================================================
//
// Builds a `Map<tagId, TagUsageBreakdown>` summarizing how many entities of
// each kind reference each tag. Powers the "Used by N" pill in the
// TagGroupEditor and any future tag-cleanup tooling (merge / find-unused /
// blast-radius-on-delete prompts).
//
// Tag references in this codebase live in two shapes:
//   1. A JSON array on the entity row — `spells.tags`, `feats.tags`,
//      `features.tags`, `items.tags`, `classes.tag_ids`, `subclasses.tag_ids`,
//      `unique_option_items.tags`. Column name + parse strategy varies, so
//      we drive scanning from a small table-of-truth below.
//   2. The `lore_article_tags` junction (article_id, tag_id) introduced in
//      migration 0003. Counted via a GROUP BY tag_id rather than parsing
//      JSON.
//
// Skipped on purpose: `sources.tags`, `image_metadata.tags` — those are
// catalog/meta layers, not user-curated content the admin is curating.
// `spells.required_tags` is also skipped for v1 — it's prerequisite usage,
// conceptually distinct from descriptive tagging, and merging counts would
// muddle the "how often is this tag used" question. A future revision can
// split `required` out as its own field.
// =============================================================================

import { fetchCollection, queryD1 } from './d1';

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

interface JsonArrayTarget {
  /** Collection name as registered in d1Tables — passed to fetchCollection. */
  collection: string;
  /** Column to read on each row (snake_case as it lives in D1). */
  column: string;
  /** Kind bucket in the breakdown, also the label shown in tooltips. */
  kind: Exclude<TagUsageEntityKind, 'lore'>;
}

const JSON_ARRAY_TARGETS: JsonArrayTarget[] = [
  { collection: 'spells',            column: 'tags',    kind: 'spells'     },
  { collection: 'feats',             column: 'tags',    kind: 'feats'      },
  { collection: 'features',          column: 'tags',    kind: 'features'   },
  { collection: 'items',             column: 'tags',    kind: 'items'      },
  { collection: 'classes',           column: 'tag_ids', kind: 'classes'    },
  { collection: 'subclasses',        column: 'tag_ids', kind: 'subclasses' },
  { collection: 'uniqueOptionItems', column: 'tags',    kind: 'options'    },
];

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

function parseTagArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Scan every tag-consuming table and return a per-tag breakdown.
 *
 * Each consumer table is fetched once with only the columns we need
 * (`id, <tags-column>`). The lore junction uses GROUP BY for an O(1) scan.
 * Network cost is bounded by `JSON_ARRAY_TARGETS.length + 1` round trips,
 * which is the same shape used by `imageMetadata.scanForReferences`.
 *
 * Failures in any individual scan are logged but don't throw — a usage
 * breakdown is still useful even if one entity type's count is missing.
 */
export async function fetchTagUsageMap(): Promise<Map<string, TagUsageBreakdown>> {
  const usage = new Map<string, TagUsageBreakdown>();

  const bumpFor = (tagId: string, kind: keyof Omit<TagUsageBreakdown, 'total'>, by = 1) => {
    if (!tagId) return;
    let entry = usage.get(tagId);
    if (!entry) {
      entry = emptyBreakdown();
      usage.set(tagId, entry);
    }
    entry[kind] += by;
    entry.total += by;
  };

  // JSON-array consumers — one fetchCollection per target, parsed in JS.
  await Promise.all(
    JSON_ARRAY_TARGETS.map(async ({ collection, column, kind }) => {
      try {
        const rows = await fetchCollection<any>(collection, { select: `id, ${column}` });
        for (const row of rows) {
          const tagIds = parseTagArray(row[column]);
          for (const tagId of tagIds) bumpFor(tagId, kind);
        }
      } catch (err) {
        console.warn(`[tagUsage] Failed to scan ${collection}.${column}:`, err);
      }
    })
  );

  // Lore junction — one grouped query.
  try {
    const rows = await queryD1<{ tag_id: string; n: number }>(
      `SELECT tag_id, COUNT(*) AS n FROM lore_article_tags GROUP BY tag_id`
    );
    for (const r of rows) {
      const n = Number(r.n) || 0;
      if (!r.tag_id || n === 0) continue;
      bumpFor(r.tag_id, 'lore', n);
    }
  } catch (err) {
    console.warn('[tagUsage] Failed to scan lore_article_tags:', err);
  }

  return usage;
}

/**
 * Build a human-readable breakdown line for a tooltip / drawer.
 * Skips zero-count kinds so the string stays short — "8 spells · 3 feats"
 * rather than "8 spells · 0 feats · 0 features · …".
 *
 * Singular/plural handled by the LABELS table; "lore" stays "lore" because
 * the plural form is identical.
 */
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
