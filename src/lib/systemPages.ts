// System Pages — data access for the site-consistent, reference-addressable
// glossary article type (Conditions, Skills, Magic, homebrew). Distinct from
// lore articles. A page's `identifier` doubles as the `&`-reference kind, and
// each entry is the `#anchor` target. See docs/_drafts/system-page-spec.html.
//
// Hybrid entries (spec §5): an entry is EITHER free-authored prose (`body`) OR
// entity-backed (`sourceKind`/`sourceId` point at an existing canonical row, so
// its text is pulled live with no duplication). A stored field on a backed entry
// still wins over the source — lets an author override a name/summary.

import { fetchCollection, upsertDocument, deleteDocument, queryD1 } from './d1';
import { slugify } from './utils';

export interface SystemPage {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
  icon: string | null;
  order: number | null;
}

export interface SystemPageEntry {
  id: string;
  pageId: string;
  identifier: string;
  name: string;
  summary: string | null;
  body: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  imageUrl: string | null;
  order: number | null;
}

/** An entry resolved for display — source-backed fields merged in. */
export interface ResolvedEntry {
  identifier: string;
  name: string;
  summary: string; // short blurb for the hover card
  body: string; // full text (BBCode)
  imageUrl: string | null;
}

export interface SystemPageDetail {
  page: SystemPage;
  entries: ResolvedEntry[];
}

// Maps a stored `source_kind` to the canonical table its `source_id` points at.
// Entity-backed entries select `name`/`description`/`image_url` from here.
// Extensible: add `skill: 'skills'`, etc. as those system pages come online.
const SYSTEM_SOURCE_TABLES: Record<string, string> = {
  condition: 'status_conditions',
};

function mapPage(r: any): SystemPage {
  return {
    id: String(r.id),
    identifier: String(r.identifier ?? ''),
    name: String(r.name ?? ''),
    description: r.description ?? null,
    icon: r.icon ?? null,
    order: r.order ?? null,
  };
}

function mapEntry(r: any): SystemPageEntry {
  return {
    id: String(r.id),
    pageId: String(r.page_id ?? r.pageId ?? ''),
    identifier: String(r.identifier ?? ''),
    name: String(r.name ?? ''),
    summary: r.summary ?? null,
    body: r.body ?? null,
    sourceKind: r.source_kind ?? r.sourceKind ?? null,
    sourceId: r.source_id ?? r.sourceId ?? null,
    imageUrl: r.image_url ?? r.imageUrl ?? null,
    order: r.order ?? null,
  };
}

/** All system pages, ordered. Powers the list UI + reference-kind discovery. */
export async function fetchSystemPages(): Promise<SystemPage[]> {
  const rows = await fetchCollection<any>('systemPages', { orderBy: '"order" ASC, name ASC' });
  return rows.map(mapPage);
}

export async function fetchSystemPageByIdentifier(identifier: string): Promise<SystemPage | null> {
  const rows = await fetchCollection<any>('systemPages', { where: 'identifier = ?', params: [identifier] });
  return rows[0] ? mapPage(rows[0]) : null;
}

export async function fetchSystemPageEntries(pageId: string): Promise<SystemPageEntry[]> {
  const rows = await fetchCollection<any>('systemPageEntries', {
    where: 'page_id = ?',
    params: [pageId],
    orderBy: '"order" ASC, name ASC',
  });
  return rows.map(mapEntry);
}

/**
 * Merge entity-backed source text into a batch of entries. Groups backed entries
 * by source table and issues one `IN (...)` query per table, so a glossary of N
 * conditions costs one query, not N.
 */
async function resolveEntries(entries: SystemPageEntry[]): Promise<ResolvedEntry[]> {
  const byTable: Record<string, Set<string>> = {};
  for (const e of entries) {
    if (e.sourceKind && e.sourceId) {
      const table = SYSTEM_SOURCE_TABLES[e.sourceKind];
      if (table) (byTable[table] ??= new Set()).add(e.sourceId);
    }
  }

  const sourceMap: Record<string, any> = {};
  for (const [table, idSet] of Object.entries(byTable)) {
    const ids = [...idSet];
    if (ids.length === 0) continue;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await queryD1<any>(
      `SELECT id, name, description, image_url FROM ${table} WHERE id IN (${placeholders})`,
      ids,
    );
    for (const r of rows) sourceMap[`${table}:${r.id}`] = r;
  }

  return entries.map((e) => {
    let name = e.name;
    let body = e.body ?? '';
    let summary = e.summary ?? '';
    let imageUrl = e.imageUrl;
    if (e.sourceKind && e.sourceId) {
      const table = SYSTEM_SOURCE_TABLES[e.sourceKind];
      const src = table ? sourceMap[`${table}:${e.sourceId}`] : null;
      if (src) {
        if (!name) name = String(src.name ?? '');
        if (!body) body = String(src.description ?? '');
        if (!summary) summary = String(src.description ?? '');
        if (!imageUrl) imageUrl = src.image_url ?? null;
      }
    }
    if (!summary) summary = body;
    return { identifier: e.identifier, name, summary, body, imageUrl };
  });
}

/**
 * A page + its display-ready entries. Powers the reader glossary. Tolerant of
 * `identifier` not matching a page's canonical identifier — falls back to a
 * slugified-name match so `/system/condition` finds a page whose admin
 * identifier is `conditions` if its name slugifies to `condition`. Lets
 * Foundry-cited routes (`&Reference[condition=…]` → `/system/condition`) land
 * on the right page without forcing the admin to rename the identifier.
 */
export async function fetchSystemPageDetail(identifier: string): Promise<SystemPageDetail | null> {
  let page = await fetchSystemPageByIdentifier(identifier);
  if (!page) {
    const target = identifier.trim().toLowerCase();
    const all = await fetchSystemPages();
    for (const p of all) {
      const nameSlug = slugify(p.name ?? '').toLowerCase();
      if (nameSlug === target) {
        page = p;
        break;
      }
    }
  }
  if (!page) return null;
  const rawEntries = await fetchSystemPageEntries(page.id);
  const entries = await resolveEntries(rawEntries);
  return { page, entries };
}

/**
 * Page-level resolve — for a bare `&kind[]` reference that cites the page
 * itself (not an entry). Returns the page name + description (the content the
 * Description panel at the top of the reader renders).
 */
export async function resolveSystemPage(
  identifier: string,
): Promise<{ name: string; description: string } | null> {
  const page = await fetchSystemPageByIdentifier(identifier);
  if (!page) return null;
  return { name: page.name, description: page.description ?? '' };
}

/**
 * Search system pages (not entries) — used by the `&` autocomplete so page-
 * level references (`&kind[]{Name}`) are discoverable alongside entry refs.
 */
export async function searchSystemPages(
  query: string,
  limit = 20,
): Promise<Array<{ kind: string; id: string; name: string }>> {
  const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await queryD1<any>(
    `SELECT identifier, name FROM system_pages
     WHERE name LIKE ? ESCAPE '\\' OR identifier LIKE ? ESCAPE '\\'
     ORDER BY name LIMIT ?`,
    [like, like, limit],
  );
  return rows.map((r) => ({
    kind: String(r.identifier),
    id: '', // empty id signals a page-level reference: &kind[]
    name: String(r.name ?? r.identifier),
  }));
}

/** Resolve a single entry by page + entry identifier — for reference hovers. */
export async function resolveSystemEntry(
  pageIdentifier: string,
  entryIdentifier: string,
): Promise<ResolvedEntry | null> {
  const rows = await queryD1<any>(
    `SELECT e.* FROM system_page_entries e JOIN system_pages p ON e.page_id = p.id
     WHERE p.identifier = ? AND e.identifier = ? LIMIT 1`,
    [pageIdentifier, entryIdentifier],
  );
  if (!rows[0]) return null;
  const [resolved] = await resolveEntries([mapEntry(rows[0])]);
  return resolved ?? null;
}

/**
 * Search entries across all system pages — powers the `&` autocomplete. Each
 * result carries its page's identifier as the reference `kind`, the entry's
 * identifier as the `id`, plus the page name for grouping/labels.
 */
export async function searchSystemEntries(
  query: string,
  limit = 20,
): Promise<Array<{ kind: string; id: string; name: string; pageName: string }>> {
  const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await queryD1<any>(
    `SELECT p.identifier AS page_identifier, p.name AS page_name,
            e.identifier AS entry_identifier, e.name AS entry_name
     FROM system_page_entries e JOIN system_pages p ON e.page_id = p.id
     WHERE e.name LIKE ? ESCAPE '\\' OR e.identifier LIKE ? ESCAPE '\\'
     ORDER BY e.name LIMIT ?`,
    [like, like, limit],
  );
  return rows.map((r) => ({
    kind: String(r.page_identifier),
    id: String(r.entry_identifier),
    name: String(r.entry_name ?? r.entry_identifier),
    pageName: String(r.page_name ?? ''),
  }));
}

// Cached kind → canonical-identifier map. A reference's `kind` might match a
// page's identifier directly (canonical) OR a slug of its name — Foundry
// compendium content cites `&Reference[condition=…]` even when the admin's
// page is named "Conditions" (identifier `conditions`). Mapping both lets the
// ref resolve regardless of which spelling the source uses, without forcing
// an identifier rename (which would break existing URLs).
let _kindMapCache: Map<string, string> | null = null;

export async function getSystemPageKindMap(): Promise<Map<string, string>> {
  if (_kindMapCache) return _kindMapCache;
  const rows = await queryD1<any>(`SELECT identifier, name FROM system_pages`);
  const map = new Map<string, string>();
  // Pass 1 — identifiers (canonical) always win.
  for (const r of rows) {
    const id = String(r.identifier ?? '').toLowerCase();
    if (id) map.set(id, id);
  }
  // Pass 2 — name-slug aliases fill any slot a canonical identifier hasn't
  // already claimed (first writer wins on collisions).
  for (const r of rows) {
    const id = String(r.identifier ?? '').toLowerCase();
    if (!id) continue;
    const nameSlug = slugify(String(r.name ?? '')).toLowerCase();
    if (nameSlug && !map.has(nameSlug)) {
      map.set(nameSlug, id);
    }
  }
  _kindMapCache = map;
  return map;
}

export function invalidateSystemPageCache(): void {
  _kindMapCache = null;
}

// --- Writes (admin editor) ----------------------------------------------------

export async function saveSystemPage(p: {
  id: string;
  identifier: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  order?: number | null;
}): Promise<void> {
  invalidateSystemPageCache();
  await upsertDocument('systemPages', p.id, {
    identifier: p.identifier,
    name: p.name,
    description: p.description ?? null,
    icon: p.icon ?? null,
    order: p.order ?? null,
    updated_at: new Date().toISOString(),
  });
}

export async function saveSystemPageEntry(e: {
  id: string;
  pageId: string;
  identifier: string;
  name: string;
  summary?: string | null;
  body?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  imageUrl?: string | null;
  order?: number | null;
}): Promise<void> {
  await upsertDocument('systemPageEntries', e.id, {
    page_id: e.pageId,
    identifier: e.identifier,
    name: e.name,
    summary: e.summary ?? null,
    body: e.body ?? null,
    source_kind: e.sourceKind ?? null,
    source_id: e.sourceId ?? null,
    image_url: e.imageUrl ?? null,
    order: e.order ?? null,
    updated_at: new Date().toISOString(),
  });
}

export async function deleteSystemPage(id: string): Promise<void> {
  invalidateSystemPageCache();
  // Remove children explicitly — don't rely on D1 having FK cascade enabled.
  await queryD1(`DELETE FROM system_page_entries WHERE page_id = ?`, [id]);
  await deleteDocument('systemPages', id);
}

export async function deleteSystemPageEntry(id: string): Promise<void> {
  await deleteDocument('systemPageEntries', id);
}
