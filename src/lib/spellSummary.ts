import { fetchCollection } from './d1';

/**
 * Slim spell projection used by every spell-browsing surface.
 *
 * Pulls every column needed to render a row, derive filter facets,
 * and check prerequisites — but skips the heavy `description`,
 * `activities`, and `effects` blobs. Detail panes fetch the full
 * row on demand via `fetchDocument('spells', id)`.
 *
 * Bucket columns (activation_bucket / range_bucket / duration_bucket
 * / shape_bucket) added 2026-05-14 — populated by the migration in
 * worker/migrations/20260514-2200_spells_bucket_columns.sql and
 * kept in sync on every save by upsertSpell/upsertSpellBatch. They
 * let `deriveSpellFilterFacets` skip a JSON parse on every row at
 * filter time. Tiny cost (~40 bytes / spell) for a real speedup
 * once the catalogue grows.
 *
 * `foundry_data` is STILL here despite the bucket columns because
 * the SpellList browser reads the raw `activation` / `range` /
 * `duration` shapes via `formatActivationLabel(facets.foundryShell
 * .activation)` etc. to render the human-readable column labels
 * ("60 ft", "1 action"). Buckets alone are too coarse for display.
 *
 * **Known scaling concern (5000-spell target):** the foundry_data
 * column is the bulk of the per-spell payload here (~3-5 KB each).
 * At 5000 spells that's 15-25 MB, well past the ~5 MB sessionStorage
 * per-origin budget. The cache layer in src/lib/d1.ts handles the
 * overflow gracefully (size-guarded write + try/catch), but cross-
 * session persistence is lost for the spells query at that scale.
 *
 * The clean fix is to materialise the display-relevant scalar
 * fields as columns too (activation_type / activation_value /
 * range_units / range_value / duration_units / duration_value)
 * and then drop foundry_data from this projection. That dropped
 * the summary payload from ~3-5 KB → ~300-500 bytes per spell.
 * Deferred until after the layout polish work on SpellListManager
 * + SpellRulesEditor lands.
 */
const SPELL_SUMMARY_COLUMNS = [
  'id', 'name', 'identifier',
  'level', 'school', 'source_id', 'image_url',
  'tags', 'foundry_data',
  'concentration', 'ritual',
  'components_vocal', 'components_somatic', 'components_material',
  'activation_bucket', 'range_bucket', 'duration_bucket', 'shape_bucket',
  'required_tags', 'prerequisite_text',
  'created_at', 'updated_at',
].join(', ');

export type SpellSummaryRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  imageUrl?: string;
  level?: number;
  school?: string;
  tagIds?: string[];
  updatedAt?: string;
  createdAt?: string;
  foundryImport?: {
    sourceBook?: string;
    sourcePage?: string;
    rules?: string;
  };
  [key: string]: any;
};

/**
 * Fetch the slim spell catalogue. Ordering defaults to `name ASC`; pass
 * `'level ASC, name ASC'` for the manager-style display.
 */
export async function fetchSpellSummaries(orderBy: string = 'name ASC'): Promise<any[]> {
  return fetchCollection<any>('spells', {
    select: SPELL_SUMMARY_COLUMNS,
    orderBy,
  });
}
