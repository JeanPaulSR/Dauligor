// Manual-upload / import system — shared types.
//
// The import core is deliberately split into a PURE half (resolve → preview)
// and a SIDE-EFFECTING half (commit → the editor's real write call). The window
// renders `fields`, calls `resolveEntity()` for a look-before-commit preview,
// then `commitEntity()` to persist. A descriptor's `commit()` MUST delegate to
// the same write function the matching hand-editor uses (e.g. `upsertSpell`) so
// imports and manual edits produce byte-identical rows.
//
// Component guide + "how to add a type" recipe (read this before extending):
//   docs/architecture/import-system.md

/** Input control the Mark & Build window renders for a field. */
export type ImportFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'source' // a `<select>` populated from the `sources` table
  | 'proficiencies' // the reusable ProficienciesEditor grid; value is the class
                    // proficiency object {armor,weapons,tools,skills,languages,…}
  | 'features'; // the class features organizer; value is an array of feature
                // drafts (parsed sections) the user can merge / edit / re-route

export interface ImportFieldOption {
  value: string;
  label: string;
}

/** One editable field on an import descriptor. `key` matches the editor's
 * camelCase form-state key so the payload builder stays a faithful mirror. */
export interface ImportFieldDef {
  key: string;
  label: string;
  kind: ImportFieldKind;
  required?: boolean;
  default?: unknown;
  options?: ImportFieldOption[]; // for kind === 'select'
  /** for kind === 'proficiencies' — which sub-grids to render (default
   * armor/weapons/tools/skills/languages; a class keeps savingThrows as a text field). */
  proficiencyTypes?: string[];
  placeholder?: string;
  help?: string;
  group?: string; // optional UI grouping ("Identity" | "Mechanics" | …)
}

/** How sure the interpreter is about one parsed value. `high` = matched a clear
 * pattern (don't bother the user); `low` = guessed/defaulted from a fuzzy match;
 * `none` = expected but not found in the text. The window flags everything that
 * isn't `high` for a quick human check. */
export type ParseConfidence = 'high' | 'low' | 'none';

/** One field's worth of interpreted text. `value` is in the SAME shape the
 * field control renders (string for text/select/number, boolean for boolean) so
 * the window can drop it straight into form state. */
export interface ParsedField {
  value: unknown;
  confidence: ParseConfidence;
  /** The text snippet this came from — shown as "where did this come from". */
  sourceText?: string;
  /** Character offsets [start, end) into the ORIGINAL pasted text that produced
   * this value. Drives the mark-up panel's left-side highlights. */
  span?: { start: number; end: number };
  /** Why it's low/none (and what to check). Shown next to a flagged field. */
  note?: string;
}

/** A re-assignment target for the mark-up panel: a logical thing a selected span
 * can be assigned to ("Range", "Level & School"). `fieldKeys` are the form-state
 * keys it writes — used to move highlights and clear flags on those fields. */
export interface ImportAssignTarget {
  key: string;
  label: string;
  fieldKeys: string[];
  /** Popover grouping ("Blocks" | "Within Proficiencies"). Targets render under
   * their group; the first group is what you "start with" (the full blocks). */
  group?: string;
  /** `'replace'` (default) sets field values via `assignField`; `'append'` adds
   * ONE item to an array field via `assignAppend` (class Features); `'resolve'`
   * runs a catalog-aware resolver via `assignResolve` (class Proficiencies block
   * + its sub-sections — skills/armor/…). */
  mode?: 'replace' | 'append' | 'resolve';
}

/** Result of interpreting a blob of pasted text into descriptor fields. Pure —
 * the window applies `fields` to form state and surfaces `leftovers`. */
export interface ParseResult {
  /** key → parsed field. Keys match `ImportFieldDef.key`. Unmentioned fields are
   * left at their current form value. */
  fields: Record<string, ParsedField>;
  /** Text the parser recognized but has no field for (e.g. a reaction trigger,
   * an area template) — surfaced so the user can add it in the editor. */
  leftovers: string[];
  /** Informational "here's what I auto-filled / where to double-check" notes —
   * distinct from `leftovers` (text that COULDN'T be placed). Rendered in a
   * neutral box, not the red warning. */
  notes?: string[];
}

export interface ImportContext {
  /** When set, the resolved entity reuses this id (edit-in-place); otherwise a
   * fresh UUID is minted — the same `existingId ?? crypto.randomUUID()` idiom
   * every editor uses. */
  existingId?: string;
  /** ISO timestamp for created/updated — pass once so preview and commit agree. */
  now?: string;
}

/** Result of resolving raw field values into a writable entity. This IS the
 * preview: `payload` is exactly what `commit()` will hand the write function. */
export interface ResolvedEntity {
  type: string;
  id: string;
  isNew: boolean;
  displayName: string;
  identifier: string;
  payload: Record<string, any>;
  errors: string[];
  warnings: string[];
}

export interface ImportDescriptor {
  /** Canonical type key, e.g. `'spell'`. */
  type: string;
  /** Human label, e.g. `'Spell'`. */
  label: string;
  /** D1 collection/table the entity lands in (informational). */
  collection: string;
  /** Form-state key holding the entity's display name. */
  nameField: string;
  /** Form-state key holding the entity's description, if any. */
  descriptionField?: string;
  /** Editable fields the window renders. */
  fields: ImportFieldDef[];
  /** PURE: raw form values → the editor-shape payload passed to the write fn.
   * No I/O, safe to call repeatedly (drives the live preview). */
  buildPayload: (fields: Record<string, any>, ctx: ImportContext) => Record<string, any>;
  /** SIDE-EFFECTING: persist via the editor's REAL write call (e.g. upsertSpell).
   * Never reimplements the D1 write layer. */
  commit: (id: string, payload: Record<string, any>) => Promise<void>;
  /** OPTIONAL · PURE: interpret a blob of pasted text into best-effort field
   * values + per-field confidence, so the window can pre-fill the form and flag
   * only what needs a human check. Types without a parser are manual-entry only.
   * Deliberately does NOT touch automation/activities — those stay manual. */
  parseText?: (text: string) => ParseResult;
  /** OPTIONAL: logical targets a selected span can be re-assigned to in the
   * mark-up panel (e.g. "Range", "Level & School"). */
  assignTargets?: ImportAssignTarget[];
  /** OPTIONAL · PURE: ingest a raw text selection into a target, returning the
   * form-key → value map to apply. Re-runs the SAME classifier the parser uses,
   * so assigning "150 feet" to Range yields `{rangeUnits:'ft', rangeValue:'150'}`
   * — not the literal string. */
  assignField?: (targetKey: string, text: string) => Record<string, unknown>;
  /** OPTIONAL · PURE: for an `append`-mode assign target, parse a selection into
   * ONE list item to push onto the target's array field (e.g. a class Feature
   * draft). Returns null when the selection yields nothing. */
  assignAppend?: (targetKey: string, text: string) => Record<string, unknown> | null;
  /** OPTIONAL: for a `resolve`-mode target, ingest a selection using external
   * CATALOGS (and the current field values, for merges) and return the field
   * patch to apply. Used by the class Proficiencies block + sub-sections, which
   * need the skills/armor/… tables to map names → ids. */
  assignResolve?: (targetKey: string, text: string, ctx: { catalogs: any; values: Record<string, any> }) => Record<string, unknown>;
  /** OPTIONAL · PURE: split a multi-entity paste into per-entity blocks, returning
   * the character offset where each block STARTS (sorted, first = first entity).
   * Empty / length-1 means a single entity. Drives batch import + the manual
   * division editor (which can add/remove these boundaries). */
  splitBlocks?: (text: string) => number[];
}
