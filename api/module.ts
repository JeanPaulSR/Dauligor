import path from "node:path";
import fs from "node:fs";
import { executeD1QueryInternal } from "./_lib/d1-internal.js";
import { SERVER_EXPORT_FETCHERS } from "./_lib/d1-fetchers-server.js";
// Cross-folder import into `src/lib/`. This works because classExport.ts no
// longer references `./d1` at runtime — `exportClassSemantic` takes its
// fetchers as a required parameter, so Vercel's serverless bundler doesn't
// pull firebase or its JSON config into the api function. The previous
// attempt used a `getDefaultExportFetchers()` helper with `await import('./d1')`
// inside it; the bundler statically traced that and crashed the function on
// load when the firebase config wasn't included in the bundle.
import {
  getSemanticSourceId,
  exportClassSemantic,
} from "../src/lib/classExport.js";

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

  try {
    // 1. Fetch all sources from D1 and calculate semantic IDs.
    const sourcesRes = await executeD1QueryInternal({ sql: "SELECT * FROM sources" });
    const allSources = (sourcesRes.results || []).map((s: any) => {
      const data = {
        ...s,
        slug: s.slug,
        abbreviation: s.abbreviation,
        imageUrl: s.image_url,
        rules: s.rules_version || "2014",
        status: s.status || "ready",
        tags: typeof s.tags === "string" ? JSON.parse(s.tags) : (s.tags || []),
      };
      return { id: s.id, ...data, semanticId: getSemanticSourceId(data, s.id) };
    });

    // 2. Fetch all classes from D1, with the JSON columns parsed and
    // snake_case fields aliased to the camelCase the Foundry contract uses.
    const classesRes = await executeD1QueryInternal({ sql: "SELECT * FROM classes" });
    const parse = (val: any) => (typeof val === "string" ? JSON.parse(val) : val);
    const allClasses = (classesRes.results || []).map((c: any) => ({
      id: c.id,
      ...c,
      sourceId: c.source_id,
      hitDie: c.hit_die,
      subclassTitle: c.subclass_title,
      subclassFeatureLevels: parse(c.subclass_feature_levels),
      asiLevels: parse(c.asi_levels),
      primaryAbility: parse(c.primary_ability),
      primaryAbilityChoice: parse(c.primary_ability_choice),
      proficiencies: parse(c.proficiencies),
      multiclassProficiencies: parse(c.multiclass_proficiencies),
      spellcasting: parse(c.spellcasting),
      advancements: parse(c.advancements),
      excludedOptionIds: parse(c.excluded_option_ids),
      uniqueOptionMappings: parse(c.unique_option_mappings),
      imageDisplay: parse(c.image_display),
      cardDisplay: parse(c.card_display),
      previewDisplay: parse(c.preview_display),
      tagIds: parse(c.tag_ids),
      imageUrl: c.image_url,
      cardImageUrl: c.card_image_url,
      previewImageUrl: c.preview_image_url,
    }));

    // 3. Group classes by source.
    const sourceToClasses = new Map<string, any[]>();
    allClasses.forEach((cls: any) => {
      const linkIds = new Set([cls.sourceId, cls.sourceBookId, cls.sourceBook].filter(Boolean));
      const matchingSource = allSources.find((s: any) => {
        const sSlug = (s.slug || "").toLowerCase();
        const sId = String(s.id).toLowerCase();
        const sSemanticId = (s.semanticId || "").toLowerCase();
        return Array.from(linkIds).some((linkId) => {
          const lId = String(linkId).toLowerCase();
          return lId === sId || lId === sSlug || lId === sSemanticId;
        });
      });
      if (matchingSource) {
        if (!sourceToClasses.has(matchingSource.id)) sourceToClasses.set(matchingSource.id, []);
        sourceToClasses.get(matchingSource.id)!.push(cls);
      }
    });

    // ── Source Library catalog (top-level catalog.json) ─────────────────────
    if (!cleanSubpath || cleanSubpath === "catalog.json") {
      const entries = allSources
        .filter((s: any) => s.status === "ready" || s.status === "active")
        .map((s: any) => {
          const slug = s.slug || s.id;
          const classes = sourceToClasses.get(s.id) || [];
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
              classes: classes.length,
              spells: 0,
              items: 0,
              bestiary: 0,
              journals: 0,
            },
            detailUrl: `${slug}/source.json`,
            classCatalogUrl: `${slug}/classes/catalog.json`,
          };
        });

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        kind: "dauligor.source-catalog.v1",
        schemaVersion: 1,
        source: {
          system: "dauligor",
          entity: "source-catalog",
          id: "dynamic-d1-library",
        },
        entries,
      }));
    }

    const pathParts = cleanSubpath.split("/");

    // ── Class catalog for a source (<slug>/classes/catalog.json) ────────────
    if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2] === "catalog.json") {
      const sourceSlug = pathParts[0].toLowerCase();
      const source = allSources.find((s: any) =>
        (s.slug || "").toLowerCase() === sourceSlug
        || String(s.id).toLowerCase() === sourceSlug
        || (s.semanticId || "").toLowerCase() === sourceSlug
      );

      if (source) {
        const classes = sourceToClasses.get(source.id) || [];
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

        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({
          kind: "dauligor.class-catalog.v1",
          schemaVersion: 1,
          source: {
            system: "dauligor",
            entity: "class-catalog",
            id: `${source.semanticId}-classes`,
            sourceId: source.semanticId,
          },
          entries,
        }));
      }
    }

    // ── Specific class payload (<slug>/classes/<identifier>.json) ───────────
    // The catalog above advertises payloadKind="dauligor.semantic.class-export",
    // so this MUST return the full bundle: class + subclasses + features +
    // scalingColumns + uniqueOptionGroups + uniqueOptionItems + spell scalings
    // + source. exportClassSemantic does the orchestration; SERVER_EXPORT_FETCHERS
    // wraps executeD1QueryInternal so it works without a Firebase JWT.
    if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2].endsWith(".json")) {
      const classIdentifier = pathParts[2].replace(".json", "").toLowerCase();
      const cls = allClasses.find((c: any) =>
        (c.identifier || "").toLowerCase() === classIdentifier
        || String(c.id).toLowerCase() === classIdentifier
      );
      if (cls) {
        const bundle = await exportClassSemantic(cls.id, SERVER_EXPORT_FETCHERS);
        if (bundle) {
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(bundle));
        }
      }
    }
  } catch (error) {
    console.error("Dynamic Module API Error:", error);
  }

  // ── Fallback: serve static fixture files under module/dauligor-pairing ──
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
