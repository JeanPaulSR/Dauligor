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
import { buildSpeciesOptionItem, type SpeciesOptionItem } from "./_speciesOptionExport.js";

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
  /** Full option items this species grants (referenced by the ItemGrant
   *  advancements on `race.system.advancement`, matched by
   *  `flags.dauligor-pairing.sourceId`). Empty when none are attached. */
  features: SpeciesOptionItem[];
  generatedAt: number;
}

// Deterministic 16-char advancement id from a seed (mirrors _backgroundExport's
// advId; "spo" = species option).
function advId(seed: string): string {
  const base = ("spo" + seed).replace(/[^a-zA-Z0-9]/g, "");
  return (base + "0000000000000000").slice(0, 16);
}

const RACE_MOVEMENT_DEFAULTS = {
  walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false, units: null,
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

  // Subspecies (migration 20260603-1800): stamp the parent species' dbId onto
  // the pairing flags so the Foundry module can group a parent species with its
  // children. Additive + dbId-based — it matches the parent bundle's
  // `flags.dauligor-pairing.dbId`, needs no extra fetch, and consumers that
  // don't read it are unaffected. Each subspecies still exports as its own
  // stand-alone `race` item; this is metadata only.
  if (row.parentSpeciesId) {
    const pairing = (item.flags as any)?.["dauligor-pairing"];
    if (pairing && typeof pairing === "object") {
      pairing.parentRaceId = String(row.parentSpeciesId);
    }
  }

  // Race-only fields, read from the dedicated table's JSON columns. Overlay
  // stored values onto the dnd5e schema skeleton so every expected key is
  // present (a partial stored object still validates).
  const movement = parseJsonField(row.movement, null);
  const senses = parseJsonField(row.senses, null);
  const creatureType = parseJsonField(row.creatureType, null);

  system.movement = movement && typeof movement === "object"
    ? { ...RACE_MOVEMENT_DEFAULTS, ...movement }
    : { ...RACE_MOVEMENT_DEFAULTS };
  // Stored senses are FLAT ({darkvision,…,units,special}); dnd5e race
  // senses nests the four ranges under `.ranges`. Re-nest on the way out
  // (defensively tolerate an already-nested stored shape too).
  const sensesObj = senses && typeof senses === "object" ? senses : {};
  const sensesRanges = sensesObj.ranges && typeof sensesObj.ranges === "object" ? sensesObj.ranges : sensesObj;
  system.senses = {
    ranges: {
      darkvision: sensesRanges.darkvision ?? null,
      blindsight: sensesRanges.blindsight ?? null,
      tremorsense: sensesRanges.tremorsense ?? null,
      truesight: sensesRanges.truesight ?? null,
    },
    units: sensesObj.units ?? null,
    special: sensesObj.special ?? "",
  };
  // dnd5e RaceData exposes the creature type as `system.type`.
  system.type = creatureType && typeof creatureType === "object"
    ? { ...RACE_TYPE_DEFAULTS, ...creatureType }
    : { ...RACE_TYPE_DEFAULTS };

  // Attached species options (the reusable racial-trait library) → an ItemGrant
  // advancement each (pool references the option's sourceId) plus the full option
  // items embedded in `features[]`, so the module imports + grants them without a
  // second fetch. Mirrors the background owned-features path. A dangling id (an
  // option deleted after attachment) is simply skipped.
  const features: SpeciesOptionItem[] = [];
  const optionIds = parseJsonField(row.speciesOptionIds, []) || [];
  if (Array.isArray(optionIds)) {
    for (const optId of optionIds) {
      try {
        const builtOption = await buildSpeciesOptionItem(String(optId), fetchers);
        if (!builtOption) continue;
        features.push(builtOption.item);
        const grant = {
          _id: advId(`opt-${builtOption.sourceId}`),
          type: "ItemGrant",
          level: 0,
          title: "",
          configuration: {
            choiceType: "feature",
            count: 0,
            pool: [builtOption.sourceId],
            optionalPool: [],
            optional: false,
          },
          value: {},
        };
        system.advancement = system.advancement && typeof system.advancement === "object"
          ? system.advancement
          : {};
        system.advancement[grant._id] = grant;
      } catch { /* skip a dangling / broken option id */ }
    }
  }

  return {
    kind: "dauligor.race-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    race: { ...item, type: "race" },
    features,
    generatedAt: Date.now(),
  };
}
