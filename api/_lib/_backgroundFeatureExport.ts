// Builder for a background-granted FEATURE item — served by
// `/api/module/background-features/<dbId>.json`, and embedded inline in a
// background bundle's `features[]` (see `_backgroundExport`).
//
// dnd5e models a background's special feature as a `feat`-type Item whose
// `system.type.value = "background"` (the same way a class feature is a `feat`
// item with `system.type.value = "class"`). A background grants it via an
// `ItemGrant` advancement on the background item.
//
// Rows come from `background_features` (migration 20260601-1400 + the
// `parentBackgroundId` owner column, 20260602-1500). camelCase columns; the
// JSON ones (advancements / activities / effects / uses / tags) are
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

export interface BackgroundFeatureItem {
  name: string;
  type: "feat";
  img?: string;
  system: Record<string, any>;
  effects: unknown[];
  flags: Record<string, any>;
}

export interface BackgroundFeatureItemBundle {
  kind: "dauligor.background-feature-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  feature: BackgroundFeatureItem;
  generatedAt: number;
}

/**
 * Build the Foundry feature item for one `background_features` row. Returns
 * `{ row, item, sourceId }` so callers can embed the item + reference it by
 * `sourceId` in an ItemGrant pool. Null when no row matches.
 */
export async function buildBackgroundFeatureItem(
  featureId: string,
  fetchers: ExportFetchers,
): Promise<{ row: any; item: BackgroundFeatureItem; sourceId: string } | null> {
  const { fetchDocument } = fetchers;
  const row: any = await fetchDocument<any>("background_features", featureId);
  if (!row) return null;

  const advancements = parseJsonField(row.advancements, []) || [];
  const activities = parseJsonField(row.activities, []) || [];
  const effects = parseJsonField(row.effects, []) || [];
  const uses = parseJsonField(row.uses, {}) || {};
  const tagIds = parseJsonField(row.tags, []) || [];
  const identifier = trimString(row.identifier) || `feature-${row.id}`;

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
    type: { value: "background", subtype: "" },
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

  const item: BackgroundFeatureItem = {
    name: String(row.name || ""),
    type: "feat",
    img: row.imageUrl || undefined,
    system,
    effects: Array.isArray(effects) ? effects : [],
    flags: {
      "dauligor-pairing": {
        schemaVersion: 1,
        entityKind: "background-feature",
        sourceId: identifier,
        dbId: String(row.id),
        sourceType: "feat",
        featType: "background",
        featSubtype: "",
        featSpellSourceId: sourceSemanticId,
        parentBackgroundId: row.parentBackgroundId ? String(row.parentBackgroundId) : null,
        tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
      },
    },
  };

  return { row, item, sourceId: identifier };
}

/** Bundle wrapper for the per-feature endpoint. */
export async function buildBackgroundFeatureItemBundle(
  featureId: string,
  fetchers: ExportFetchers,
): Promise<BackgroundFeatureItemBundle | null> {
  const built = await buildBackgroundFeatureItem(featureId, fetchers);
  if (!built) return null;
  return {
    kind: "dauligor.background-feature-item.v1",
    schemaVersion: 1,
    dbId: String(built.row.id),
    sourceId: built.sourceId,
    feature: built.item,
    generatedAt: Date.now(),
  };
}
