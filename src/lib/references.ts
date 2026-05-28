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
import { queryD1 } from './d1';
import { resolveRefRoute, type RefKind } from './bbcode';

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
  /** In-app route, or null when the kind has no public route yet (e.g. subclass). */
  route: string | null;
}

interface KindConfig {
  table: string;
  idCol: string;
  nameCol: string;
  /** SQL expression producing the hover-card summary for this kind. */
  summaryExpr: string;
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
  feat:      { table: 'feats',             idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  item:      { table: 'items',             idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  condition: { table: 'status_conditions', idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  article:   { table: 'lore_articles',     idCol: 'slug',       nameCol: 'title', summaryExpr: 'excerpt' },
};

/** The reference kinds with a backing table + search/resolve support today. */
export const REFERENCEABLE_KINDS = Object.keys(KIND_CONFIG) as RefKind[];

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
 * Resolve a single reference to its display data for the hover card.
 * Returns null when the kind is unknown or the entity doesn't exist
 * (a dangling reference).
 */
export async function resolveReference(kind: string, id: string): Promise<RefResolved | null> {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) return null;
  const sql =
    `SELECT ${cfg.idCol} AS id, ${cfg.nameCol} AS name, ${cfg.summaryExpr} AS summary ` +
    `FROM ${cfg.table} WHERE ${cfg.idCol} = ? LIMIT 1`;
  const rows = await queryD1<{ id: string; name: string | null; summary: string | null }>(sql, [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    kind: kind as RefKind,
    id: String(row.id),
    name: String(row.name ?? row.id),
    summary: String(row.summary ?? ''),
    route: resolveRefRoute(kind, String(row.id)),
  };
}
