// /api/module/* — public Foundry module export endpoint.
//
// Read paths flow through getOrBuild (R2 read-through cache) or
// live-built handlers for the surfaces that deliberately skip R2.
// Staff-only POST paths drive the rebake pipeline.
//
// Read endpoints (public, GET):
//   /api/module/catalog.json
//   /api/module/sources/catalog.json          (the "sources/" prefix is stripped)
//   /api/module/<source>/classes/catalog.json
//   /api/module/<source>/classes/<class>.json
//   /api/module/<source>/classes/<class>/spells.json   (live, no R2)
//   /api/module/spells/<dbId>.json                     (live, no R2)
//   /api/module/<source>/spells.json                   (live, no R2)
//   /api/module/feats/<dbId>.json                      (live, no R2)
//   /api/module/<source>/feats.json                    (live, no R2)
//   /api/module/tags/catalog.json                      (live, no R2)
//
// Write endpoints (staff-only, POST):
//   /api/module/queue-rebake     — queue a rebake (60-minute scheduled-for)
//   /api/module/rebake-now       — fire a rebake immediately + warm CDN
//
// Opportunistic background queue processing: every GET request kicks off
// at most one pending rebake via context.waitUntil. The isolate stays
// alive past the response while the rebake finishes, matching the
// Vercel-era pattern that relied on the runtime keeping the function
// alive briefly after res.end().

import {
  buildClassBundleForIdentifier,
  buildSourceClassCatalog,
  buildTopLevelCatalog,
  rebakeBundle,
} from "../../../api/_lib/module-export-pipeline.js";
import { buildClassSpellListByIdentifier } from "../../../api/_lib/_classSpellList.js";
import { buildSourceSpellListBundle } from "../../../api/_lib/_sourceSpellList.js";
import { buildSpellItemBundle } from "../../../api/_lib/_spellExport.js";
import { buildSourceFeatListBundle } from "../../../api/_lib/_sourceFeatList.js";
import { buildFeatItemBundle } from "../../../api/_lib/_featExport.js";
import { buildItemBundle } from "../../../api/_lib/_itemExport.js";
import { buildTagCatalog } from "../../../api/_lib/_tagCatalog.js";
import { SERVER_EXPORT_FETCHERS } from "../../../api/_lib/d1-fetchers-server.js";
import {
  classBundleKey,
  MODULE_EXPORT_CACHE_HEADER,
  readBundle,
  sourceClassCatalogKey,
  topLevelCatalogKey,
  warmPublicUrlsForKeys,
  writeBundle,
} from "../../../api/_lib/module-export-store.js";
import {
  clearForRebake,
  popDueEntries,
  queueRebake,
  type ExportEntityKind,
} from "../../../api/_lib/module-export-queue.js";
import { HttpError, requireStaffAccess } from "../../../api/_lib/firebase-admin.js";

// ── Response helpers ───────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function serveCached(body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": MODULE_EXPORT_CACHE_HEADER,
    },
  });
}

/**
 * Live-built response with a short HTTP cache. Used by the per-class
 * spell list, per-spell, per-source spell list, and tag catalog
 * endpoints — they deliberately skip the R2 layer so edits propagate
 * to the Foundry module on the next import without a rebake step.
 * `max-age=60` only (no `s-maxage`) so the edge cache doesn't pin
 * results longer than the browser does.
 */
function serveLive(body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });
}

function serveJson(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

// ── Builder cache (R2 read-through) ────────────────────────────────────────

async function getOrBuild<T>(
  key: string,
  build: () => Promise<T | null>,
  isValidCache?: (cached: T) => boolean,
): Promise<T | null> {
  const cached = await readBundle<T>(key);
  // Optional validity gate — used when a server-side change adds a
  // new required field to the bundle shape. Without this, R2 would
  // happily keep serving the pre-change cached blob until something
  // explicitly rebakes the key. The validator returns false on a
  // stale shape, which triggers a live rebuild + write-through.
  if (cached && (!isValidCache || isValidCache(cached))) return cached;

  const fresh = await build();
  if (fresh) {
    // Fire-and-forget — we don't want a slow R2 write to slow the response,
    // and a write failure shouldn't kill the request.
    writeBundle(key, fresh).catch((error) => {
      console.warn("[module] writeBundle failed (fire-and-forget)", { key, error });
    });
  }
  return fresh;
}

const VALID_KINDS: ReadonlySet<ExportEntityKind> = new Set([
  "class", "subclass", "feature", "scalingColumn", "optionGroup", "optionItem", "source",
]);

function parseEntityFromBody(body: any): { kind: ExportEntityKind; id: string } | null {
  const kind = String(body?.kind ?? "").trim();
  const id = String(body?.id ?? "").trim();
  if (!kind || !id) return null;
  if (!VALID_KINDS.has(kind as ExportEntityKind)) return null;
  return { kind: kind as ExportEntityKind, id };
}

/**
 * Background queue drainer. Pulls due rebake entries and runs at most
 * `budget` of them. Returns the promise so the caller can pass it to
 * `context.waitUntil()` — Workers keeps the isolate alive past the
 * response while the rebake finishes. Mirrors the Vercel-era pattern
 * that relied on the runtime keeping the function alive briefly after
 * `res.end()`.
 */
function processQueueOpportunistically(budget: number = 1): Promise<void> {
  return popDueEntries(budget)
    .then(async (entries) => {
      for (const entry of entries) {
        try {
          const written = await rebakeBundle(entry.kind, entry.id);
          if (written.length) {
            console.log("[module] opportunistic rebake", { kind: entry.kind, id: entry.id, written });
          }
        } catch (error) {
          console.warn("[module] opportunistic rebake failed", { entry, error });
        }
      }
    })
    .catch((error) => {
      console.warn("[module] popDueEntries failed", { error });
    });
}

// ── Handler ────────────────────────────────────────────────────────────────

export const onRequest = async (context: any): Promise<Response> => {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  let subpath = url.pathname.replace(/^\/api\/module\/?/, "");

  // The Foundry side hits `/api/module/sources/catalog.json` for the
  // top-level source list; strip the `sources/` prefix so the
  // dispatcher below can treat it as the root catalog.
  let cleanSubpath = subpath;
  if (cleanSubpath === "sources" || cleanSubpath === "sources/") {
    cleanSubpath = "";
  } else if (cleanSubpath.startsWith("sources/")) {
    cleanSubpath = cleanSubpath.slice("sources/".length);
  }

  const pathParts = cleanSubpath ? cleanSubpath.split("/") : [];

  // ── POST endpoints (queue + manual bake) ─────────────────────────────────
  if (request.method === "POST") {
    try {
      if (cleanSubpath === "queue-rebake") {
        await requireStaffAccess(request.headers.get("authorization") ?? undefined);
        const body = (await request.json().catch(() => ({}))) as any;
        const entry = parseEntityFromBody(body);
        if (!entry) {
          return serveJson(400, { error: "Body must be { kind, id } with a known entity kind." });
        }
        await queueRebake(entry.kind, entry.id);
        return serveJson(200, { queued: entry, scheduledFor: Date.now() + 60 * 60 * 1000 });
      }

      if (cleanSubpath === "rebake-now") {
        await requireStaffAccess(request.headers.get("authorization") ?? undefined);
        const body = (await request.json().catch(() => ({}))) as any;
        const entry = parseEntityFromBody(body);
        if (!entry) {
          return serveJson(400, { error: "Body must be { kind, id } with a known entity kind." });
        }
        const written = await rebakeBundle(entry.kind, entry.id);
        // The user explicitly chose to bake, so any pending queue entry for
        // this exact entity is satisfied. Other classes that may also depend
        // on this entity (e.g. an option-group cascading to multiple classes)
        // were rebaked above; their queue entries (if any) keep their own
        // last_edit_at and will fire normally.
        await clearForRebake(entry.kind, entry.id);
        // Warm the CDN for the just-rebaked URLs. Without this, the very
        // next external reader past the s-maxage window would still get
        // the stale CDN entry while SWR refreshes in the background.
        // Best-effort — failures don't break the response.
        await warmPublicUrlsForKeys(written);
        return serveJson(200, { rebaked: entry, written });
      }
    } catch (error: any) {
      if (error instanceof HttpError) {
        return serveJson(error.status, { error: error.message });
      }
      console.error("[module] POST handler failed", { error });
      return serveJson(500, { error: error?.message ?? "Internal server error." });
    }

    return serveJson(404, { error: "Unknown POST endpoint" });
  }

  // ── GET endpoints (read-through cache) ───────────────────────────────────
  // Kick off background queue processing via context.waitUntil — Workers
  // keeps the isolate alive while it finishes, same effective behaviour as
  // the Vercel-era reliance on post-`res.end()` isolate longevity.
  if (typeof context.waitUntil === "function") {
    context.waitUntil(processQueueOpportunistically(1));
  }

  try {
    if (!cleanSubpath || cleanSubpath === "catalog.json") {
      // Stale-shape detector: catalogs baked before the spell-count
      // patch don't carry `supportedImportTypes` on each entry, and
      // their `counts.spells` was hard-coded to 0. The Foundry
      // importer's Spells wizard relies on both to filter
      // spell-capable sources, so a stale catalog leaves the picker
      // empty. Rebuilding on detection lets the cache self-heal
      // without a manual rebake.
      //
      // Also reject catalogs that pre-date the feat-count patch — the
      // `counts.feats` field is part of the shape now (Number, not
      // missing), and the Foundry Feats wizard reads it the same way
      // the Spells wizard reads `counts.spells`.
      const result = await getOrBuild(
        topLevelCatalogKey(),
        buildTopLevelCatalog,
        (cached: any) => {
          const entries = cached?.entries ?? [];
          if (!entries.length) return true; // empty catalog is fine
          return entries.every(
            (e: any) =>
              Array.isArray(e?.supportedImportTypes)
              && typeof e?.counts?.feats === "number",
          );
        },
      );
      if (result) return serveCached(result);
    }

    else if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2] === "catalog.json") {
      const sourceSlug = pathParts[0].toLowerCase();
      const result = await getOrBuild(
        sourceClassCatalogKey(sourceSlug),
        () => buildSourceClassCatalog(sourceSlug),
      );
      if (result) return serveCached(result);
    }

    else if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2].endsWith(".json")) {
      const sourceSlug = pathParts[0].toLowerCase();
      const classIdentifier = pathParts[2].replace(".json", "").toLowerCase();
      const result = await getOrBuild(
        classBundleKey(sourceSlug, classIdentifier),
        () => buildClassBundleForIdentifier(classIdentifier),
      );
      if (result) return serveCached(result);
    }

    // Per-class spell list — live read-through, NOT R2-cached. URL:
    //   /api/module/<source>/classes/<class>/spells.json
    // Spell-list edits (manual curation, rule-driven recompute on
    // spell tag changes) used to require a class rebake to land in
    // the actor importer. By splitting the spell list off and serving
    // it live with a short HTTP cache, edits propagate to the Foundry
    // module on the next import — no rebake step needed.
    else if (
      pathParts.length === 4
      && pathParts[1] === "classes"
      && pathParts[3] === "spells.json"
    ) {
      // sourceSlug captured for forward-compat / logging but not
      // consumed by the builder — we resolve directly by class
      // identifier, which is globally unique across sources in the
      // current schema.
      const _sourceSlug = pathParts[0].toLowerCase();
      const classIdentifier = pathParts[2].toLowerCase();
      const result = await buildClassSpellListByIdentifier(
        classIdentifier,
        SERVER_EXPORT_FETCHERS,
      );
      if (result) return serveLive(result);
      // Fall through to 404 if the class identifier didn't match.
    }

    // Per-spell full item — live read-through. URL:
    //   /api/module/spells/<dbId>.json
    // The Foundry importer's embed phase fetches each picked spell
    // from this endpoint to get the full `system` block + effects.
    else if (
      pathParts.length === 2
      && pathParts[0] === "spells"
      && pathParts[1].endsWith(".json")
    ) {
      const dbId = pathParts[1].replace(".json", "");
      const result = await buildSpellItemBundle(dbId, SERVER_EXPORT_FETCHERS);
      if (result) return serveLive(result);
      // Fall through to 404 if no spell row matched.
    }

    // Per-source spell list — live read-through, no R2 cache. URL:
    //   /api/module/<source>/spells.json
    // The `pathParts[0] === "spells"` check above is ordered BEFORE
    // this one so `/api/module/spells/<dbId>.json` still routes to
    // the per-spell handler (never to this one, since `dbId.json`
    // doesn't equal `"spells.json"`).
    else if (
      pathParts.length === 2
      && pathParts[1] === "spells.json"
    ) {
      const slug = pathParts[0].toLowerCase();
      const result = await buildSourceSpellListBundle(slug, SERVER_EXPORT_FETCHERS);
      if (result) return serveLive(result);
      // Fall through to 404 if the source slug didn't match.
    }

    // Per-feat full item — live read-through. URL:
    //   /api/module/feats/<dbId>.json
    // Mirrors `/api/module/spells/<dbId>.json`. The Foundry feat
    // browser fetches the full feat from this endpoint after the user
    // picks a row in the lightweight summary pool.
    else if (
      pathParts.length === 2
      && pathParts[0] === "feats"
      && pathParts[1].endsWith(".json")
    ) {
      const dbId = pathParts[1].replace(".json", "");
      const result = await buildFeatItemBundle(dbId, SERVER_EXPORT_FETCHERS);
      if (result) return serveLive(result);
      // Fall through to 404 if no feat row matched.
    }

    // Per-item full document — live read-through, no R2 cache. URL:
    //   /api/module/items/<dbId>.json
    // Phase B.2 of the non-class scaling track: ships the full
    // Foundry-ready item document with synthesized ScaleValue
    // advancements from owner-scoped `scaling_columns` rows. Mirrors
    // the spell / feat detail endpoints in shape but for items.
    // Module-side consumer (an item importer paralleling the feat
    // one) is the next infrastructure step — flagged in
    // docs/roadmap.md § Scaling columns for non-class owners.
    else if (
      pathParts.length === 2
      && pathParts[0] === "items"
      && pathParts[1].endsWith(".json")
    ) {
      const dbId = pathParts[1].replace(".json", "");
      const result = await buildItemBundle(dbId, SERVER_EXPORT_FETCHERS);
      if (result) return serveLive(result);
      // Fall through to 404 if no item row matched.
    }

    // Per-source feat list — live read-through, no R2 cache. URL:
    //   /api/module/<source>/feats.json
    // Mirrors the per-source spell list endpoint. Ordered AFTER the
    // `pathParts[0] === "feats"` arm so `/api/module/feats/<dbId>.json`
    // still routes to the per-feat handler.
    else if (
      pathParts.length === 2
      && pathParts[1] === "feats.json"
    ) {
      const slug = pathParts[0].toLowerCase();
      const result = await buildSourceFeatListBundle(slug, SERVER_EXPORT_FETCHERS);
      if (result) return serveLive(result);
      // Fall through to 404 if the source slug didn't match.
    }

    // Public tag catalog — live read-through, no R2 cache. URL:
    //   /api/module/tags/catalog.json
    // The Foundry Prepare Spells manager fetches this on open so it
    // can resolve `flags.dauligor-pairing.tagIds` on spell summaries
    // and render Tag-group filter sections matching the public
    // /compendium/spells filter UI.
    else if (
      pathParts.length === 2
      && pathParts[0] === "tags"
      && pathParts[1] === "catalog.json"
    ) {
      const result = await buildTagCatalog();
      if (result) return serveLive(result);
    }
  } catch (error) {
    console.error("Dynamic Module API Error:", error);
  }

  // No live builder matched this path. In normal operation R2 is
  // populated by the bake pipeline (`POST /api/module/rebake-now` + the
  // queue-driven cascade); any path that didn't hit a live builder is
  // genuinely unmapped.
  return serveJson(404, { error: `Module path not found: ${subpath}` });
};
