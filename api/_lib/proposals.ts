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
import {
  parseRequirementTree,
  isLeaf,
  isGroup,
  type Requirement,
} from "./_requirements.js";

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
  | "unique_option_item"
  // Nested entity owned by a class/subclass. Made proposable so a
  // content-creator can author scaling columns inside a block instead
  // of hitting the proxy's staff-only direct-write gate. See
  // handoffs/proposal-system/2026-05-28-cross-referential-cluster-design.md
  // (Part A).
  | "scaling_column"
  // Class/subclass features (Wild Shape, Rage, …) — the existing
  // `features`-table entity, now proposable so "propose a class" yields
  // a *usable* class, not a feature-less shell. A feature is an interior
  // node: its `advancements` re-open the whole advancement reference
  // graph, and option groups attach back to it via
  // `unique_option_groups.feature_id`. Brought into scope after the
  // compendium-editors cross-reference audit (full-scope decision).
  | "feature";

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
  "scaling_column",
  "feature",
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
    // `description` + `linked_article_id` were added by migration
    // 20260522-1100 and are authored in TagsExplorer — omitting them
    // approved a tag-description / linked-article edit as a silent no-op.
    writableColumns: new Set([
      "id", "group_id", "name", "slug", "parent_tag_id",
      "description", "linked_article_id",
    ]),
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
      "multiclassing", "primary_ability", "primary_ability_choice",
      "spellcasting", "advancements",
      "subclass_feature_levels", "multiclass_proficiencies",
      "excluded_option_ids", "asi_levels", "unique_option_mappings",
      // Display-config columns are stored as JSON objects in D1
      // (see migrations/0008_classes.sql comments). Missing them
      // here caused admin approval of class CREATE proposals to fail
      // with D1_TYPE_ERROR — the client sends them as JS objects and
      // sanitizePayload would pass them through unstringified. Fixed
      // 2026-05-26 prod incident.
      "card_display", "image_display", "preview_display",
    ]),
  },
  subclass: {
    tableName: "subclasses",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "class_id", "name", "identifier", "class_identifier", "source_id",
      // `preview` is a short blurb mirroring classes.preview, added by
      // migration 20260529-1200 and authored in SubclassEditor. Omitting it
      // dropped a proposed subclass's blurb on approval (same bug class as the
      // R1 scaling_column gap). (F3 fix.)
      "description", "lore", "preview",
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
    // `advancements` (migration 20260527-1200 era), `feat_category_id`,
    // and `requirements_short_text` (20260527-0100) are staged by the
    // proposal-mode FeatsEditor — omitting them silently dropped a
    // proposed feat's advancement graph, category FK, and short
    // requirements text on approval.
    writableColumns: new Set([
      "id", "name", "identifier", "feat_type", "feat_subtype", "source_type",
      "requirements", "requirements_short_text", "repeatable",
      "uses_max", "uses_spent", "uses_recovery",
      "description", "image_url", "feat_category_id",
      "activities", "effects", "advancements",
      "source_id", "page", "tags", "requirements_tree",
    ]),
    jsonColumns: new Set([
      "uses_recovery", "activities", "effects", "advancements",
      "tags", "requirements_tree",
    ]),
  },
  // Items were rebuilt to Foundry dnd5e 5.3.1 item-sheet fidelity
  // (migrations 20260524-1800 → 20260608-1300): `weight`/`price` became
  // JSON shapes (the old flat price_value/price_denomination columns are
  // DROPPED — allowlisting them made approval fail with "no such
  // column"), and the per-type detail columns (weapon damage/range,
  // armor AC fields, tool fields, container capacity/currency, vehicle,
  // base-item FKs, uses) landed. This allowlist mirrors the rebuilt
  // ItemsEditor's payload; omitting a column an editor stages means an
  // approved proposal silently drops that field (the F3/#65 bug class).
  item: {
    tableName: "items",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "name", "identifier", "item_type",
      "type_subtype", "type_inner_subtype",
      "rarity", "quantity", "weight", "price",
      "attunement", "equipped", "identified", "magical", "proficient",
      "description", "unidentified_description", "chat_description",
      "image_url",
      "properties", "uses",
      // Weapon shape.
      "damage", "range", "mastery", "magical_bonus", "ammunition",
      // Armor shape.
      "armor_value", "armor_dex", "armor_magical_bonus", "strength",
      "stealth", "armor_type",
      // Vehicle-equipment shape.
      "vehicle",
      // Tool shape.
      "tool_type", "bonus", "chat_flavor", "ability_id",
      // Container shape.
      "capacity", "currency", "container_id",
      // Base-item FKs (polymorphic) + the verbatim Foundry slug.
      "base_weapon_id", "base_armor_id", "base_tool_id", "base_item",
      "activities", "effects", "advancements",
      "source_id", "page", "tags",
    ]),
    jsonColumns: new Set([
      "weight", "price", "properties", "uses",
      "damage", "range", "ammunition",
      "vehicle", "capacity", "currency",
      "activities", "effects", "advancements", "tags",
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
      // The editor always sends `uses_recovery` as a RecoveryRule array
      // (UniqueOptionGroupEditor handleSaveItem) — without stringification
      // the raw array binds into the approval INSERT/UPDATE and the whole
      // (block-atomic) approve fails with D1_TYPE_ERROR. Mirrors the
      // `feature` config, which has carried it from day one.
      "uses_recovery",
    ]),
  },
  // Scaling columns belong to a class or subclass (parent_id +
  // parent_type) and are referenced by id from class/subclass
  // advancements and option-item configs. The `values` column is a
  // JSON map of level (string) → value. Schema: 0009_scalings.sql.
  //
  // parent_type is one of class|subclass|feat|race|background|item
  // (the panel's ScalingOwnerType). All six are accepted — the
  // approval-side guard #1 resolves whichever parent type is present.
  scaling_column: {
    tableName: "scaling_columns",
    pkColumn: "id",
    // `type` ('number'|'dice'|'string'|'cr'|'distance'), `identifier`, and
    // `distance_units` were added by migration 20260508-1158 and are part of
    // the editor's payload. Omitting them dropped a proposed column's type on
    // approval (a "dice" column reverted to the 'number' default). (R1 fix.)
    writableColumns: new Set([
      "id", "name", "parent_id", "parent_type", "values",
      "type", "identifier", "distance_units",
    ]),
    jsonColumns: new Set(["values"]),
  },
  // Class/subclass features — the existing `features` table. Writable
  // set = every non-timestamp column (timestamps are server-managed and
  // stripped). `tags` is the feature's tag column (NOT `tag_ids`; see
  // upsertFeature in src/lib/compendium.ts, which translates tagIds→tags
  // on write). Schema: `features` table (backup 20260521).
  feature: {
    tableName: "features",
    pkColumn: "id",
    writableColumns: new Set([
      "id", "name", "identifier", "parent_id", "parent_type", "level",
      "feature_type", "subtype", "requirements", "description", "image_url",
      "uses_max", "uses_spent", "uses_recovery",
      "prerequisites_level", "prerequisites_items", "repeatable",
      "properties", "activities", "effects", "advancements",
      "source_id", "page", "tags",
      "is_subclass_feature", "quantity_column_id", "scaling_column_id", "icon_url",
    ]),
    jsonColumns: new Set([
      "uses_recovery", "prerequisites_items", "properties",
      "activities", "effects", "advancements", "tags",
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
export type D1Statement = { sql: string; params: any[] };

/**
 * Pure SQL builder for an approved revision — the same INSERT / UPDATE /
 * DELETE `applyApprovedOperation` runs, but returned as statements instead
 * of executed. This is the seam Part D's block-atomic approve relies on:
 * it collects every revision's statements and hands the whole array to
 * `executeD1QueryInternal([...])`, which the worker runs as one
 * `env.DB.batch()` (atomic — all-or-nothing). The per-row approve path
 * keeps calling `applyApprovedOperation`, which just executes the result.
 *
 * Returns the resolved entity id (for a create, the payload's `id`) so the
 * caller can stamp `pending_revisions.entity_id` in the same batch.
 */
export function buildApprovedStatements(args: {
  entityType: EntityType;
  operation: Operation;
  entityId: string | null;
  proposedPayload: string | null;
}): { entityId: string; statements: D1Statement[] } {
  const config = ENTITY_CONFIGS[args.entityType];
  const payload = args.proposedPayload
    ? parseJsonOrThrow(args.proposedPayload, "proposed_payload")
    : null;

  if (args.operation === "delete") {
    const id = args.entityId;
    if (!id) {
      throw new HttpError(400, "delete revisions must carry entity_id.");
    }
    return {
      entityId: id,
      statements: [
        {
          sql: `DELETE FROM ${config.tableName} WHERE ${config.pkColumn} = ?`,
          params: [id],
        },
      ],
    };
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
    return {
      entityId: id,
      statements: [
        {
          sql: `INSERT INTO ${config.tableName} (${colSql}) VALUES (${placeholders})`,
          params: cols.map((c) => sanitized[c]),
        },
      ],
    };
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
    return { entityId: id, statements: [] };
  }
  const setClause = setCols.map((c) => `"${c}" = ?`).join(", ");
  const params = setCols.map((c) => sanitized[c]);
  params.push(id);
  return {
    entityId: id,
    statements: [
      {
        sql: `UPDATE ${config.tableName} SET ${setClause} WHERE ${config.pkColumn} = ?`,
        params,
      },
    ],
  };
}

export async function applyApprovedOperation(args: {
  entityType: EntityType;
  operation: Operation;
  entityId: string | null;
  proposedPayload: string | null;
}): Promise<{ entityId: string }> {
  const { entityId, statements } = buildApprovedStatements(args);
  for (const stmt of statements) {
    await executeD1QueryInternal({ sql: stmt.sql, params: stmt.params });
  }
  return { entityId };
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
/* Block-atomic approval: reference integrity (guard #1) + ordering (Part D)  */
/* -------------------------------------------------------------------------- */

/**
 * One draftable id reference found on a revision's payload. `candidateTypes`
 * is the set of entity types the id may resolve against (polymorphic parents
 * carry more than one). The reference is satisfied if `id` is either a
 * same-block draft of one of those types OR an existing live row in one of
 * those tables. Guard #1 fails approval only when it is neither.
 */
export interface EntityReference {
  field: string;
  id: string;
  candidateTypes: EntityType[];
}

// parent_type discriminator → proposable entity type. Only these four can be
// authored as same-block drafts (race / background owners are always live —
// they aren't proposable — so their parent refs are skipped, not validated).
const PARENT_TYPE_TO_ENTITY: Record<string, EntityType> = {
  class: "class",
  subclass: "subclass",
  feat: "feat",
  item: "item",
};

function pushRef(
  refs: EntityReference[],
  field: string,
  id: unknown,
  candidateTypes: EntityType[],
): void {
  if (typeof id !== "string") return;
  const trimmed = id.trim();
  // Skip empties and the editor's "no selection" sentinels.
  if (!trimmed || trimmed === "none" || trimmed === "__none__") return;
  refs.push({ field, id: trimmed, candidateTypes });
}

function asArray(raw: unknown): any[] {
  const v = typeof raw === "string" ? safeParseJson(raw) : raw;
  return Array.isArray(v) ? v : [];
}

// `advancements[]` reference fields, shared by class / subclass / feat / item /
// feature (a feature is an interior node — its advancements re-open the same
// graph). The grant-feature ref sits at the advancement top level
// (`featureId`); the rest live under `.configuration.*`. Verified against
// AdvancementManager.tsx + compendium-editors' 2026-05-30 pool-fields handoff.
//
// The pool arrays (`configuration.pool` / `optionalPool`) ARE walked: their
// checkboxes write ids from the same overlay-merged catalogs as the
// single-selects, so a pooled in-block draft must resolve too. The element
// kind is keyed by `configuration.choiceType` (feat vs feature) — other
// flavors (e.g. item pools) aren't block-draftable, so they resolve live-only
// and are skipped here to avoid false "dangling" failures.
// `configuration.excludedOptionIds` is intentionally NOT walked: a dangling
// excluded id is a benign no-op (exclusion just filters; it can't leave a
// dangling live pointer), so hard-failing approval on it would be over-strict.
function collectAdvancementRefs(
  raw: unknown,
  prefix: string,
  refs: EntityReference[],
): void {
  const list = asArray(raw);
  for (let i = 0; i < list.length; i++) {
    const adv = list[i];
    if (!adv || typeof adv !== "object") continue;
    const at = `${prefix}[${i}]`;
    pushRef(refs, `${at}.featureId`, (adv as any).featureId, ["feature"]);
    const cfg = (adv as any).configuration;
    if (cfg && typeof cfg === "object") {
      pushRef(refs, `${at}.configuration.scalingColumnId`, cfg.scalingColumnId, ["scaling_column"]);
      pushRef(refs, `${at}.configuration.optionScalingColumnId`, cfg.optionScalingColumnId, ["scaling_column"]);
      pushRef(refs, `${at}.configuration.optionGroupId`, cfg.optionGroupId, ["unique_option_group"]);
      pushRef(refs, `${at}.configuration.usesFeatureId`, cfg.usesFeatureId, ["feature"]);
      // pool / optionalPool — element kind depends on choiceType.
      const choiceType = typeof cfg.choiceType === "string" ? cfg.choiceType : "";
      const poolType: EntityType | null =
        choiceType === "feat" ? "feat" : choiceType === "feature" ? "feature" : null;
      if (poolType) {
        for (const key of ["pool", "optionalPool"] as const) {
          const arr = cfg[key];
          if (Array.isArray(arr)) {
            for (let j = 0; j < arr.length; j++) {
              pushRef(refs, `${at}.configuration.${key}[${j}]`, arr[j], [poolType]);
            }
          }
        }
      }
    }
  }
}

// `requirements_tree` leaves (feat prereqs, option-item cross-references).
// Leaf shapes from _requirements.ts: class/levelInClass→classId,
// subclass→subclassId, optionItem→itemId, feature→featureId, spell→spellId,
// spellRule→spellRuleId. ability/proficiency/level/string carry no entity ref.
function collectRequirementRefs(
  raw: unknown,
  field: string,
  refs: EntityReference[],
): void {
  const tree = parseRequirementTree(raw);
  if (!tree) return;
  const walk = (req: Requirement): void => {
    if (isLeaf(req)) {
      switch (req.type) {
        case "class":
        case "levelInClass":
          pushRef(refs, `${field}:class`, (req as any).classId, ["class"]);
          break;
        case "subclass":
          pushRef(refs, `${field}:subclass`, (req as any).subclassId, ["subclass"]);
          break;
        case "optionItem":
          pushRef(refs, `${field}:optionItem`, (req as any).itemId, ["unique_option_item"]);
          break;
        case "feature":
          pushRef(refs, `${field}:feature`, (req as any).featureId, ["feature"]);
          break;
        case "spell":
          pushRef(refs, `${field}:spell`, (req as any).spellId, ["spell"]);
          break;
        case "spellRule":
          pushRef(refs, `${field}:spellRule`, (req as any).spellRuleId, ["spell_rule"]);
          break;
      }
      return;
    }
    if (isGroup(req)) for (const c of req.children) walk(c);
  };
  walk(tree);
}

function collectPolymorphicParent(
  payload: Record<string, any>,
  allowed: EntityType[],
  refs: EntityReference[],
): void {
  const pid = payload.parent_id;
  if (typeof pid !== "string" || !pid) return;
  const mapped = PARENT_TYPE_TO_ENTITY[String(payload.parent_type ?? "")];
  // race/background/unknown parent → can't be a same-block draft; skip.
  if (!mapped || !allowed.includes(mapped)) return;
  pushRef(refs, `parent_id (parent_type=${payload.parent_type})`, pid, [mapped]);
}

/**
 * Every draftable id reference a revision's payload carries — the input to
 * guard #1. Covers the cross-reference graph compendium-editors confirmed in
 * their §3 coverage handback (2026-05-29): direct FK parents, the
 * `advancements[]` graph, `requirements_tree` leaves, the option-group
 * feature back-link, and spell-rule application targets. Unknown / opaque
 * payload shapes yield no refs (guard #1 never blocks on what it can't parse).
 */
export function collectReferences(
  entityType: EntityType,
  payloadRaw: unknown,
): EntityReference[] {
  const payload =
    typeof payloadRaw === "string" ? safeParseJson(payloadRaw) : payloadRaw;
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, any>;
  const refs: EntityReference[] = [];

  switch (entityType) {
    case "subclass":
      pushRef(refs, "class_id", p.class_id, ["class"]);
      collectAdvancementRefs(p.advancements, "advancements", refs);
      break;
    case "feature":
      collectPolymorphicParent(p, ["class", "subclass"], refs);
      collectAdvancementRefs(p.advancements, "advancements", refs);
      break;
    case "scaling_column":
      collectPolymorphicParent(p, ["class", "subclass", "feat", "item"], refs);
      break;
    case "unique_option_item":
      pushRef(refs, "group_id", p.group_id, ["unique_option_group"]);
      collectAdvancementRefs(p.advancements, "advancements", refs);
      collectRequirementRefs(p.requirements_tree, "requirements_tree", refs);
      break;
    case "unique_option_group":
      pushRef(refs, "feature_id", p.feature_id, ["feature"]);
      break;
    case "class":
      collectAdvancementRefs(p.advancements, "advancements", refs);
      break;
    case "feat":
      collectAdvancementRefs(p.advancements, "advancements", refs);
      collectRequirementRefs(p.requirements_tree, "requirements_tree", refs);
      break;
    case "item":
      collectAdvancementRefs(p.advancements, "advancements", refs);
      break;
    case "spell_rule_application": {
      pushRef(refs, "rule_id", p.rule_id, ["spell_rule"]);
      const t = PARENT_TYPE_TO_ENTITY[String(p.applies_to_type ?? "")];
      if (t === "class" || t === "subclass") {
        pushRef(refs, `applies_to_id (${p.applies_to_type})`, p.applies_to_id, [t]);
      }
      break;
    }
    // spell / spell_rule / tag / tag_group: leaves — no cluster refs.
    default:
      break;
  }
  return refs;
}

/**
 * Minimal revision shape the ordering pass needs.
 */
export interface BlockRevisionLite {
  id: string;
  entityType: EntityType;
  operation: Operation;
  entityId: string | null;
  payload: any;
}

// Structural FK parent ids (the edges that constrain INSERT order: a parent row
// must exist before the child that points at it). Only these — the JSON
// advancement refs don't constrain order (client-minted ids are valid the
// moment both rows land in the same atomic batch).
function structuralParentIds(r: BlockRevisionLite): string[] {
  const p = r.payload;
  if (!p || typeof p !== "object") return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v) out.push(v);
  };
  switch (r.entityType) {
    case "subclass":
      add(p.class_id);
      break;
    case "unique_option_item":
      add(p.group_id);
      break;
    case "feature": {
      const pt = String(p.parent_type ?? "");
      if (pt === "class" || pt === "subclass") add(p.parent_id);
      break;
    }
    case "scaling_column": {
      const pt = String(p.parent_type ?? "");
      if (PARENT_TYPE_TO_ENTITY[pt]) add(p.parent_id);
      break;
    }
  }
  return out;
}

/**
 * Topologically order a block's revisions so an FK parent is applied before
 * the child that references it (class → subclass, group → option-item, parent
 * → feature/scaling-column). Within a tier order is arbitrary. Detects a
 * dependency cycle (returns the offending revision ids) so the approve can
 * refuse cleanly rather than deadlock — the only author-makeable cycle is the
 * cross-group option-item requirement edge, which isn't a structural FK so it
 * won't actually appear here, but the check is generic and cheap.
 */
export function orderBlockRevisions(
  revs: BlockRevisionLite[],
): { ordered: BlockRevisionLite[]; cycle: string[] | null } {
  const byEntityId = new Map<string, BlockRevisionLite>();
  for (const r of revs) if (r.entityId) byEntityId.set(r.entityId, r);

  const deps = new Map<string, Set<string>>();
  const children = new Map<string, string[]>();
  for (const r of revs) {
    deps.set(r.id, new Set());
    children.set(r.id, []);
  }
  for (const r of revs) {
    if (r.operation === "delete") continue;
    for (const parentId of structuralParentIds(r)) {
      const parent = byEntityId.get(parentId);
      if (parent && parent.id !== r.id && parent.operation !== "delete") {
        if (!deps.get(r.id)!.has(parent.id)) {
          deps.get(r.id)!.add(parent.id);
          children.get(parent.id)!.push(r.id);
        }
      }
    }
  }

  const indeg = new Map<string, number>();
  for (const r of revs) indeg.set(r.id, deps.get(r.id)!.size);
  const queue: string[] = revs.filter((r) => indeg.get(r.id) === 0).map((r) => r.id);
  const byId = new Map(revs.map((r) => [r.id, r]));
  const ordered: BlockRevisionLite[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const c of children.get(id)!) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) queue.push(c);
    }
  }
  if (ordered.length !== revs.length) {
    const seen = new Set(ordered.map((r) => r.id));
    return {
      ordered: revs,
      cycle: revs.filter((r) => !seen.has(r.id)).map((r) => r.id),
    };
  }
  return { ordered, cycle: null };
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
