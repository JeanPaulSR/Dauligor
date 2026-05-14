import { fetchCollection } from './d1';

/**
 * Slim spell projection used by every spell-browsing surface.
 *
 * Pulls every column needed to render a row, derive filter facets,
 * and check prerequisites — but skips the heavy `description`,
 * `activities`, `effects`, AND `foundry_data` blobs. Detail panes
 * fetch the full row on demand via `fetchDocument('spells', id)`.
 *
 * The "every column needed to render" trick is that the catalogue
 * doesn't carry the Foundry `system` object at all — instead it
 * carries the eight scalar fields the display path actually reads
 * (activation_type / activation_value / activation_condition /
 * range_units / range_value / range_special / duration_units /
 * duration_value) plus the four pre-computed filter buckets
 * (activation_bucket / range_bucket / duration_bucket /
 * shape_bucket). Both sets are kept in sync with foundry_data on
 * every save by upsertSpell + upsertSpellBatch in
 * src/lib/compendium.ts.
 *
 * Per-spell summary payload after this slim:
 *   ~300-500 bytes (down from ~3-5 KB when foundry_data was
 *   present).
 *
 * Scale headroom: 5000 spells × ~400 bytes = ~2 MB total, well
 * under the ~5 MB sessionStorage per-origin browser quota. The
 * cache layer (src/lib/d1.ts) keeps the size-guard for safety in
 * case the catalogue grows past expectations.
 *
 * Migrations that materialised the dropped data:
 *   worker/migrations/20260514-2200_spells_bucket_columns.sql
 *   worker/migrations/20260514-2230_spells_bucket_columns_fix_paths.sql
 *   worker/migrations/20260514-2300_spells_display_scalars.sql
 *
 * Consumer note: pages that need the full `foundry_data` (the
 * manual editor's Mechanics tab, the detail panel's components
 * list, etc.) call `fetchSpell(id)` or `fetchDocument('spells',
 * id)` — those return the full row.
 */
const SPELL_SUMMARY_COLUMNS = [
  'id', 'name', 'identifier',
  'level', 'school', 'source_id', 'image_url',
  'tags',
  'concentration', 'ritual',
  'components_vocal', 'components_somatic', 'components_material',
  'activation_bucket', 'range_bucket', 'duration_bucket', 'shape_bucket',
  'activation_type', 'activation_value', 'activation_condition',
  'range_units', 'range_value', 'range_special',
  'duration_units', 'duration_value',
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
