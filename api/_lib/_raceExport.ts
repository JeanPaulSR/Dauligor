// Builder for the full Foundry-ready race/species item — served by
// `/api/module/races/<dbId>.json`. Parallel to `_featExport.ts`.
//
// Species (the 2024 rename of "Race") now live in their own `species` table
// (migration 20260601-1200), promoted out of the shared `feats` table. The UI
// calls them "Species"; the Foundry export `type` stays "race" for dnd5e
// compatibility. The shared description / advancement / source machinery comes
// from `buildSpeciesBackgroundItem`; this builder layers on the three
// creature-shaped `system` fields the dnd5e RaceData schema adds (verified
// against dnd5e master module/data/item/race.mjs):
//
//   system.movement  — MovementField {walk,fly,swim,climb,burrow,hover,units}
//                       (bonus/special disabled for races)
//   system.senses    — SensesField {darkvision,blindsight,tremorsense,
//                       truesight,units,special}
//   system.type      — CreatureTypeField {value:"humanoid",subtype,swarm,custom}
//                       — the creature type the species confers
//
// dnd5e RaceData mixins: AdvancementTemplate + ItemDescriptionTemplate, plus
// the three fields above. The racial traits themselves are ItemGrant / Size /
// ScaleValue advancements on the `advancements` column.
//
// Storage: read straight from the `species` table's camelCase columns
// (`movement` / `senses` / `creatureType`, all JSON). Defaults below fill any
// missing keys so the exported document validates in Foundry.

import type { ExportFetchers } from "./_classExport.js";
import { buildSpeciesBackgroundItem, parseJsonField } from "./_speciesBackgroundShared.js";

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

const RACE_MOVEMENT_DEFAULTS = {
  walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false, units: null,
};
const RACE_SENSES_DEFAULTS = {
  darkvision: null, blindsight: null, tremorsense: null, truesight: null, units: null, special: "",
};
const RACE_TYPE_DEFAULTS = {
  value: "humanoid", subtype: "", swarm: "", custom: "",
};

/**
 * Build the full Foundry-ready race item bundle for one row.
 * Returns null when no row matches.
 */
export async function buildRaceItemBundle(
  raceId: string,
  fetchers: ExportFetchers,
): Promise<RaceItemBundle | null> {
  const built = await buildSpeciesBackgroundItem("species", raceId, fetchers, {
    foundryType: "race",
    entityKind: "race",
    scalingParentType: "race",
  });
  if (!built) return null;

  const { row, item, sourceId } = built;
  const system = item.system;

  // Race-only fields, read from the dedicated table's JSON columns. Overlay
  // stored values onto the dnd5e schema skeleton so every expected key is
  // present (a partial stored object still validates).
  const movement = parseJsonField(row.movement, null);
  const senses = parseJsonField(row.senses, null);
  const creatureType = parseJsonField(row.creatureType, null);

  system.movement = movement && typeof movement === "object"
    ? { ...RACE_MOVEMENT_DEFAULTS, ...movement }
    : { ...RACE_MOVEMENT_DEFAULTS };
  system.senses = senses && typeof senses === "object"
    ? { ...RACE_SENSES_DEFAULTS, ...senses }
    : { ...RACE_SENSES_DEFAULTS };
  // dnd5e RaceData exposes the creature type as `system.type`.
  system.type = creatureType && typeof creatureType === "object"
    ? { ...RACE_TYPE_DEFAULTS, ...creatureType }
    : { ...RACE_TYPE_DEFAULTS };

  return {
    kind: "dauligor.race-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    race: { ...item, type: "race" },
    generatedAt: Date.now(),
  };
}
