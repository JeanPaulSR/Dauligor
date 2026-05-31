// Builder for the full Foundry-ready race/species item — served by
// `/api/module/races/<dbId>.json`. Parallel to `_featExport.ts`.
//
// Races live in the `feats` table (feat_type='race'); they share the feat
// machinery (description, advancements, source, tags) and differ only in the
// Foundry `type` ("race", not "feat") plus three creature-shaped fields the
// dnd5e RaceData schema adds (verified against dnd5e master
// module/data/item/race.mjs):
//
//   system.movement  — MovementField {walk,fly,swim,climb,burrow,hover,units}
//                       (bonus/special disabled for races)
//   system.senses    — SensesField {darkvision,blindsight,tremorsense,
//                       truesight,units,special}
//   system.type      — CreatureTypeField {value:"humanoid",subtype,swarm,custom}
//                       — the creature type the species confers
//
// dnd5e RaceData mixins: AdvancementTemplate + ItemDescriptionTemplate, plus
// the three fields above. The racial traits themselves are ItemGrant
// advancements (feature items granted on the actor), same as feats.
//
// Storage note: the Dauligor `feats` table has no dedicated movement/senses/
// creature-type columns yet (races are an intentional placeholder there). We
// read them best-effort and default to dnd5e-schema-clean empties so the
// exported document validates in Foundry today; the round-trip will reveal
// what the eventual races table must carry.

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

export interface RaceItemBundle {
  kind: "dauligor.race-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  race: {
    name: string;
    type: "race";
    img?: string;
    system: Record<string, any>;
    effects: unknown[];
    flags: Record<string, any>;
  };
  generatedAt: number;
}

/**
 * Build the full Foundry-ready race item bundle for one row.
 * Returns null when no row matches (or the row isn't a race).
 */
export async function buildRaceItemBundle(
  raceId: string,
  fetchers: ExportFetchers,
): Promise<RaceItemBundle | null> {
  const built = await buildFeatLikeItem(raceId, fetchers, {
    foundryType: "race",
    entityKind: "race",
  });
  if (!built) return null;

  const { row, item, sourceId } = built;
  const system = item.system;

  // Race-only fields. Best-effort from the row (placeholder storage today),
  // defaulting to dnd5e schema-clean shapes so the document validates.
  const movement = parseJsonField(row.movement, null);
  const senses = parseJsonField(row.senses, null);
  const creatureType = parseJsonField(row.creature_type ?? row.type, null);

  system.movement = movement && typeof movement === "object"
    ? movement
    : { walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false, units: null };
  system.senses = senses && typeof senses === "object"
    ? senses
    : { darkvision: null, blindsight: null, tremorsense: null, truesight: null, units: null, special: "" };
  system.type = creatureType && typeof creatureType === "object"
    ? creatureType
    : { value: "humanoid", subtype: "", swarm: "", custom: "" };

  return {
    kind: "dauligor.race-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    race: { ...item, type: "race" },
    generatedAt: Date.now(),
  };
}
