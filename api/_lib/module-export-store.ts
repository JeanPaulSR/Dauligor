// Server-side cache layer for `/api/module/*` exports.
//
// Reads go to R2 directly via the public URL — `https://images.dauligor.com`
// is fronted by Cloudflare's CDN, so a hot bundle is an edge-cached HTTP GET
// from inside the Vercel function. Writes/deletes go through the project
// Worker (which holds the R2 binding) using the same `R2_API_SECRET` the rest
// of the project uses.
//
// All helpers swallow errors and return null/false rather than throwing — R2
// outages should never break the module endpoints; the caller falls back to
// a live D1 build.

const PUBLIC_URL_FALLBACK = "https://images.dauligor.com";
// Bumped v1 → v2 (catalog grew `tags`+`subclasses[]`); v2 → v3 (per-class
// `shortName`); v3 → v4 (per-subclass `shortName`); v4 → v5 (ScaleValue
// advancement export now writes `configuration.scale: { "<level>": { value }}`
// instead of the wrong `configuration.values: { "<level>": "raw" }` —
// dnd5e's roll-data layer needs the canonical shape so `@scale.<class>.<id>`
// references resolve on the sheet (Barbarian's Rage uses formula was the
// visible symptom). Old prefixes are orphaned in R2; safe to delete.
const EXPORT_PREFIX = "module-export/v5";

// 60s browser cache, 5min CDN cache, stale-while-revalidate 24h. Tuned for
// "edits are infrequent, reads are constant". Tweaked higher than typical
// because invalidations are explicit (rebake-now / queue) — the CDN value
// is a worst-case bound on staleness from background reads.
const PUBLIC_CACHE_HEADER = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

function getPublicBaseUrl() {
  return (process.env.R2_PUBLIC_URL || PUBLIC_URL_FALLBACK).replace(/\/+$/, "");
}

function getWorkerConfig() {
  const workerUrl = process.env.R2_WORKER_URL;
  const apiSecret = process.env.R2_API_SECRET;
  if (!workerUrl || !apiSecret) return null;
  return { workerUrl: workerUrl.endsWith("/") ? workerUrl : `${workerUrl}/`, apiSecret };
}

export const MODULE_EXPORT_CACHE_HEADER = PUBLIC_CACHE_HEADER;

// ── Key helpers ─────────────────────────────────────────────────────────────

export function topLevelCatalogKey() {
  return `${EXPORT_PREFIX}/catalog.json`;
}

export function sourceClassCatalogKey(sourceSlug: string) {
  return `${EXPORT_PREFIX}/${sourceSlug}/classes/catalog.json`;
}

export function classBundleKey(sourceSlug: string, classIdentifier: string) {
  return `${EXPORT_PREFIX}/${sourceSlug}/classes/${classIdentifier}.json`;
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function readBundle<T = unknown>(key: string): Promise<T | null> {
  try {
    const url = `${getPublicBaseUrl()}/${key}`;
    // `cache: "no-store"` so the Vercel function's own runtime fetch cache
    // doesn't shadow R2 invalidations. The Cloudflare edge ahead of R2 is the
    // cache we actually want; that one honours object-level Cache-Control.
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) return null;

    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn("[module-export-store] readBundle failed", { key, error });
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

export async function writeBundle(key: string, value: unknown): Promise<boolean> {
  const config = getWorkerConfig();
  if (!config) {
    console.warn("[module-export-store] writeBundle skipped — worker not configured");
    return false;
  }

  try {
    const target = new URL("raw", config.workerUrl);
    target.searchParams.set("key", key);

    const response = await fetch(target.toString(), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.apiSecret}`,
        "Content-Type": "application/json",
        "Cache-Control": PUBLIC_CACHE_HEADER,
      },
      body: JSON.stringify(value),
    });
    return response.ok;
  } catch (error) {
    console.warn("[module-export-store] writeBundle failed", { key, error });
    return false;
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteBundle(key: string): Promise<boolean> {
  const config = getWorkerConfig();
  if (!config) {
    console.warn("[module-export-store] deleteBundle skipped — worker not configured");
    return false;
  }

  try {
    const target = new URL("delete", config.workerUrl);
    target.searchParams.set("key", key);

    const response = await fetch(target.toString(), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.apiSecret}` },
    });
    return response.ok;
  } catch (error) {
    console.warn("[module-export-store] deleteBundle failed", { key, error });
    return false;
  }
}
