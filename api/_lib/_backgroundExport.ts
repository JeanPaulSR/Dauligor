// Builder for the full Foundry-ready background item — served by
// `/api/module/backgrounds/<dbId>.json`. Parallel to `_featExport.ts`.
//
// Backgrounds now live in their own `backgrounds` table (migration
// 20260601-1200), promoted out of the shared `feats` table. The shared
// description / advancement / source machinery comes from
// `buildSpeciesBackgroundItem`; this builder layers on the two
// background-only `system` fields the dnd5e BackgroundData schema adds via
// StartingEquipmentTemplate:
//
//   system.startingEquipment[]  — EquipmentEntryData tree
//                                  ({_id, group, sort, type, count, key,
//                                   requiresProficiency}); type ∈
//                                   AND|OR|armor|tool|weapon|focus|currency|linked
//   system.wealth               — FormulaField (starting-gold alternative)
//
// dnd5e BackgroundData mixins: AdvancementTemplate + ItemDescriptionTemplate
// + StartingEquipmentTemplate (verified against dnd5e master
// module/data/item/background.mjs). `singleton: true` — an actor holds one.
//
// Storage: read straight from the `backgrounds` table's camelCase columns
// (`startingEquipment` JSON, `wealth` TEXT). These are empty in the current
// 5etools-sourced catalog but the columns ship anyway; entries round-trip
// once authored / imported.

import type { ExportFetchers } from "./_classExport.js";
import { buildSpeciesBackgroundItem, parseJsonField } from "./_speciesBackgroundShared.js";

export interface BackgroundItemBundle {
  kind: "dauligor.background-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  background: {
    name: string;
    type: "background";
    img?: string;
    system: Record<string, any>;
    effects: unknown[];
    flags: Record<string, any>;
  };
  generatedAt: number;
}

/**
 * Build the full Foundry-ready background item bundle for one row.
 * Returns null when no row matches.
 */
export async function buildBackgroundItemBundle(
  backgroundId: string,
  fetchers: ExportFetchers,
): Promise<BackgroundItemBundle | null> {
  const built = await buildSpeciesBackgroundItem("backgrounds", backgroundId, fetchers, {
    foundryType: "background",
    entityKind: "background",
    scalingParentType: "background",
  });
  if (!built) return null;

  const { row, item, sourceId } = built;
  const system = item.system;

  // Background-only fields, read from the dedicated table's columns.
  // `startingEquipment` is an array of EquipmentEntryData; `wealth` is a
  // roll-formula string.
  system.startingEquipment = parseJsonField(row.startingEquipment, []) || [];
  system.wealth = typeof row.wealth === "string"
    ? row.wealth
    : row.wealth != null ? String(row.wealth) : "";

  return {
    kind: "dauligor.background-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    background: { ...item, type: "background" },
    generatedAt: Date.now(),
  };
}
