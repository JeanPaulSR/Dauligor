// Queue helpers for the module-export rebake pipeline.
//
// Editor saves call `queueRebake` to record "this entity needs a rebake at
// least 1 hour from now" — consecutive saves on the same entity reset the
// debounce window via UPSERT on PRIMARY KEY (entity_kind, entity_id).
//
// `popDueEntries` is the read side: opportunistic processors (lazy-on-read
// inside api/module.ts, or a future Cloudflare Cron) ask "what's due?" and
// rebake those entries. We DELETE the queue rows up front rather than after
// the rebake — that way a slow/failed rebake doesn't block other readers
// from making progress, and a re-failed entry would be re-queued on the
// next save anyway.
//
// `clearForRebake` is what `rebake-now` calls when the user explicitly
// hits "Bake Now" — it removes the queue entry as part of the manual run
// so the entry doesn't fire again from the cron path later.

import { executeD1QueryInternal } from "./d1-internal.js";

export type ExportEntityKind =
  | "class"
  | "subclass"
  | "feature"
  | "scalingColumn"
  | "optionGroup"
  | "optionItem"
  | "source";

const DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour after last edit

export async function queueRebake(kind: ExportEntityKind, id: string): Promise<void> {
  const now = Date.now();
  await executeD1QueryInternal({
    sql: `INSERT INTO module_export_queue (entity_kind, entity_id, last_edit_at)
          VALUES (?, ?, ?)
          ON CONFLICT(entity_kind, entity_id)
          DO UPDATE SET last_edit_at = excluded.last_edit_at`,
    params: [kind, id, now],
  });
}

export async function clearForRebake(kind: ExportEntityKind, id: string): Promise<void> {
  await executeD1QueryInternal({
    sql: "DELETE FROM module_export_queue WHERE entity_kind = ? AND entity_id = ?",
    params: [kind, id],
  });
}

export interface QueueEntry {
  kind: ExportEntityKind;
  id: string;
  lastEditAt: number;
}

/**
 * SELECT entries whose last_edit_at is older than `Date.now() - DEBOUNCE_MS`,
 * limited by `budget`. Rows are DELETEd as part of the same call — callers
 * own the work from this point forward.
 *
 * Two-statement pattern instead of `RETURNING` so this stays portable across
 * D1 versions that have flaky support for the SQLite extension. Quick race
 * window between the SELECT and DELETE — at worst, two readers process the
 * same entry; the rebake is idempotent so this is benign.
 */
export async function popDueEntries(budget: number = 3): Promise<QueueEntry[]> {
  if (budget <= 0) return [];
  const cutoff = Date.now() - DEBOUNCE_MS;
  const sel = await executeD1QueryInternal({
    sql: `SELECT entity_kind, entity_id, last_edit_at
          FROM module_export_queue
          WHERE last_edit_at <= ?
          ORDER BY last_edit_at ASC
          LIMIT ?`,
    params: [cutoff, budget],
  });
  const rows = (sel.results ?? []) as Array<{ entity_kind: string; entity_id: string; last_edit_at: number }>;
  if (!rows.length) return [];

  const placeholders = rows.map(() => "(? AND ?)").join(" OR ");
  const params: any[] = [];
  for (const row of rows) {
    params.push(row.entity_kind);
    params.push(row.entity_id);
  }
  // CONSIDER: a single composed DELETE with OR clauses is awkward in SQLite;
  // running one DELETE per row is clearer and the budget is small (≤3).
  for (const row of rows) {
    await executeD1QueryInternal({
      sql: "DELETE FROM module_export_queue WHERE entity_kind = ? AND entity_id = ?",
      params: [row.entity_kind, row.entity_id],
    });
  }

  return rows.map((row) => ({
    kind: row.entity_kind as ExportEntityKind,
    id: row.entity_id,
    lastEditAt: Number(row.last_edit_at) || 0,
  }));
}

/**
 * Read-only inspection — used by smoke tests and the manual "Bake Now"
 * cleanup path. Doesn't mutate the queue.
 */
export async function peekQueue(): Promise<QueueEntry[]> {
  const res = await executeD1QueryInternal({
    sql: `SELECT entity_kind, entity_id, last_edit_at
          FROM module_export_queue
          ORDER BY last_edit_at ASC`,
  });
  const rows = (res.results ?? []) as Array<{ entity_kind: string; entity_id: string; last_edit_at: number }>;
  return rows.map((row) => ({
    kind: row.entity_kind as ExportEntityKind,
    id: row.entity_id,
    lastEditAt: Number(row.last_edit_at) || 0,
  }));
}
