// =============================================================================
// Cascade strategies — server-side detection of which entities a
// proposed DELETE will affect, so the client can enroll those as
// dependent revisions in the same bundle.
// =============================================================================
//
// Strategy registry pattern. Each strategy maps an entity_type to a
// function that, given a delete revision, returns the list of
// dependent UPDATE/DELETE revisions to add to the bundle.
//
// Phase 2 — currently only `tag` is implemented (the highest-impact
// case and the cleanest reuse of the existing tag-usage scan).
// `tag_group`, `unique_option_group`, and `class` strategies are
// scoped out for follow-up sessions; their registry slots return
// empty arrays so they don't block submit.
//
// All other entity types fall through to a no-op — `subclass`,
// `spell`, `feat`, `item`, `unique_option_item`, `class_spell_list`,
// `spell_rule`, `spell_rule_application` either have no dependents
// (standalone), or their cascade is handled by D1's FK ON DELETE
// CASCADE without needing a proposal revision (subclasses under a
// class).
//
// See docs/architecture/proposal-editor-pattern.md for the bigger
// picture (cascade_parent_revision_id, "Handle this dependent" UI,
// admin-side grouping).
// =============================================================================

import { executeD1QueryInternal } from "./d1-internal.js";
import type { EntityType } from "./proposals.js";

/**
 * A dependent revision the cascade engine wants to enroll in the
 * same bundle as the parent DELETE. The wrapper turns each of these
 * into a `POST /api/proposals` entry with `cascade_parent_revision_id`
 * pointing at the parent.
 *
 * - `operation === 'update'`: the dependent's payload has the
 *   reference to the deleted entity stripped (e.g. tag id removed
 *   from a spell's `tags` array). Proposer can later swap to a
 *   replacement via the "Handle this dependent" UI; the default is
 *   strip-the-reference.
 * - `operation === 'delete'`: the dependent itself is being deleted
 *   alongside the parent (used by class -> subclass cascade if/when
 *   that strategy lands).
 */
export interface DependentSpec {
  entity_type: EntityType;
  entity_id: string;
  operation: "update" | "delete";
  /** The full proposed_payload for an UPDATE dependent (snake_case D1
   *  shape). Null for delete dependents — those don't need a payload. */
  proposed_payload: Record<string, unknown> | null;
  /** Human-readable description of the change for the "Handle this
   *  dependent" UI: e.g. "Removes tag 'Primordial' from this spell's
   *  tag list." */
  description: string;
  /** The original column value before the strip — used by the UI to
   *  show "current → proposed" diffs and to support undo. */
  current_value: unknown;
}

/**
 * Strategy fn shape. `parentEntityId` is the id of the entity being
 * deleted. Strategies do their own DB scans (the worker has the data
 * hot — no point round-tripping through the proxy).
 */
type Strategy = (parentEntityId: string) => Promise<DependentSpec[]>;

/* -------------------------------------------------------------------------- */
/* Tag strategy                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every consumer table that stores tag refs in a JSON column or
 * junction table. Mirrors `src/lib/tagUsage.ts` — the same scan but
 * returning the full entity row instead of a COUNT, so we can build
 * UPDATE revisions that strip the deleted tag id from each.
 *
 * `kind` labels what the spec returns in `description`. `column`
 * is the JSON array column on the parent table; for the lore branch
 * the reference is a junction row, so we model it as a delete
 * dependent instead of an update.
 */
const TAG_CONSUMERS: ReadonlyArray<{
  kind: string;
  entity_type: EntityType;
  table: string;
  column: string;
}> = [
  { kind: "spell",       entity_type: "spell",               table: "spells",              column: "tags"    },
  { kind: "feat",        entity_type: "feat",                table: "feats",               column: "tags"    },
  // 'features' isn't a proposable entity yet — features cascade via
  // their parent class/subclass. Skip them for now; a follow-up can
  // add a feature strategy if features become proposable.
  { kind: "item",        entity_type: "item",                table: "items",               column: "tags"    },
  { kind: "class",       entity_type: "class",               table: "classes",             column: "tag_ids" },
  { kind: "subclass",    entity_type: "subclass",            table: "subclasses",          column: "tag_ids" },
  { kind: "option-item", entity_type: "unique_option_item",  table: "unique_option_items", column: "tags"    },
];

const tagStrategy: Strategy = async (tagId) => {
  if (!tagId) return [];
  // For each consumer table, find every row whose JSON-array column
  // contains this tag id, then build an UPDATE dependent that strips
  // the id from the array.
  //
  // The scan uses `json_each` for membership and returns the full row
  // shape so we have all the columns the UPDATE will need to round-
  // trip through the existing proposal-write path. We could return
  // just `(id, column)` and let the apply path patch a single field —
  // but the existing proposed_payload contract takes a complete row
  // shape, so returning the full shape minus the deleted-tag-id is
  // the path of least friction.
  const dependents: DependentSpec[] = [];

  for (const consumer of TAG_CONSUMERS) {
    const sql = `
      SELECT t.*
        FROM ${consumer.table} t
        JOIN json_each(t.${consumer.column}) je
        WHERE t.${consumer.column} IS NOT NULL
          AND json_valid(t.${consumer.column})
          AND je.value = ?
    `;
    const result = await executeD1QueryInternal({ sql, params: [tagId] });
    const rows = Array.isArray(result?.results) ? result.results : [];

    for (const row of rows) {
      const currentTags = safeParseTags(row[consumer.column]);
      const nextTags = currentTags.filter((tid) => tid !== tagId);
      const proposed_payload: Record<string, unknown> = {
        ...row,
        [consumer.column]: nextTags,
        updated_at: new Date().toISOString(),
      };
      dependents.push({
        entity_type: consumer.entity_type,
        entity_id: String(row.id),
        operation: "update",
        proposed_payload,
        description: `Removes the deleted tag from ${consumer.kind} "${row.name ?? row.identifier ?? row.id}".`,
        current_value: currentTags,
      });
    }
  }

  // Lore articles use a junction table (lore_article_tags). Each
  // matching row is a single junction record; the dependent is a
  // DELETE on the junction row itself, NOT on the article. The
  // proposal allowlist doesn't currently include the junction so
  // these aren't enrollable via the normal flow — we skip them with
  // a TODO for the lore-side proposal wiring.
  //
  // TODO: once `lore_article_tags` is a proposable entity_type (or
  // we add a `lore_article` update-payload that includes its tags
  // array), enroll lore dependents here. For now the cascade-preview
  // returns the count via a separate report field so the proposer
  // sees that lore references exist but are admin-resolved.

  return dependents;
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Entity types whose DELETE proposals trigger cascade detection. Any
 * type not listed here gets an empty dependent list, meaning the
 * cascade-preview endpoint will treat the parent DELETE as
 * standalone. That's correct for spells / feats / items / subclasses
 * / class_spell_list rows — D1 FKs (where they exist) handle the
 * cleanup, and the proposal-side has nothing extra to do.
 */
const STRATEGIES: Partial<Record<EntityType, Strategy>> = {
  tag: tagStrategy,
  // Phase 2 follow-up:
  // tag_group: tagGroupStrategy,   // cascade-delete every tag in the group + tag dependents
  // unique_option_group: ...,      // scan classes.advancements JSON for optionGroupId refs
  // class: classStrategy,          // cascade-DELETE every subclass with class_id = ?
};

/**
 * Top-level entry point. Looks up the strategy for `entityType` and
 * runs it; returns `[]` if no strategy is registered (standalone
 * delete — no cascade needed).
 */
export async function detectCascadeDependents(
  entityType: EntityType,
  entityId: string,
): Promise<DependentSpec[]> {
  const strategy = STRATEGIES[entityType];
  if (!strategy) return [];
  try {
    return await strategy(entityId);
  } catch (err) {
    console.error(
      `[cascadeStrategies] ${entityType} strategy failed for ${entityId}:`,
      err,
    );
    // Fall back to empty — better to let the admin sort out the
    // cascade manually than to block the proposer's submit because
    // of a transient DB blip.
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function safeParseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}
