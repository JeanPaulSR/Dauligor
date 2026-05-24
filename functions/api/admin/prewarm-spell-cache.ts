// /api/admin/prewarm-spell-cache — refresh `consumer_spell_list_cache`
//
// Re-computes any cache row whose input fingerprint has gone stale
// (different applied-rule set, spell write, tag write, or rule write
// since the last compute) and writes the new spell-id list back. Rows
// whose fingerprint still matches are skipped — cheap (4 small queries
// per consumer) versus the ~100ms recompute cost.
//
// Phase 4.5 of the spell-list-resolution rework. Called by the worker
// `scheduled` handler (see worker/index.js + wrangler.toml's cron
// triggers) so the first user reads after a content edit always hit
// the cache. Admins can also POST this manually — useful for a
// post-bulk-import warmup.
//
// Auth: shares the worker's `R2_API_SECRET` (same value the Pages
// Functions use when proxying D1 queries through the worker). The
// scheduled handler passes `Authorization: Bearer ${API_SECRET}`;
// nothing else can call it. No Firebase auth — this is server-to-
// server only.
//
// Response shape:
//   { ok: true, scanned, recomputed, hits, errors, durationMs }
// On non-fatal per-consumer errors the count is reflected in `errors`
// but the overall request still 200s — one stale consumer shouldn't
// block warming the other 99.

import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";
import {
  SERVER_EXPORT_FETCHERS,
} from "../../../api/_lib/d1-fetchers-server.js";
import {
  prewarmAllConsumers,
  type D1Writer,
} from "../../../api/_lib/_spellListResolver.js";

const serverWriter: D1Writer = async (sql, params) => {
  await executeD1QueryInternal({ sql, params });
};

export const onRequest = async (context: any): Promise<Response> => {
  const { request } = context;
  if (request.method !== "POST") {
    return Response.json(
      { error: `Method ${request.method} not allowed.` },
      { status: 405 },
    );
  }

  // Server-to-server auth: must present the shared worker secret.
  // R2_API_SECRET is the same value `executeD1QueryInternal` uses to
  // call the worker — we just check it on the inbound direction too.
  const expected = process.env.R2_API_SECRET;
  if (!expected) {
    return Response.json(
      { error: "Prewarm endpoint is misconfigured (R2_API_SECRET unset)." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const expectedHeader = `Bearer ${expected}`;
  if (auth !== expectedHeader) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await prewarmAllConsumers(SERVER_EXPORT_FETCHERS, serverWriter);
    // Strip `details` from the top-level response to keep payloads small
    // — the scheduled handler only logs the summary counts. Callers that
    // want per-consumer breakdowns can pass ?verbose=1.
    const url = new URL(request.url);
    const verbose = url.searchParams.get("verbose") === "1";
    const body: any = {
      ok: true,
      scanned: summary.scanned,
      recomputed: summary.recomputed,
      hits: summary.hits,
      errors: summary.errors,
      durationMs: summary.durationMs,
    };
    if (verbose) body.details = summary.details;
    return Response.json(body);
  } catch (err: any) {
    return Response.json(
      { error: err?.message ?? "Prewarm failed." },
      { status: 500 },
    );
  }
};
