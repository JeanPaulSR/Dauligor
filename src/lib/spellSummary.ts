import { fetchCollection } from './d1';

/**
 * Lightweight summary record for the spell list. The legacy `spellSummaries`
 * Firestore collection is decommissioned — we read directly from the `spells`
 * D1 table and shape rows for the UI here.
 */
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

export function subscribeSpellSummaries(
  onData: (records: SpellSummaryRecord[]) => void,
  onError?: (error: unknown) => void,
  _onModeChange?: (mode: 'spellSummaries' | 'spells-fallback') => void
) {
  let active = true;

  const load = async () => {
    try {
      const data = await fetchCollection<any>('spells', { orderBy: 'name ASC' });

      if (!active) return;

      // Map D1 results (snake_case columns) back to camelCase expected by the UI
      const mapped: SpellSummaryRecord[] = data.map(row => ({
        ...row,
        sourceId: row.source_id,
        imageUrl: row.image_url,
        foundryData: typeof row.foundry_data === 'string' ? JSON.parse(row.foundry_data) : row.foundry_data,
        tagIds: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
        // Ensure foundryShell/foundryDocument fallbacks for the summary view if needed
        foundryShell: row.foundry_shell || (typeof row.foundry_data === 'string' ? JSON.parse(row.foundry_data) : row.foundry_data)
      }));

      onData(mapped);
    } catch (err) {
      if (active) onError?.(err);
    }
  };

  load();

  return () => {
    active = false;
  };
}
