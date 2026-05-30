// /api/proposals/* — creator-side dispatcher for content proposals.
//
// The Phase 2 entry point for any user holding the additive
// `content-creator` permission (admins also pass, for testing /
// on-behalf submissions). The endpoint never writes to the live
// entity tables — it only records intent in `pending_revisions`,
// where an admin reviews + approves before the change lands.
//
// Routes:
//
//   POST /api/proposals
//     Submit one or many revisions. The body shape:
//       {
//         revisions: [
//           {
//             entity_type: "tag" | "tag_group" | "spell_rule" | ...,
//             entity_id?:  string | null,
//             operation:   "create" | "update" | "delete",
//             proposed_payload?: object | null,
//             cascade_parent_revision_id?: string | null,
//             notes_from_proposer?: string,
//           },
//           ...
//         ],
//         bundle_id?: string | null,   // omit = server picks a new one for multi-revision bundles
//         notes_from_proposer?: string // bundle-wide notes; per-revision overrides this
//       }
//     For a single revision: pass `revisions: [...]` with one entry,
//     or use the bare-object shape (no `revisions` key) — the server
//     normalises both.
//     The server captures `snapshot_at_proposal` from the current
//     row at submit time for every update/delete; the proposer
//     never sends it.
//
//   GET /api/proposals
//     List the calling user's own proposals (ordered newest first).
//     Filter by `?status=pending|approved|rejected|withdrawn`.
//
//   GET /api/proposals/:id
//     One proposal by id. 404 unless the caller owns it OR is admin.
//
//   PATCH /api/proposals/:id
//     Update a pending proposal's `proposed_payload` /
//     `notes_from_proposer` (own + pending only).
//
//   DELETE /api/proposals/:id
//     Withdraw a pending proposal (own + pending only; sets status
//     to `withdrawn`, doesn't actually DELETE the row).

import {
  HttpError,
  getCredentialErrorMessage,
} from "../../../api/_lib/firebase-admin.js";
import { requireContentCreatorAccess } from "../../../api/_lib/permissions.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";
import {
  isProposableEntityType,
  isAllowedOperation,
  loadCurrentEntity,
  safeParseJson,
  type EntityType,
  type Operation,
  type Status,
} from "../../../api/_lib/proposals.js";
import {
  detectCascadeDependents,
  type DependentSpec,
} from "../../../api/_lib/cascadeStrategies.js";

const VALID_STATUS_FILTERS = new Set<Status>([
  "draft",
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);

type IncomingRevision = {
  entity_type: EntityType;
  entity_id: string | null;
  operation: Operation;
  proposed_payload: Record<string, any> | null;
  cascade_parent_revision_id: string | null;
  notes_from_proposer: string | null;
};

/* -------------------------------------------------------------------------- */
/* Submit                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeSubmitBody(body: any): {
  revisions: IncomingRevision[];
  bundle_id: string | null;
  notes_from_proposer: string | null;
  is_draft: boolean;
} {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Body must be a JSON object.");
  }

  const bundleId =
    typeof body.bundle_id === "string" && body.bundle_id ? body.bundle_id : null;
  const bundleNotes =
    typeof body.notes_from_proposer === "string" ? body.notes_from_proposer : null;
  // Draft mode: rows land with status='draft' instead of 'pending'.
  // Hidden from the admin queue until the caller flips them to
  // pending via POST /api/proposals/bundle/:id/submit. The Submission
  // Block UX uses this to stage many edits without spamming the
  // queue mid-authoring.
  const isDraft = body.is_draft === true;
  // Cascade mode: the submit body includes auto-enrolled dependent
  // revisions (linked via cascade_parent_revision_id) from the
  // cascade-preview pre-flush. A tag delete with 200 spell+class+feat
  // dependents would overflow the standard 50-revision cap; the
  // hard ceiling (1000) is enforced regardless. The client sets this
  // flag explicitly so non-cascade callers can't accidentally bypass
  // the smaller bound.
  const isCascade = body.is_cascade === true;

  let rawRevisions: any[];
  if (Array.isArray(body.revisions)) {
    rawRevisions = body.revisions;
  } else if (typeof body.entity_type === "string") {
    rawRevisions = [body];
  } else {
    throw new HttpError(
      400,
      "Body must include `revisions: [...]` or be a single-revision object.",
    );
  }
  if (rawRevisions.length === 0) {
    throw new HttpError(400, "`revisions` must contain at least one entry.");
  }
  const cap = isCascade ? CASCADE_HARD_LIMIT : 50;
  if (rawRevisions.length > cap) {
    throw new HttpError(
      400,
      isCascade
        ? `Cascade bundle exceeds the ${CASCADE_HARD_LIMIT}-revision ceiling. Split the delete into smaller pieces or ask an admin.`
        : "Max 50 revisions per bundle.",
    );
  }

  const revisions: IncomingRevision[] = rawRevisions.map((raw, idx) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpError(400, `revisions[${idx}] must be an object.`);
    }
    if (!isProposableEntityType(raw.entity_type)) {
      throw new HttpError(
        400,
        `revisions[${idx}].entity_type is not in the allowlist.`,
      );
    }
    if (!isAllowedOperation(raw.operation)) {
      throw new HttpError(
        400,
        `revisions[${idx}].operation must be create/update/delete.`,
      );
    }
    const entityId =
      typeof raw.entity_id === "string" && raw.entity_id ? raw.entity_id : null;
    if (raw.operation !== "create" && !entityId) {
      throw new HttpError(
        400,
        `revisions[${idx}].entity_id is required for ${raw.operation}.`,
      );
    }
    const payload =
      raw.proposed_payload && typeof raw.proposed_payload === "object" && !Array.isArray(raw.proposed_payload)
        ? (raw.proposed_payload as Record<string, any>)
        : null;
    if (raw.operation !== "delete" && payload === null) {
      throw new HttpError(
        400,
        `revisions[${idx}].proposed_payload is required for ${raw.operation}.`,
      );
    }
    const cascadeParent =
      typeof raw.cascade_parent_revision_id === "string" && raw.cascade_parent_revision_id
        ? raw.cascade_parent_revision_id
        : null;
    const notes =
      typeof raw.notes_from_proposer === "string"
        ? raw.notes_from_proposer
        : bundleNotes;
    return {
      entity_type: raw.entity_type,
      entity_id: entityId,
      operation: raw.operation,
      proposed_payload: payload,
      cascade_parent_revision_id: cascadeParent,
      notes_from_proposer: notes,
    };
  });

  return {
    revisions,
    // Auto-generate a bundle id when >1 revisions are submitted
    // together and the caller didn't supply one. Single-revision
    // submits stay bundle_id=null so the queue doesn't render them
    // as a one-row "bundle".
    //
    // Draft submits (block-mode adds) ALWAYS need a bundle_id so
    // the block can be addressed atomically later (submit-bundle,
    // discard-bundle). The client should supply one; if missing,
    // we mint one even for a single-revision draft.
    bundle_id:
      bundleId ||
      (revisions.length > 1 || isDraft ? `bundle-${crypto.randomUUID()}` : null),
    notes_from_proposer: bundleNotes,
    is_draft: isDraft,
  };
}

/* -------------------------------------------------------------------------- */
/* Cascade preview                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Returns the dependent revisions a set of DELETE proposals would
 * trigger, so the client can build the full POST body (parent +
 * dependents) in one round-trip. Strategy registry lives in
 * `api/_lib/cascadeStrategies.ts`.
 *
 * Body: `{ deletes: [{ entity_type, entity_id }, ...] }`
 * Returns: `{ dependents: [{ parent_index, ...DependentSpec }, ...], over_limit: boolean }`
 *
 * `parent_index` is the array index of the parent delete in the
 * request body. The client uses it to wire each dependent to the
 * right `cascade_parent_revision_id` after pre-minting parent revision
 * ids.
 *
 * `over_limit: true` when the combined parent+children count would
 * exceed 1000 — the bundle-size hard ceiling. The client should
 * surface a "talk to admin / break this delete into smaller pieces"
 * error rather than silently truncating.
 */
const CASCADE_HARD_LIMIT = 1000;

async function handleCascadePreview(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const rawDeletes = Array.isArray(body?.deletes) ? body.deletes : [];
  if (rawDeletes.length === 0) {
    return Response.json({ dependents: [], over_limit: false });
  }
  if (rawDeletes.length > 50) {
    throw new HttpError(400, "Cascade preview accepts at most 50 deletes per call.");
  }

  type ParentRef = { index: number; entity_type: EntityType; entity_id: string };
  const parents: ParentRef[] = [];
  for (let i = 0; i < rawDeletes.length; i++) {
    const d = rawDeletes[i];
    if (!d || typeof d !== "object") {
      throw new HttpError(400, `deletes[${i}] must be an object.`);
    }
    if (!isProposableEntityType(d.entity_type)) {
      throw new HttpError(400, `deletes[${i}].entity_type is invalid.`);
    }
    if (typeof d.entity_id !== "string" || !d.entity_id) {
      throw new HttpError(400, `deletes[${i}].entity_id is required.`);
    }
    parents.push({ index: i, entity_type: d.entity_type, entity_id: d.entity_id });
  }

  // Run each strategy in parallel — the worker has the data hot,
  // wall-clock is one round-trip per consumer table per parent.
  const enrolled: Array<DependentSpec & { parent_index: number }> = [];
  await Promise.all(
    parents.map(async (p) => {
      const deps = await detectCascadeDependents(p.entity_type, p.entity_id);
      for (const dep of deps) {
        enrolled.push({ ...dep, parent_index: p.index });
      }
    }),
  );

  // Dedup: if two parent deletes both cascade to the same child
  // (e.g. two tags being deleted at once, both referenced by the
  // same spell), collapse to one dependent. Last parent wins on
  // ties — the strategy logic naturally orders them deterministically
  // since we iterate parents in array order. The proposer sees one
  // "Handle this dependent" row per affected entity instead of two.
  const seen = new Set<string>();
  const dedupedDependents: typeof enrolled = [];
  for (const dep of enrolled) {
    const key = `${dep.entity_type}:${dep.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedDependents.push(dep);
  }

  const total = parents.length + dedupedDependents.length;
  const over_limit = total > CASCADE_HARD_LIMIT;
  return Response.json({
    dependents: dedupedDependents,
    over_limit,
    total,
    hard_limit: CASCADE_HARD_LIMIT,
  });
}

async function handleSubmit(request: Request, proposerId: string): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const { revisions, bundle_id, is_draft } = normalizeSubmitBody(body);

  const insertedIds: string[] = [];
  const statusValue = is_draft ? "draft" : "pending";

  // Phase 1 — read snapshots (sequential SELECTs) and build one INSERT per
  // revision. We capture the snapshot for each non-create revision by reading
  // the current entity row at submit time. The shape is whatever the entity
  // table returns from SELECT * — JSON columns stay as strings (their on-disk
  // shape), which matches how the conflict detector compares them. A missing
  // target for an update/delete is a hard 404 here, before anything is written.
  const statements: { sql: string; params: any[] }[] = [];
  for (const rev of revisions) {
    let snapshot: Record<string, any> | null = null;
    if (rev.operation !== "create" && rev.entity_id) {
      snapshot = await loadCurrentEntity(rev.entity_type, rev.entity_id);
      if (snapshot === null) {
        throw new HttpError(
          404,
          `Cannot propose ${rev.operation} on missing ${rev.entity_type} ${rev.entity_id}.`,
        );
      }
    }
    const id = `rev-${crypto.randomUUID()}`;
    insertedIds.push(id);
    statements.push({
      sql: `INSERT INTO pending_revisions (
              id, bundle_id, proposed_by_user_id, status, entity_type, entity_id,
              operation, proposed_payload, snapshot_at_proposal,
              notes_from_proposer, cascade_parent_revision_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        bundle_id,
        proposerId,
        statusValue,
        rev.entity_type,
        rev.entity_id,
        rev.operation,
        rev.proposed_payload ? JSON.stringify(rev.proposed_payload) : null,
        snapshot ? JSON.stringify(snapshot) : null,
        rev.notes_from_proposer,
        rev.cascade_parent_revision_id,
      ],
    });
  }

  // Phase 2 — insert every revision as ONE atomic env.DB.batch() (R4). A
  // failure mid-flush now leaves NOTHING written: no orphaned `pending_revisions`
  // staging rows, and a retry can't duplicate a partially-written block. (The
  // old per-row loop left earlier inserts persisted when a later row threw.)
  if (statements.length > 0) {
    const result = await executeD1QueryInternal(statements);
    if (result && result.success === false) {
      throw new HttpError(
        500,
        result.error || "Failed to record the proposal block — nothing was saved.",
      );
    }
  }

  return Response.json({
    ok: true,
    bundle_id,
    revision_ids: insertedIds,
    status: statusValue,
  });
}

/* -------------------------------------------------------------------------- */
/* List own                                                                    */
/* -------------------------------------------------------------------------- */

async function handleListOwn(
  request: Request,
  proposerId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const params: any[] = [proposerId];
  let sql = `SELECT * FROM pending_revisions WHERE proposed_by_user_id = ?`;
  if (statusParam && VALID_STATUS_FILTERS.has(statusParam as Status)) {
    sql += ` AND status = ?`;
    params.push(statusParam);
  }
  sql += ` ORDER BY proposed_at DESC LIMIT 500`;

  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return Response.json({
    proposals: rows.map((row: any) => hydrateProposal(row)),
  });
}

/* -------------------------------------------------------------------------- */
/* Get one (own or admin)                                                     */
/* -------------------------------------------------------------------------- */

async function handleGetOne(
  proposalId: string,
  callerUid: string,
  callerIsAdmin: boolean,
): Promise<Response> {
  const result = await executeD1QueryInternal({
    sql: `SELECT * FROM pending_revisions WHERE id = ? LIMIT 1`,
    params: [proposalId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "Proposal not found.");
  }
  const row = rows[0] as any;
  if (!callerIsAdmin && row.proposed_by_user_id !== callerUid) {
    // 404 not 403 so probes can't enumerate ids belonging to other
    // creators.
    throw new HttpError(404, "Proposal not found.");
  }
  return Response.json({ proposal: hydrateProposal(row) });
}

/* -------------------------------------------------------------------------- */
/* Patch + withdraw                                                            */
/* -------------------------------------------------------------------------- */

async function loadOwnEditable(
  proposalId: string,
  proposerId: string,
): Promise<any> {
  const result = await executeD1QueryInternal({
    sql: `SELECT * FROM pending_revisions WHERE id = ? LIMIT 1`,
    params: [proposalId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) throw new HttpError(404, "Proposal not found.");
  const row = rows[0] as any;
  if (row.proposed_by_user_id !== proposerId) {
    throw new HttpError(404, "Proposal not found.");
  }
  // Both `draft` (block-mode staging) and `pending` (queued for
  // admin review) are editable by the proposer. Approved / rejected
  // / withdrawn are immutable.
  if (row.status !== "pending" && row.status !== "draft") {
    throw new HttpError(
      409,
      `Proposal is ${row.status}; can only edit while pending or draft.`,
    );
  }
  return row;
}

async function handlePatch(
  request: Request,
  proposalId: string,
  proposerId: string,
): Promise<Response> {
  const row = await loadOwnEditable(proposalId, proposerId);
  const body = (await request.json().catch(() => ({}))) as any;

  const setClauses: string[] = [];
  const params: any[] = [];
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if ("proposed_payload" in body) {
      if (row.operation === "delete") {
        throw new HttpError(
          400,
          "delete revisions don't carry a payload to patch.",
        );
      }
      if (
        body.proposed_payload === null ||
        (typeof body.proposed_payload === "object" && !Array.isArray(body.proposed_payload))
      ) {
        setClauses.push("proposed_payload = ?");
        params.push(
          body.proposed_payload === null
            ? null
            : JSON.stringify(body.proposed_payload),
        );
      } else {
        throw new HttpError(400, "`proposed_payload` must be an object or null.");
      }
    }
    if ("notes_from_proposer" in body) {
      setClauses.push("notes_from_proposer = ?");
      params.push(
        typeof body.notes_from_proposer === "string"
          ? body.notes_from_proposer
          : null,
      );
    }
    if ("cascade_parent_revision_id" in body) {
      setClauses.push("cascade_parent_revision_id = ?");
      params.push(
        typeof body.cascade_parent_revision_id === "string" &&
          body.cascade_parent_revision_id
          ? body.cascade_parent_revision_id
          : null,
      );
    }
  }
  if (setClauses.length === 0) {
    return Response.json({ ok: true, id: proposalId, noop: true });
  }
  params.push(proposalId);
  await executeD1QueryInternal({
    sql: `UPDATE pending_revisions SET ${setClauses.join(", ")} WHERE id = ?`,
    params,
  });
  return Response.json({ ok: true, id: proposalId });
}

async function handleWithdraw(
  proposalId: string,
  proposerId: string,
): Promise<Response> {
  const row = await loadOwnEditable(proposalId, proposerId);
  if (row.status === "draft") {
    // Drafts never made it to the admin queue — hard-delete instead
    // of leaving a withdrawn audit trail.
    await executeD1QueryInternal({
      sql: `DELETE FROM pending_revisions WHERE id = ?`,
      params: [proposalId],
    });
    return Response.json({ ok: true, id: proposalId, deleted: true });
  }
  await executeD1QueryInternal({
    sql: `UPDATE pending_revisions SET status = 'withdrawn', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    params: [proposalId],
  });
  return Response.json({ ok: true, id: proposalId });
}

/* -------------------------------------------------------------------------- */
/* Bundle (submission block) operations                                        */
/* -------------------------------------------------------------------------- */

const VALID_BUNDLE_STATUS = new Set(["open", "submitted", "discarded"]);

/**
 * Create a new submission block with name + description metadata.
 * Returns the server-issued bundle id. The client uses this id as
 * `bundle_id` on subsequent draft revisions, replacing the previous
 * client-only UUID flow.
 */
async function handleCreateBundle(
  request: Request,
  proposerId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new HttpError(400, "Block name is required.");
  }
  if (name.length > 200) {
    throw new HttpError(400, "Block name must be 200 characters or fewer.");
  }
  const description =
    typeof body?.description === "string" ? body.description : null;
  if (description && description.length > 2000) {
    throw new HttpError(
      400,
      "Block description must be 2000 characters or fewer.",
    );
  }
  const id = `bundle-${crypto.randomUUID()}`;
  await executeD1QueryInternal({
    sql: `INSERT INTO proposal_bundles
            (id, name, description, created_by_user_id)
          VALUES (?, ?, ?, ?)`,
    params: [id, name, description, proposerId],
  });
  return Response.json({
    ok: true,
    bundle: {
      id,
      name,
      description,
      status: "open",
      created_by_user_id: proposerId,
    },
  });
}

/**
 * List the caller's bundles, filterable by `?status=open|submitted|
 * discarded`. Default: all statuses, newest first. Used by the "pick
 * an existing block or create a new one" prompt and the future
 * cross-block menu.
 */
async function handleListBundles(
  request: Request,
  proposerId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const params: any[] = [proposerId];
  let sql = `SELECT * FROM proposal_bundles WHERE created_by_user_id = ?`;
  if (statusParam && VALID_BUNDLE_STATUS.has(statusParam)) {
    sql += ` AND status = ?`;
    params.push(statusParam);
  }
  sql += ` ORDER BY updated_at DESC LIMIT 200`;
  const result = await executeD1QueryInternal({ sql, params });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return Response.json({ bundles: rows });
}

/**
 * Load a single bundle's metadata. Used on mount to hydrate
 * `activeBundle` from a persisted `activeBundleId`. Returns 404
 * unless the caller owns the bundle.
 */
async function handleGetBundle(
  bundleId: string,
  proposerId: string,
): Promise<Response> {
  const result = await executeD1QueryInternal({
    sql: `SELECT * FROM proposal_bundles
            WHERE id = ? AND created_by_user_id = ?
            LIMIT 1`,
    params: [bundleId, proposerId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "Block not found.");
  }
  return Response.json({ bundle: rows[0] });
}

/**
 * Rename / re-describe an open bundle. Refuses to touch
 * submitted/discarded ones — the metadata is part of the audit
 * trail once the block has been sent for review.
 */
async function handlePatchBundle(
  request: Request,
  bundleId: string,
  proposerId: string,
): Promise<Response> {
  const owned = await executeD1QueryInternal({
    sql: `SELECT status FROM proposal_bundles
            WHERE id = ? AND created_by_user_id = ?
            LIMIT 1`,
    params: [bundleId, proposerId],
  });
  const ownedRows = Array.isArray(owned?.results) ? owned.results : [];
  if (ownedRows.length === 0) {
    throw new HttpError(404, "Block not found.");
  }
  if ((ownedRows[0] as any).status !== "open") {
    throw new HttpError(
      409,
      "Cannot edit a submitted or discarded block.",
    );
  }
  const body = (await request.json().catch(() => ({}))) as any;
  const setClauses: string[] = [];
  const params: any[] = [];
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) {
      throw new HttpError(400, "Block name cannot be empty.");
    }
    if (name.length > 200) {
      throw new HttpError(400, "Block name must be 200 characters or fewer.");
    }
    setClauses.push("name = ?");
    params.push(name);
  }
  if ("description" in body) {
    const description =
      typeof body.description === "string" ? body.description : null;
    if (description && description.length > 2000) {
      throw new HttpError(
        400,
        "Block description must be 2000 characters or fewer.",
      );
    }
    setClauses.push("description = ?");
    params.push(description);
  }
  if (setClauses.length === 0) {
    return Response.json({ ok: true, id: bundleId, noop: true });
  }
  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(bundleId);
  await executeD1QueryInternal({
    sql: `UPDATE proposal_bundles SET ${setClauses.join(", ")} WHERE id = ?`,
    params,
  });
  return Response.json({ ok: true, id: bundleId });
}

/**
 * Atomically flip every `draft` row in the bundle to `pending`. The
 * admin queue starts seeing them after this call. Refuses if the
 * bundle owns no rows (or none in `draft` status), and refuses if
 * any row in the bundle isn't owned by the caller (a sanity check
 * — the proposer-id filter on the SELECT prevents cross-user
 * tampering anyway).
 *
 * Phase 4.1: also flips the proposal_bundles metadata row (if one
 * exists) to `status='submitted'`. Pre-Phase-4.1 bundles have no
 * metadata row; the UPDATE is a no-op for those.
 */
async function handleSubmitBundle(
  bundleId: string,
  proposerId: string,
): Promise<Response> {
  const result = await executeD1QueryInternal({
    sql: `SELECT id, status FROM pending_revisions
            WHERE bundle_id = ? AND proposed_by_user_id = ?`,
    params: [bundleId, proposerId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "Bundle not found or empty.");
  }
  const draftRows = rows.filter((r: any) => r.status === "draft");
  if (draftRows.length === 0) {
    throw new HttpError(
      409,
      "Bundle has no draft rows to submit (already submitted or already resolved).",
    );
  }
  await executeD1QueryInternal({
    sql: `UPDATE pending_revisions SET status = 'pending'
            WHERE bundle_id = ? AND proposed_by_user_id = ? AND status = 'draft'`,
    params: [bundleId, proposerId],
  });
  await executeD1QueryInternal({
    sql: `UPDATE proposal_bundles
            SET status = 'submitted', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND created_by_user_id = ?`,
    params: [bundleId, proposerId],
  });
  return Response.json({
    ok: true,
    bundle_id: bundleId,
    submitted_count: draftRows.length,
  });
}

/**
 * Discard a draft bundle: delete every row in `bundle_id` that the
 * caller owns AND is in `draft` status. Pending / approved /
 * rejected rows are left untouched (deleting them would erase audit
 * history). Returns the count actually removed.
 *
 * Phase 4.1: also hard-deletes the proposal_bundles metadata row.
 * A metadata-only bundle (created via POST /api/proposals/bundle
 * but with no drafts yet) is still discardable — the 404 only fires
 * when neither metadata nor drafts exist.
 */
async function handleDiscardBundle(
  bundleId: string,
  proposerId: string,
): Promise<Response> {
  const metadataResult = await executeD1QueryInternal({
    sql: `SELECT 1 AS exists_flag FROM proposal_bundles
            WHERE id = ? AND created_by_user_id = ?
            LIMIT 1`,
    params: [bundleId, proposerId],
  });
  const hasMetadata =
    Array.isArray(metadataResult?.results) &&
    metadataResult.results.length > 0;
  const countResult = await executeD1QueryInternal({
    sql: `SELECT COUNT(*) AS n FROM pending_revisions
            WHERE bundle_id = ? AND proposed_by_user_id = ? AND status = 'draft'`,
    params: [bundleId, proposerId],
  });
  const n = Number(
    (Array.isArray(countResult?.results) && (countResult.results[0] as any)?.n) || 0,
  );
  if (!hasMetadata && n === 0) {
    throw new HttpError(404, "No drafts or block metadata to discard.");
  }
  if (n > 0) {
    await executeD1QueryInternal({
      sql: `DELETE FROM pending_revisions
              WHERE bundle_id = ? AND proposed_by_user_id = ? AND status = 'draft'`,
      params: [bundleId, proposerId],
    });
  }
  if (hasMetadata) {
    await executeD1QueryInternal({
      sql: `DELETE FROM proposal_bundles
              WHERE id = ? AND created_by_user_id = ?`,
      params: [bundleId, proposerId],
    });
  }
  return Response.json({
    ok: true,
    bundle_id: bundleId,
    discarded_count: n,
  });
}

/* -------------------------------------------------------------------------- */
/* Row hydration                                                              */
/* -------------------------------------------------------------------------- */

function hydrateProposal(row: any): Record<string, any> {
  return {
    ...row,
    proposed_payload: safeParseJson(row.proposed_payload),
    snapshot_at_proposal: safeParseJson(row.snapshot_at_proposal),
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded, role } = await requireContentCreatorAccess(authHeader);
    const proposerId = String(decoded.uid);
    const callerIsAdmin = role === "admin";

    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    if (path.length === 0) {
      if (request.method === "POST") return await handleSubmit(request, proposerId);
      if (request.method === "GET") return await handleListOwn(request, proposerId);
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    // /api/proposals/cascade-preview — pre-flush hook used by the
    // wrapper's Submit Changes flow. Given the set of DELETE
    // revisions about to be POSTed, return the dependent revisions
    // each strategy would enroll. The client uses the response to
    // build the full POST body in one call (parent + dependents
    // linked via cascade_parent_revision_id).
    if (path.length === 1 && path[0] === "cascade-preview") {
      if (request.method !== "POST") {
        return Response.json(
          { error: `Method ${request.method} not allowed.` },
          { status: 405 },
        );
      }
      return await handleCascadePreview(request);
    }

    // /api/proposals/bundle — block metadata + lifecycle.
    // MUST be checked before the generic /:id branch below, since
    // `bundle` is reserved as the first segment for these routes.
    //
    //   POST   /api/proposals/bundle          create a new block
    //   GET    /api/proposals/bundle          list own blocks (optional ?status)
    //   GET    /api/proposals/bundle/:id      get one (hydrates active block)
    //   PATCH  /api/proposals/bundle/:id      rename / re-describe (open only)
    //   DELETE /api/proposals/bundle/:id      discard (drafts + metadata)
    //   POST   /api/proposals/bundle/:id/submit  drafts → pending atomically
    if (path[0] === "bundle") {
      if (path.length === 1) {
        if (request.method === "POST") {
          return await handleCreateBundle(request, proposerId);
        }
        if (request.method === "GET") {
          return await handleListBundles(request, proposerId);
        }
        return Response.json(
          { error: `Method ${request.method} not allowed.` },
          { status: 405 },
        );
      }
      const bundleId = path[1];
      if (path.length === 2) {
        if (request.method === "GET") {
          return await handleGetBundle(bundleId, proposerId);
        }
        if (request.method === "PATCH") {
          return await handlePatchBundle(request, bundleId, proposerId);
        }
        if (request.method === "DELETE") {
          return await handleDiscardBundle(bundleId, proposerId);
        }
        return Response.json(
          { error: `Method ${request.method} not allowed.` },
          { status: 405 },
        );
      }
      if (path.length === 3 && path[2] === "submit" && request.method === "POST") {
        return await handleSubmitBundle(bundleId, proposerId);
      }
    }

    if (path.length === 1) {
      const proposalId = path[0];
      if (request.method === "GET") {
        return await handleGetOne(proposalId, proposerId, callerIsAdmin);
      }
      if (request.method === "PATCH") {
        return await handlePatch(request, proposalId, proposerId);
      }
      if (request.method === "DELETE") {
        return await handleWithdraw(proposalId, proposerId);
      }
      return Response.json(
        { error: `Method ${request.method} not allowed.` },
        { status: 405 },
      );
    }

    return Response.json(
      { error: `Unknown /api/proposals route: /${path.join("/")}` },
      { status: 404 },
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
      `/api/proposals (${request.method} ${request.url}) failed:`,
      error,
    );
    return Response.json(
      { error: message || "/api/proposals request failed." },
      { status: 500 },
    );
  }
};
