// Shared logic for the content-proposals workflow (Phase 2).
//
// Anything used by both the creator-side endpoint
// (`functions/api/proposals/[[path]].ts`) and the admin-side
// endpoint (`functions/api/admin/proposals/[[path]].ts`) lives here:
//
//   - The per-entity column allowlist + JSON-column marking. Every
//     write proposed against the phase-1 entity tables gets scrubbed
//     against these before it lands.
//   - `loadCurrentEntity` for snapshot capture (submit time) +
//     conflict detection (approve time).
//   - `applyApprovedOperation` — the one place that translates an
//     approved `create` / `update` / `delete` into the actual SQL.
//     Re-applying via `executeD1QueryInternal` skips the proxy gate
//     (the same escape hatch `r2/scan-references` uses), which is
//     correct here because the proposal has already passed admin
//     review.
//
// Module-side impact: none. Approvals fire the same downstream
// hooks (rebake, recompute) as direct admin edits because they
// touch the same tables.

import { executeD1QueryInternal } from "./d1-internal.js";
import { HttpError } from "./firebase-admin.js";

/* -------------------------------------------------------------------------- */
/* Entity + operation allowlists                                              */
/* -------------------------------------------------------------------------- */

export type EntityType =
  | "tag"
  | "tag_group"
  | "spell_rule"
  | "spell_rule_application"
  | "class_spell_list";

export const PROPOSABLE_ENTITY_TYPES: ReadonlyArray<EntityType> = [
  "tag",
  "tag_group",
  "spell_rule",
  "spell_rule_application",
  "class_spell_list",
];

export function isProposableEntityType(s: unknown): s is EntityType {
  return (
    typeof s === "string" &&
    (PROPOSABLE_ENTITY_TYPES as ReadonlyArray<string>).includes(s)
  );
}

export type Operation = "create" | "update" | "delete";

export const ALLOWED_OPERATIONS: ReadonlyArray<Operation> = [
  "create",
  "update",
  "delete",
];

export function isAllowedOperation(s: unknown): s is Operation {
  return (
    typeof s === "string" &&
    (ALLOWED_OPERATIONS as ReadonlyArray<string>).includes(s)
  );
}

export type Status = "pending" | "approved" | "rejected" | "withdrawn";

/* -------------------------------------------------------------------------- */
/* Per-entity config                                                          */
/* -------------------------------------------------------------------------- */

type EntityConfig = {
  // Real D1 table name.
  tableName: string;
  // Primary-key column (always TEXT in the phase-1 set).
  pkColumn: string;
  // Columns the proposer may set in `proposed_payload`. Server-
  // managed timestamps (`created_at`, `updated_at`, `added_at`) are
  // excluded so the proposer can't drift them away from the actual
  // write time.
  writableColumns: ReadonlySet<string>;
  // Columns whose value is a JSON document — when the proposer sends
  // them as a JS object, the SQL layer needs the stringified form.
  jsonColumns: ReadonlySet<string>;
};

const ENTITY_CONFIGS: Record<EntityType, EntityConfig> = {
  tag: {
    tableName: "tags",
    pkColumn: "id",
    writableColumns: new Set(["id", "group_id", "name", "slug", "parent_tag_id"]),
    jsonColumns: new Set(),
  },
  tag_group: {
    tableName: "tag_groups",
    pkColumn: "id",
    writableColumns: new Set(["id", "name", "category", "classifications", "description"]),
    jsonColumns: new Set(["classifications"]),
  },
  spell_rule: {
    tableName: "spell_rules",
    pkColumn: "id",
    writableColumns: new Set(["id", "name", "description", "query", "manual_spells"]),
    jsonColumns: new Set(["query", "manual_spells"]),
  },
  spell_rule_application: {
    tableName: "spell_rule_applications",
    pkColumn: "id",
    writableColumns: new Set(["id", "rule_id", "applies_to_type", "applies_to_id"]),
    jsonColumns: new Set(),
  },
  class_spell_list: {
    tableName: "class_spell_lists",
    pkColumn: "id",
    writableColumns: new Set(["id", "class_id", "spell_id", "source"]),
    jsonColumns: new Set(),
  },
};

export function getEntityConfig(entityType: EntityType): EntityConfig {
  return ENTITY_CONFIGS[entityType];
}

/* -------------------------------------------------------------------------- */
/* Payload validation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Strips a `proposed_payload` to columns the entity actually owns,
 * stringifying JSON columns when the proposer passed objects. Throws
 * 400 if the payload doesn't look like an object. Returns the
 * cleaned column→value map, ready for INSERT or UPDATE.
 */
export function sanitizePayload(
  entityType: EntityType,
  payload: unknown,
): Record<string, any> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "`proposed_payload` must be a JSON object.");
  }
  const config = ENTITY_CONFIGS[entityType];
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!config.writableColumns.has(key)) continue;
    if (value === undefined) continue;
    if (config.jsonColumns.has(key)) {
      // Allow either the JS shape or a pre-stringified value (the
      // existing TagsExplorer / SpellRulesEditor code sometimes
      // stringifies before sending).
      out[key] = typeof value === "string" ? value : JSON.stringify(value);
    } else {
      out[key] = value === null ? null : value;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Snapshot loader                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Reads the current row for the given entity by id. Returns null if
 * the row doesn't exist. The result is the raw D1 row shape — every
 * column the table has, with JSON columns left as strings (the
 * caller stringifies/parses as needed).
 */
export async function loadCurrentEntity(
  entityType: EntityType,
  entityId: string,
): Promise<Record<string, any> | null> {
  const config = ENTITY_CONFIGS[entityType];
  const result = await executeD1QueryInternal({
    sql: `SELECT * FROM ${config.tableName} WHERE ${config.pkColumn} = ? LIMIT 1`,
    params: [entityId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows[0] || null;
}

/* -------------------------------------------------------------------------- */
/* Apply approved operation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Re-applies an approved revision against the real entity table.
 * Called from POST /api/admin/proposals/:id/approve only — never from
 * the creator path. Uses `executeD1QueryInternal` so the proxy gate
 * is bypassed (the same trick `r2/scan-references` uses to walk
 * `users`).
 *
 * For `create`: the proposer's `entity_id` is the row id; the
 * sanitized payload is the column set. For `update`: writes only
 * the allow-listed columns from the payload, leaves everything else
 * untouched. For `delete`: blanks out the row by primary key.
 *
 * Returns the resolved entity id (useful when the original proposal
 * had `entity_id = null` for a create and the payload supplied the
 * id).
 */
export async function applyApprovedOperation(args: {
  entityType: EntityType;
  operation: Operation;
  entityId: string | null;
  proposedPayload: string | null;
}): Promise<{ entityId: string }> {
  const config = ENTITY_CONFIGS[args.entityType];
  const payload = args.proposedPayload
    ? parseJsonOrThrow(args.proposedPayload, "proposed_payload")
    : null;

  if (args.operation === "delete") {
    const id = args.entityId;
    if (!id) {
      throw new HttpError(400, "delete revisions must carry entity_id.");
    }
    await executeD1QueryInternal({
      sql: `DELETE FROM ${config.tableName} WHERE ${config.pkColumn} = ?`,
      params: [id],
    });
    return { entityId: id };
  }

  if (!payload || typeof payload !== "object") {
    throw new HttpError(
      400,
      `${args.operation} revisions must carry a proposed_payload object.`,
    );
  }
  const sanitized = sanitizePayload(args.entityType, payload);

  if (args.operation === "create") {
    // The payload's `id` wins, falling back to the revision row's
    // entity_id if the proposer set both there and not on payload.
    let id: string | undefined =
      typeof sanitized.id === "string" ? sanitized.id : undefined;
    if (!id && args.entityId) id = args.entityId;
    if (!id) id = crypto.randomUUID();
    sanitized.id = id;

    const cols = Object.keys(sanitized);
    if (cols.length === 0) {
      throw new HttpError(400, "create revision payload is empty.");
    }
    const placeholders = cols.map(() => "?").join(", ");
    const colSql = cols.map((c) => `"${c}"`).join(", ");
    await executeD1QueryInternal({
      sql: `INSERT INTO ${config.tableName} (${colSql}) VALUES (${placeholders})`,
      params: cols.map((c) => sanitized[c]),
    });
    return { entityId: id };
  }

  // update
  const id = args.entityId;
  if (!id) {
    throw new HttpError(400, "update revisions must carry entity_id.");
  }
  // Strip pk from the SET clause — UPDATE shouldn't move primary
  // keys around.
  delete sanitized[config.pkColumn];
  const setCols = Object.keys(sanitized);
  if (setCols.length === 0) {
    return { entityId: id };
  }
  const setClause = setCols.map((c) => `"${c}" = ?`).join(", ");
  const params = setCols.map((c) => sanitized[c]);
  params.push(id);
  await executeD1QueryInternal({
    sql: `UPDATE ${config.tableName} SET ${setClause} WHERE ${config.pkColumn} = ?`,
    params,
  });
  return { entityId: id };
}

/* -------------------------------------------------------------------------- */
/* Conflict detection                                                         */
/* -------------------------------------------------------------------------- */

export type ConflictStatus =
  | { conflicted: false }
  | {
      conflicted: true;
      reason: "row_changed" | "row_deleted" | "row_present_for_create";
      currentRow: Record<string, any> | null;
    };

/**
 * Compares the proposer's snapshot to the row's current state.
 * Returns whether the approve path should refuse or surface the
 * 3-way diff to the admin.
 *
 *   - create: refuse if a row at the proposed id already exists.
 *   - update: refuse if the row has been edited (snapshot differs
 *     from current) or has been deleted (current is null).
 *   - delete: refuse if the row has already been deleted OR the
 *     snapshot differs from current (someone edited mid-flight).
 *
 * The "differs" check is a shallow column compare against the
 * sanitized writable columns — JSON columns compared as strings
 * (their on-disk form). Columns outside the writable set (timestamps)
 * are ignored.
 */
export function detectConflict(args: {
  entityType: EntityType;
  operation: Operation;
  snapshot: Record<string, any> | null;
  current: Record<string, any> | null;
}): ConflictStatus {
  const { entityType, operation, snapshot, current } = args;
  const config = ENTITY_CONFIGS[entityType];

  if (operation === "create") {
    if (current !== null) {
      return {
        conflicted: true,
        reason: "row_present_for_create",
        currentRow: current,
      };
    }
    return { conflicted: false };
  }

  if (current === null) {
    return { conflicted: true, reason: "row_deleted", currentRow: null };
  }

  if (snapshot === null) {
    // update/delete without a snapshot means the proposer didn't
    // capture state — treat as drift so an admin sees the live row
    // before approving.
    return { conflicted: true, reason: "row_changed", currentRow: current };
  }

  for (const col of config.writableColumns) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, col)) continue;
    const a = snapshot[col];
    const b = current[col];
    const aStr = a === null || a === undefined ? null : String(a);
    const bStr = b === null || b === undefined ? null : String(b);
    if (aStr !== bStr) {
      return { conflicted: true, reason: "row_changed", currentRow: current };
    }
  }

  return { conflicted: false };
}

/* -------------------------------------------------------------------------- */
/* JSON helpers                                                               */
/* -------------------------------------------------------------------------- */

export function parseJsonOrThrow(raw: string, field: string): any {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new HttpError(
      400,
      `Field "${field}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function safeParseJson(raw: string | null | undefined): any | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
