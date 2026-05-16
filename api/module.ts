import path from "node:path";
import fs from "node:fs";
import {
  buildClassBundleForIdentifier,
  buildSourceClassCatalog,
  buildTopLevelCatalog,
  rebakeBundle,
} from "./_lib/module-export-pipeline.js";
import { buildClassSpellListByIdentifier } from "./_lib/_classSpellList.js";
import { buildSpellItemBundle } from "./_lib/_spellExport.js";
import { SERVER_EXPORT_FETCHERS } from "./_lib/d1-fetchers-server.js";
import {
  classBundleKey,
  MODULE_EXPORT_CACHE_HEADER,
  readBundle,
  sourceClassCatalogKey,
  topLevelCatalogKey,
  warmPublicUrlsForKeys,
  writeBundle,
} from "./_lib/module-export-store.js";
import {
  clearForRebake,
  popDueEntries,
  queueRebake,
  type ExportEntityKind,
} from "./_lib/module-export-queue.js";
import { HttpError, requireStaffAccess } from "./_lib/firebase-admin.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function serveCached(res: any, body: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", MODULE_EXPORT_CACHE_HEADER);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/**
 * Serve a live-built bundle with a short HTTP cache.
 *
 * Used by the per-class spell-list endpoint, which deliberately
 * skips the R2 layer: spell-list churn (manual curation, rule-driven
 * recompute on spell tag edits) used to require a class rebake to
 * propagate. By serving live from D1 with a 60-second `max-age`
 * (no `s-maxage`, so Vercel's CDN doesn't pin the result longer
 * than the browser), edits become visible to the Foundry module on
 * the next import without any rebake step.
 *
 * D1 cost is one membership query + one spells query per request.
 * For pools of 20-100 spells (typical class size) this is in the
 * tens of milliseconds.
 */
function serveLive(res: any, body: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function getOrBuild<T>(
  key: string,
  build: () => Promise<T | null>,
): Promise<T | null> {
  const cached = await readBundle<T>(key);
  if (cached) return cached;

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

async function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function parseEntityFromBody(body: any): { kind: ExportEntityKind; id: string } | null {
  const kind = String(body?.kind ?? "").trim();
  const id = String(body?.id ?? "").trim();
  if (!kind || !id) return null;
  if (!VALID_KINDS.has(kind as ExportEntityKind)) return null;
  return { kind: kind as ExportEntityKind, id };
}

// Background queue processing — kicks off opportunistically on read traffic
// without blocking the response. Vercel's runtime keeps the function alive
// briefly after `res.end()`, which is enough for one rebake cycle.
function processQueueOpportunistically(budget: number = 1) {
  popDueEntries(budget)
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

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url || "", "http://localhost");
  let subpath = urlObj.pathname.replace(/^\/api\/module\/?/, "");

  let cleanSubpath = subpath;
  if (cleanSubpath === "sources" || cleanSubpath === "sources/") {
    cleanSubpath = "";
  } else if (cleanSubpath.startsWith("sources/")) {
    cleanSubpath = cleanSubpath.slice("sources/".length);
  }

  const pathParts = cleanSubpath ? cleanSubpath.split("/") : [];

  // ── POST endpoints (queue + manual bake) ─────────────────────────────────
  if (req.method === "POST") {
    try {
      if (cleanSubpath === "queue-rebake") {
        await requireStaffAccess(req.headers.authorization);
        const body = await readJsonBody(req);
        const entry = parseEntityFromBody(body);
        if (!entry) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "Body must be { kind, id } with a known entity kind." }));
        }
        await queueRebake(entry.kind, entry.id);
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ queued: entry, scheduledFor: Date.now() + 60 * 60 * 1000 }));
      }

      if (cleanSubpath === "rebake-now") {
        await requireStaffAccess(req.headers.authorization);
        const body = await readJsonBody(req);
        const entry = parseEntityFromBody(body);
        if (!entry) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "Body must be { kind, id } with a known entity kind." }));
        }
        const written = await rebakeBundle(entry.kind, entry.id);
        // The user explicitly chose to bake, so any pending queue entry for
        // this exact entity is satisfied. Other classes that may also depend
        // on this entity (e.g. an option-group cascading to multiple classes)
        // were rebaked above; their queue entries (if any) keep their own
        // last_edit_at and will fire normally.
        await clearForRebake(entry.kind, entry.id);
        // Warm Vercel CDN for the just-rebaked URLs. Without this, the
        // very next external reader past the s-maxage window would still
        // get the stale CDN entry while SWR refreshes in the background;
        // by warming proactively the next reader gets fresh content
        // immediately. Best-effort — failures don't break the response.
        await warmPublicUrlsForKeys(written);
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ rebaked: entry, written }));
      }
    } catch (error: any) {
      if (error instanceof HttpError) {
        res.statusCode = error.status;
        return res.end(JSON.stringify({ error: error.message }));
      }
      console.error("[module] POST handler failed", { error });
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: error?.message ?? "Internal server error." }));
    }

    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "Unknown POST endpoint" }));
  }

  // ── GET endpoints (read-through cache) ───────────────────────────────────
  // Kick off background queue processing — fire-and-forget; Vercel will
  // keep the isolate alive briefly after the response completes, which is
  // enough for one rebake. If the function is killed early, the queue
  // entry stays for the next request.
  processQueueOpportunistically(1);

  try {
    if (!cleanSubpath || cleanSubpath === "catalog.json") {
      const result = await getOrBuild(topLevelCatalogKey(), buildTopLevelCatalog);
      if (result) return serveCached(res, result);
    }

    else if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2] === "catalog.json") {
      const sourceSlug = pathParts[0].toLowerCase();
      const result = await getOrBuild(
        sourceClassCatalogKey(sourceSlug),
        () => buildSourceClassCatalog(sourceSlug),
      );
      if (result) return serveCached(res, result);
    }

    else if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2].endsWith(".json")) {
      const sourceSlug = pathParts[0].toLowerCase();
      const classIdentifier = pathParts[2].replace(".json", "").toLowerCase();
      const result = await getOrBuild(
        classBundleKey(sourceSlug, classIdentifier),
        () => buildClassBundleForIdentifier(classIdentifier),
      );
      if (result) return serveCached(res, result);
    }

    // Per-class spell list — live read-through, NOT R2-cached. URL:
    //   /api/module/<source>/classes/<class>/spells.json
    // Spell-list edits (manual curation, rule-driven recompute on
    // spell tag changes) used to require a class rebake to land in
    // the actor importer. By splitting the spell list off and serving
    // it live with a short HTTP cache, edits propagate to the Foundry
    // module on the next import — no rebake step needed.
    //
    // The class bundle no longer ships `classSpellItems` (the Foundry
    // module now fetches this endpoint separately during class
    // import). See docs/features/foundry-export.md and
    // module/dauligor-pairing/docs/spell-picker-by-type.md.
    else if (
      pathParts.length === 4
      && pathParts[1] === "classes"
      && pathParts[3] === "spells.json"
    ) {
      // sourceSlug is captured for forward-compat / logging but not
      // consumed by the builder — we resolve directly by class
      // identifier, which is globally unique across sources in the
      // current schema. If that ever changes, the builder gains a
      // sourceSlug filter and this passes it through.
      const _sourceSlug = pathParts[0].toLowerCase();
      const classIdentifier = pathParts[2].toLowerCase();
      const result = await buildClassSpellListByIdentifier(
        classIdentifier,
        SERVER_EXPORT_FETCHERS,
      );
      if (result) return serveLive(res, result);
      // Fall through to 404 if the class identifier didn't match.
    }

    // Per-spell full item — live read-through. URL:
    //   /api/module/spells/<dbId>.json
    // The Foundry importer's embed phase fetches each picked spell
    // from this endpoint to get the full `system` block + effects.
    // The class spell-list endpoint above ships LIGHTWEIGHT summaries
    // (~80% smaller); this fills in the rest only for the handful of
    // spells the user actually picks. See `_classSpellList.ts` and
    // `_spellExport.ts` for the split rationale.
    else if (
      pathParts.length === 2
      && pathParts[0] === "spells"
      && pathParts[1].endsWith(".json")
    ) {
      const dbId = pathParts[1].replace(".json", "");
      const result = await buildSpellItemBundle(dbId, SERVER_EXPORT_FETCHERS);
      if (result) return serveLive(res, result);
      // Fall through to 404 if no spell row matched.
    }
  } catch (error) {
    console.error("Dynamic Module API Error:", error);
  }

  // ── Fallback: serve static fixture files under module/dauligor-pairing ──
  let filePath = path.join(process.cwd(), "module/dauligor-pairing/data/sources", cleanSubpath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "catalog.json");
  } else if (!filePath.endsWith(".json")) {
    if (fs.existsSync(filePath + ".json")) {
      filePath = filePath + ".json";
    } else if (fs.existsSync(path.join(filePath, "catalog.json"))) {
      filePath = path.join(filePath, "catalog.json");
    }
  }

  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "application/json");
    return res.end(fs.readFileSync(filePath, "utf-8"));
  }

  res.statusCode = 404;
  return res.end(JSON.stringify({ error: `Source not found at: ${subpath}` }));
}
