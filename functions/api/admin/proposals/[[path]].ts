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
  applyRevertOperation,
  detectConflict,
  detectRevertDrift,
  invertOperation,
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

  // `draft` rows are user-private scratch space for the submission
  // block UX (see Phase 2e). They are never surfaced to admins; the
  // proposer flips them to `pending` via POST /api/proposals/bundle/
  // <id>/submit, at which point they become visible. Force the
  // status filter into the four non-draft values regardless of what
  // the client asks for.
  const statusForQuery =
    statusParam === "draft" ? "pending" : statusParam;
  if (VALID_STATUS_FILTERS.has(statusForQuery as Status)) {
    whereClauses.push("status = ?");
    params.push(statusForQuery);
  } else {
    whereClauses.push("status != 'draft'");
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
/* List bundles (block-based admin review)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Admin-side bundle list — surfaces what's pending review as the
 * coherent "block" units the content creator submitted, rather than
 * slicing by entity type (the legacy tab-strip approach was orthogonal
 * to how creators actually package their work).
 *
 * For each bundle, returns metadata + per-status revision counts + the
 * set of entity_types that appear in it. Bundles with at least one
 * pending revision sort to the top (FIFO by oldest-pending). With
 * `?status=resolved`, also surfaces bundles whose pending revisions
 * have all been resolved (approved / rejected / withdrawn).
 *
 * Orphan revisions — those with `bundle_id IS NULL` from pre-Phase-4.1
 * single-revision submits — are returned in a sibling `orphans` field
 * (NOT folded into a synthetic bundle row, so the client can render
 * them in a separate "Standalone proposals" section if desired).
 */
async function handleListBundles(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") || "pending";
  const includeResolved = statusParam === "all" || statusParam === "resolved";

  // Bundle list — left-join pending_revisions and aggregate counts.
  // The HAVING clause filters to bundles with at least one pending row
  // (default) or any row at all (when showing resolved).
  const bundleSql = `
    SELECT
      b.id,
      b.name,
      b.description,
      b.created_by_user_id,
      b.created_at,
      b.updated_at,
      b.status AS bundle_status,
      u.username AS proposer_username,
      u.display_name AS proposer_display_name,
      COUNT(pr.id) AS revision_count,
      SUM(CASE WHEN pr.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN pr.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN pr.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
      SUM(CASE WHEN pr.status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn_count,
      MIN(pr.proposed_at) AS first_proposed_at,
      MAX(pr.proposed_at) AS last_proposed_at,
      GROUP_CONCAT(DISTINCT pr.entity_type) AS entity_types_csv
    FROM proposal_bundles b
    LEFT JOIN users u ON u.id = b.created_by_user_id
    LEFT JOIN pending_revisions pr
        ON pr.bundle_id = b.id AND pr.status != 'draft'
    WHERE b.status = 'submitted'
    GROUP BY b.id
    ${includeResolved ? "" : "HAVING pending_count > 0"}
    ORDER BY
      ${includeResolved
        ? "MAX(pr.proposed_at) DESC"
        : "MIN(pr.proposed_at) ASC"}
    LIMIT 200
  `;
  const bundleResult = await executeD1QueryInternal({ sql: bundleSql, params: [] });
  const bundleRows = Array.isArray(bundleResult?.results)
    ? bundleResult.results
    : [];

  const bundles = bundleRows.map((row: any) => ({
    id: String(row.id),
    name: row.name ?? "(untitled)",
    description: row.description ?? null,
    created_by_user_id: row.created_by_user_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    bundle_status: row.bundle_status ?? null,
    proposer_username: row.proposer_username ?? null,
    proposer_display_name: row.proposer_display_name ?? null,
    revision_count: Number(row.revision_count ?? 0),
    pending_count: Number(row.pending_count ?? 0),
    approved_count: Number(row.approved_count ?? 0),
    rejected_count: Number(row.rejected_count ?? 0),
    withdrawn_count: Number(row.withdrawn_count ?? 0),
    first_proposed_at: row.first_proposed_at ?? null,
    last_proposed_at: row.last_proposed_at ?? null,
    entity_types:
      typeof row.entity_types_csv === "string" && row.entity_types_csv
        ? String(row.entity_types_csv).split(",").filter(Boolean)
        : [],
  }));

  // Orphan revisions — pending_revisions with bundle_id IS NULL OR
  // with a bundle_id but no matching proposal_bundles row (pre-Phase-
  // 4.1 bundles created without metadata). Group by proposer so the
  // client can render a small "Standalone" section per user.
  const orphanSql = `
    SELECT
      pr.id,
      pr.entity_type,
      pr.entity_id,
      pr.operation,
      pr.status,
      pr.bundle_id,
      pr.proposed_by_user_id,
      pr.proposed_at,
      u.username AS proposer_username,
      u.display_name AS proposer_display_name
    FROM pending_revisions pr
    LEFT JOIN users u ON u.id = pr.proposed_by_user_id
    LEFT JOIN proposal_bundles b ON b.id = pr.bundle_id
    WHERE pr.status ${includeResolved ? "!= 'draft'" : "= 'pending'"}
      AND (pr.bundle_id IS NULL OR b.id IS NULL)
    ORDER BY pr.proposed_at ASC
    LIMIT 200
  `;
  const orphanResult = await executeD1QueryInternal({ sql: orphanSql, params: [] });
  const orphans = Array.isArray(orphanResult?.results)
    ? orphanResult.results.map((row: any) => ({
        id: String(row.id),
        entity_type: row.entity_type,
        entity_id: row.entity_id ?? null,
        operation: row.operation,
        status: row.status,
        bundle_id: row.bundle_id ?? null,
        proposed_by_user_id: row.proposed_by_user_id ?? null,
        proposed_at: row.proposed_at ?? null,
        proposer_username: row.proposer_username ?? null,
        proposer_display_name: row.proposer_display_name ?? null,
      }))
    : [];

  return Response.json({ bundles, orphans });
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
  const row = rows[0] as any;
  // Drafts are user-private (see handleList). Even by id, an admin
  // can't reach into someone's in-progress block — the proposer
  // gets the same row back via /api/proposals/<id> if they own it.
  if (row.status === "draft") {
    throw new HttpError(404, "Proposal not found.");
  }
  return row;
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

  // Cascade approval ordering: if this is a DELETE that has pending
  // cascade children, approve the CHILDREN first (each is an UPDATE
  // that strips the about-to-be-deleted reference). Otherwise the
  // parent delete leaves stale ids dangling in dependents' JSON
  // arrays — not an FK violation (refs live in JSON), but a
  // correctness gap.
  //
  // Children only need approval-cascading when the parent is a DELETE
  // — UPDATE / CREATE parents shouldn't have cascade children
  // attached to them (the strategy registry only fires on DELETEs).
  // Still, guard defensively.
  const cascadedChildrenIds: string[] = [];
  if (row.operation === "delete") {
    const childResult = await executeD1QueryInternal({
      sql: `SELECT id, entity_type, entity_id, operation, proposed_payload
              FROM pending_revisions
              WHERE cascade_parent_revision_id = ? AND status = 'pending'`,
      params: [revisionId],
    });
    const childRows = Array.isArray(childResult?.results) ? childResult.results : [];
    // Approve UPDATE children first, DELETE children last (the parent
    // itself is a DELETE — children that are also DELETEs apply after
    // the strip-references children but before the parent).
    const updateChildren = childRows.filter((c: any) => c.operation === "update");
    const deleteChildren = childRows.filter((c: any) => c.operation === "delete");
    for (const child of [...updateChildren, ...deleteChildren]) {
      if (!isProposableEntityType(child.entity_type)) continue;
      try {
        const { entityId: childEntityId } = await applyApprovedOperation({
          entityType: child.entity_type as EntityType,
          operation: child.operation as Operation,
          entityId: child.entity_id,
          proposedPayload: child.proposed_payload,
        });
        await executeD1QueryInternal({
          sql: `UPDATE pending_revisions
                    SET status = 'approved',
                        reviewed_by_user_id = ?,
                        reviewed_at = CURRENT_TIMESTAMP,
                        entity_id = COALESCE(entity_id, ?)
                  WHERE id = ?`,
          params: [reviewerUid, childEntityId, String(child.id)],
        });
        cascadedChildrenIds.push(String(child.id));
      } catch (err) {
        console.error(
          `[adminProposals] cascade child ${child.id} failed during parent ${revisionId} approval:`,
          err,
        );
        // Don't abort the whole parent approve — admin can manually
        // resolve the bad child. The parent delete proceeds with the
        // remaining cleanly-stripped children already applied.
      }
    }
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

  return Response.json({
    ok: true,
    id: revisionId,
    entity_id: entityId,
    cascaded_children_ids: cascadedChildrenIds,
  });
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
/* Pin / unpin (admin-only exempt-from-retention marker)                       */
/*                                                                              */
/* Resolved revisions (approved / rejected / withdrawn) get pruned by a daily   */
/* cron sweep after 30 days. Pinning a row sets `pinned_at` so it survives the  */
/* sweep — useful for substantial changes the audit trail should keep longer.  */
/* -------------------------------------------------------------------------- */

async function handlePin(
  revisionId: string,
  pinned: boolean,
): Promise<Response> {
  const row = await loadRow(revisionId);
  if (row.status === "draft" || row.status === "pending") {
    throw new HttpError(
      400,
      `Cannot pin a ${row.status} proposal — pinning is for resolved (approved/rejected/withdrawn) rows only.`,
    );
  }
  await executeD1QueryInternal({
    sql: `UPDATE pending_revisions
              SET pinned_at = ?
            WHERE id = ?`,
    params: [pinned ? new Date().toISOString() : null, revisionId],
  });
  return Response.json({ ok: true, id: revisionId, pinned });
}

/* -------------------------------------------------------------------------- */
/* Revert (admin-side rollback of an already-approved revision)                */
/* -------------------------------------------------------------------------- */

async function handleRevert(
  revisionId: string,
  reviewerUid: string,
): Promise<Response> {
  const row = await loadRow(revisionId);
  if (row.status !== "approved") {
    throw new HttpError(
      409,
      `Cannot revert a ${row.status} proposal — only approved revisions can be rolled back.`,
    );
  }
  if (!isProposableEntityType(row.entity_type)) {
    throw new HttpError(400, "Proposal carries an unknown entity_type.");
  }

  const proposedPayload = safeParseJson(row.proposed_payload);
  const snapshot = safeParseJson(row.snapshot_at_proposal);
  const entityType = row.entity_type as EntityType;
  const originalOperation = row.operation as Operation;
  const entityId = row.entity_id;

  // For create/update, the row the approval left behind matches
  // `proposed_payload`. For delete, the approval left nothing.
  const expectedRow = originalOperation === "delete" ? null : proposedPayload;
  const currentRow = entityId ? await loadCurrentEntity(entityType, entityId) : null;

  const drift = detectRevertDrift({
    entityType,
    originalOperation,
    expectedRow,
    currentRow,
  });
  if (drift.drifted) {
    return Response.json(
      {
        error:
          "The live row has drifted from the post-approval state. Resolve manually before reverting.",
        drift: {
          reason: drift.reason,
          current_row: drift.currentRow,
          expected_row: drift.expectedRow,
        },
      },
      { status: 409 },
    );
  }

  await applyRevertOperation({
    entityType,
    originalOperation,
    entityId,
    snapshotAtProposal: snapshot,
  });

  // Log a new revision capturing the revert. The audit trail then
  // shows two rows: the original approval and the revert. Reverting
  // a revert just creates a third row with the operation flipped
  // again — no special case.
  const flippedOp = invertOperation(originalOperation);
  // After revert:
  //   - revert(create) deleted the row → new revision is a delete
  //     with proposed_payload = null, snapshot = what the create
  //     wrote (so a later revert-of-revert can re-create).
  //   - revert(update) restored the snapshot → new revision is an
  //     update with proposed_payload = snapshot, snapshot = what
  //     the original approval had written.
  //   - revert(delete) re-inserted the snapshot → new revision is
  //     a create with proposed_payload = snapshot, snapshot = null.
  let newProposedPayload: string | null;
  let newSnapshot: string | null;
  if (originalOperation === "create") {
    newProposedPayload = null;
    newSnapshot = row.proposed_payload; // raw JSON of what create wrote
  } else if (originalOperation === "delete") {
    newProposedPayload = row.snapshot_at_proposal;
    newSnapshot = null;
  } else {
    // update
    newProposedPayload = row.snapshot_at_proposal;
    newSnapshot = row.proposed_payload;
  }

  const newRevisionId = `rev-${crypto.randomUUID()}`;
  const notes = `[revert of ${revisionId}] Reverted by admin.`;
  await executeD1QueryInternal({
    sql: `INSERT INTO pending_revisions (
            id, bundle_id, proposed_by_user_id, status, entity_type, entity_id,
            operation, proposed_payload, snapshot_at_proposal,
            notes_from_proposer, reviewed_by_user_id, reviewed_at
          ) VALUES (?, NULL, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    params: [
      newRevisionId,
      reviewerUid,
      entityType,
      entityId,
      flippedOp,
      newProposedPayload,
      newSnapshot,
      notes,
      reviewerUid,
    ],
  });

  return Response.json({
    ok: true,
    reverted_revision_id: revisionId,
    new_revision_id: newRevisionId,
    new_operation: flippedOp,
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

    if (path.length === 1 && path[0] === "bundles" && request.method === "GET") {
      return await handleListBundles(request);
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
      if (action === "revert") return await handleRevert(revisionId, reviewerUid);
      if (action === "pin") return await handlePin(revisionId, true);
      if (action === "unpin") return await handlePin(revisionId, false);
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
