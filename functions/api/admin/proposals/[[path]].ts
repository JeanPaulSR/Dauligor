// /api/admin/proposals/* — admin review queue for content proposals.
//
// Phase 2 admin counterpart to /api/proposals. Lists pending +
// resolved revisions, lets the admin approve / reject / detect
// conflicts, and writes the approved revision through to the real
// entity table (via `executeD1QueryInternal`, which bypasses the
// proxy gate the same way `r2/scan-references` does).
//
// Bundle cascade: rejecting a parent revision automatically cascades
// to every other pending revision in the same bundle that named
// this row as `cascade_parent_revision_id`. Approval of a bundle is
// a per-revision call from the client — server doesn't try to
// approve N rows atomically since D1 can't transact cross-statement.
//
// Routes:
//
//   GET /api/admin/proposals
//     Full queue. Supports `?status=pending|approved|rejected|withdrawn`
//     (default `pending`), `?entity_type=<one>`, `?proposer=<uid>`,
//     `?bundle_id=<id>`. Ordered oldest first within pending; newest
//     first within resolved.
//
//   GET /api/admin/proposals/:id
//     One revision, hydrated. Includes the current live row for the
//     entity and the precomputed conflict status so the admin UI
//     can render the 3-way diff without an extra round trip.
//
//   POST /api/admin/proposals/:id/approve
//     Apply the revision. Refuses with 409 + conflict info if
//     `snapshot_at_proposal` no longer matches the live row.
//     Otherwise marks status=approved and writes the entity
//     through `applyApprovedOperation`.
//
//   POST /api/admin/proposals/:id/reject
//     Mark status=rejected (+ optional `rejection_reason` body).
//     Cascades to any pending child revisions in the same bundle.

import {
  HttpError,
  getCredentialErrorMessage,
  requireAdminAccess,
} from "../../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../../api/_lib/d1-internal.js";
import {
  applyApprovedOperation,
  detectConflict,
  isProposableEntityType,
  loadCurrentEntity,
  safeParseJson,
  type EntityType,
  type Operation,
  type Status,
} from "../../../../api/_lib/proposals.js";

const VALID_STATUS_FILTERS = new Set<Status>([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);

/* -------------------------------------------------------------------------- */
/* List queue                                                                  */
/* -------------------------------------------------------------------------- */

async function handleList(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") || "pending";
  const entityTypeParam = url.searchParams.get("entity_type");
  const proposerParam = url.searchParams.get("proposer");
  const bundleParam = url.searchParams.get("bundle_id");

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (VALID_STATUS_FILTERS.has(statusParam as Status)) {
    whereClauses.push("status = ?");
    params.push(statusParam);
  }
  if (entityTypeParam && isProposableEntityType(entityTypeParam)) {
    whereClauses.push("entity_type = ?");
    params.push(entityTypeParam);
  }
  if (proposerParam) {
    whereClauses.push("proposed_by_user_id = ?");
    params.push(proposerParam);
  }
  if (bundleParam) {
    whereClauses.push("bundle_id = ?");
    params.push(bundleParam);
  }

  // Pending: oldest first (FIFO review). Resolved: newest first so
  // the admin's most recent actions float to the top.
  const orderClause =
    statusParam === "pending"
      ? "ORDER BY proposed_at ASC"
      : "ORDER BY COALESCE(reviewed_at, proposed_at) DESC";

  const sql = `SELECT pr.*, u.username AS proposer_username, u.display_name AS proposer_display_name
                 FROM pending_revisions pr
            LEFT JOIN users u ON u.id = pr.proposed_by_user_id
                ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
                ${orderClause}
                LIMIT 500`;

  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];
  const proposals = rows.map((row: any) => hydrateProposal(row));
  return Response.json({ proposals });
}

/* -------------------------------------------------------------------------- */
/* Get one with conflict status                                                */
/* -------------------------------------------------------------------------- */

async function loadRow(revisionId: string): Promise<any> {
  const result = await executeD1QueryInternal({
    sql: `SELECT pr.*, u.username AS proposer_username, u.display_name AS proposer_display_name
            FROM pending_revisions pr
       LEFT JOIN users u ON u.id = pr.proposed_by_user_id
           WHERE pr.id = ?
           LIMIT 1`,
    params: [revisionId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) throw new HttpError(404, "Proposal not found.");
  return rows[0];
}

async function handleGetOne(revisionId: string): Promise<Response> {
  const row = await loadRow(revisionId);
  return Response.json({
    proposal: await hydrateWithConflict(row),
  });
}

/* -------------------------------------------------------------------------- */
/* Approve                                                                     */
/* -------------------------------------------------------------------------- */

async function handleApprove(
  revisionId: string,
  reviewerUid: string,
): Promise<Response> {
  const row = await loadRow(revisionId);
  if (row.status !== "pending") {
    throw new HttpError(
      409,
      `Cannot approve a ${row.status} proposal. Re-open / clone it first if you want to re-apply.`,
    );
  }
  if (!isProposableEntityType(row.entity_type)) {
    throw new HttpError(400, "Proposal carries an unknown entity_type.");
  }

  const snapshot = safeParseJson(row.snapshot_at_proposal);
  const current = row.entity_id
    ? await loadCurrentEntity(row.entity_type as EntityType, row.entity_id)
    : null;

  const conflict = detectConflict({
    entityType: row.entity_type as EntityType,
    operation: row.operation as Operation,
    snapshot,
    current,
  });
  if (conflict.conflicted) {
    return Response.json(
      {
        error: "Proposal conflicts with the current row state. Reload, resolve, and re-approve.",
        conflict: {
          reason: conflict.reason,
          current_row: conflict.currentRow,
          snapshot_at_proposal: snapshot,
          proposed_payload: safeParseJson(row.proposed_payload),
        },
      },
      { status: 409 },
    );
  }

  const { entityId } = await applyApprovedOperation({
    entityType: row.entity_type as EntityType,
    operation: row.operation as Operation,
    entityId: row.entity_id,
    proposedPayload: row.proposed_payload,
  });

  await executeD1QueryInternal({
    sql: `UPDATE pending_revisions
              SET status = 'approved',
                  reviewed_by_user_id = ?,
                  reviewed_at = CURRENT_TIMESTAMP,
                  entity_id = COALESCE(entity_id, ?)
            WHERE id = ?`,
    params: [reviewerUid, entityId, revisionId],
  });

  return Response.json({ ok: true, id: revisionId, entity_id: entityId });
}

/* -------------------------------------------------------------------------- */
/* Reject (with bundle cascade)                                                */
/* -------------------------------------------------------------------------- */

async function handleReject(
  request: Request,
  revisionId: string,
  reviewerUid: string,
): Promise<Response> {
  const row = await loadRow(revisionId);
  if (row.status !== "pending") {
    throw new HttpError(409, `Cannot reject a ${row.status} proposal.`);
  }
  const body = (await request.json().catch(() => ({}))) as any;
  const reason =
    typeof body?.rejection_reason === "string" && body.rejection_reason.trim()
      ? body.rejection_reason.trim()
      : null;

  // Mark this row rejected.
  await executeD1QueryInternal({
    sql: `UPDATE pending_revisions
              SET status = 'rejected',
                  rejection_reason = ?,
                  reviewed_by_user_id = ?,
                  reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
    params: [reason, reviewerUid, revisionId],
  });

  // Cascade to any pending children declaring THIS row as parent.
  // Children get the same reason with a [cascade] prefix so the
  // proposer can tell why their dependant was knocked over.
  const cascadeReason = reason
    ? `[cascade from ${revisionId}] ${reason}`
    : `[cascade from ${revisionId}]`;
  const cascadeResult = await executeD1QueryInternal({
    sql: `SELECT id FROM pending_revisions
            WHERE cascade_parent_revision_id = ? AND status = 'pending'`,
    params: [revisionId],
  });
  const cascadeRows = Array.isArray(cascadeResult?.results)
    ? cascadeResult.results
    : [];
  const cascadeIds = cascadeRows.map((r: any) => String(r.id));
  for (const childId of cascadeIds) {
    await executeD1QueryInternal({
      sql: `UPDATE pending_revisions
                SET status = 'rejected',
                    rejection_reason = ?,
                    reviewed_by_user_id = ?,
                    reviewed_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
      params: [cascadeReason, reviewerUid, childId],
    });
  }

  return Response.json({
    ok: true,
    id: revisionId,
    cascaded_revision_ids: cascadeIds,
  });
}

/* -------------------------------------------------------------------------- */
/* Hydration                                                                   */
/* -------------------------------------------------------------------------- */

function hydrateProposal(row: any): Record<string, any> {
  return {
    ...row,
    proposed_payload: safeParseJson(row.proposed_payload),
    snapshot_at_proposal: safeParseJson(row.snapshot_at_proposal),
  };
}

async function hydrateWithConflict(row: any): Promise<Record<string, any>> {
  const base = hydrateProposal(row);
  if (!isProposableEntityType(row.entity_type)) return base;
  const current = row.entity_id
    ? await loadCurrentEntity(row.entity_type as EntityType, row.entity_id)
    : null;
  const conflict = detectConflict({
    entityType: row.entity_type as EntityType,
    operation: row.operation as Operation,
    snapshot: safeParseJson(row.snapshot_at_proposal),
    current,
  });
  return { ...base, current_row: current, conflict };
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded } = await requireAdminAccess(authHeader);
    const reviewerUid = String(decoded.uid);

    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    if (path.length === 0 && request.method === "GET") {
      return await handleList(request);
    }

    if (path.length === 1 && request.method === "GET") {
      return await handleGetOne(path[0]);
    }

    if (path.length === 2 && request.method === "POST") {
      const revisionId = path[0];
      const action = path[1];
      if (action === "approve") return await handleApprove(revisionId, reviewerUid);
      if (action === "reject")
        return await handleReject(request, revisionId, reviewerUid);
      return Response.json(
        { error: `Unknown action: ${action}` },
        { status: 404 },
      );
    }

    return Response.json(
      {
        error: `Method ${request.method} not allowed for /api/admin/proposals/${path.join("/")}`,
      },
      { status: 405 },
    );
  } catch (error: any) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return Response.json({ error: credentialMessage }, { status: 503 });
    }
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `/api/admin/proposals (${request.method} ${request.url}) failed:`,
      error,
    );
    return Response.json(
      { error: message || "/api/admin/proposals request failed." },
      { status: 500 },
    );
  }
};
