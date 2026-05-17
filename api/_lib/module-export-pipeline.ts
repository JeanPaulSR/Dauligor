// Central rebake pipeline for the module-export R2 cache.
//
// `rebakeBundle(kind, id)` resolves the cascade for a changed entity and
// writes every affected R2 object. Both the manual "Bake Now" path and the
// background queue processor consume this. The corresponding read path lives
// in `api/module.ts` (which calls the build helpers below for live builds
// when R2 misses).
//
// Cascade rules:
//   class            → that class bundle + that source's catalog (+ top-level catalog if class added/removed)
//   subclass         → parent class bundle (+ that source's catalog because subclasses[] is in the catalog entry)
//   feature          → owning class's bundle (recurses up if owner is a subclass)
//   scalingColumn    → owning class's bundle (same parent-resolution as feature)
//   optionGroup      → every class whose advancements reference the group
//   optionItem       → parent option group → cascade as `optionGroup`
//   source           → top-level catalog + that source's catalog + every per-class bundle in that source

import { executeD1QueryInternal } from "./d1-internal.js";
import { exportClassSemantic, getSemanticSourceId } from "./_classExport.js";
import { SERVER_EXPORT_FETCHERS } from "./d1-fetchers-server.js";
import {
  classBundleKey,
  sourceClassCatalogKey,
  topLevelCatalogKey,
  writeBundle,
} from "./module-export-store.js";
import type { ExportEntityKind } from "./module-export-queue.js";

// ── Row denormalizers ──────────────────────────────────────────────────────

const parseJson = (val: any) => (typeof val === "string" ? JSON.parse(val) : val);

export function denormalizeSourceRow(row: any) {
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

export function denormalizeClassRow(row: any) {
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

// ── Live builders (used by both the read-on-miss path and rebake) ─────────

export async function buildTopLevelCatalog() {
  const sourcesRes = await executeD1QueryInternal({ sql: "SELECT * FROM sources" });
  const allSources = (sourcesRes.results || []).map(denormalizeSourceRow);

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
        // Public semantic id. The internal D1 row id is intentionally
        // NOT exposed — consumers join against this synthesized id,
        // and the spell-summary endpoint resolves its FK column to
        // the same shape before shipping (see `_classSpellList.ts`).
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

export async function buildSourceClassCatalog(sourceSlug: string) {
  const sourcesRes = await executeD1QueryInternal({ sql: "SELECT * FROM sources" });
  const allSources = (sourcesRes.results || []).map(denormalizeSourceRow);
  const source = allSources.find((s: any) =>
    (s.slug || "").toLowerCase() === sourceSlug
    || String(s.id).toLowerCase() === sourceSlug
    || (s.semanticId || "").toLowerCase() === sourceSlug
  );
  if (!source) return null;

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

  // Batch-fetch subclasses for these classes — feeds the catalog's
  // `subclasses[]` array per entry so the Foundry browser can render
  // subclass nesting + tag filter without per-class bundle fetches.
  // Each subclass also resolves its own `shortName` (source abbreviation):
  // a Sorcerer published in PHB might have a Tasha-released subclass
  // whose label should read "TCE", not "PHB".
  const classIds = classes.map((c: any) => c.id);
  const sourcesById = new Map<string, any>(allSources.map((s: any) => [String(s.id), s]));
  const subclassesByClassId = new Map<string, Array<{ identifier: string; name: string; shortName: string }>>();
  if (classIds.length) {
    const placeholders = classIds.map(() => "?").join(",");
    const subRes = await executeD1QueryInternal({
      sql: `SELECT id, class_id, identifier, name, source_id FROM subclasses WHERE class_id IN (${placeholders})`,
      params: classIds,
    });
    for (const row of subRes.results || []) {
      const cid = String(row.class_id);
      const subSource = row.source_id ? sourcesById.get(String(row.source_id)) : null;
      const shortName = subSource?.abbreviation
        ?? subSource?.name
        ?? source.abbreviation
        ?? source.name
        ?? "";
      const list = subclassesByClassId.get(cid) ?? [];
      list.push({
        identifier: row.identifier || row.id,
        name: row.name,
        shortName,
      });
      subclassesByClassId.set(cid, list);
    }
  }

  const entries = classes.map((cls: any) => {
    const identifier = cls.identifier || cls.id;
    const subList = (subclassesByClassId.get(cls.id) ?? [])
      .map((sub) => ({ sourceId: `subclass-${sub.identifier}`, name: sub.name, shortName: sub.shortName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      sourceId: `class-${identifier}`,
      name: cls.name,
      // Source abbreviation (PHB, XGE, …) so the Foundry browser can label
      // classes by abbreviation. The legacy `deriveSourceLabel` fallback
      // produced "2014" / "2024" when given just the rules year.
      shortName: source.abbreviation || source.name,
      type: "class",
      img: cls.imageUrl || "",
      rules: cls.rules || source.rules || "2014",
      description: (cls.description || "").substring(0, 200),
      payloadKind: "dauligor.semantic.class-export",
      payloadUrl: `${identifier}.json`,
      tags: Array.isArray(cls.tagIds) ? cls.tagIds : [],
      subclasses: subList,
    };
  });

  // Resolve tag IDs → display names so the Foundry class browser's filter
  // chips can label themselves as "Martial" / "Spellcaster" / etc. rather
  // than raw D1 PKs like "3sDgK4MJv2cjp2ex0Vte". We only fetch the tags
  // actually referenced by classes in this catalog — keeps the payload
  // small even when the tags table is broad. The wizard's classlist view
  // (`src/pages/compendium/ClassList.tsx`) does the same lookup at render
  // time via `tagsByGroup`; this ships the resolved labels directly so
  // the module doesn't need a second round-trip.
  const referencedTagIds = Array.from(new Set(entries.flatMap((e) => e.tags).map(String).filter(Boolean)));
  const tagIndex: Record<string, string> = {};
  if (referencedTagIds.length) {
    const placeholders = referencedTagIds.map(() => "?").join(",");
    const tagRes = await executeD1QueryInternal({
      sql: `SELECT id, name FROM tags WHERE id IN (${placeholders})`,
      params: referencedTagIds,
    });
    for (const row of tagRes.results || []) {
      if (row.id && row.name) tagIndex[String(row.id)] = String(row.name);
    }
  }

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
    tagIndex,
  };
}

export async function buildClassBundleForIdentifier(classIdentifier: string) {
  const lookup = classIdentifier.toLowerCase();
  const classesRes = await executeD1QueryInternal({
    sql: "SELECT * FROM classes WHERE LOWER(identifier) = ? OR LOWER(id) = ? LIMIT 1",
    params: [lookup, lookup],
  });
  const row = (classesRes.results || [])[0];
  if (!row) return null;
  return await exportClassSemantic(row.id, SERVER_EXPORT_FETCHERS);
}

// ── Cascade resolvers ──────────────────────────────────────────────────────
// Each helper returns the data it needs; rebake fns combine them.

async function getClassRowById(classId: string) {
  const res = await executeD1QueryInternal({
    sql: "SELECT * FROM classes WHERE id = ? LIMIT 1",
    params: [classId],
  });
  return (res.results || [])[0] || null;
}

async function getSourceSlugByClass(classRow: any): Promise<string | null> {
  if (!classRow?.source_id) return null;
  const res = await executeD1QueryInternal({
    sql: "SELECT slug, id FROM sources WHERE id = ? LIMIT 1",
    params: [classRow.source_id],
  });
  const sourceRow = (res.results || [])[0];
  return ((sourceRow?.slug as string) || (sourceRow?.id as string)) ?? null;
}

async function findOwningClassIdForFeatureOrScaling(parentId: string): Promise<string | null> {
  // parent_id can be a class id directly, or a subclass id (we walk up).
  // Try class first.
  const classRes = await executeD1QueryInternal({
    sql: "SELECT id FROM classes WHERE id = ? LIMIT 1",
    params: [parentId],
  });
  if ((classRes.results || []).length > 0) return parentId;

  // Then subclass.
  const subRes = await executeD1QueryInternal({
    sql: "SELECT class_id FROM subclasses WHERE id = ? LIMIT 1",
    params: [parentId],
  });
  const subRow = (subRes.results || [])[0];
  return ((subRow?.class_id as string) || null);
}

async function findClassesReferencingOptionGroup(groupId: string): Promise<string[]> {
  // class.advancements is JSON; the group id appears as a string token.
  // LIKE-match on the raw text is loose but safe — false positives just
  // mean an extra rebake of an unaffected class, which is benign.
  const res = await executeD1QueryInternal({
    sql: "SELECT id FROM classes WHERE advancements LIKE ? OR unique_option_mappings LIKE ?",
    params: [`%${groupId}%`, `%${groupId}%`],
  });
  return (res.results || []).map((r: any) => String(r.id));
}

async function findClassesInSource(sourceId: string): Promise<string[]> {
  const res = await executeD1QueryInternal({
    sql: "SELECT id FROM classes WHERE source_id = ?",
    params: [sourceId],
  });
  return (res.results || []).map((r: any) => String(r.id));
}

// ── Rebake helpers ─────────────────────────────────────────────────────────

export async function rebakeTopLevelCatalog(): Promise<string[]> {
  const fresh = await buildTopLevelCatalog();
  if (!fresh) return [];
  const key = topLevelCatalogKey();
  const ok = await writeBundle(key, fresh);
  return ok ? [key] : [];
}

export async function rebakeSourceCatalogBySlug(sourceSlug: string): Promise<string[]> {
  const fresh = await buildSourceClassCatalog(sourceSlug);
  if (!fresh) return [];
  const key = sourceClassCatalogKey(sourceSlug);
  const ok = await writeBundle(key, fresh);
  return ok ? [key] : [];
}

export async function rebakeClass(classId: string): Promise<string[]> {
  const row = await getClassRowById(classId);
  if (!row) return [];
  const cls = denormalizeClassRow(row);
  const identifier = cls.identifier || cls.id;
  const sourceSlug = await getSourceSlugByClass(row);
  if (!sourceSlug) {
    console.warn("[pipeline] rebakeClass: missing source slug", { classId });
    return [];
  }

  const bundle = await exportClassSemantic(row.id, SERVER_EXPORT_FETCHERS);
  if (!bundle) return [];

  const written: string[] = [];
  const bundleK = classBundleKey(sourceSlug, identifier);
  if (await writeBundle(bundleK, bundle)) written.push(bundleK);

  // Source catalog can change when class metadata (img/desc/tags/subclasses) shifts.
  written.push(...await rebakeSourceCatalogBySlug(sourceSlug));

  return written;
}

async function rebakeSubclass(subclassId: string): Promise<string[]> {
  const res = await executeD1QueryInternal({
    sql: "SELECT class_id FROM subclasses WHERE id = ? LIMIT 1",
    params: [subclassId],
  });
  const classId = (res.results || [])[0]?.class_id as string | undefined;
  if (!classId) return [];
  return rebakeClass(classId);
}

async function rebakeFeature(featureId: string): Promise<string[]> {
  const res = await executeD1QueryInternal({
    sql: "SELECT parent_id FROM features WHERE id = ? LIMIT 1",
    params: [featureId],
  });
  const parentId = (res.results || [])[0]?.parent_id as string | undefined;
  if (!parentId) return [];
  const owningClassId = await findOwningClassIdForFeatureOrScaling(parentId);
  if (!owningClassId) return [];
  return rebakeClass(owningClassId);
}

async function rebakeScalingColumn(scalingColumnId: string): Promise<string[]> {
  const res = await executeD1QueryInternal({
    sql: "SELECT parent_id FROM scaling_columns WHERE id = ? LIMIT 1",
    params: [scalingColumnId],
  });
  const parentId = (res.results || [])[0]?.parent_id as string | undefined;
  if (!parentId) return [];
  const owningClassId = await findOwningClassIdForFeatureOrScaling(parentId);
  if (!owningClassId) return [];
  return rebakeClass(owningClassId);
}

async function rebakeOptionGroup(groupId: string): Promise<string[]> {
  const classIds = await findClassesReferencingOptionGroup(groupId);
  const written: string[] = [];
  for (const cid of classIds) {
    written.push(...await rebakeClass(cid));
  }
  return written;
}

async function rebakeOptionItem(itemId: string): Promise<string[]> {
  const res = await executeD1QueryInternal({
    sql: "SELECT group_id FROM unique_option_items WHERE id = ? LIMIT 1",
    params: [itemId],
  });
  const groupId = (res.results || [])[0]?.group_id as string | undefined;
  if (!groupId) return [];
  return rebakeOptionGroup(groupId);
}

async function rebakeSource(sourceId: string): Promise<string[]> {
  // Source rename/abbreviation/slug change ripples into per-class bundles
  // (sourceBookId references) and the catalogs.
  const res = await executeD1QueryInternal({
    sql: "SELECT slug FROM sources WHERE id = ? LIMIT 1",
    params: [sourceId],
  });
  const sourceSlug = (res.results || [])[0]?.slug as string | undefined;

  const written: string[] = [];
  written.push(...await rebakeTopLevelCatalog());
  if (sourceSlug) {
    written.push(...await rebakeSourceCatalogBySlug(sourceSlug));
  }
  const classIds = await findClassesInSource(sourceId);
  for (const cid of classIds) {
    written.push(...await rebakeClass(cid));
  }
  return written;
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export async function rebakeBundle(kind: ExportEntityKind, id: string): Promise<string[]> {
  try {
    switch (kind) {
      case "class": return await rebakeClass(id);
      case "subclass": return await rebakeSubclass(id);
      case "feature": return await rebakeFeature(id);
      case "scalingColumn": return await rebakeScalingColumn(id);
      case "optionGroup": return await rebakeOptionGroup(id);
      case "optionItem": return await rebakeOptionItem(id);
      case "source": return await rebakeSource(id);
      default:
        console.warn("[pipeline] unknown entity kind", { kind, id });
        return [];
    }
  } catch (error) {
    console.error("[pipeline] rebakeBundle failed", { kind, id, error });
    throw error;
  }
}
