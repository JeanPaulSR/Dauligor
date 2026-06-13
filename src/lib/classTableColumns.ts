/**
 * Helpers for deciding which columns the class progression table draws.
 *
 * Two rules, both render-time only (a hidden/empty column still exists in
 * data and still exports to Foundry — this only governs the rendered table):
 *
 * 1. **Auto-hide all-zero spellcasting columns.** A spellbook caster (e.g.
 *    Wizard) has Cantrips Known per level but no Spells Known — its
 *    spells-known series is all zeros and the column shouldn't show.
 *    `levelSeriesHasValue` answers "does any level carry a non-zero value
 *    for this series?" so each spellcasting column can render independently.
 *    (Spell-slot level columns are already trimmed by `maxSpellLevel`.)
 *
 * 2. **Author-hidden custom columns.** A custom scaling column can be marked
 *    hidden (`scaling_columns.hidden`); `isColumnHidden` coerces the D1
 *    INTEGER 0/1 (or a boolean) so render sites can filter it out.
 *
 * Shared by ClassView (public) and ClassPreviewPane (editor preview) so the
 * two tables can't drift.
 */

/** True when a scaling column is flagged hidden (D1 INTEGER 0/1 or boolean). */
export function isColumnHidden(col: any): boolean {
  const h = col?.hidden;
  return h === true || h === 1 || h === '1';
}

/**
 * True when at least one level in a spellcasting series carries a non-zero
 * numeric value under any of `keys`. `levels` is the `{ "1": {...}, … }` map
 * from a spells-known / spellcasting scaling; `keys` are the aliased field
 * names for one column (e.g. `['cantrips','cantripsKnown']`,
 * `['spellsKnown','spells']`). Empty / missing / all-zero → false, so the
 * caller can drop the column.
 */
export function levelSeriesHasValue(
  levels: Record<string, any> | null | undefined,
  keys: string[],
): boolean {
  if (!levels) return false;
  for (const lvl of Object.values(levels)) {
    if (!lvl) continue;
    for (const k of keys) {
      const v = Number((lvl as any)[k]);
      if (Number.isFinite(v) && v > 0) return true;
    }
  }
  return false;
}
