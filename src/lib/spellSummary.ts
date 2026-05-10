import { fetchCollection } from './d1';

/**
 * Slim spell projection used by every spell-browsing surface.
 *
 * Pulls every column needed to render a row, derive filter facets, and check
 * prerequisites — but skips the heavy `description`, `activities`, and `effects`
 * blobs. At ~5000 spells, including `description` alone can push the catalogue
 * over 5 MB (sessionStorage's per-origin limit). Detail panes fetch the full
 * row on demand via `fetchDocument('spells', id)`.
 *
 * `foundry_data` is included because it's needed for casting/range/duration
 * bucketing (only ~400-500 bytes per spell — small enough to keep in the slim).
 */
const SPELL_SUMMARY_COLUMNS = [
  'id', 'name', 'identifier',
  'level', 'school', 'source_id', 'image_url',
  'tags', 'foundry_data',
  'concentration', 'ritual',
  'components_vocal', 'components_somatic', 'components_material',
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
