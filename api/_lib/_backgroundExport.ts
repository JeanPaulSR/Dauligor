// Builder for the full Foundry-ready background item — served by
// `/api/module/backgrounds/<dbId>.json`. Parallel to `_featExport.ts`.
//
// Backgrounds live in the `feats` table (feat_type='background'); they share
// the feat machinery (description, advancements, source, tags) and differ only
// in the Foundry `type` ("background", not "feat") plus two background-only
// fields the dnd5e BackgroundData schema adds via StartingEquipmentTemplate:
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
// Storage note: the Dauligor `feats` table does NOT have dedicated
// `starting_equipment` / `wealth` columns yet (backgrounds are an intentional
// placeholder in the feats table). We read them best-effort from the row in
// case a future migration / JSON column adds them, and default to empty so the
// exported document is validation-clean in Foundry today. This is exactly the
// kind of gap the export-button-first approach surfaces: the round-trip will
// show what the eventual backgrounds table needs to carry.

import type { ExportFetchers } from "./_classExport.js";
import { buildFeatLikeItem } from "./_featExport.js";

const parseJsonField = (val: any, fallback: any) => {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

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
 * Returns null when no row matches (or the row isn't a background).
 */
export async function buildBackgroundItemBundle(
  backgroundId: string,
  fetchers: ExportFetchers,
): Promise<BackgroundItemBundle | null> {
  const built = await buildFeatLikeItem(backgroundId, fetchers, {
    foundryType: "background",
    entityKind: "background",
  });
  if (!built) return null;

  const { row, item, sourceId } = built;
  const system = item.system;

  // Background-only fields. Read best-effort from the row (placeholder
  // storage today) and default to schema-clean empties so the document
  // validates in Foundry. `startingEquipment` is an array of
  // EquipmentEntryData; `wealth` is a roll formula string.
  system.startingEquipment = parseJsonField(row.starting_equipment, []) || [];
  system.wealth = typeof row.wealth === "string" ? row.wealth : "";

  return {
    kind: "dauligor.background-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    background: { ...item, type: "background" },
    generatedAt: Date.now(),
  };
}
