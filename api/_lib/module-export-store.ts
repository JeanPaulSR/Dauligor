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
// `configuration.scale` shape); v5 → v6 (ScaleValue is now type-aware
// per the column's `type` field — dice columns export
// `{ number, faces, modifiers }` per level instead of `{ value: "1d6" }`,
// and `distance.units` ships explicitly).
// Old prefixes are orphaned in R2; safe to delete.
const EXPORT_PREFIX = "module-export/v6";

// 60s browser cache, 5min CDN cache, 5min stale-while-revalidate.
//
// The previous `stale-while-revalidate=86400` (24h) was overly generous:
// after `rebake-now` succeeded and R2 was already fresh, the first reader
// past the 5-min `s-maxage` window got a stale CDN response *and* kicked
// off the background revalidation — but only the second reader saw the
// fresh content. With low-traffic endpoints, that "second reader" could
// be 10+ minutes away, making manual bakes feel broken.
//
// Reducing SWR to 5min caps worst-case staleness at 10min (`s-maxage` +
// SWR window) and removes the surprise. Manual bakes now also call
// `warmPublicUrlsForKeys()` after writing R2, which trips the SWR
// refresh proactively so the very next external reader gets fresh
// content even without us waiting 5min.
const PUBLIC_CACHE_HEADER = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";

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

// ── CDN warming ─────────────────────────────────────────────────────────────

/**
 * After a fresh R2 write, fire one HEAD-equivalent fetch per affected
 * URL through Vercel so the function runs against the new R2 content
 * and the CDN cache entry is replaced with the fresh body.
 *
 * Without this, the next *external* reader would hit Vercel's existing
 * stale entry, get served stale, and only THEN trigger the
 * `stale-while-revalidate` background refresh — so the user who hit
 * "Bake Now" might re-fetch and see their *old* data while the system
 * silently warms in the background. By doing the warm-up ourselves on
 * the bake path, the very next external reader gets fresh content.
 *
 * Strict best-effort: each fetch has a short timeout, swallows errors,
 * and never blocks the rebake response. The bake itself already wrote
 * R2 successfully by the time this runs; warming is just a UX nicety.
 *
 * R2 keys look like `module-export/v6/ll/classes/foo.json`. The
 * corresponding Vercel URL is
 * `https://<host>/api/module/ll/classes/foo.json`. We strip the
 * `${EXPORT_PREFIX}/` prefix and prepend the public origin.
 *
 * `process.env.PUBLIC_SITE_URL` is the origin the Vercel function
 * should warm against (e.g. `https://www.dauligor.com`). Falls back to
 * `https://${VERCEL_URL}` (Vercel's per-deployment hostname) when
 * unset — that path works in preview deployments too. If neither is
 * available the helper exits silently.
 */
function getPublicSiteUrl(): string | null {
  const explicit = (process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return null;
}

export function publicUrlForBundleKey(key: string): string | null {
  const siteUrl = getPublicSiteUrl();
  if (!siteUrl) return null;
  const stripped = key.startsWith(`${EXPORT_PREFIX}/`)
    ? key.slice(EXPORT_PREFIX.length + 1)
    : key;
  return `${siteUrl}/api/module/${stripped}`;
}

export async function warmPublicUrlsForKeys(keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  const urls = keys.map((k) => publicUrlForBundleKey(k)).filter((u): u is string => !!u);
  if (!urls.length) return;

  // Per-request 3s timeout. The function only needs to fetch from R2
  // and re-serialize, so 3s is generous; if Vercel is slower than that
  // the warm step would block the bake response and any future
  // external reader would still get the SWR-promoted bundle anyway.
  await Promise.all(urls.map(async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        // Send a header the function can log if needed. Not gated on —
        // any GET against the URL triggers the same CDN-warm effect.
        headers: { "x-dauligor-warm": "rebake-now" },
      });
    } catch (error) {
      // Swallow — R2 is already fresh, this is just a nicety.
      console.warn("[module-export-store] warmPublicUrlsForKeys: fetch failed", { url, error });
    } finally {
      clearTimeout(timer);
    }
  }));
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
