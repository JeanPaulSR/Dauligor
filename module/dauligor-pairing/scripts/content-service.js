// Reads the Dauligor app's lore + campaign content for the in-Foundry page viewer,
// authenticated as the logged-in user (auth-service `authFetch` → Bearer token).
// The server filters by the account's role + active campaign, so the module just
// renders what it gets. Returns parsed JSON; throws a friendly Error on
// auth/network failure so the viewer can show a sensible state.
//
// System-page reads (the `&kind[anchor]` rule refs) use POST /api/d1/query
// directly — owner decision 2026-06-06 (Option A: no new app endpoint) — and are
// added in the system-page phase (see resolveSystemEntry below, Phase 4).

import { authFetch, resolveApiHost } from "./auth-service.js";
import { log } from "./utils.js";

async function getJson(path) {
  let res;
  try {
    res = await authFetch(path);
  } catch (err) {
    if (String(err?.message).includes("Not logged in")) {
      throw new Error("Log in to your Dauligor account to view this content.");
    }
    throw new Error("Couldn't reach Dauligor (network or CORS).");
  }
  if (res.status === 401) throw new Error("Your Dauligor session expired — log in again.");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Dauligor request failed (HTTP ${res.status}).`);
  return res.json().catch(() => null);
}

// ── lore articles ───────────────────────────────────────────────────────────

/** Lightweight article list (viewer-filtered server-side). */
export async function listArticles(opts = {}) {
  const params = new URLSearchParams();
  if (opts.folder) params.set("folder", String(opts.folder));
  if (opts.category) params.set("category", String(opts.category));
  if (opts.orderBy) params.set("orderBy", String(opts.orderBy));
  const qs = params.toString();
  const data = await getJson(`/api/lore/articles${qs ? `?${qs}` : ""}`);
  return Array.isArray(data?.articles) ? data.articles : [];
}

/** Full article by id or slug → { article (+blocks/metadata/tags), parent, mentions } | null. */
export async function getArticle(idOrSlug) {
  if (!idOrSlug) return null;
  return getJson(`/api/lore/articles/${encodeURIComponent(idOrSlug)}`);
}

/** Just an article's block layout (raw rows). */
export async function getArticleBlocks(id) {
  if (!id) return [];
  const data = await getJson(`/api/lore/articles/${encodeURIComponent(id)}/blocks`);
  return Array.isArray(data?.blocks) ? data.blocks : [];
}

// ── campaigns ─────────────────────────────────────────────────────────────

/** Campaigns the logged-in user can see (membership-filtered server-side). */
export async function listCampaigns() {
  const data = await getJson(`/api/campaigns`);
  return Array.isArray(data?.campaigns) ? data.campaigns : [];
}

export async function getCampaign(id) {
  if (!id) return null;
  const data = await getJson(`/api/campaigns/${encodeURIComponent(id)}`);
  return data?.campaign ?? null;
}

/** A campaign's homepage block layout (raw rows). */
export async function getCampaignHomeBlocks(id) {
  if (!id) return [];
  const data = await getJson(`/api/campaigns/${encodeURIComponent(id)}/home-blocks`);
  return Array.isArray(data?.blocks) ? data.blocks : [];
}

// ── system pages (Phase 4 — Option A via /api/d1/query) ─────────────────────
//
// A `&kind[anchor]` rule ref points at a SYSTEM PAGE (kind = the page identifier)
// and an entry (anchor = a `definition` block on that page). System pages are
// block layouts, so the viewer renders the whole page with the same block engine
// and scrolls to the anchor — no per-entry resolve needed. Reads go through the
// generic D1 proxy: `system_pages` / `system_page_blocks` are player-readable
// (NOT in the proxy's PROTECTED_READ_TABLES), so a plain SELECT passes the gate
// with just the Bearer token. Mirrors src/lib/systemPages.ts.

function slugify(s) {
  return String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Run a read-only SELECT through the D1 proxy. Returns the rows (`results`). */
async function queryD1(sql, params = []) {
  let res;
  try {
    res = await authFetch(`/api/d1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
  } catch (err) {
    if (String(err?.message).includes("Not logged in")) {
      throw new Error("Log in to your Dauligor account to view this content.");
    }
    throw new Error("Couldn't reach Dauligor (network or CORS).");
  }
  if (res.status === 401) throw new Error("Your Dauligor session expired — log in again.");
  if (!res.ok) throw new Error(`Dauligor request failed (HTTP ${res.status}).`);
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.results) ? data.results : [];
}

// ── reference-resolution caches ──────────────────────────────────────────────
// The system-pages list + kind map are fetched once and reused; the ref cache
// memoizes resolved entities (and known-missing ones, stored as null) by
// `kind:id`. All three are cleared by clearReferenceCache() — wired to the
// viewer's Refresh so edits made on the site appear without reopening Foundry.
let _systemPagesCache = null;
let _systemKindMapCache = null;
const _refCache = new Map();

export function clearReferenceCache() {
  _systemPagesCache = null;
  _systemKindMapCache = null;
  _refCache.clear();
}

/** All system pages (id/identifier/name/description), fetched once + cached. */
async function getSystemPagesList() {
  if (_systemPagesCache) return _systemPagesCache;
  const rows = await queryD1(`SELECT id, identifier, name, description, icon, "order" FROM system_pages`);
  _systemPagesCache = Array.isArray(rows) ? rows : [];
  return _systemPagesCache;
}

/**
 * Map a reference `kind` → the canonical system-page identifier it resolves to,
 * or undefined when no page owns that kind. Mirrors src/lib/systemPages.ts
 * getSystemPageKindMap: identifiers win, then name-slug aliases fill open slots
 * (so `&condition[…]` can find a page named "Conditions" / identifier `conditions`).
 */
async function getSystemPageKindMap() {
  if (_systemKindMapCache) return _systemKindMapCache;
  const pages = await getSystemPagesList();
  const map = new Map();
  for (const p of pages) {
    const id = String(p.identifier ?? "").toLowerCase();
    if (id) map.set(id, id);
  }
  for (const p of pages) {
    const id = String(p.identifier ?? "").toLowerCase();
    if (!id) continue;
    const ns = slugify(p.name);
    if (ns && !map.has(ns)) map.set(ns, id);
  }
  _systemKindMapCache = map;
  return map;
}

/**
 * Resolve a system-page KIND (a `&` ref kind) to its page row + block layout.
 * Honors the app's name-slug alias: a ref `&condition[...]` resolves a page whose
 * identifier is `conditions` if its name slugifies to `condition` (mirrors
 * getSystemPageKindMap). Returns `{ page, blocks }` or null when no page matches.
 */
export async function getSystemPage(kind) {
  const k = String(kind ?? "").trim().toLowerCase();
  if (!k) return null;
  const pages = await getSystemPagesList();
  if (!pages.length) return null;
  let page = pages.find((p) => String(p.identifier ?? "").toLowerCase() === k);
  if (!page) page = pages.find((p) => slugify(p.name) === k); // name-slug alias
  if (!page) return null;
  const blocks = await queryD1(
    `SELECT id, page_id, block_type, "order", config FROM system_page_blocks WHERE page_id = ? ORDER BY "order" ASC`,
    [page.id],
  );
  return { page, blocks: Array.isArray(blocks) ? blocks : [] };
}

// ── entity-reference resolution (display cards) ──────────────────────────────
//
// Entity-reference blocks (reference / entity-feature / entity-row / recommended)
// store EntityRefs `{ kind, id }` where `id` is the SEMANTIC identifier/slug, NOT
// a DB primary key. resolveReferences turns a batch of them into a Map keyed
// `kind:id` of display data `{ name, summary, image, sourceLabel, rule }` so the
// renderer can draw rich cards. Mirrors src/lib/references.ts resolveReference:
// system pages own a kind first (the `&` rule family); otherwise a static
// compendium/lore table by identifier. `rule` tells the renderer whether a card's
// link is a `&` system-page route (opens in-viewer) or an `@` entity route.
//
// Every table read here is player-readable through the D1 proxy (NOT in
// PROTECTED_READ_TABLES), so the logged-in user's Bearer token is enough.

// Static (non-system-page) kinds → table + columns. image/source only for
// class/subclass (matching the app — other kinds resolve to name + summary).
// `where` is an extra SQL predicate ANDed onto the id lookup. Backgrounds + species
// have their OWN tables (`backgrounds` / `species`, leaner camelCase columns —
// `_speciesBackgroundShared.ts`); the per-entity endpoints `/api/module/backgrounds`
// + `/api/module/races` (races read the `species` table) are keyed by those tables'
// `id`. The `feats` table holds standalone feats AND class/subclass features
// (discriminated by `feat_type`), so `feat` filters to standalone feats only
// (feat_type 'feat' or NULL) — case-insensitive, since the column isn't reliably
// lowercase.
const REF_KIND_TABLES = {
  spell:      { table: "spells",            idCol: "identifier", summary: "description" },
  class:      { table: "classes",           idCol: "identifier", summary: "COALESCE(NULLIF(preview, ''), description)", image: "COALESCE(NULLIF(card_image_url, ''), image_url)", source: "(SELECT abbreviation FROM sources WHERE sources.id = classes.source_id)", sourceSlug: "(SELECT slug FROM sources WHERE sources.id = classes.source_id)" },
  subclass:   { table: "subclasses",        idCol: "identifier", summary: "COALESCE(NULLIF(preview, ''), description)", image: "COALESCE(NULLIF(card_image_url, ''), image_url)", source: "(SELECT abbreviation FROM sources WHERE sources.id = subclasses.source_id)" },
  feat:       { table: "feats",             idCol: "identifier", where: "LOWER(COALESCE(feat_type, 'feat')) = 'feat'", summary: "description" },
  item:       { table: "items",             idCol: "identifier", summary: "description" },
  background: { table: "backgrounds",       idCol: "identifier", summary: "description" },
  species:    { table: "species",           idCol: "identifier", summary: "description" },
  race:       { table: "species",           idCol: "identifier", summary: "description" },
  condition:  { table: "status_conditions", idCol: "identifier", summary: "description" },
  article:    { table: "lore_articles",     idCol: "slug", nameCol: "title", summary: "excerpt" },
};

// Parse a system page's definition blocks (incl. nested in containers) into
// anchor → { name, body }. Self-contained so content-service doesn't depend on
// the renderer module.
function collectDefinitionEntries(blocks) {
  const map = new Map();
  const walk = (rows) => {
    for (const row of (Array.isArray(rows) ? rows : [])) {
      if (!row || typeof row !== "object") continue;
      const type = String(row.block_type ?? row.blockType ?? "");
      let config = row.config;
      if (typeof config === "string") { try { config = JSON.parse(config); } catch { config = {}; } }
      if (!config || typeof config !== "object") config = {};
      if (type === "definition" && config.anchor) {
        const anchor = String(config.anchor);
        if (!map.has(anchor)) map.set(anchor, { name: String(config.name || anchor), body: String(config.body || "") });
      }
      if (Array.isArray(config.children)) walk(config.children);
    }
  };
  walk(blocks);
  return map;
}

// Resolve a batch of ids for one static-table kind in a single SELECT.
async function resolveTableRefs(kind, ids, out) {
  const cfg = REF_KIND_TABLES[kind];
  if (!cfg) return; // unknown kind → stays unresolved (renderer marks it)
  const nameCol = cfg.nameCol || "name";
  // `id AS ref_docid` carries the DB primary key alongside the semantic id, so a
  // consumer can fetch the full Foundry-ready item by db id (on-demand import of
  // an `@spell[…]` reference). `id` is the slug used in the ref; `ref_docid` is
  // the table's primary key the `/api/module/<kind>/<dbId>.json` endpoint wants.
  const cols = [`${cfg.idCol} AS ref_id`, `id AS ref_docid`, `${nameCol} AS ref_name`, `${cfg.summary} AS ref_summary`];
  if (cfg.image) cols.push(`${cfg.image} AS ref_image`);
  if (cfg.source) cols.push(`${cfg.source} AS ref_source`);
  if (cfg.sourceSlug) cols.push(`${cfg.sourceSlug} AS ref_source_slug`);
  const placeholders = ids.map(() => "?").join(", ");
  const extraWhere = cfg.where ? ` AND ${cfg.where}` : "";
  const rows = await queryD1(
    `SELECT ${cols.join(", ")} FROM ${cfg.table} WHERE ${cfg.idCol} IN (${placeholders})${extraWhere}`,
    ids,
  );
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const id = String(row.ref_id ?? "");
    if (!id) continue;
    out.set(`${kind}:${id}`, {
      name: String(row.ref_name ?? id),
      summary: String(row.ref_summary ?? ""),
      image: row.ref_image ? String(row.ref_image) : null,
      sourceLabel: row.ref_source ? String(row.ref_source) : null,
      sourceSlug: row.ref_source_slug ? String(row.ref_source_slug) : null,
      docId: row.ref_docid != null ? String(row.ref_docid) : null,
      rule: false,
    });
  }
}

// Resolve a batch of ids that belong to a system page: definition blocks first
// (the canonical block-authored entries), then a legacy system_page_entries
// fallback for pages not yet block-migrated.
async function resolveSystemRefs(canonical, kind, ids, out) {
  const result = await getSystemPage(canonical);
  if (!result?.page) return;
  const defs = collectDefinitionEntries(result.blocks);
  const misses = [];
  for (const id of ids) {
    const d = defs.get(id);
    if (d) out.set(`${kind}:${id}`, { name: d.name || id, summary: d.body || "", image: null, sourceLabel: null, rule: true });
    else misses.push(id);
  }
  if (misses.length) await resolveLegacySystemEntries(result.page, kind, misses, out);
}

// Legacy system_page_entries fallback. Merges entity-backed source text
// (condition → status_conditions) the way the app's resolveEntries does, so a
// backed entry without its own name/summary still fills.
async function resolveLegacySystemEntries(page, kind, ids, out) {
  const placeholders = ids.map(() => "?").join(", ");
  let rows;
  try {
    rows = await queryD1(
      `SELECT identifier, name, summary, body, source_kind, source_id, image_url FROM system_page_entries WHERE page_id = ? AND identifier IN (${placeholders})`,
      [page.id, ...ids],
    );
  } catch {
    return; // entries table absent / unreadable → leave unresolved
  }
  rows = Array.isArray(rows) ? rows : [];
  const condIds = [...new Set(rows.filter((r) => r.source_kind === "condition" && r.source_id).map((r) => String(r.source_id)))];
  const condMap = {};
  if (condIds.length) {
    const ph = condIds.map(() => "?").join(", ");
    const crows = await queryD1(`SELECT id, name, description, image_url FROM status_conditions WHERE id IN (${ph})`, condIds);
    for (const c of (Array.isArray(crows) ? crows : [])) condMap[String(c.id)] = c;
  }
  for (const r of rows) {
    let name = String(r.name ?? "");
    let summary = String(r.summary ?? "");
    const body = String(r.body ?? "");
    let image = r.image_url ? String(r.image_url) : null;
    if (r.source_kind === "condition" && r.source_id && condMap[String(r.source_id)]) {
      const src = condMap[String(r.source_id)];
      if (!name) name = String(src.name ?? "");
      if (!summary) summary = String(src.description ?? "");
      if (!image) image = src.image_url ? String(src.image_url) : null;
    }
    if (!summary) summary = body;
    const id = String(r.identifier ?? "");
    if (id) out.set(`${kind}:${id}`, { name: name || id, summary, image, sourceLabel: null, rule: true });
  }
}

/**
 * Resolve a batch of EntityRefs to display data for cards. Returns a Map keyed
 * `kind:id` → { name, summary, image, sourceLabel, rule }. Unresolved refs are
 * absent from the map (and cached as null) so the renderer can mark them
 * "reference not yet made". Placeholder + id-less refs are skipped.
 */
export async function resolveReferences(refs) {
  const out = new Map();
  const want = new Map(); // key → { kind, id }
  for (const r of (Array.isArray(refs) ? refs : [])) {
    if (!r || typeof r !== "object") continue;
    const kind = String(r.kind || "");
    const id = String(r.id || "");
    if (!kind || kind === "placeholder" || !id) continue;
    const key = `${kind}:${id}`;
    if (_refCache.has(key)) {
      const v = _refCache.get(key);
      if (v) out.set(key, v);
      continue;
    }
    if (!want.has(key)) want.set(key, { kind, id });
  }
  if (!want.size) return out;

  const byKind = new Map();
  for (const { kind, id } of want.values()) {
    if (!byKind.has(kind)) byKind.set(kind, new Set());
    byKind.get(kind).add(id);
  }

  let kindMap;
  try { kindMap = await getSystemPageKindMap(); } catch { kindMap = new Map(); }

  await Promise.all([...byKind.entries()].map(async ([kind, idSet]) => {
    const ids = [...idSet];
    try {
      const canonical = kindMap.get(String(kind).toLowerCase());
      if (canonical) await resolveSystemRefs(canonical, kind, ids, out);
      else await resolveTableRefs(kind, ids, out);
    } catch (err) {
      log(`resolveReferences: '${kind}' failed`, err);
    }
    // Cache every wanted id (resolved or null) so we don't refetch it.
    for (const id of ids) {
      const key = `${kind}:${id}`;
      _refCache.set(key, out.get(key) ?? null);
    }
  }));

  return out;
}
