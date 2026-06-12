// Browser-side candidate builder for the in-app Foundry monster import
// workbench (MonsterImportWorkbench). Wraps the pure `creatureEntryToMonsterRow`
// transform (src/lib/monsterImport.ts — the same one the seed script uses) and
// shapes each transformed row into a review candidate the workbench renders.
//
// Mirrors `buildSpeciesBackgroundCandidates` in speciesBackgroundImport.ts, with
// two monster-specific differences:
//   1. Monsters are matched by their Foundry **actor id** (the `monsters` PK),
//      not a source+identifier natural key — re-importing the same creature
//      overwrites that row (ON CONFLICT(id) DO UPDATE).
//   2. Re-import identifier safety: the transform bumps a colliding identifier
//      to "-2". When re-importing a creature already in the table we must NOT
//      let it collide with its OWN existing identifier, so we seed
//      `takenIdentifiers` with existing identifiers EXCEPT those owned by a row
//      in this import batch.

import { creatureEntryToMonsterRow, type MonsterImportContext } from './monsterImport';

export interface MonsterImportCandidate {
  /** Stable id for list keys + selection = the transformed row's Foundry id. */
  candidateId: string;
  /** The full transformed `monsters` row (camelCase, JSON cols as objects). */
  row: Record<string, any>;
  name: string;
  cr: number | null;
  creatureType: string;
  size: string;
  imageUrl: string;
  sourceBook: string;
  /** Auto-resolved sourceId ('' when the book didn't match a source). */
  matchedSourceId: string;
  sourceResolved: boolean;
  /** True when a row with this id already exists (→ update, not insert). */
  existing: boolean;
  warnings: string[];
  spellMissing: number;
  sectionCounts: Record<string, number>;
}

type SourceRecord = { id: string; abbreviation?: string; slug?: string; name?: string; [k: string]: any };

/** Strip a "'14"/"’24" year suffix + upper-case (mirrors monsterImport.normalizeBook). */
const normalizeBook = (b: string) => String(b || '').replace(/['’]\d{2}$/, '').trim().toUpperCase();

const SECTION_KEYS = [
  'traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions', 'lairActions', 'regionalEffects',
] as const;

/**
 * Pull the creature entries out of whatever the user loaded:
 *   - a `dauligor.foundry-creature-folder-export.v1` `{ creatures: [...] }`
 *   - a bare array of entries
 *   - a single entry (`{ sourceDocument, creatureSummary, … }`)
 */
export function parseCreatureEntries(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.creatures)) return payload.creatures;
  if (payload.sourceDocument || payload.creatureSummary) return [payload];
  return [];
}

export function buildMonsterImportCandidates(
  payload: any,
  sources: SourceRecord[],
  spellIdentifiers: Iterable<string>,
  existingMonsters: Array<{ id: string; identifier?: string }>,
): MonsterImportCandidate[] {
  const entries = parseCreatureEntries(payload);
  if (!entries.length) return [];

  const sourcesByAbbrev = new Map<string, string>();
  for (const s of sources) {
    if (s.abbreviation) sourcesByAbbrev.set(normalizeBook(s.abbreviation), s.id);
    if (s.slug) sourcesByAbbrev.set(String(s.slug).toUpperCase(), s.id);
  }
  const spellIdents = new Set<string>(Array.from(spellIdentifiers, (x) => String(x)));

  const existingIds = new Set(existingMonsters.map((m) => String(m.id)));
  const importIds = new Set(entries.map((e) => String(e?.id || e?.sourceDocument?._id || '')));
  const takenIdentifiers = new Set<string>();
  for (const m of existingMonsters) {
    if (m.identifier && !importIds.has(String(m.id))) takenIdentifiers.add(String(m.identifier));
  }

  const ctx: MonsterImportContext = { sourcesByAbbrev, spellIdents, takenIdentifiers };

  return entries.map((entry) => {
    const { row, warnings } = creatureEntryToMonsterRow(entry, ctx);
    const sectionCounts: Record<string, number> = {};
    for (const k of SECTION_KEYS) sectionCounts[k] = Array.isArray(row[k]) ? row[k].length : 0;
    sectionCounts.spellcasting = Array.isArray(row.spellcasting) ? row.spellcasting.length : 0;
    return {
      candidateId: String(row.id),
      row,
      name: String(row.name || 'Unknown'),
      cr: row.cr ?? null,
      creatureType: String(row.creatureType || ''),
      size: String(row.size || ''),
      imageUrl: String(row.imageUrl || row.tokenImageUrl || ''),
      sourceBook: String(row.sourceBook || ''),
      matchedSourceId: String(row.sourceId || ''),
      sourceResolved: !!row.sourceId,
      existing: existingIds.has(String(row.id)),
      warnings,
      spellMissing: warnings.filter((w) => w.startsWith('spell')).length,
      sectionCounts,
    };
  });
}
