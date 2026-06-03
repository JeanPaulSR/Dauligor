// Builder for the public spellcasting master-chart endpoint served at
// `/api/module/spellcasting/multiclass-chart.json`.
//
// This is the standard multiclass full-caster spell-slot table — the same
// `multiclass_master_chart` D1 record (`standardMulticlassProgression`/`master`
// in app terms) the web app's classes page reads to render its slot columns.
// The Foundry character-creator class preview pulls it once, then derives a
// class's slots by scaling character level through the class's authored
// `spellcasting.progressionFormula` and looking up this chart — exactly the
// app's `calculateEffectiveCastingLevel` + `getSpellSlotsForLevel` flow.
// (Cantrips / spells-known and pact-magic slots already ship inside each
// class bundle via spellsKnownScalings / alternativeSpellcastingScalings, so
// the only piece missing module-side was this master chart.)
//
// Live read with a short HTTP cache (matches the tag-catalog policy). One
// cheap single-row D1 read.

import { executeD1QueryInternal } from "./d1-internal.js";

export interface MasterChartLevel {
  level: number;
  slots: number[]; // 9 entries, slots[i] = slot count for spell level i+1
}

export async function buildSpellcastingChartBundle(): Promise<any | null> {
  const res = await executeD1QueryInternal({
    sql: "SELECT levels FROM multiclass_master_chart WHERE id = 'master' LIMIT 1",
  });
  const row = (res?.results || [])[0] as { levels: unknown } | undefined;
  if (!row) return null;

  let levels: any = row.levels;
  if (typeof levels === "string") {
    try { levels = JSON.parse(levels); } catch { levels = []; }
  }
  if (!Array.isArray(levels)) levels = [];

  const normalized: MasterChartLevel[] = levels
    .map((r: any) => ({
      level: Number(r?.level),
      slots: Array.isArray(r?.slots) ? r.slots.map((n: any) => Number(n) || 0) : [],
    }))
    .filter((r: MasterChartLevel) => Number.isFinite(r.level))
    .sort((a: MasterChartLevel, b: MasterChartLevel) => a.level - b.level);

  return {
    kind: "dauligor.spellcasting-chart.v1",
    schemaVersion: 1,
    source: { system: "dauligor", entity: "spellcasting-chart", id: "dynamic-d1-library" },
    levels: normalized,
  };
}
