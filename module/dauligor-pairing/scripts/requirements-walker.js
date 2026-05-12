/**
 * Module-side evaluator + formatter for the compound-requirement trees
 * authored on unique-option items (and, soon, feats).
 *
 * The tree shape is defined in `src/lib/requirements.ts` on the editor
 * side; this file is a JS port of the parts the importer needs at the
 * option-picker step. Keep the two in sync — when a leaf type is added
 * upstream, mirror the change here.
 *
 * The shape of `requirementsTree`, after export:
 *
 *   Root: `{ kind: 'all'|'any'|'one', children: Requirement[] }`
 *          | `{ kind: 'leaf', type: <LeafType>, ...payload }`
 *          | `null`
 *
 * IDs inside leaves: `optionItem.itemId` has already been remapped from
 * D1 entity-ids to canonical sourceIds at export time (see
 * `src/lib/classExport.ts:remapRequirementTree`), so the importer can
 * compare directly against the picked-sourceIds set with no extra
 * translation. The other entity-bound leaves (class, subclass, feature,
 * spell, spellRule) DO NOT currently get remapped — they're rendered as
 * advisory text only in this first pass.
 *
 * Evaluation policy (V1)
 * ----------------------
 * Auto-evaluate against the actor whenever the picker can supply the
 * data. The picker hands in a `ctx` populated from the live actor:
 *   - `optionItem`    → satisfied set (picks across all groups)
 *   - `level`         → class-being-imported / total character level
 *   - `abilityScore`  → actor.system.abilities[ability].value
 *   - `proficiency`   → per-category Sets of slugs, plus an
 *                       aliases map for full-word skill names
 *                       ("athletics" → "ath")
 *   - `feature`       → actor items' entityId / sourceId
 *   - `spell`         → spell-typed actor items' entityId / sourceId
 *   - `class`         → actor class items keyed by entityId
 *   - `subclass`      → actor subclass items by entityId
 *   - `levelInClass`  → class-item levels, compared against `minLevel`
 *
 * Still manual (returns "manual" — doesn't block selection):
 *   - `spellRule` — needs a tag-resolution pass against actor
 *     spells that the walker doesn't currently do.
 *   - `string`    — free-text by design; the player acknowledges it.
 *
 * An option is blocked when at least one auto-evaluable leaf is
 * `unmet`. If every leaf is `manual`, the option is enabled with the
 * requirements text shown as a soft hint.
 *
 * Group semantics (`all` / `any` / `one`) match the editor's labels:
 *   - `all` (And): every child must be satisfied
 *   - `any` (Or):  at least one child must be satisfied
 *   - `one` (Xor): exactly one child must be satisfied
 *
 * For `any` / `one`, manual leaves are treated optimistically (they
 * may or may not satisfy the group) so we don't false-block options
 * the user could legitimately pick.
 */

// ─── Type guards ─────────────────────────────────────────────────────────

const GROUP_KINDS = new Set(["all", "any", "one"]);

function isGroup(node) {
  return node != null && GROUP_KINDS.has(node.kind);
}

function isLeaf(node) {
  return node != null && node.kind === "leaf";
}

// ─── Evaluation ──────────────────────────────────────────────────────────

/**
 * Status of a single leaf or group during walking:
 *   - "met":    we can prove this is satisfied
 *   - "unmet":  we can prove this is NOT satisfied (blocks the option)
 *   - "manual": we cannot evaluate from the available context; render
 *               as advisory text, do not block
 */

/**
 * Evaluate a leaf against the import context.
 *
 * @param {object} leaf
 * @param {EvaluationContext} ctx
 * @returns {"met" | "unmet" | "manual"}
 */
function evaluateLeaf(leaf, ctx) {
  switch (leaf.type) {
    case "optionItem": {
      // `itemId` is a sourceId post-export remap; ctx.satisfied holds
      // sourceIds the user has already picked across all prior + current
      // option groups in this import.
      if (!leaf.itemId) return "manual";
      return ctx.satisfied.has(leaf.itemId) ? "met" : "unmet";
    }
    case "level": {
      const target = leaf.isTotal ? ctx.totalLevel : ctx.classLevel;
      if (!Number.isFinite(target)) return "manual";
      return target >= (Number(leaf.minLevel) || 0) ? "met" : "unmet";
    }
    case "abilityScore": {
      const score = ctx.abilityScores?.[leaf.ability];
      if (!Number.isFinite(score)) return "manual";
      return score >= (Number(leaf.min) || 0) ? "met" : "unmet";
    }
    case "proficiency": {
      // Author requires "Athletics", "Longsword", etc. — check the
      // actor's proficiency set for the matching category. `category`
      // narrows the lookup (skill / weapon / armor / tool / language /
      // save); `identifier` is the Foundry-style slug. The picker
      // populates lowercased sets per category for direct hits, plus
      // an aliases table that maps editor-authored full words (like
      // "athletics") to the canonical 3-letter dnd5e keys (like
      // "ath"). When neither map has the slug we fall through to
      // unmet rather than manual — the player can see precisely
      // what's missing.
      const pool = ctx.proficiencies?.[leaf.category];
      if (!pool) return "manual";
      const id = String(leaf.identifier ?? "").toLowerCase();
      if (!id) return "manual";
      if (pool.has(id)) return "met";
      const aliased = ctx.proficiencyAliases?.[leaf.category]?.[id];
      if (aliased && pool.has(aliased)) return "met";
      return "unmet";
    }
    case "feature": {
      // Author requires a specific class feature granted earlier.
      // The leaf's `featureId` is the D1 row PK (editor-authored).
      // Embedded feature items on the actor carry the same PK as
      // `flags.dauligor-pairing.entityId`, set by
      // `createSemanticFeatureItem`. Match either entityId or
      // sourceId so already-migrated re-imports work too.
      if (!leaf.featureId) return "manual";
      if (ctx.ownedEntityIds?.has(leaf.featureId)) return "met";
      if (ctx.ownedSourceIds?.has(leaf.featureId)) return "met";
      return "unmet";
    }
    case "spell": {
      // Same matching pattern as `feature` but scoped to actor items
      // of type "spell". A separate set lets the walker tell apart
      // "the actor has a feature with this PK" from "the actor knows
      // a spell with this PK" — they live in distinct namespaces in
      // D1, so the picker pre-filters by type.
      if (!leaf.spellId) return "manual";
      if (ctx.ownedSpellEntityIds?.has(leaf.spellId)) return "met";
      if (ctx.ownedSpellSourceIds?.has(leaf.spellId)) return "met";
      return "unmet";
    }
    case "class": {
      // "Character must have any levels in <class>". Matches against
      // the actor's class items by entityId — same PK pattern as
      // feature/spell. We could also accept sourceId but actor class
      // items always carry entityId.
      if (!leaf.classId) return "manual";
      if (ctx.classLevels?.has(leaf.classId)) return "met";
      return "unmet";
    }
    case "subclass": {
      // "Character has subclass X". Subclasses also embed on the
      // actor as their own items with entityId in flags.
      if (!leaf.subclassId) return "manual";
      if (ctx.subclassEntityIds?.has(leaf.subclassId)) return "met";
      return "unmet";
    }
    case "levelInClass": {
      // "Character has at least N levels in <class>". Pull the class
      // item's level from the per-class map built by the picker.
      if (!leaf.classId) return "manual";
      const levels = ctx.classLevels?.get(leaf.classId) ?? 0;
      const min = Number(leaf.minLevel) || 0;
      return levels >= min ? "met" : "unmet";
    }
    // Still manual — spell rules need a tag-resolution pass the
    // walker doesn't currently do, and `string` leaves are
    // free-text by design (the player has to acknowledge them).
    case "spellRule":
    case "string":
      return "manual";
    default:
      // Unknown leaf type from a future-authored tree this build hasn't
      // shipped a walker for yet. Don't block on it.
      return "manual";
  }
}

/**
 * Roll up a group's children. `all` requires every child be met (manual
 * counts as not-yet-blocking); `any` is met if any child is met; `one`
 * is met if exactly one auto-evaluable child is met. In every case, a
 * single unequivocally-unmet auto-evaluable child blocks `all`; for
 * `any`/`one` we stay optimistic when nothing's clearly met.
 */
function rollUpGroup(kind, childStatuses) {
  if (childStatuses.length === 0) return "met"; // empty group ≡ no gate
  const metCount = childStatuses.filter(s => s === "met").length;
  const unmetCount = childStatuses.filter(s => s === "unmet").length;
  const manualCount = childStatuses.filter(s => s === "manual").length;

  if (kind === "all") {
    if (unmetCount > 0) return "unmet";
    if (manualCount > 0) return "manual";
    return "met";
  }
  if (kind === "any") {
    if (metCount > 0) return "met";
    if (manualCount > 0) return "manual";
    return "unmet";
  }
  // "one" (Xor)
  if (metCount === 1 && manualCount === 0) return "met";
  if (metCount > 1) return "unmet"; // too many satisfied
  if (manualCount > 0) return "manual"; // can't tell
  return "unmet";
}

/**
 * Walk a requirement tree and report whether the option should be
 * blocked, plus collect the leaves the user is missing for display.
 *
 * Returns:
 *   - status: overall "met" | "unmet" | "manual"
 *   - blocked: boolean — true iff an auto-evaluable branch came back
 *              "unmet" (the picker uses this to disable the row)
 *   - missingLeaves: leaves that came back "unmet" (auto-failed)
 *
 * @param {object|null} tree
 * @param {EvaluationContext} ctx
 * @returns {{ status: string, blocked: boolean, missingLeaves: object[] }}
 */
export function evaluateRequirementsTree(tree, ctx) {
  if (!tree) return { status: "met", blocked: false, missingLeaves: [] };

  const missingLeaves = [];

  function walk(node) {
    if (isLeaf(node)) {
      const status = evaluateLeaf(node, ctx);
      if (status === "unmet") missingLeaves.push(node);
      return status;
    }
    if (isGroup(node)) {
      const childStatuses = node.children
        .filter(Boolean)
        .map(child => walk(child));
      return rollUpGroup(node.kind, childStatuses);
    }
    return "manual";
  }

  const status = walk(tree);
  return {
    status,
    blocked: status === "unmet",
    missingLeaves,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────

const ABILITY_LABEL = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const PROFICIENCY_LABEL = {
  weapon: "Weapon proficiency",
  armor: "Armor proficiency",
  tool: "Tool proficiency",
  skill: "Skill proficiency",
  language: "Language",
};

/**
 * Render a single leaf to readable text. Naming matches the editor's
 * `formatLeaf` in `src/lib/requirements.ts` so the picker reads the
 * same way as Foundry's item-card `system.requirements`.
 *
 * @param {object} leaf
 * @param {FormatLookups} lookups
 * @returns {string}
 */
function formatLeaf(leaf, lookups) {
  switch (leaf.type) {
    case "level":
      return leaf.isTotal
        ? `Level ${leaf.minLevel}+ (character level)`
        : `Level ${leaf.minLevel}+`;
    case "levelInClass": {
      // classId is NOT remapped at export time yet (see header note),
      // so this falls back to the raw id when no name lookup exists.
      const name = lookups.classNameById?.[leaf.classId] ?? "a class";
      return `${name} ${leaf.minLevel}+`;
    }
    case "class": {
      const name = lookups.classNameById?.[leaf.classId] ?? "(unknown class)";
      return name;
    }
    case "subclass": {
      const name = lookups.subclassNameById?.[leaf.subclassId] ?? "(unknown subclass)";
      return name;
    }
    case "optionItem": {
      const name = lookups.optionItemNameBySourceId?.[leaf.itemId] ?? "(unknown option)";
      return name;
    }
    case "feature": {
      const name = lookups.featureNameById?.[leaf.featureId] ?? "(a class feature)";
      return name;
    }
    case "spell": {
      const name = lookups.spellNameById?.[leaf.spellId] ?? "(a spell)";
      return `Knows ${name}`;
    }
    case "spellRule": {
      const name = lookups.spellRuleNameById?.[leaf.spellRuleId] ?? "(a spell matching a rule)";
      return `Knows ${name}`;
    }
    case "abilityScore":
      return `${ABILITY_LABEL[leaf.ability] ?? leaf.ability} ${leaf.min} or higher`;
    case "proficiency":
      return `${PROFICIENCY_LABEL[leaf.category] ?? "Proficiency"}: ${leaf.identifier}`;
    case "string":
      return leaf.value || "(see description)";
    default:
      return "(unknown requirement)";
  }
}

/**
 * Render a tree to a readable string. Mirrors the editor's
 * `formatRequirementText` but JS — group joiners and the >2-children
 * "exactly one of (…)" shortcut included so the output matches the
 * authoring preview.
 *
 * @param {object|null} tree
 * @param {FormatLookups} lookups
 * @param {boolean} _nested — internal: nested groups get parenthesized
 * @returns {string}
 */
export function formatRequirementsTree(tree, lookups = {}, _nested = false) {
  if (!tree) return "";
  if (isLeaf(tree)) return formatLeaf(tree, lookups);

  const joiner = { all: " and ", any: " or ", one: " xor " }[tree.kind] ?? " and ";
  const label = { all: "all of", any: "any of", one: "exactly one of" }[tree.kind] ?? "all of";

  const children = (tree.children ?? []).filter(Boolean);
  if (children.length === 0) return "";
  if (children.length === 1) return formatRequirementsTree(children[0], lookups, _nested);

  if (tree.kind === "one" && children.length > 2) {
    const parts = children.map(c => formatRequirementsTree(c, lookups, true));
    return `${label} (${parts.join(", ")})`;
  }

  const parts = children.map(c => formatRequirementsTree(c, lookups, true));
  const joined = parts.join(joiner);
  return _nested ? `(${joined})` : joined;
}

/**
 * Render only the unmet (auto-failed) leaves as a short hint string for
 * the disabled-tooltip line. Skips manual leaves so the user isn't told
 * to fix something we can't verify.
 *
 * @param {object[]} missingLeaves
 * @param {FormatLookups} lookups
 * @returns {string}
 */
export function formatMissingLeaves(missingLeaves, lookups = {}) {
  if (!missingLeaves?.length) return "";
  return missingLeaves.map(l => formatLeaf(l, lookups)).join(", ");
}

// ─── Back-compat shim for legacy flat `requiresOptionIds` ────────────────

/**
 * Build an implicit `all` tree from the legacy flat array so the
 * walker can run against old exports identically to the new tree.
 *
 * Returns null when the array is empty so the walker short-circuits
 * to "no gate".
 *
 * @param {string[]} requiresOptionIds
 * @returns {object|null}
 */
export function treeFromFlatRequiresOptionIds(requiresOptionIds) {
  const arr = Array.isArray(requiresOptionIds) ? requiresOptionIds.filter(Boolean) : [];
  if (arr.length === 0) return null;
  if (arr.length === 1) {
    return { kind: "leaf", type: "optionItem", itemId: arr[0] };
  }
  return {
    kind: "all",
    children: arr.map(itemId => ({ kind: "leaf", type: "optionItem", itemId })),
  };
}
