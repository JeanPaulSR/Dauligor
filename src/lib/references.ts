/**
 * Reference resolve + search — Phase 2 of the reference-authoring track.
 *
 * Powers two consumers:
 *   - the @/& autocomplete (Phase 3): searchReferences(kind, query)
 *   - the hover card (Phase 4):        resolveReference(kind, id)
 *
 * Reads go through the existing D1 proxy (`queryD1`), which already admits
 * compendium / condition / lore-article reads for signed-in users — so no
 * new server endpoint is needed. The route is resolved with the same
 * `resolveRefRoute` the BBCode renderer uses, keeping app links consistent.
 *
 * Summaries are returned as their raw stored form (BBCode for most kinds,
 * a plain excerpt for articles); the hover-card component renders them.
 */
import { batchQueryD1, queryD1 } from './d1';
import { resolveRefRoute, type RefKind } from './bbcode';
import { parseRequirementTree, resolveDetailPrereq, type RequirementFormatLookup } from './requirements';

/** Escape LIKE wildcards so the user's query matches literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

export interface RefSearchResult {
  kind: RefKind;
  id: string;
  name: string;
}

export interface RefResolved extends RefSearchResult {
  /** Raw summary text (BBCode for most kinds; article excerpt for articles). */
  summary: string;
  /**
   * Prereq line for the hover-card header (feats today). Resolution order:
   * short description → composite (formatted requirement tree) → free text.
   */
  prereq: string;
  /**
   * Full prerequisite "description" for the hover reveal: composite → free
   * text (the short override excluded). Lets a truncated/abbreviated `prereq`
   * line surface the complete requirement when hovered. '' when none.
   */
  prereqFull: string;
  /** In-app route, or null when the kind has no public route yet (e.g. subclass, condition). */
  route: string | null;
}

interface KindConfig {
  table: string;
  idCol: string;
  nameCol: string;
  /** SQL expression producing the hover-card summary for this kind. */
  summaryExpr: string;
  /** Short-description override column — highest-priority prereq (feats). */
  shortTextCol?: string;
  /** Free-text requirements column — lowest-priority prereq (feats). */
  freeTextCol?: string;
  /** Structured requirement-tree column → the composite prereq (feats). */
  treeCol?: string;
}

/**
 * Per-kind table mapping. `id` is the SEMANTIC identifier (slug), never a
 * Foundry UUID. Summary source per the hover-card design:
 *   spell/feat/item/condition → description
 *   class                     → preview (the brief box), else description
 *   subclass                  → description
 *   article                   → excerpt (the brief field already on the table)
 */
const KIND_CONFIG: Record<string, KindConfig> = {
  spell:     { table: 'spells',            idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  class:     { table: 'classes',           idCol: 'identifier', nameCol: 'name',  summaryExpr: "COALESCE(NULLIF(preview, ''), description)" },
  subclass:  { table: 'subclasses',        idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  feat:      { table: 'feats',             idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description', shortTextCol: 'requirements_short_text', freeTextCol: 'requirements', treeCol: 'requirements_tree' },
  item:      { table: 'items',             idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  condition: { table: 'status_conditions', idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  article:   { table: 'lore_articles',     idCol: 'slug',       nameCol: 'title', summaryExpr: 'excerpt' },
};

/** The reference kinds with a backing table + search/resolve support today. */
export const REFERENCEABLE_KINDS = Object.keys(KIND_CONFIG) as RefKind[];

/** Which kinds each sigil searches. `@` = entity documents, `&` = rules. */
export const FAMILY_KINDS: Record<'entity' | 'rule', RefKind[]> = {
  entity: ['spell', 'class', 'subclass', 'feat', 'item', 'article'],
  rule: ['condition'],
};

/**
 * Search across all kinds in a sigil family in a single query (one D1
 * round-trip). Powers the inline @/& autocomplete: `@` → entity family,
 * `&` → rule family. Results carry their `kind` so the inserted reference
 * is `@<kind>[id]{name}`.
 */
export async function searchReferenceFamily(
  family: 'entity' | 'rule',
  query: string,
  limit = 8,
): Promise<RefSearchResult[]> {
  const kinds = FAMILY_KINDS[family];
  if (!kinds || kinds.length === 0) return [];
  const like = `%${escapeLike(query.trim())}%`;
  // One SELECT per kind, issued as a single D1 batch. We can't UNION the
  // kinds into one statement: Cloudflare D1 caps a compound SELECT at 5
  // terms, and the entity family has 6 kinds — a 6-term UNION fails with
  // "too many terms in compound SELECT" and the whole search returns
  // nothing. Batching keeps each statement independent (no compound cap)
  // and still costs a single round-trip.
  const queries = kinds.map((k) => {
    const cfg = KIND_CONFIG[k];
    return {
      sql:
        `SELECT '${k}' AS kind, ${cfg.idCol} AS id, ${cfg.nameCol} AS name ` +
        `FROM ${cfg.table} WHERE ${cfg.idCol} IS NOT NULL AND ${cfg.idCol} != '' ` +
        `AND (${cfg.nameCol} LIKE ? ESCAPE '\\' OR ${cfg.idCol} LIKE ? ESCAPE '\\') ` +
        `ORDER BY ${cfg.nameCol} LIMIT ${limit}`,
      params: [like, like],
    };
  });
  const sets = await batchQueryD1(queries);
  const rows = sets.flatMap(
    (s: { results?: Array<{ kind: string; id: string; name: string | null }> }) => s?.results ?? [],
  );
  rows.sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
  return rows
    .slice(0, limit)
    .map((r) => ({ kind: r.kind as RefKind, id: String(r.id), name: String(r.name ?? r.id) }));
}

/**
 * Search a single kind by name or identifier. Returns up to `limit`
 * matches ordered by name. Empty query returns the first `limit` rows.
 */
export async function searchReferences(
  kind: string,
  query: string,
  limit = 20,
): Promise<RefSearchResult[]> {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) return [];
  const like = `%${escapeLike(query.trim())}%`;
  const sql =
    `SELECT ${cfg.idCol} AS id, ${cfg.nameCol} AS name FROM ${cfg.table} ` +
    `WHERE ${cfg.idCol} IS NOT NULL AND ${cfg.idCol} != '' ` +
    `AND (${cfg.nameCol} LIKE ? ESCAPE '\\' OR ${cfg.idCol} LIKE ? ESCAPE '\\') ` +
    `ORDER BY ${cfg.nameCol} LIMIT ?`;
  const rows = await queryD1<{ id: string; name: string | null }>(sql, [like, like, limit]);
  return rows.map((r) => ({ kind: kind as RefKind, id: String(r.id), name: String(r.name ?? r.id) }));
}

/**
 * Name lookups the requirement formatter needs to render id-bearing leaves
 * (e.g. a skill-proficiency leaf `ath` → "Athletics") instead of raw slugs.
 * Loaded once, lazily — only when a feat that actually has a requirement
 * tree is resolved — and memoised for the session. Skills are the only leaf
 * kind currently used by feat prerequisites in the data; other proficiency
 * categories / class refs fall back to their slug until wired here.
 */
let requirementLookupPromise: Promise<RequirementFormatLookup> | null = null;
function getRequirementLookup(): Promise<RequirementFormatLookup> {
  if (!requirementLookupPromise) {
    requirementLookupPromise = (async () => {
      try {
        const skills = await queryD1<{ identifier: string | null; name: string | null }>(
          'SELECT identifier, name FROM skills WHERE identifier IS NOT NULL',
        );
        const skillNameById: Record<string, string> = {};
        for (const s of skills) {
          if (s.identifier) skillNameById[String(s.identifier)] = String(s.name ?? s.identifier);
        }
        return { skillNameById };
      } catch {
        return {};
      }
    })();
  }
  return requirementLookupPromise;
}

/**
 * Resolve a single reference to its display data for the hover card.
 * Returns null when the kind is unknown or the entity doesn't exist
 * (a dangling reference).
 */
export async function resolveReference(kind: string, id: string): Promise<RefResolved | null> {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) return null;
  const cols = [`${cfg.idCol} AS id`, `${cfg.nameCol} AS name`, `${cfg.summaryExpr} AS summary`];
  if (cfg.shortTextCol) cols.push(`${cfg.shortTextCol} AS prereq_short`);
  if (cfg.freeTextCol) cols.push(`${cfg.freeTextCol} AS prereq_free`);
  if (cfg.treeCol) cols.push(`${cfg.treeCol} AS requirements_tree`);
  const sql = `SELECT ${cols.join(', ')} FROM ${cfg.table} WHERE ${cfg.idCol} = ? LIMIT 1`;
  const rows = await queryD1<{
    id: string;
    name: string | null;
    summary: string | null;
    prereq_short?: string | null;
    prereq_free?: string | null;
    requirements_tree?: unknown;
  }>(sql, [id]);
  const row = rows[0];
  if (!row) return null;
  // Prereq LINE order (compact): short description (override) → composite
  // (formatted requirement tree) → free text.
  // Prereq HOVER order (fullest): free text → composite → short description —
  // shown when the prereq is hovered so the complete requirement is always
  // readable (the compact line may be abbreviated or cut off).
  let prereq = '';
  let prereqFull = '';
  if (cfg.shortTextCol || cfg.freeTextCol || cfg.treeCol) {
    const tree = parseRequirementTree(row.requirements_tree);
    // Only pay for the name lookup when there's actually a tree to format.
    const lookup = tree ? await getRequirementLookup() : {};
    const short = String(row.prereq_short ?? '').trim();
    const composite = tree ? resolveDetailPrereq({ freeText: null, tree }, lookup) : '';
    const free = String(row.prereq_free ?? '').trim();
    prereq = short || composite || free;
    prereqFull = free || composite || short;
  }
  return {
    kind: kind as RefKind,
    id: String(row.id),
    name: String(row.name ?? row.id),
    summary: String(row.summary ?? ''),
    prereq,
    prereqFull,
    route: resolveRefRoute(kind, String(row.id)),
  };
}
