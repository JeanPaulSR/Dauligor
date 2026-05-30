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
import {
  resolveSystemEntry,
  resolveSystemPage,
  searchSystemEntries,
  searchSystemPages,
  getSystemPageKindMap,
} from './systemPages';
import { parseRequirementTree, resolveDetailPrereq, type RequirementFormatLookup } from './requirements';
import { slugifyReferenceSegment } from './referenceSyntax';

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
  /** Card image for image-led kinds (classes); absent/null otherwise. */
  imageUrl?: string | null;
  /** Source abbreviation for image-led cards (classes), e.g. "PHB". */
  sourceLabel?: string | null;
  /** In-app route, or null when the kind has no public route yet (e.g. subclass, condition). */
  route: string | null;
  /**
   * Resolved DB primary-key id — distinct from `id`, which is the semantic
   * identifier/slug used in the `@kind[id]` syntax. Lets a host load the full
   * document by primary key (e.g. opening the class preview pane, which
   * fetches via `fetchDocument('classes', pk)`). Absent for derived-slug kinds
   * (option groups) that have no single backing row.
   */
  docId?: string;
}

interface KindConfig {
  table: string;
  idCol: string;
  nameCol: string;
  /** SQL expression producing the hover-card summary for this kind. */
  summaryExpr: string;
  /** SQL expression for a card image (classes show an image-led preview card). */
  imageExpr?: string;
  /** SQL expression for a source label (classes show the source abbreviation). */
  sourceExpr?: string;
  /** Short-description override column — highest-priority prereq (feats). */
  shortTextCol?: string;
  /** Free-text requirements column — lowest-priority prereq (feats). */
  freeTextCol?: string;
  /** Structured requirement-tree column → the composite prereq (feats). */
  treeCol?: string;
  /**
   * Kinds without a stored slug identifier (unique option groups key by a
   * random id). The reference id is derived as slugify(name) — names are
   * unique — and matched in JS: search returns slugify(name) as the id, and
   * resolve fetches the (small) table and matches slugify(name) === id.
   */
  deriveSlugId?: boolean;
  /**
   * Child-options table for drill-down kinds (option groups → their items).
   * A composite id `<group-slug>:<item-slug>` resolves to one option inside a
   * group. itemNameCol/itemSummaryExpr default to name/description.
   */
  itemsTable?: string;
  /** FK column on the items table pointing back to the parent group row. */
  itemFkCol?: string;
  itemNameCol?: string;
  itemSummaryExpr?: string;
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
  class:     { table: 'classes',           idCol: 'identifier', nameCol: 'name',  summaryExpr: "COALESCE(NULLIF(preview, ''), description)", imageExpr: "COALESCE(NULLIF(card_image_url, ''), image_url)", sourceExpr: "(SELECT abbreviation FROM sources WHERE sources.id = classes.source_id)" },
  subclass:  { table: 'subclasses',        idCol: 'identifier', nameCol: 'name',  summaryExpr: "COALESCE(NULLIF(preview, ''), description)", imageExpr: "COALESCE(NULLIF(card_image_url, ''), image_url)", sourceExpr: "(SELECT abbreviation FROM sources WHERE sources.id = subclasses.source_id)" },
  feat:      { table: 'feats',             idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description', shortTextCol: 'requirements_short_text', freeTextCol: 'requirements', treeCol: 'requirements_tree' },
  item:      { table: 'items',             idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  condition: { table: 'status_conditions', idCol: 'identifier', nameCol: 'name',  summaryExpr: 'description' },
  article:   { table: 'lore_articles',     idCol: 'slug',       nameCol: 'title', summaryExpr: 'excerpt' },
  // No stored slug — keyed by slugify(name) (names are unique). idCol=name so
  // the search query filters by name; the resolved/search id is slugified.
  'option-group': { table: 'unique_option_groups', idCol: 'name', nameCol: 'name', summaryExpr: 'description', deriveSlugId: true, itemsTable: 'unique_option_items', itemFkCol: 'group_id' },
};

/** The reference kinds with a backing table + search/resolve support today. */
export const REFERENCEABLE_KINDS = Object.keys(KIND_CONFIG) as RefKind[];

/** Which kinds each sigil searches. `@` = entity documents, `&` = rules. */
export const FAMILY_KINDS: Record<'entity' | 'rule', RefKind[]> = {
  entity: ['spell', 'class', 'subclass', 'feat', 'item', 'article', 'option-group'],
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
  let kinds = FAMILY_KINDS[family];
  if (!kinds || kinds.length === 0) return [];
  const like = `%${escapeLike(query.trim())}%`;

  // Rule family: system-page entries are the primary `&` targets, and the pages
  // themselves are page-level targets (`&kind[]` — empty brackets cite the page
  // itself, not an entry). Pull both in, and drop any static rule kind shadowed
  // by a same-named system page (a "condition" system page replaces the
  // status_conditions search, per locked spec §8 #3).
  let systemResults: RefSearchResult[] = [];
  if (family === 'rule') {
    // Kind map includes name-slug aliases, so the shadow check also fires
    // when a Foundry-style kind (`condition`) matches a same-named system
    // page authored under a different identifier (`conditions`).
    const kindMap = await getSystemPageKindMap();
    const [sysPages, sysEntries] = await Promise.all([
      searchSystemPages(query, limit),
      searchSystemEntries(query, limit),
    ]);
    systemResults = [
      ...sysPages.map((r) => ({ kind: r.kind as RefKind, id: r.id, name: r.name })),
      ...sysEntries.map((r) => ({ kind: r.kind as RefKind, id: r.id, name: r.name })),
    ];
    kinds = kinds.filter((k) => !kindMap.has(k));
  }

  // One SELECT per remaining kind, issued as a single D1 batch. We can't UNION
  // the kinds into one statement: Cloudflare D1 caps a compound SELECT at 5
  // terms, and the entity family has 6 kinds — a 6-term UNION fails with "too
  // many terms in compound SELECT" and the whole search returns nothing.
  // Batching keeps each statement independent (no compound cap), one round-trip.
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
  const sets = queries.length ? await batchQueryD1(queries) : [];
  const rows = sets.flatMap(
    (s: { results?: Array<{ kind: string; id: string; name: string | null }> }) => s?.results ?? [],
  );
  const staticResults: RefSearchResult[] = rows.map((r) => {
    const kind = r.kind as RefKind;
    const name = String(r.name ?? r.id);
    // Kinds without a stored slug (option groups) key by slugify(name).
    const id = KIND_CONFIG[kind]?.deriveSlugId ? slugifyReferenceSegment(name) : String(r.id);
    return { kind, id, name };
  });

  const merged = [...systemResults, ...staticResults];
  merged.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return merged.slice(0, limit);
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
 * Drill-down: the options inside one option group. Powers the @-autocomplete
 * after the user picks a group. Returns composite ids `<group-slug>:<item-slug>`
 * so inserting one yields `@option-group[metamagic:twin-spell]{Twin Spell}`.
 */
export async function searchOptionGroupItems(
  groupSlug: string,
  query = '',
  limit = 30,
): Promise<RefSearchResult[]> {
  const cfg = KIND_CONFIG['option-group'];
  if (!cfg?.itemsTable) return [];
  const groups = await queryD1<{ gid: string; name: string | null }>(
    `SELECT id AS gid, ${cfg.nameCol} AS name FROM ${cfg.table}`,
  );
  const group = groups.find((g) => slugifyReferenceSegment(String(g.name ?? '')) === groupSlug);
  if (!group) return [];
  const nameCol = cfg.itemNameCol ?? 'name';
  const like = `%${escapeLike(query.trim())}%`;
  const items = await queryD1<{ name: string | null }>(
    `SELECT ${nameCol} AS name FROM ${cfg.itemsTable} WHERE ${cfg.itemFkCol} = ? ` +
      `AND ${nameCol} LIKE ? ESCAPE '\\' ORDER BY ${nameCol} LIMIT ${limit}`,
    [group.gid, like],
  );
  return items.map((it) => ({
    kind: 'option-group' as RefKind,
    id: `${groupSlug}:${slugifyReferenceSegment(String(it.name ?? ''))}`,
    name: String(it.name ?? ''),
  }));
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
  // System pages own the `&` rule kinds (locked: identifier = kind). Try them
  // first so a "condition" system page replaces the static status_conditions
  // resolve. Gated on the cached identifier set, so non-system kinds (@spell,
  // @class, …) skip the extra query and fall straight through.
  // System pages own the `&` rule kinds. The reference's `kind` might be a
  // canonical page identifier OR a slug of the page's name — Foundry imports
  // cite `&Reference[condition=…]` even when the admin's page is `conditions`,
  // so the kind map exposes both. Resolve via the canonical identifier so the
  // returned route always lands on the right URL.
  const kindMap = await getSystemPageKindMap();
  const canonical = kindMap.get(kind.toLowerCase());
  if (canonical) {
    if (!id) {
      // Page-level reference (`&kind[]`) → the page itself; summary is the
      // admin-authored description rendered atop the reader.
      const page = await resolveSystemPage(canonical);
      if (page) {
        return {
          kind: kind as RefKind,
          id: '',
          name: page.name,
          summary: page.description,
          prereq: '',
          prereqFull: '',
          imageUrl: null,
          route: `/system/${encodeURIComponent(canonical)}`,
        };
      }
    } else {
      const entry = await resolveSystemEntry(canonical, id);
      if (entry) {
        return {
          kind: kind as RefKind,
          id,
          name: entry.name,
          summary: entry.summary,
          prereq: '',
          prereqFull: '',
          imageUrl: entry.imageUrl ?? null,
          route: `/system/${encodeURIComponent(canonical)}#${encodeURIComponent(id)}`,
        };
      }
    }
    // Page exists but no matching entry → fall through to any static config.
  }
  const cfg = KIND_CONFIG[kind];
  if (!cfg) return null;
  if (cfg.deriveSlugId) {
    // id is `<group-slug>` or `<group-slug>:<item-slug>`. These rows have no
    // stored slug, so match slugify(name) over the (small) tables in JS.
    const [groupSlug, itemSlug] = id.split(':');
    const groups = await queryD1<{ gid: string; name: string | null; summary: string | null }>(
      `SELECT id AS gid, ${cfg.nameCol} AS name, ${cfg.summaryExpr} AS summary FROM ${cfg.table}`,
    );
    const group = groups.find((g) => slugifyReferenceSegment(String(g.name ?? '')) === groupSlug);
    if (!group) return null;
    const base = { kind: kind as RefKind, id, prereq: '', prereqFull: '', route: resolveRefRoute(kind, id) };
    if (!itemSlug) {
      return { ...base, name: String(group.name ?? id), summary: String(group.summary ?? '') };
    }
    // A specific option inside the group.
    if (!cfg.itemsTable) return null;
    const nameCol = cfg.itemNameCol ?? 'name';
    const items = await queryD1<{ name: string | null; summary: string | null }>(
      `SELECT ${nameCol} AS name, ${cfg.itemSummaryExpr ?? 'description'} AS summary FROM ${cfg.itemsTable} WHERE ${cfg.itemFkCol} = ?`,
      [group.gid],
    );
    const item = items.find((it) => slugifyReferenceSegment(String(it.name ?? '')) === itemSlug);
    if (!item) return null;
    return { ...base, name: String(item.name ?? id), summary: String(item.summary ?? '') };
  }
  // `id AS doc_id` carries the real primary key alongside the semantic `id`
  // (which is the identifier/slug for every configured kind). Hosts that need
  // to fetch the full document by PK (e.g. the class preview pane) read docId.
  const cols = [`${cfg.idCol} AS id`, `${cfg.nameCol} AS name`, `${cfg.summaryExpr} AS summary`, 'id AS doc_id'];
  if (cfg.shortTextCol) cols.push(`${cfg.shortTextCol} AS prereq_short`);
  if (cfg.freeTextCol) cols.push(`${cfg.freeTextCol} AS prereq_free`);
  if (cfg.treeCol) cols.push(`${cfg.treeCol} AS requirements_tree`);
  if (cfg.imageExpr) cols.push(`${cfg.imageExpr} AS image`);
  if (cfg.sourceExpr) cols.push(`${cfg.sourceExpr} AS source_label`);
  const sql = `SELECT ${cols.join(', ')} FROM ${cfg.table} WHERE ${cfg.idCol} = ? LIMIT 1`;
  const rows = await queryD1<{
    id: string;
    name: string | null;
    summary: string | null;
    prereq_short?: string | null;
    prereq_free?: string | null;
    requirements_tree?: unknown;
    image?: string | null;
    source_label?: string | null;
    doc_id?: string | null;
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
    imageUrl: row.image ?? null,
    sourceLabel: row.source_label ?? null,
    route: resolveRefRoute(kind, String(row.id)),
    docId: row.doc_id != null ? String(row.doc_id) : undefined,
  };
}
