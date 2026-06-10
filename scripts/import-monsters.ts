// Seed runner: transform every creature in the Foundry creature export into a
// `monsters` row (via src/lib/monsterImport.ts) and emit a SQL file of INSERTs
// to apply to local D1. One-time seed / re-seed; the durable transform lives in
// the lib. Run with:
//
//   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/import-monsters.ts
//
// Inputs (env-overridable):
//   EXPORT      → the creature-folder export JSON
//   SOURCES     → JSON array of {id, abbreviation, slug} (wrangler SELECT)
//   SPELLS      → JSON array of {identifier} (wrangler SELECT)
//   OUT         → SQL output path
import { readFileSync, writeFileSync } from 'node:fs';
import {
  creatureEntryToMonsterRow, MONSTER_COLUMNS, MONSTER_JSON_COLUMNS,
  type MonsterImportContext,
} from '../src/lib/monsterImport';

const EXPORT = process.env.EXPORT || 'E:/DnD/Professional/Foundry Export/creatures/creatures-creatures-export.json';
const SOURCES = process.env.SOURCES || 'worker/.wrangler/_import/sources.json';
const SPELLS = process.env.SPELLS || 'worker/.wrangler/_import/spells.json';
const OUT = process.env.OUT || 'worker/.wrangler/_import/monsters.sql';

function loadWranglerJson(path: string): any[] {
  // wrangler --json prints `[{ results: [...] }]`
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  return parsed?.[0]?.results ?? parsed?.results ?? parsed ?? [];
}

console.log('[import-monsters] loading export…');
const data = JSON.parse(readFileSync(EXPORT, 'utf-8'));
const creatures: any[] = data.creatures ?? [];
console.log(`[import-monsters] ${creatures.length} creatures`);

const sourceRows = loadWranglerJson(SOURCES);
const sourcesByAbbrev = new Map<string, string>();
for (const s of sourceRows) {
  if (s.abbreviation) sourcesByAbbrev.set(String(s.abbreviation).toUpperCase(), s.id);
  if (s.slug) sourcesByAbbrev.set(String(s.slug).toUpperCase(), s.id);
}
const spellIdents = new Set<string>(loadWranglerJson(SPELLS).map((r: any) => r.identifier));
console.log(`[import-monsters] ${sourcesByAbbrev.size} source keys, ${spellIdents.size} spell identifiers`);

const ctx: MonsterImportContext = { sourcesByAbbrev, spellIdents, takenIdentifiers: new Set() };

const rows: Record<string, any>[] = [];
const warnCounts: Record<string, number> = {};
let unresolvedSource = 0, missingSpellRefs = 0;
for (const entry of creatures) {
  const { row, warnings } = creatureEntryToMonsterRow(entry, ctx);
  rows.push(row);
  for (const w of warnings) {
    const kind = w.startsWith('source') ? 'source-unresolved' : w.startsWith('spell') ? 'spell-missing' : 'other';
    warnCounts[kind] = (warnCounts[kind] || 0) + 1;
    if (kind === 'source-unresolved') unresolvedSource++;
    if (kind === 'spell-missing') missingSpellRefs++;
  }
}

// ─── serialize to SQL ──────────────────────────────────────────────────────
function sqlValue(col: string, v: any): string {
  if (MONSTER_JSON_COLUMNS.has(col)) return `'${JSON.stringify(v ?? (Array.isArray(v) ? [] : {})).replace(/'/g, "''")}'`;
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

const cols = MONSTER_COLUMNS as readonly string[];
const colList = cols.join(', ');
const lines: string[] = [];
// One row per INSERT — D1 caps a single SQL statement at ~100KB (SQLITE_TOOBIG),
// and a batched multi-row VALUES easily exceeds it for big creatures.
const BATCH = Number(process.env.BATCH) || 1;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const values = batch.map((r) => `(${cols.map((c) => sqlValue(c, r[c])).join(', ')})`).join(',\n');
  lines.push(`INSERT INTO monsters (${colList}) VALUES\n${values};`);
}
// DELETE first so a re-import cleanly replaces existing rows (nothing
// FK-references monsters). Avoids PK conflicts on the INSERTs.
writeFileSync(OUT, 'DELETE FROM monsters;\n\n' + lines.join('\n\n'), 'utf-8');

// ─── report ────────────────────────────────────────────────────────────────
const withSpellcasting = rows.filter((r) => r.hasSpellcasting).length;
const withLegendary = rows.filter((r) => r.hasLegendary).length;
const withLair = rows.filter((r) => r.hasLair).length;
const acNull = rows.filter((r) => r.ac == null).length;
console.log(`[import-monsters] wrote ${rows.length} rows → ${OUT}`);
console.log(`  resolved sources: ${rows.length - unresolvedSource}/${rows.length} (unresolved warnings: ${unresolvedSource})`);
console.log(`  spellcasters: ${withSpellcasting}  legendary: ${withLegendary}  lair: ${withLair}  ac-null: ${acNull}`);
console.log(`  warning kinds: ${JSON.stringify(warnCounts)}  (missing-spell-ref instances: ${missingSpellRefs})`);
