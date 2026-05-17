// Builder for the per-source spell list. Served live by the
// `/api/module/<source>/spells.json` endpoint.
//
// Rationale: the per-class spell list endpoint (`_classSpellList.ts`)
// is curated — it ships only the spells a class can pick. The Foundry
// importer's new Spells page (`DauligorSpellBrowserApp`) browses
// EVERY spell published in a source so the user can import any spell
// onto the actor without a class attachment (lands in the
// "Other Spells" / `__other__` orphan bucket on the Dauligor sheet).
//
// Same lightweight summary shape as `_classSpellList.ts` so the
// browser side can reuse the picker's row + filter + detail
// rendering with no per-summary translation.
//
// Live read with a short HTTP cache (60s, matches the class spell
// list policy). Spell additions / tag edits propagate to the importer
// on the next manager open without a rebake.

import type { ExportFetchers } from "./_classExport.js";
import { getSemanticSourceId } from "./_classExport.js";

const parseJsonField = (val: any, fallback: any) => {
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
 * Same shape as `ClassSpellItem` in `_classSpellList.ts` — the Foundry
 * picker code reads from the `flags.dauligor-pairing` block uniformly
 * regardless of whether the pool came from a per-class fetch or this
 * per-source fetch. Keep these shapes in lockstep.
 */
export interface SourceSpellItem {
  name: string;
  type: "spell";
  img?: string;
  flags: {
    "dauligor-pairing": {
      schemaVersion: 1;
      entityKind: "spell";
      sourceId: string;
      dbId: string;
      // Per-source pool has no class attribution — these spells are
      // browsed independently of any class.
      classSourceId: null;
      level: number;
      school: string;
      spellSourceId: string | null;
      requiredTagIds: string[];
      prerequisiteText: string;
      tagIds: string[];
      activationBucket: string;
      rangeBucket: string;
      durationBucket: string;
      shapeBucket: string;
      componentsVocal: boolean;
      componentsSomatic: boolean;
      componentsMaterial: boolean;
      concentration: boolean;
      ritual: boolean;
    };
  };
}

export interface SourceSpellListBundle {
  kind: "dauligor.source-spell-list.v1";
  schemaVersion: 1;
  sourceId: string;
  sourceSlug: string;
  sourceSemanticId: string;
  spells: SourceSpellItem[];
  generatedAt: number;
}

/**
 * Build the Foundry-ready spell list bundle for one source.
 *
 * Read-through: each call hits D1 with three queries — one to resolve
 * the source slug → row, one to list every spell in that source, and
 * one to resolve `source_id` → semantic id for the response.
 *
 * Returns null when the slug resolves to no row.
 */
export async function buildSourceSpellListBundle(
  sourceSlug: string,
  fetchers: ExportFetchers,
): Promise<SourceSpellListBundle | null> {
  const { fetchCollection } = fetchers;
  const slugLower = String(sourceSlug || "").toLowerCase();
  if (!slugLower) return null;

  // Resolve the URL slug to the D1 source row. The slug can match by
  // `slug`, the row PK `id`, or the semantic id (`source-phb-2014`
  // style) — matches `buildSourceClassCatalog`'s lookup rules so the
  // two endpoints stay symmetric.
  const sourceRows = await fetchCollection<any>("sources", {
    select: "id, slug, abbreviation, name, rules_version",
  });
  const source = sourceRows.find((r: any) => {
    const slug = String(r.slug ?? "").toLowerCase();
    const id = String(r.id ?? "").toLowerCase();
    const semantic = getSemanticSourceId({
      slug: r.slug,
      abbreviation: r.abbreviation,
      rules: r.rules_version || "2014",
    }, r.id).toLowerCase();
    return slug === slugLower || id === slugLower || semantic === slugLower;
  });
  if (!source) return null;

  const sourceId = String(source.id);
  const sourceSemanticId = getSemanticSourceId({
    slug: source.slug,
    abbreviation: source.abbreviation,
    rules: source.rules_version || "2014",
  }, sourceId);

  // Pull every spell published in this source. Same lightweight
  // SELECT as `_classSpellList.ts` — drops `foundry_data`, `effects`,
  // `description` (BBCode), and other large columns; the picker reads
  // from `flags.dauligor-pairing` exclusively. Full payload is
  // fetched on-pick via `/api/module/spells/<dbId>.json`.
  const spellRows = await fetchCollection<any>("spells", {
    where: "source_id = ?",
    params: [sourceId],
    select:
      "id, name, identifier, level, school, image_url, source_id, tags, " +
      "required_tags, prerequisite_text, concentration, ritual, " +
      "activation_bucket, range_bucket, duration_bucket, shape_bucket, " +
      "components_vocal, components_somatic, components_material",
  });

  const spells: SourceSpellItem[] = spellRows.map((row: any) => {
    const requiredTagIds = parseJsonField(row.required_tags, []) || [];
    const tagIds = parseJsonField(row.tags, []) || [];
    return {
      name: String(row.name || ""),
      type: "spell" as const,
      img: row.image_url || undefined,
      flags: {
        "dauligor-pairing": {
          schemaVersion: 1,
          entityKind: "spell",
          sourceId: trimString(row.identifier) || `spell-${row.id}`,
          dbId: String(row.id),
          // Per-source pool: no class attribution by definition.
          classSourceId: null,
          level: Number(row.level || 0),
          school: String(row.school || ""),
          spellSourceId: sourceSemanticId,
          requiredTagIds: Array.isArray(requiredTagIds)
            ? requiredTagIds.map(String)
            : [],
          prerequisiteText: String(row.prerequisite_text || ""),
          tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
          activationBucket: String(row.activation_bucket || "special"),
          rangeBucket: String(row.range_bucket || "special"),
          durationBucket: String(row.duration_bucket || "instant"),
          shapeBucket: String(row.shape_bucket || "none"),
          componentsVocal: Boolean(row.components_vocal),
          componentsSomatic: Boolean(row.components_somatic),
          componentsMaterial: Boolean(row.components_material),
          concentration: Boolean(row.concentration),
          ritual: Boolean(row.ritual),
        },
      },
    };
  });

  // Stable ordering: level asc, then name asc. Matches the public
  // `/compendium/spells` browse order so the importer pool feels
  // consistent with the website.
  spells.sort((a, b) => {
    const la = a.flags["dauligor-pairing"].level;
    const lb = b.flags["dauligor-pairing"].level;
    if (la !== lb) return la - lb;
    return a.name.localeCompare(b.name);
  });

  return {
    kind: "dauligor.source-spell-list.v1",
    schemaVersion: 1,
    sourceId,
    sourceSlug: String(source.slug || ""),
    sourceSemanticId,
    spells,
    generatedAt: Date.now(),
  };
}
