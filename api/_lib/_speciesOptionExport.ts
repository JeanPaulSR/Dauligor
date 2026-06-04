// Builder for a species OPTION item — served by
// `/api/module/species-options/<dbId>.json`, and embedded inline in a species
// (race) bundle's `features[]` (see `_raceExport`).
//
// Species options are the reusable racial-trait library (Darkvision, Powerful
// Build, …) that `species_features` was consolidated into. dnd5e models a
// granted racial trait as a `feat`-type Item whose `system.type.value = "race"`
// (the same way a class feature is a `feat` item with type.value = "class", and
// a background feature uses "background"). A species grants each attached option
// via an `ItemGrant` advancement on the race item (see `_raceExport`).
//
// Rows come from `species_options` (migration 20260603-1600). camelCase columns;
// the JSON ones (advancements / activities / effects / uses / tags) are
// `parseJsonField`'d server-side (the server fetcher path doesn't auto-parse).

import type { ExportFetchers } from "./_classExport.js";
import { getSemanticSourceId } from "./_classExport.js";
import { bbcodeToHtml } from "./_bbcode.js";
import { parseJsonField } from "./_speciesBackgroundShared.js";

const trimString = (val: any) => String(val ?? "").trim();

function arrayToFoundryMap(entries: any): Record<string, any> {
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    return entries as Record<string, any>;
  }
  const list = Array.isArray(entries) ? entries : [];
  const map: Record<string, any> = {};
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] ?? {};
    const id = trimString(entry?._id);
    map[id || `adv${String(i).padStart(14, "0")}`] = entry;
  }
  return map;
}

export interface SpeciesOptionItem {
  name: string;
  type: "feat";
  img?: string;
  system: Record<string, any>;
  effects: unknown[];
  flags: Record<string, any>;
}

export interface SpeciesOptionItemBundle {
  kind: "dauligor.species-option-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  option: SpeciesOptionItem;
  generatedAt: number;
}

/**
 * Build the Foundry feat item for one `species_options` row. Returns
 * `{ row, item, sourceId }` so callers can embed the item + reference it by
 * `sourceId` in an ItemGrant pool. Null when no row matches.
 */
export async function buildSpeciesOptionItem(
  optionId: string,
  fetchers: ExportFetchers,
): Promise<{ row: any; item: SpeciesOptionItem; sourceId: string } | null> {
  const { fetchDocument } = fetchers;
  const row: any = await fetchDocument<any>("species_options", optionId);
  if (!row) return null;

  const advancements = parseJsonField(row.advancements, []) || [];
  const activities = parseJsonField(row.activities, []) || [];
  const effects = parseJsonField(row.effects, []) || [];
  const uses = parseJsonField(row.uses, {}) || {};
  const tagIds = parseJsonField(row.tags, []) || [];
  const identifier = trimString(row.identifier) || `option-${row.id}`;

  let sourceBook = "";
  let sourceRulesVersion = "2014";
  let sourceSemanticId: string | null = null;
  if (row.sourceId) {
    const sourceRow: any = await fetchDocument<any>("sources", String(row.sourceId));
    if (sourceRow) {
      sourceBook = String(sourceRow.abbreviation || sourceRow.name || "");
      sourceRulesVersion = String(sourceRow.rules_version || "2014");
      sourceSemanticId = getSemanticSourceId({
        slug: sourceRow.slug,
        abbreviation: sourceRow.abbreviation,
        rules: sourceRow.rules_version || "2014",
      }, sourceRow.id);
    } else {
      sourceSemanticId = String(row.sourceId);
    }
  }

  const descriptionBbcode = trimString(row.description);
  const descriptionHtml = descriptionBbcode ? bbcodeToHtml(descriptionBbcode) : "";

  const system: Record<string, any> = {
    // A racial trait is a `feat` item with system.type.value = "race".
    type: { value: "race", subtype: "" },
    identifier,
    description: { value: descriptionHtml, chat: "" },
    requirements: "",
    properties: [],
    uses: {
      max: trimString((uses as any).max),
      spent: Number((uses as any).spent || 0),
      recovery: Array.isArray((uses as any).recovery) ? (uses as any).recovery : [],
    },
    activities: arrayToFoundryMap(activities),
    advancement: arrayToFoundryMap(advancements),
    prerequisites: { items: [], repeatable: false },
    source: {
      book: sourceBook,
      page: trimString(row.page),
      rules: sourceRulesVersion,
      revision: 1,
      custom: "",
      license: "",
    },
    crewed: false,
    enchant: {},
  };

  const item: SpeciesOptionItem = {
    name: String(row.name || ""),
    type: "feat",
    img: row.imageUrl || undefined,
    system,
    effects: Array.isArray(effects) ? effects : [],
    flags: {
      "dauligor-pairing": {
        schemaVersion: 1,
        entityKind: "species-option",
        // `sourceId` here is the ENTITY identifier slug (the importer's match
        // key + the ItemGrant pool key), not the book — same convention as the
        // other exporters.
        sourceId: identifier,
        dbId: String(row.id),
        sourceType: "feat",
        featType: "race",
        featSubtype: "",
        featSpellSourceId: sourceSemanticId,
        tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
      },
    },
  };

  return { row, item, sourceId: identifier };
}

/** Bundle wrapper for the per-option endpoint. */
export async function buildSpeciesOptionItemBundle(
  optionId: string,
  fetchers: ExportFetchers,
): Promise<SpeciesOptionItemBundle | null> {
  const built = await buildSpeciesOptionItem(optionId, fetchers);
  if (!built) return null;
  return {
    kind: "dauligor.species-option-item.v1",
    schemaVersion: 1,
    dbId: String(built.row.id),
    sourceId: built.sourceId,
    option: built.item,
    generatedAt: Date.now(),
  };
}
