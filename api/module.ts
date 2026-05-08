import path from "node:path";
import fs from "node:fs";
import { executeD1QueryInternal } from "./_lib/d1-internal.js";
import { SERVER_EXPORT_FETCHERS } from "./_lib/d1-fetchers-server.js";
// Sibling-folder import — works fine in Vercel's bundler. The earlier
// attempts at `import ... from "../src/lib/classExport.js"` both crashed
// the function on load with FUNCTION_INVOCATION_FAILED. The server copy of
// classExport.ts lives in api/_lib/_classExport.ts (along with copies of
// _referenceSyntax.ts and _classProgression.ts). Drift management note at
// the top of _classExport.ts.
import { exportClassSemantic, getSemanticSourceId } from "./_lib/_classExport.js";
import {
  classBundleKey,
  MODULE_EXPORT_CACHE_HEADER,
  readBundle,
  sourceClassCatalogKey,
  topLevelCatalogKey,
  writeBundle,
} from "./_lib/module-export-store.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function serveCached(res: any, body: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", MODULE_EXPORT_CACHE_HEADER);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const parseJson = (val: any) => (typeof val === "string" ? JSON.parse(val) : val);

function denormalizeSourceRow(row: any) {
  const data = {
    ...row,
    slug: row.slug,
    abbreviation: row.abbreviation,
    imageUrl: row.image_url,
    rules: row.rules_version || "2014",
    status: row.status || "ready",
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags || []),
  };
  return { id: row.id, ...data, semanticId: getSemanticSourceId(data, row.id) };
}

function denormalizeClassRow(row: any) {
  return {
    id: row.id,
    ...row,
    sourceId: row.source_id,
    hitDie: row.hit_die,
    subclassTitle: row.subclass_title,
    subclassFeatureLevels: parseJson(row.subclass_feature_levels),
    asiLevels: parseJson(row.asi_levels),
    primaryAbility: parseJson(row.primary_ability),
    primaryAbilityChoice: parseJson(row.primary_ability_choice),
    proficiencies: parseJson(row.proficiencies),
    multiclassProficiencies: parseJson(row.multiclass_proficiencies),
    spellcasting: parseJson(row.spellcasting),
    advancements: parseJson(row.advancements),
    excludedOptionIds: parseJson(row.excluded_option_ids),
    uniqueOptionMappings: parseJson(row.unique_option_mappings),
    imageDisplay: parseJson(row.image_display),
    cardDisplay: parseJson(row.card_display),
    previewDisplay: parseJson(row.preview_display),
    tagIds: parseJson(row.tag_ids),
    imageUrl: row.image_url,
    cardImageUrl: row.card_image_url,
    previewImageUrl: row.preview_image_url,
  };
}

function classMatchesSource(cls: any, source: any) {
  const sSlug = (source.slug || "").toLowerCase();
  const sId = String(source.id).toLowerCase();
  const sSemanticId = (source.semanticId || "").toLowerCase();
  const linkIds = [cls.sourceId, cls.sourceBookId, cls.sourceBook].filter(Boolean);
  return linkIds.some((linkId) => {
    const lId = String(linkId).toLowerCase();
    return lId === sId || lId === sSlug || lId === sSemanticId;
  });
}

// ── Builders (live D1) ─────────────────────────────────────────────────────

async function buildTopLevelCatalog() {
  const sourcesRes = await executeD1QueryInternal({ sql: "SELECT * FROM sources" });
  const allSources = (sourcesRes.results || []).map(denormalizeSourceRow);

  // Class counts per source. One narrow GROUP BY query instead of scanning
  // the full classes table — class rows can be wide (lots of JSON columns).
  const countsRes = await executeD1QueryInternal({
    sql: "SELECT source_id, COUNT(*) AS class_count FROM classes GROUP BY source_id",
  });
  const classCountsBySourceId = new Map<string, number>();
  for (const row of countsRes.results || []) {
    classCountsBySourceId.set(String(row.source_id), Number(row.class_count) || 0);
  }

  const entries = allSources
    .filter((s: any) => s.status === "ready" || s.status === "active")
    .map((s: any) => {
      const slug = s.slug || s.id;
      return {
        sourceId: s.semanticId,
        slug,
        name: s.name,
        shortName: s.abbreviation || s.name,
        description: s.description || "",
        coverImage: s.imageUrl || "",
        status: s.status || "ready",
        rules: s.rules || "2014",
        tags: s.tags || [],
        counts: {
          classes: classCountsBySourceId.get(String(s.id)) || 0,
          spells: 0,
          items: 0,
          bestiary: 0,
          journals: 0,
        },
        detailUrl: `${slug}/source.json`,
        classCatalogUrl: `${slug}/classes/catalog.json`,
      };
    });

  return {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "dynamic-d1-library",
    },
    entries,
  };
}

async function buildSourceClassCatalog(sourceSlug: string) {
  // Resolve the source by slug or id. Lower-cased compare matches the
  // pre-existing matching behavior; we still scan all sources because a slug
  // can also match the derived `semanticId` (rare path).
  const sourcesRes = await executeD1QueryInternal({ sql: "SELECT * FROM sources" });
  const allSources = (sourcesRes.results || []).map(denormalizeSourceRow);
  const source = allSources.find((s: any) =>
    (s.slug || "").toLowerCase() === sourceSlug
    || String(s.id).toLowerCase() === sourceSlug
    || (s.semanticId || "").toLowerCase() === sourceSlug
  );
  if (!source) return null;

  // Scoped class fetch — most matches resolve via direct source_id, but the
  // legacy linker also accepts sourceBookId / sourceBook columns. Fall back
  // to a broader scan only if the direct match yields nothing, since for
  // existing rows source_id is the canonical column.
  let classesRes = await executeD1QueryInternal({
    sql: "SELECT * FROM classes WHERE source_id = ?",
    params: [source.id],
  });
  let classes = (classesRes.results || []).map(denormalizeClassRow);
  if (!classes.length) {
    classesRes = await executeD1QueryInternal({ sql: "SELECT * FROM classes" });
    classes = (classesRes.results || [])
      .map(denormalizeClassRow)
      .filter((cls: any) => classMatchesSource(cls, source));
  }

  const entries = classes.map((cls: any) => {
    const identifier = cls.identifier || cls.id;
    return {
      sourceId: `class-${identifier}`,
      name: cls.name,
      type: "class",
      img: cls.imageUrl || "",
      rules: cls.rules || source.rules || "2014",
      description: (cls.description || "").substring(0, 200),
      payloadKind: "dauligor.semantic.class-export",
      payloadUrl: `${identifier}.json`,
    };
  });

  return {
    kind: "dauligor.class-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "class-catalog",
      id: `${source.semanticId}-classes`,
      sourceId: source.semanticId,
    },
    entries,
  };
}

async function buildClassBundleForIdentifier(classIdentifier: string) {
  // One narrow query — no preamble. The export pipeline does its own
  // sub-fetches for refs/subclasses/features/etc. inside `exportClassSemantic`.
  const lookup = classIdentifier.toLowerCase();
  const classesRes = await executeD1QueryInternal({
    sql: "SELECT * FROM classes WHERE LOWER(identifier) = ? OR LOWER(id) = ? LIMIT 1",
    params: [lookup, lookup],
  });
  const row = (classesRes.results || [])[0];
  if (!row) return null;
  return await exportClassSemantic(row.id, SERVER_EXPORT_FETCHERS);
}

// ── Cache-aware wrappers ───────────────────────────────────────────────────

async function getOrBuild<T>(
  key: string,
  build: () => Promise<T | null>,
): Promise<T | null> {
  const cached = await readBundle<T>(key);
  if (cached) return cached;

  const fresh = await build();
  if (fresh) {
    // Fire-and-forget — we don't want a slow R2 write to slow the response,
    // and a write failure shouldn't kill the request.
    writeBundle(key, fresh).catch((error) => {
      console.warn("[module] writeBundle failed (fire-and-forget)", { key, error });
    });
  }
  return fresh;
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url || "", "http://localhost");
  let subpath = urlObj.pathname.replace(/^\/api\/module\/?/, "");

  let cleanSubpath = subpath;
  if (cleanSubpath === "sources" || cleanSubpath === "sources/") {
    cleanSubpath = "";
  } else if (cleanSubpath.startsWith("sources/")) {
    cleanSubpath = cleanSubpath.slice("sources/".length);
  }

  const pathParts = cleanSubpath ? cleanSubpath.split("/") : [];

  try {
    // ── Top-level source catalog ─────────────────────────────────────
    if (!cleanSubpath || cleanSubpath === "catalog.json") {
      const result = await getOrBuild(topLevelCatalogKey(), buildTopLevelCatalog);
      if (result) return serveCached(res, result);
    }

    // ── Per-source class catalog ─────────────────────────────────────
    else if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2] === "catalog.json") {
      const sourceSlug = pathParts[0].toLowerCase();
      const result = await getOrBuild(
        sourceClassCatalogKey(sourceSlug),
        () => buildSourceClassCatalog(sourceSlug),
      );
      if (result) return serveCached(res, result);
    }

    // ── Per-class semantic bundle ────────────────────────────────────
    else if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2].endsWith(".json")) {
      const sourceSlug = pathParts[0].toLowerCase();
      const classIdentifier = pathParts[2].replace(".json", "").toLowerCase();
      const result = await getOrBuild(
        classBundleKey(sourceSlug, classIdentifier),
        () => buildClassBundleForIdentifier(classIdentifier),
      );
      if (result) return serveCached(res, result);
    }
  } catch (error) {
    console.error("Dynamic Module API Error:", error);
  }

  // ── Fallback: serve static fixture files under module/dauligor-pairing ──
  // Static fixtures don't go through the R2 cache — they're already on
  // disk and Vercel's static asset layer handles their caching.
  let filePath = path.join(process.cwd(), "module/dauligor-pairing/data/sources", cleanSubpath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "catalog.json");
  } else if (!filePath.endsWith(".json")) {
    if (fs.existsSync(filePath + ".json")) {
      filePath = filePath + ".json";
    } else if (fs.existsSync(path.join(filePath, "catalog.json"))) {
      filePath = path.join(filePath, "catalog.json");
    }
  }

  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "application/json");
    return res.end(fs.readFileSync(filePath, "utf-8"));
  }

  res.statusCode = 404;
  return res.end(JSON.stringify({ error: `Source not found at: ${subpath}` }));
}
