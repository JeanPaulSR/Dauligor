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
  const row = masterTable.find((r: any) => r.level === targetLevel);
  return row ? row.slots : Array(9).fill(0);
}
