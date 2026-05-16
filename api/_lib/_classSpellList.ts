// Builder for the per-class curated spell list. Served live by the
// `/api/module/<source>/classes/<class>/spells.json` endpoint — NOT
// baked into R2 like the class bundle.
//
// Rationale: spell-list changes (manual curation and rule-driven
// recompute on spell tag edits) used to require a full class rebake
// to make the new pool visible on the Foundry side, because
// `classSpellItems` shipped INSIDE the class bundle. That coupling
// meant a one-spell tag edit had to fan out to a class rebake even
// when nothing else about the class had changed.
//
// Now the spell list has its own endpoint with a short HTTP cache
// (60s), so:
//   - Spell tag changes flow through immediately (next class import
//     re-fetches and gets the new pool).
//   - Class rebake is decoupled from spell-list churn — the bundle
//     stays stable until you actually edit the class itself.
//   - The endpoint is a thin D1 JOIN, no R2 cache, no warming step.

import type { ExportFetchers } from "./_classExport.js";

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
 * Lightweight summary of one spell in a class's curated list.
 *
 * Intentionally OMITS the heavy `system` block (description,
 * activities, etc.) and `effects`. The Foundry importer uses these
 * summaries for the picker's row render, filter chips, and budget
 * logic. When the user picks a spell, the embed phase fetches the
 * full item from `/api/module/spells/<dbId>.json` before writing it
 * to the actor.
 *
 * Size: ~800 bytes per spell vs ~3-5 KB for the full item. Typical
 * 37-spell pool drops from 141 KB → ~30 KB (~78% reduction). Larger
 * pools (200+ spells) save proportionally more.
 *
 * Filter parity with `/compendium/spells`: the bucket fields below
 * (`activationBucket`, `rangeBucket`, `durationBucket`, `shapeBucket`,
 * `componentsVocal/Somatic/Material`) match every facet the public
 * spell browser ships filter chips for. The importer's picker can
 * therefore offer the same chip set without re-fetching full data.
 *
 * Every field consumed by `runSpellSelectionStep` and the embed
 * loop's "find by sourceId" pass is preserved — the only change
 * downstream is the embed step needing one fetch per picked spell.
 */
export interface ClassSpellItem {
  name: string;
  /** Always "spell" — kept so downstream typeguard checks pass. */
  type: "spell";
  /** Image URL for the picker row icon. Tiny string; kept inline. */
  img?: string;
  /**
   * Flags carry every field the picker reads. Identity fields
   * (sourceId, dbId, classSourceId), display + grouping fields
   * (level, school, spellSourceId for the source badge), filter
   * facets identical to /compendium/spells (activation/range/
   * duration/shape buckets + V/S/M component flags + ritual +
   * concentration), and prereq metadata (requiredTagIds +
   * prerequisiteText + tagIds).
   */
  flags: {
    "dauligor-pairing": {
      schemaVersion: 1;
      entityKind: "spell";
      sourceId: string;
      dbId: string;
      classSourceId: string | null;
      level: number;
      school: string;
      spellSourceId: string | null;
      requiredTagIds: string[];
      prerequisiteText: string;
      tagIds: string[];
      // Filter facets — mirrors src/lib/spellFilters.ts buckets.
      // These are pre-computed columns on the `spells` table (see
      // worker/migrations/20260514-2200_spells_bucket_columns.sql)
      // and kept in sync by `upsertSpell` / `upsertSpellBatch` so
      // we never need to parse foundry_data on the picker side.
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

export interface ClassSpellListBundle {
  kind: "dauligor.class-spell-list.v1";
  schemaVersion: 1;
  classId: string;
  classIdentifier: string;
  classSourceId: string | null;
  spells: ClassSpellItem[];
  generatedAt: number;
}

/**
 * Build the Foundry-ready spell list bundle for a single class.
 *
 * Read-through: each call hits D1 with two queries — one for the
 * `class_spell_lists` membership rows, one for the matching `spells`
 * rows. No R2 cache. The HTTP response is short-cached via the
 * `Cache-Control` header set by the route handler.
 *
 * Returns null when the class id resolves to no row.
 */
export async function buildClassSpellListBundle(
  classId: string,
  fetchers: ExportFetchers,
): Promise<ClassSpellListBundle | null> {
  const { fetchCollection, fetchDocument } = fetchers;

  const classRow = await fetchDocument<any>("classes", classId);
  if (!classRow) return null;

  const classIdentifier = trimString(classRow.identifier) || classRow.id;
  const classSourceId = trimString(classRow.source_id) || null;

  // Membership rows for this class. Both manual + rule-driven entries
  // ship — the Foundry importer doesn't distinguish source on the
  // pool side (it's all "available to pick"). The `membership_source`
  // is included on each item flag for debugging / future filtering.
  const cslRows = await fetchCollection<any>("classSpellLists", {
    where: "class_id = ?",
    params: [classId],
  });
  const classSpellIds = [
    ...new Set(cslRows.map((r: any) => r.spell_id).filter(Boolean)),
  ] as string[];

  if (classSpellIds.length === 0) {
    return {
      kind: "dauligor.class-spell-list.v1",
      schemaVersion: 1,
      classId,
      classIdentifier,
      classSourceId,
      spells: [],
      generatedAt: Date.now(),
    };
  }

  // Lightweight SELECT — only fields needed for picker rows + filter
  // chips + the dbId / sourceId the embed phase uses to fetch the
  // full item. Deliberately drops `foundry_data` (the system block),
  // `effects`, and any large descriptive columns. The full spell is
  // fetched on demand via `/api/module/spells/<dbId>.json`.
  //
  // The bucket columns (activation/range/duration/shape) and
  // component flags (vocal/somatic/material) ARE included — they're
  // small precomputed scalars kept in sync by `upsertSpell` /
  // `upsertSpellBatch` and give the picker filter parity with the
  // app's `/compendium/spells` browser.
  const spellRows = await fetchCollection<any>("spells", {
    where: `id IN (${classSpellIds.map(() => "?").join(",")})`,
    params: classSpellIds,
    select:
      "id, name, identifier, level, school, image_url, source_id, tags, " +
      "required_tags, prerequisite_text, concentration, ritual, " +
      "activation_bucket, range_bucket, duration_bucket, shape_bucket, " +
      "components_vocal, components_somatic, components_material",
  });

  const spells: ClassSpellItem[] = spellRows.map((row: any) => {
    const requiredTagIds = parseJsonField(row.required_tags, []) || [];
    const tagIds = parseJsonField(row.tags, []) || [];
    return {
      name: String(row.name || ""),
      type: "spell" as const,
      img: row.image_url || undefined,
      // NOTE: no `system` field and no `effects` array. The Foundry
      // importer's picker reads from flags below; the embed phase
      // fetches the full item from `/api/module/spells/<dbId>.json`
      // before writing to the actor.
      flags: {
        "dauligor-pairing": {
          schemaVersion: 1,
          entityKind: "spell",
          // sourceId is the stable identifier the importer keys
          // against when checking "does this actor already have this
          // spell?". Prefer the slug identifier, fall back to the DB
          // id with a `spell-` prefix so it's never numeric-looking.
          sourceId: trimString(row.identifier) || `spell-${row.id}`,
          dbId: String(row.id),
          classSourceId,
          level: Number(row.level || 0),
          school: String(row.school || ""),
          spellSourceId: row.source_id || null,
          requiredTagIds: Array.isArray(requiredTagIds)
            ? requiredTagIds.map(String)
            : [],
          prerequisiteText: String(row.prerequisite_text || ""),
          tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
          // Filter facets (bucket values match `src/lib/spellFilters.ts`
          // bucket constants). Default to "special"/"other"/"none" so
          // the chips still bucket legacy rows whose bucket column
          // didn't backfill (foundry_data was NULL at migration time).
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

  return {
    kind: "dauligor.class-spell-list.v1",
    schemaVersion: 1,
    classId,
    classIdentifier,
    classSourceId,
    spells,
    generatedAt: Date.now(),
  };
}

/**
 * Identifier-keyed convenience for the HTTP route. The URL ships a
 * class identifier (e.g. `wizard`), not a UUID. This resolves
 * identifier → class row → calls `buildClassSpellListBundle`.
 *
 * Lowercase match on both `identifier` and `id` columns to match the
 * pattern `module-export-pipeline.ts:buildClassBundleForIdentifier`
 * uses. Returns null when no class matches.
 */
export async function buildClassSpellListByIdentifier(
  classIdentifier: string,
  fetchers: ExportFetchers,
): Promise<ClassSpellListBundle | null> {
  const lookup = classIdentifier.toLowerCase();
  // We avoid using fetchers.fetchCollection here because the WHERE
  // clause needs LOWER() on both columns and that's awkward to
  // express through the param-shaping helper. Go direct with the
  // server-side internal query.
  const { executeD1QueryInternal } = await import("./d1-internal.js");
  const res = await executeD1QueryInternal({
    sql: "SELECT id FROM classes WHERE LOWER(identifier) = ? OR LOWER(id) = ? LIMIT 1",
    params: [lookup, lookup],
  });
  const row = (res.results || [])[0] as { id?: string } | undefined;
  if (!row?.id) return null;
  return buildClassSpellListBundle(row.id, fetchers);
}
