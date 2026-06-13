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
      const raw = (lvl as any)[k];
      if (raw == null || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n)) {
        // Numeric: only a positive value counts (a spellbook caster's all-zero
        // spells-known stays hidden).
        if (n > 0) return true;
      } else {
        // Non-numeric → a formula like "@mod + @level/2" (Artificer-style
        // spells known). That's a meaningful value, so the column should show.
        const s = String(raw).trim();
        if (s !== '' && s !== '—') return true;
      }
    }
  }
  return false;
}

// ─── Formula display ──────────────────────────────────────────────────────
//
// Spell/scaling cells can carry an authoring FORMULA (e.g. a class whose
// "Spells Known" is `@mod + (@level/2)`). The class table can't evaluate it
// (it has no character), so instead of the raw `@`-shorthand we show what it
// MEANS: `@mod` → the spellcasting ability (INT), `@level` → Level, etc.
// Tokens mirror the authoring shortcuts in lib/referenceSyntax.ts.

/** Humanize an authoring formula's `@`-shortcuts for display in a table cell. */
export function humanizeScalingFormula(raw: string, abilityAbbr?: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  const ability = (abilityAbbr || 'ability').toUpperCase();
  let s = raw;
  // Longer tokens first so a shorter rule can't strip part of a longer one.
  s = s.replace(/@totalLevel\b/giu, 'Total Level');
  s = s.replace(/@level\b/giu, 'Level');
  s = s.replace(/@prof\b/giu, 'PB');
  s = s.replace(/@mod\b/giu, ability);
  s = s.replace(/@value\b/giu, `${ability} score`);
  // Tidy spacing: collapse runs, drop padding inside parens, space binary +/-.
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  s = s.replace(/\s*([+\-])\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Format a Cantrips / Spells-Known cell: blank → em-dash, a formula (`@…`) →
 * humanized, a plain number/string → as-is.
 */
export function formatKnownCell(value: unknown, abilityAbbr?: string): string {
  if (value == null || value === '') return '—';
  const s = String(value);
  return s.includes('@') ? humanizeScalingFormula(s, abilityAbbr) : s;
}
