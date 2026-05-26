// Builder for the per-source feat list. Served live by the
// `/api/module/<source>/feats.json` endpoint.
//
// Parallel to `_sourceSpellList.ts` — the Foundry importer's Feat
// Browser browses every feat published in a source so the user can
// import any feat onto the actor without a class attachment.
//
// Same lightweight summary shape philosophy as the spell list: the
// picker reads from `flags.dauligor-pairing` and the heavy `system`
// block (advancements, activities, effects, full description) is
// fetched on-pick from `/api/module/feats/<dbId>.json`.
//
// Live read with a short HTTP cache (60s, matches the spell list
// policy). Feat additions / tag edits propagate on the next browser
// open without a rebake.

import type { ExportFetchers } from "./_classExport.js";
import { getSemanticSourceId } from "./_classExport.js";
import {
  collectFeatRequirementReferences,
  buildFeatRequirementLookup,
  renderFeatRequirementText,
} from "./_featRequirements.js";

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
 * Lightweight feat summary — analogous to `SourceSpellItem` in
 * `_sourceSpellList.ts`. The picker reads from the
 * `flags.dauligor-pairing` block; the full `system` block is fetched
 * on-pick from the per-feat endpoint. Keep this shape in lockstep with
 * what the Foundry feat browser expects.
 */
export interface SourceFeatItem {
  name: string;
  type: "feat";
  img?: string;
  flags: {
    "dauligor-pairing": {
      schemaVersion: 1;
      entityKind: "feat";
      sourceId: string;
      dbId: string;
      // Whether the feat is a class-feature variant. Derived from the
      // `source_type` column ('classFeature' / 'subclassFeature' /
      // 'feat'). Surfaced separately from `featType` so the importer
      // can flag class-feature picks distinctly even though Foundry
      // stores both as `type: "feat"` items.
      featSourceType: string;
      featType: string;
      featSubtype: string;
      featSpellSourceId: string | null;
      repeatable: boolean;
      hasUses: boolean;
      hasActivities: boolean;
      hasEffects: boolean;
      hasAdvancements: boolean;
      hasPrereqs: boolean;
      // Short prereq text from the feats.requirements column. Shipped
      // in the summary so the picker's detail pane can render the
      // "Prerequisites: …" line without a per-feat full fetch. Empty
      // string when the feat has no requirements.
      requirements: string;
      tagIds: string[];
    };
  };
}

export interface SourceFeatListBundle {
  kind: "dauligor.source-feat-list.v1";
  schemaVersion: 1;
  sourceId: string;
  sourceSlug: string;
  sourceSemanticId: string;
  feats: SourceFeatItem[];
  generatedAt: number;
}

/**
 * Build the Foundry-ready feat list bundle for one source.
 *
 * Returns null when the slug resolves to no source row.
 */
export async function buildSourceFeatListBundle(
  sourceSlug: string,
  fetchers: ExportFetchers,
): Promise<SourceFeatListBundle | null> {
  const { fetchCollection } = fetchers;
  const slugLower = String(sourceSlug || "").toLowerCase();
  if (!slugLower) return null;

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

  // Pull every feat published in this source. Lightweight SELECT
  // mirroring `_sourceSpellList.ts` — drops the heavy description
  // (BBCode), the activities array, effects array, and advancements.
  // The picker only needs name + img + the flag projection below.
  const featRows = await fetchCollection<any>("feats", {
    where: "source_id = ?",
    params: [sourceId],
    select:
      "id, name, identifier, feat_type, feat_subtype, source_type, " +
      "image_url, source_id, tags, requirements, requirements_tree, " +
      "repeatable, uses_max, uses_spent, activities, effects, advancements",
  });

  // One pass to collect referenced entity IDs across every feat's
  // `requirements_tree`, then one batched fetch per leaf-type to
  // populate the name lookup. The structured `formatRequirementText`
  // pipeline is the same one /compendium/feats and the Modular Option
  // editor use — so the picker reads the prereqs identically to the
  // authoring surface (entity names, not "<unknown class>" placeholders).
  const requirementRefs = collectFeatRequirementReferences(featRows);
  const requirementLookup = await buildFeatRequirementLookup(fetchers, requirementRefs);

  const feats: SourceFeatItem[] = featRows.map((row: any) => {
    const tagIds = parseJsonField(row.tags, []) || [];
    // `activities` / `effects` / `advancements` auto-parse via the JSON
    // column allow-list in `d1-fetchers-server.ts`. Tolerate both
    // parsed-array and stringly-typed inputs in case the allow-list
    // diverges in the future.
    const activities = Array.isArray(row.activities)
      ? row.activities
      : parseJsonField(row.activities, []) || [];
    const effects = Array.isArray(row.effects)
      ? row.effects
      : parseJsonField(row.effects, []) || [];
    const advancements = Array.isArray(row.advancements)
      ? row.advancements
      : parseJsonField(row.advancements, []) || [];

    return {
      name: String(row.name || ""),
      type: "feat" as const,
      img: row.image_url || undefined,
      flags: {
        "dauligor-pairing": {
          schemaVersion: 1,
          entityKind: "feat",
          sourceId: trimString(row.identifier) || `feat-${row.id}`,
          dbId: String(row.id),
          featSourceType: String(row.source_type || "feat"),
          featType: String(row.feat_type || "feat"),
          featSubtype: String(row.feat_subtype || ""),
          featSpellSourceId: sourceSemanticId,
          repeatable: Boolean(Number(row.repeatable || 0)),
          hasUses: Boolean(trimString(row.uses_max)) || Number(row.uses_spent || 0) > 0,
          hasActivities: Array.isArray(activities) && activities.length > 0,
          hasEffects: Array.isArray(effects) && effects.length > 0,
          hasAdvancements: Array.isArray(advancements) && advancements.length > 0,
          // Render the structured requirements_tree (with entity-name
          // resolution) and fall back to the legacy free-text column
          // when no tree is authored yet. `hasPrereqs` reflects the
          // SAME boolean — whether the picker will show a prereq line.
          hasPrereqs: Boolean(renderFeatRequirementText(row, requirementLookup)),
          requirements: renderFeatRequirementText(row, requirementLookup),
          tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
        },
      },
    };
  });

  // Stable ordering: type asc, then name asc. Mirrors the public
  // `/compendium/feats` default browse order.
  feats.sort((a, b) => {
    const ta = a.flags["dauligor-pairing"].featType;
    const tb = b.flags["dauligor-pairing"].featType;
    if (ta !== tb) return ta.localeCompare(tb);
    return a.name.localeCompare(b.name);
  });

  return {
    kind: "dauligor.source-feat-list.v1",
    schemaVersion: 1,
    sourceId,
    sourceSlug: String(source.slug || ""),
    sourceSemanticId,
    feats,
    generatedAt: Date.now(),
  };
}
