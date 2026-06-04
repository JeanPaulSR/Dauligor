// Shared Foundry-item builder for the dedicated `species` + `backgrounds`
// tables (migration 20260601-1200). Both export as feat-shaped Foundry items
// (description + advancement + source machinery) that differ only in the
// Foundry `type` they stamp and a few type-specific `system` fields layered on
// by the per-kind exporter (`_raceExport` / `_backgroundExport`).
//
// Why this isn't `buildFeatLikeItem`: that builder is hardwired to
// `fetchDocument("feats", id)` and reads ~20 feat-only snake_case columns
// (feat_type, uses_*, activities, repeatable, source_type, …). The species /
// backgrounds tables carry a leaner, **camelCase** column set, so they get
// their own builder rather than threading a dozen defaults through the feat
// path.
//
// SERVER-SIDE JSON NOTE: the client `queryD1` (src/lib/d1.ts) auto-parses JSON
// columns, but the server `ExportFetchers` path does NOT — JSON columns arrive
// as raw strings here. So every JSON column is run through `parseJsonField`,
// same as `_featExport`/`_classExport`.

import type { ExportFetchers } from "./_classExport.js";
import {
  getSemanticSourceId,
  denormalizeScalingColumnRow,
  normalizeScaleValueAdvancement,
} from "./_classExport.js";
import { bbcodeToHtml } from "./_bbcode.js";

export const parseJsonField = (val: any, fallback: any) => {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const trimString = (val: any) => String(val ?? "").trim();

/**
 * Coerce an advancement array into dnd5e's keyed-object map shape
 * (`{ "<_id>": Advancement, ... }`). Mirrors `_featExport.arrayToFoundryMap`
 * — preserves `_id` keys when present so a round-trip stays stable.
 */
function arrayToFoundryMap(entries: any): Record<string, any> {
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    return entries as Record<string, any>;
  }
  const list = Array.isArray(entries) ? entries : [];
  const map: Record<string, any> = {};
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] ?? {};
    const id = trimString(entry?._id);
    const key = id || `adv${String(i).padStart(14, "0")}`;
    map[key] = entry;
  }
  return map;
}

export interface SpeciesBackgroundLikeItem {
  name: string;
  type: string;
  img?: string;
  system: Record<string, any>;
  effects: unknown[];
  flags: Record<string, any>;
}

export interface BuildSpeciesBackgroundOptions {
  /** Foundry Item `type` to stamp — "race" or "background". */
  foundryType: string;
  /** `flags.dauligor-pairing.entityKind`. */
  entityKind: string;
  /** `scaling_columns.parent_type` owner key — "race" or "background". */
  scalingParentType: string;
}

/**
 * Build the shared species/background-shaped Foundry item from a row in the
 * given table. Returns `{ row, item, sourceId }` (NOT the bundle envelope) so
 * the per-kind exporter can wrap it and extend `system` with its own fields.
 * Returns null when no row matches.
 */
export async function buildSpeciesBackgroundItem(
  collection: string,
  rowId: string,
  fetchers: ExportFetchers,
  opts: BuildSpeciesBackgroundOptions,
): Promise<{ row: any; item: SpeciesBackgroundLikeItem; sourceId: string } | null> {
  const { fetchDocument, fetchCollection } = fetchers;
  const row: any = await fetchDocument<any>(collection, rowId);
  if (!row) return null;

  const advancementsArr = parseJsonField(row.advancements, []) || [];
  const tagIds = parseJsonField(row.tags, []) || [];

  // Scaling columns this row owns (parent_type = "race" | "background").
  // ScaleValue advancements (e.g. Dragonborn breath dice) normalize against
  // them so `@scale.<identifier>.<column>` resolves in Foundry.
  let scalingColumnsRaw: any[] = [];
  try {
    const rows = await fetchCollection<any>("scaling_columns", {
      where: "parent_id = ? AND parent_type = ?",
      params: [String(row.id), opts.scalingParentType],
      orderBy: "name ASC",
    });
    scalingColumnsRaw = (rows || []).map(denormalizeScalingColumnRow);
  } catch {
    scalingColumnsRaw = [];
  }
  const scalingById = Object.fromEntries(
    scalingColumnsRaw.map((column) => [column.id, column]),
  );

  const normalizedAdvancements = (Array.isArray(advancementsArr) ? advancementsArr : []).map(
    (adv: any) => {
      if (!adv || typeof adv !== "object") return adv;
      if (trimString(adv.type) === "ScaleValue") {
        return normalizeScaleValueAdvancement(adv, scalingById) || adv;
      }
      return adv;
    },
  );

  const identifier = trimString(row.identifier) || `${opts.foundryType}-${row.id}`;

  // Resolve the source FK → semantic id + book/rules for the source block.
  // Best-effort: a stale FK doesn't break the bundle.
  let sourceSemanticId: string | null = null;
  let sourceBook = "";
  let sourceRulesVersion = "2014";
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

  // Description: authored BBCode → HTML. Mirrors the feat/spell export.
  const descriptionBbcode = trimString(row.description);
  const descriptionHtml = descriptionBbcode ? bbcodeToHtml(descriptionBbcode) : "";

  const system: Record<string, any> = {
    identifier,
    description: {
      value: descriptionHtml,
      chat: "",
    },
    // dnd5e expects a keyed-object map for advancement.
    advancement: arrayToFoundryMap(normalizedAdvancements),
    source: {
      book: sourceBook,
      page: trimString(row.page),
      rules: sourceRulesVersion,
      revision: 1,
      custom: "",
      license: "",
    },
  };

  const item: SpeciesBackgroundLikeItem = {
    name: String(row.name || ""),
    type: opts.foundryType,
    img: row.imageUrl || undefined,
    system,
    // The dedicated tables don't carry top-level ActiveEffects yet; ship an
    // empty array so the imported document validates. (Add an `effects`
    // column + UI in a follow-up if hand-authored effects are needed.)
    effects: [],
    flags: {
      "dauligor-pairing": {
        schemaVersion: 1,
        entityKind: opts.entityKind,
        // `sourceId` here is the ENTITY identifier slug (the importer's match
        // key), not the book — same convention as `_featExport`.
        sourceId: identifier,
        dbId: String(row.id),
        sourceType: opts.foundryType,
        // Preserve the feat-export flag keys so any consumer keyed on them
        // keeps working; for these tables featType == the Foundry type and
        // there's no subtype.
        featType: opts.foundryType,
        featSubtype: "",
        featSpellSourceId: sourceSemanticId,
        tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
      },
    },
  };

  return { row, item, sourceId: identifier };
}
