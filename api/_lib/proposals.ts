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
  | "spell"
  | "class"
  | "subclass"
  | "feat"
  | "item"
  | "unique_option_group"
  | "unique_option_item";

export const PROPOSABLE_ENTITY_TYPES: ReadonlyArray<EntityType> = [
  "tag",
  "tag_group",
  "spell_rule",
  "spell_rule_application",
  "spell",
  "class",
  "subclass",
  "feat",
  "item",
  "unique_option_group",
  "unique_option_item",
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

export type Status = "draft" | "pending" | "approved" | "rejected" | "withdrawn";

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
    writableColumns: new Set([
      "id", "name", "description", "query", "manual_spells", "manual_exclusions",
    ]),
    jsonColumns: new Set(["query", "manual_spells", "manual_exclusions"]),
  },
  spell_rule_application: {
    tableName: "spell_rule_applications",
    pkColumn: "id",
    writableColumns: new Set(["id", "rule_id", "applies_to_type", "applies_to_id"]),
    jsonColumns: new Set(),
  },
  // class_spell_list entity removed in phase 4.6 alongside the
  // class_spell_lists table drop. Spell-list curation now flows
  // through spell_rule updates (which mutate manual_spells /
  // manual_exclusions); the resolver reads applied-rule state at
  // request time.
  // ── Heavy entities (Phase 4). Allow-list mirrors what the
  // corresponding editor lets an admin write. Server-managed
  // timestamps (created_at / updated_at) are intentionally NOT in
  // the writable set — sanitisation strips them so a proposer can't
  // forge an "old" updated_at.
  spell: {
    tableName: "spells",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "name", "identifier", "level", "school", "preparation_mode",
      "ritual", "concentration",
      "components_vocal", "components_somatic", "components_material",
      "components_material_text", "components_consumed", "components_cost",
      "description", "image_url",
      "activities", "effects", "foundry_data",
      "source_id", "page",
      "tags", "required_tags", "prerequisite_text",
      "activation_bucket", "range_bucket", "duration_bucket", "shape_bucket",
      "activation_type", "activation_value", "activation_condition",
      "range_units", "range_value", "range_special",
      "duration_units", "duration_value",
    ]),
    jsonColumns: new Set([
      "activities", "effects", "foundry_data", "tags", "required_tags",
    ]),
  },
  class: {
    tableName: "classes",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "name", "identifier", "source_id", "category", "tag_ids",
      "hit_die", "description", "lore", "preview",
      "image_url", "card_image_url", "preview_image_url",
      "card_display", "image_display", "preview_display",
      "saving_throws", "proficiencies", "starting_equipment", "multiclassing",
      "primary_ability", "primary_ability_choice",
      "spellcasting", "advancements", "subclass_title", "subclass_feature_levels",
      "wealth", "multiclass_proficiencies", "excluded_option_ids", "asi_levels",
      "unique_option_mappings",
    ]),
    jsonColumns: new Set([
      "tag_ids", "saving_throws", "proficiencies", "starting_equipment",
      "multiclassing", "primary_ability_choice", "spellcasting", "advancements",
      "subclass_feature_levels", "multiclass_proficiencies",
      "excluded_option_ids", "asi_levels", "unique_option_mappings",
    ]),
  },
  subclass: {
    tableName: "subclasses",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "class_id", "name", "identifier", "class_identifier", "source_id",
      "description", "lore",
      "image_url", "image_display", "card_image_url", "card_display",
      "preview_image_url", "preview_display",
      "spellcasting", "advancements",
      "tag_ids", "excluded_option_ids", "unique_option_group_ids",
    ]),
    jsonColumns: new Set([
      "image_display", "card_display", "preview_display",
      "spellcasting", "advancements",
      "tag_ids", "excluded_option_ids", "unique_option_group_ids",
    ]),
  },
  feat: {
    tableName: "feats",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "name", "identifier", "feat_type", "feat_subtype", "source_type",
      "requirements", "repeatable", "uses_max", "uses_spent", "uses_recovery",
      "description", "image_url",
      "activities", "effects",
      "source_id", "page", "tags", "requirements_tree",
    ]),
    jsonColumns: new Set([
      "uses_recovery", "activities", "effects", "tags", "requirements_tree",
    ]),
  },
  item: {
    tableName: "items",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "name", "identifier", "item_type",
      "rarity", "quantity", "weight",
      "price_value", "price_denomination",
      "attunement", "equipped", "identified", "magical",
      "description", "image_url",
      "activities", "effects",
      "source_id", "page", "tags",
    ]),
    jsonColumns: new Set([
      "activities", "effects", "tags",
    ]),
  },
  unique_option_group: {
    tableName: "unique_option_groups",
    pkColumn: "id",
    writableColumns: new Set(["id", "name", "description", "source_id", "class_ids"]),
    jsonColumns: new Set(["class_ids"]),
  },
  unique_option_item: {
    tableName: "unique_option_items",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "group_id", "name", "description", "icon_url", "source_id",
      "level_prerequisite", "string_prerequisite", "is_repeatable", "page",
      "class_ids", "feature_type", "subtype", "image_url",
      "uses_max", "uses_spent", "uses_recovery",
      "properties", "activities", "effects", "advancements",
      "tags", "quantity_column_id", "scaling_column_id",
      "requirements_tree", "level_prereq_is_total",
    ]),
    jsonColumns: new Set([
      "class_ids", "properties", "activities", "effects", "advancements",
      "tags", "requirements_tree",
    ]),
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
/* Revert                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Flip a proposal operation for the audit-log entry of a revert.
 *
 *   - create's revert is a delete.
 *   - delete's revert is a create.
 *   - update's revert is another update (back to the snapshot).
 *
 * Revert-of-revert just flips again, so the audit trail is fully
 * symmetric — no special-case for the "this revision IS a revert"
 * case.
 */
export function invertOperation(op: Operation): Operation {
  if (op === "create") return "delete";
  if (op === "delete") return "create";
  return "update";
}

export type RevertDriftStatus =
  | { drifted: false }
  | {
      drifted: true;
      reason: "row_changed" | "row_already_deleted" | "row_resurrected";
      currentRow: Record<string, any> | null;
      expectedRow: Record<string, any> | null;
    };

/**
 * Drift check for the revert path. Compares the live row to the
 * state the approved revision LEFT behind (not the pre-proposal
 * snapshot). If the row has been changed / deleted / re-created
 * between approval and revert, refuse so the revert doesn't
 * silently stomp those changes.
 *
 *   - create/update revert: live row must still match the row the
 *     approval wrote (i.e. `expectedRow`, derived from
 *     `proposed_payload`). null current → already deleted; differs
 *     → edited.
 *   - delete revert: live row must still be null. A non-null
 *     current means someone re-created the entity (possibly with
 *     different content) and reverting would clobber that.
 *
 * Same shallow column-compare semantics as detectConflict — only
 * `writableColumns` are inspected, JSON columns compared as
 * stringified.
 */
export function detectRevertDrift(args: {
  entityType: EntityType;
  originalOperation: Operation;
  expectedRow: Record<string, any> | null;
  currentRow: Record<string, any> | null;
}): RevertDriftStatus {
  const { entityType, originalOperation, expectedRow, currentRow } = args;
  const config = ENTITY_CONFIGS[entityType];

  if (originalOperation === "delete") {
    if (currentRow !== null) {
      return {
        drifted: true,
        reason: "row_resurrected",
        currentRow,
        expectedRow,
      };
    }
    return { drifted: false };
  }

  if (currentRow === null) {
    return {
      drifted: true,
      reason: "row_already_deleted",
      currentRow,
      expectedRow,
    };
  }
  if (expectedRow === null) {
    return { drifted: true, reason: "row_changed", currentRow, expectedRow };
  }

  for (const col of config.writableColumns) {
    if (!Object.prototype.hasOwnProperty.call(expectedRow, col)) continue;
    const a = expectedRow[col];
    const b = currentRow[col];
    const aStr = a === null || a === undefined ? null : String(a);
    const bStr = b === null || b === undefined ? null : String(b);
    if (aStr !== bStr) {
      return { drifted: true, reason: "row_changed", currentRow, expectedRow };
    }
  }
  return { drifted: false };
}

/**
 * Apply the inverse of an approved revision. Like
 * `applyApprovedOperation`, all writes go through
 * `executeD1QueryInternal` so the proxy gate is bypassed (the
 * `r2/scan-references` escape hatch). Caller is expected to have
 * already run `detectRevertDrift` and refused if drift was found.
 *
 *   - revert(create) → DELETE
 *   - revert(update) → UPDATE back to `snapshot_at_proposal`
 *   - revert(delete) → INSERT using `snapshot_at_proposal`
 */
export async function applyRevertOperation(args: {
  entityType: EntityType;
  originalOperation: Operation;
  entityId: string | null;
  snapshotAtProposal: Record<string, any> | null;
}): Promise<{ entityId: string }> {
  const config = ENTITY_CONFIGS[args.entityType];

  if (args.originalOperation === "create") {
    const id = args.entityId;
    if (!id) {
      throw new HttpError(400, "Revert of a create requires entity_id.");
    }
    await executeD1QueryInternal({
      sql: `DELETE FROM ${config.tableName} WHERE ${config.pkColumn} = ?`,
      params: [id],
    });
    return { entityId: id };
  }

  if (args.originalOperation === "update") {
    const id = args.entityId;
    if (!id) {
      throw new HttpError(400, "Revert of an update requires entity_id.");
    }
    if (!args.snapshotAtProposal) {
      throw new HttpError(
        400,
        "Revert of an update requires snapshot_at_proposal.",
      );
    }
    const sanitized = sanitizePayload(args.entityType, args.snapshotAtProposal);
    delete sanitized[config.pkColumn];
    const setCols = Object.keys(sanitized);
    if (setCols.length === 0) return { entityId: id };
    const setClause = setCols.map((c) => `"${c}" = ?`).join(", ");
    const params = setCols.map((c) => sanitized[c]);
    params.push(id);
    await executeD1QueryInternal({
      sql: `UPDATE ${config.tableName} SET ${setClause} WHERE ${config.pkColumn} = ?`,
      params,
    });
    return { entityId: id };
  }

  // revert(delete) → INSERT from the snapshot.
  if (!args.snapshotAtProposal) {
    throw new HttpError(
      400,
      "Revert of a delete requires snapshot_at_proposal.",
    );
  }
  const sanitized = sanitizePayload(args.entityType, args.snapshotAtProposal);
  let id =
    typeof sanitized.id === "string" && sanitized.id
      ? sanitized.id
      : args.entityId;
  if (!id) {
    throw new HttpError(400, "Revert of a delete requires an entity id.");
  }
  sanitized.id = id;
  const cols = Object.keys(sanitized);
  if (cols.length === 0) {
    throw new HttpError(
      400,
      "Snapshot is empty — nothing to insert on delete-revert.",
    );
  }
  const placeholders = cols.map(() => "?").join(", ");
  const colSql = cols.map((c) => `"${c}"`).join(", ");
  await executeD1QueryInternal({
    sql: `INSERT INTO ${config.tableName} (${colSql}) VALUES (${placeholders})`,
    params: cols.map((c) => sanitized[c]),
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
