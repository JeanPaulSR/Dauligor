import { evaluate } from 'mathjs';

export function calculateEffectiveCastingLevel(level: number, formula: string): number {
  if (!formula) return 0;
  try {
    // MathJS supports floor, ceil, etc.
    const result = evaluate(
      formula.toLowerCase()
        .replace(/level/g, level.toString())
        .replace(/ciel/g, 'ceil')
    );
    return Math.floor(result);
  } catch (error) {
    console.error("Formula evaluation error:", error, formula);
    return 0;
  }
}

export function getSpellSlotsForLevel(effectiveLevel: number, masterTable: any[]): number[] {
  if (effectiveLevel <= 0) return Array(9).fill(0);
  const targetLevel = Math.min(20, Math.max(1, effectiveLevel));
  if (!Array.isArray(masterTable)) return Array(9).fill(0);
  const row = masterTable.find((r: any) => r.level === targetLevel);
  return row ? row.slots : Array(9).fill(0);
}

export interface PactSlotResult {
  /** Number of pact slots at this effective pact-caster level. */
  slots: number;
  /** The single spell level those pact slots are cast at (1–5). */
  slotLevel: number;
}

/**
 * Pact magic counterpart to `getSpellSlotsForLevel`. The pact master chart
 * (`multiclass_master_chart` row id 'pact') stores rows of
 * `{ level, slots, slotLevel }` — unlike standard slots, pact casters get a
 * fixed number of slots that are ALL the same spell level, scaling with the
 * pact-caster level. Returns `{ slots: 0, slotLevel: 0 }` when the table is
 * missing or the level has no slots.
 */
export function getPactSlotsForLevel(effectiveLevel: number, pactTable: any[]): PactSlotResult {
  if (effectiveLevel <= 0) return { slots: 0, slotLevel: 0 };
  const targetLevel = Math.min(20, Math.max(1, effectiveLevel));
  if (!Array.isArray(pactTable)) return { slots: 0, slotLevel: 0 };
  const row = pactTable.find((r: any) => Number(r.level) === targetLevel);
  if (!row) return { slots: 0, slotLevel: 0 };
  return {
    slots: Math.max(0, Number(row.slots) || 0),
    slotLevel: Math.max(0, Number(row.slotLevel) || 0),
  };
}

/**
 * Build a per-level pact display table for the class/subclass viewers, sourced
 * from the Pact Master Chart. The shape matches the existing "alt spellcasting"
 * columns the viewers already render — `levels[level] = { slotCount, slotLevel }`
 * — so pact casters reuse that table without new render code. The Full/Half/
 * Third progression (if any) scales the pact-caster level, matching the
 * character builder; with no progression it is full (level maps 1:1).
 * Returns null for non-pact spellcasting or a missing chart.
 */
export function buildPactDisplayTable(
  spellcasting: any,
  spellcastingTypes: any[],
  pactChart: any,
): { name: string; levels: Record<string, { slotCount: number; slotLevel: number }> } | null {
  if (!spellcasting || String(spellcasting.castingMode || '').toLowerCase() !== 'pact') return null;
  const pactLevels = pactChart?.levels;
  if (!Array.isArray(pactLevels)) return null;
  const type = Array.isArray(spellcastingTypes)
    ? spellcastingTypes.find((t: any) => t.id === spellcasting.progressionId)
    : null;
  const formula = type?.formula ? String(type.formula) : '1 * level';
  const levels: Record<string, { slotCount: number; slotLevel: number }> = {};
  for (let level = 1; level <= 20; level++) {
    const contribution = calculateEffectiveCastingLevel(level, formula);
    const effectiveLevel = contribution > 0 ? contribution : level;
    const { slots, slotLevel } = getPactSlotsForLevel(effectiveLevel, pactLevels);
    levels[level.toString()] = { slotCount: slots, slotLevel };
  }
  return { name: type?.name ? `Pact Magic (${type.name})` : 'Pact Magic', levels };
}
