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

/**
 * Resolve a `&kind[anchor]` rule reference to its system-page entry, via the
 * generic D1 query proxy (system_pages / system_page_blocks are player-readable).
 * Stubbed until the system-page phase; documented here so the contract is fixed.
 */
export async function resolveSystemEntry(/* kind, anchor */) {
  log("content-service: resolveSystemEntry not wired yet (Phase 4)");
  return null;
}
