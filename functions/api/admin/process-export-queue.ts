// /api/admin/process-export-queue — drain the module-export rebake queue.
//
// The companion to the debounce queue in `api/_lib/module-export-queue.ts`.
// Editor saves (and the "rebake this system" admin button) enqueue entities
// with a `last_edit_at` timestamp; an entity becomes "due" once it has been
// quiet for `DEBOUNCE_MS` (1 hour). This endpoint pops a SMALL bounded batch
// of due entries and rebakes each — deliberately throttled so a backlog of
// many edits drains GRADUALLY across cron ticks instead of firing a burst of
// rebakes that would blow the Worker subrequest budget in one invocation.
//
// Called by the worker `scheduled` handler on a frequent cron (see
// worker/index.js + wrangler.toml). The opportunistic per-request path
// (`processQueueOpportunistically`, budget 1) inside the module router stays
// as a fast-track when Foundry traffic is flowing; this cron is what makes the
// queue drain on a timer even when nobody is hitting the API.
//
// Auth: server-to-server only — the shared `R2_API_SECRET` Bearer token, same
// as `prewarm-spell-cache`. No Firebase/user auth.
//
// Response: { ok, due, rebaked, failed, written, durationMs }

import { popDueEntries } from "../../../api/_lib/module-export-queue.js";
import { rebakeBundle } from "../../../api/_lib/module-export-pipeline.js";

// Bounded per-call budget. Each class rebake fans out to several D1 reads + an
// R2 write (+ a source-catalog rebake) — roughly 25 subrequests for a complex
// class. The Worker/Pages-Functions subrequest cap is 50 on the FREE plan
// (1000 on paid), so ONE class per invocation is the safe budget on free; the
// frequent cron drives throughput instead of a big per-call batch. Bump this
// (and pass ?budget=) only on a paid plan. Tunable.
const DRAIN_BUDGET = 1;

export const onRequest = async (context: any): Promise<Response> => {
  const { request } = context;
  if (request.method !== "POST") {
    return Response.json({ error: `Method ${request.method} not allowed.` }, { status: 405 });
  }

  const expected = process.env.R2_API_SECRET;
  if (!expected) {
    return Response.json(
      { error: "Queue-drain endpoint is misconfigured (R2_API_SECRET unset)." },
      { status: 503 },
    );
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  // Allow an explicit override (?budget=N) for a manual catch-up sweep on a
  // PAID plan (more subrequest headroom). On the free plan leave it unset — >1
  // risks the 50-subrequest cap. Capped so a stray call can't run away.
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("budget"));
  const budget = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 5) : DRAIN_BUDGET;

  let rebaked = 0;
  let failed = 0;
  const written: string[] = [];
  try {
    const due = await popDueEntries(budget);
    for (const entry of due) {
      try {
        const keys = await rebakeBundle(entry.kind, entry.id);
        written.push(...keys);
        rebaked += 1;
      } catch (error) {
        failed += 1;
        console.warn("[process-export-queue] rebake failed", { entry, error });
      }
    }
    return Response.json({
      ok: true,
      due: due.length,
      rebaked,
      failed,
      written: written.length,
      durationMs: Date.now() - t0,
    });
  } catch (error: any) {
    console.error("[process-export-queue] drain failed", { error });
    return Response.json(
      { ok: false, error: error?.message ?? "Queue drain failed.", rebaked, failed },
      { status: 500 },
    );
  }
};
